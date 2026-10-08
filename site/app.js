// api.binance.com 은 일부 지역(미국 등)에서 차단되므로 시세 전용 도메인으로 대체
const TICKERS = [
  "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
  "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
];
const UNIT = { "1h": "1시간", "1d": "1일", "1w": "1주" };
const MODEL_NAME = { naive: "기준선", drift: "Drift", ridge: "Ridge", lgbm: "LightGBM" };

let report = null;
let freq = "1h";
let live = null;
let chart = null;

const $ = (id) => document.getElementById(id);
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
const pct = (v, d = 2) => {
  const s = Math.abs(v).toFixed(d);
  return (Number(s) === 0 ? "" : v > 0 ? "+" : "-") + s + "%";
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function fmtTime(iso, f) {
  const opts = { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" };
  if (f === "1h") Object.assign(opts, { hour: "2-digit", hourCycle: "h23" });
  return new Date(iso).toLocaleString("ko-KR", opts).replace(/\s/g, " ");
}

// GitHub Actions 가 목표 시각 5분 뒤(cron "5 * * * *")에 실행된다
const RUN_DELAY_MS = 5 * 60 * 1000;
const CYCLE = { "1h": "매시간 갱신", "1d": "매일 09:00 KST 갱신", "1w": "매주 월요일 09:00 KST 갱신" };

function clock(d) {
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function dayClock(d) {
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function remaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분 ${String(s % 60).padStart(2, "0")}초`;
}

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 ${m % 60}분 전` : `${Math.floor(h / 24)}일 전`;
}

function tick() {
  if (!report) return;
  const f = report.forecasts[freq];
  const now = Date.now();
  const start = new Date(f.as_of).getTime();
  const end = new Date(f.next.t).getTime();
  const scheduled = end + RUN_DELAY_MS;
  const fmt = freq === "1h" ? clock : dayClock;

  const el = $("next-update");
  if (now < scheduled) {
    el.textContent = remaining(scheduled - now);
    el.classList.remove("overdue");
    $("next-update-at").textContent = `${fmt(new Date(scheduled))} KST 예정`;
  } else {
    el.textContent = "갱신 중…";
    el.classList.add("overdue");
    $("next-update-at").textContent = "GitHub 실행을 기다리는 중입니다. 보통 몇 분 안에 끝나며, 자동으로 불러옵니다.";
  }
  $("last-update").textContent = ago(now - new Date(report.generated_at).getTime());
  $("cycle").textContent = CYCLE[freq];

  const p = Math.min(1, Math.max(0, (now - start) / (end - start)));
  $("progress-bar").style.width = (p * 100).toFixed(2) + "%";
  $("progress-start").textContent = `기준 ${fmt(new Date(start))}`;
  $("progress-end").textContent = now < end ? `결과 확인 ${fmt(new Date(end))}` : "결과 확정, 새 예측 대기";
}

async function loadReport() {
  // GitHub Pages CDN 캐시를 피하기 위해 쿼리 문자열을 붙인다
  const r = await fetch("data/forecast.json?t=" + Date.now(), { cache: "no-store" });
  const next = await r.json();
  if (report && next.generated_at === report.generated_at) return;
  report = next;
  $("generated").textContent = "예측 생성 " + new Date(report.generated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST";
  renderTables();
  render();
}

// 갱신 예정 시각이 지났으면 1분마다, 아니면 5분마다 새 예측을 확인한다
async function pollReport() {
  try {
    await loadReport();
  } catch (e) {}
  // 매 실행마다 모든 주기가 함께 갱신되므로 가장 잦은 1시간 기준으로 판단
  const f = report?.forecasts["1h"];
  const overdue = f && Date.now() > new Date(f.next.t).getTime() + RUN_DELAY_MS;
  setTimeout(pollReport, overdue ? 60 * 1000 : 5 * 60 * 1000);
}

async function pollLive() {
  for (const url of TICKERS) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      live = parseFloat((await r.json()).price);
      $("live-price").textContent = usd(live);
      renderLive();
      return;
    } catch (e) {}
  }
  $("live-price").textContent = "연결 실패";
}

function renderLive() {
  if (!report || live == null) return;
  const f = report.forecasts[freq];
  const diff = (live / f.price - 1) * 100;
  $("live-vs-anchor").innerHTML = `실시간 가격은 기준가 대비 <span class="${diff >= 0 ? "pos" : "neg"}">${pct(diff)}</span>`;
  const n = f.next;
  let where;
  if (live < n.lo95 || live > n.hi95) where = "실시간 가격이 95% 구간 <b>밖</b>에 있습니다";
  else if (live < n.lo68 || live > n.hi68) where = "실시간 가격이 68~95% 구간에 있습니다";
  else where = "실시간 가격이 68% 구간 안에 있습니다";
  $("live-in-band").innerHTML = where;
}

function render() {
  const f = report.forecasts[freq];
  document.querySelectorAll(".unit").forEach((el) => (el.textContent = UNIT[freq]));
  $("as-of").textContent = fmtTime(f.as_of, freq === "1h" ? "1h" : "1d") + " KST";
  $("anchor").textContent = usd(f.price);
  const n = f.next;
  const w95 = ((n.hi95 / f.price - 1) * 100).toFixed(2);
  const w68 = ((n.hi68 / f.price - 1) * 100).toFixed(2);
  $("r95").textContent = `${usd(n.lo95)} ~ ${usd(n.hi95)}  (±${w95}%)`;
  $("r68").textContent = `${usd(n.lo68)} ~ ${usd(n.hi68)}  (±${w68}%)`;

  for (const m of ["lgbm", "ridge"]) {
    const v = f.lean_pct[m];
    const el = $("lean-" + m);
    el.textContent = pct(v, 3);
    el.className = Number(v.toFixed(3)) === 0 ? "" : v > 0 ? "pos" : "neg";
  }
  const s = report.summary?.[freq];
  $("lean-note").textContent = s
    ? `백테스트 방향 적중률 ${(s.lgbm.dir_acc * 100).toFixed(1)}%. 기준선보다 유의하게 낫지 않으므로 참고만 하세요.`
    : "";
  $("cover").textContent = `최근 ${f.history.length}개 중 실제 가격이 95% 구간 안: ${(f.recent_cover95 * 100).toFixed(0)}%`;
  renderLive();
  renderChart(f);
  tick();
}

function renderChart(f) {
  const hist = f.history;
  const fut = f.future;
  const labels = [...hist.map((h) => h.t), ...fut.map((p) => p.t)].map((t) => fmtTime(t, freq));
  const H = hist.length;
  const pad = (n) => Array(n).fill(null);
  // 예측 부채꼴은 마지막 실제 가격(기준가)에서 시작
  const fan = (key) => [...pad(H - 1), f.price, ...fut.map((p) => p[key])];

  const datasets = [
    { data: [...hist.map((h) => h.lo95), ...pad(fut.length)], borderWidth: 0, pointRadius: 0 },
    { data: [...hist.map((h) => h.hi95), ...pad(fut.length)], borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: css("--past") },
    { data: fan("lo95"), borderWidth: 0, pointRadius: 0 },
    { data: fan("hi95"), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: css("--band95") },
    { data: fan("lo68"), borderWidth: 0, pointRadius: 0 },
    { data: fan("hi68"), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: css("--band68") },
    { data: fan("mid"), borderColor: css("--accent"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 },
    {
      label: "실제", data: [...hist.map((h) => h.actual), ...pad(fut.length)],
      borderColor: css("--text"), borderWidth: 2, pointRadius: 0, tension: 0.15,
    },
  ];

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: (item) => item.raw != null && [1, 3, 5, 7].includes(item.datasetIndex),
        callbacks: {
          label: (item) => {
            const i = item.dataIndex;
            if (item.datasetIndex === 7) return `실제 ${usd(item.raw)}`;
            if (item.datasetIndex === 1) return `95% 구간 ${usd(hist[i].lo95)} ~ ${usd(hist[i].hi95)}`;
            const p = fut[i - H];
            if (!p) return null;
            if (item.datasetIndex === 3) return `예측 95% ${usd(p.lo95)} ~ ${usd(p.hi95)}`;
            return `예측 68% ${usd(p.lo68)} ~ ${usd(p.hi68)}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: css("--muted"), maxTicksLimit: innerWidth < 720 ? 4 : 8, maxRotation: 0 }, grid: { display: false } },
      y: {
        position: "right",
        ticks: { color: css("--muted"), callback: (v) => "$" + (v / 1000).toFixed(v < 1e5 ? 1 : 0) + "k" },
        grid: { color: css("--border") },
      },
    },
  };

  if (chart) chart.destroy();
  chart = new Chart($("chart"), { type: "line", data: { labels, datasets }, options: opts });
}

function renderTables() {
  const s = report.summary;
  if (s) {
    const rows = ["1h", "1d", "1w"].filter((k) => s[k]).map((k) => {
      const r = s[k];
      const mapes = ["naive", "ridge", "lgbm"].map((m) => r[m].mape_pct);
      const best = Math.min(...mapes);
      const cells = mapes.map((v) => `<td class="${v === best ? "best" : ""}">${v.toFixed(3)}%</td>`).join("");
      return `<tr><td>${UNIT[k]}</td>${cells}
        <td>${(r.lgbm.dir_acc * 100).toFixed(1)}%</td>
        <td>${r.lgbm.dm_p.toFixed(2)}</td>
        <td>${(r.garch_sigma.cover_2sigma * 100).toFixed(1)}%</td>
        <td>${r.n.toLocaleString()}</td></tr>`;
    });
    $("bt-table").innerHTML = `<thead><tr><th>주기</th><th>기준선 MAPE</th><th>Ridge</th><th>LightGBM</th>
      <th>방향 적중</th><th>DM p</th><th>95% 구간 포함</th><th>표본</th></tr></thead><tbody>${rows.join("")}</tbody>`;
    $("bt-note").textContent = "DM p: 기준선과 오차 차이가 우연인지 검정한 p값 (0.05 미만이어야 유의). 95% 구간 포함: GARCH 95% 구간 안에 실제 가격이 들어간 비율 (목표 95%).";
  }
  const c = report.btcgpt_compare;
  if (c) {
    const rows = ["1h", "1d", "1w"].filter((k) => c[k]).map((k) => {
      const r = c[k];
      const vals = ["btcgpt", "naive", "ridge", "lgbm"].map((m) => r[m]);
      const best = Math.min(...vals);
      return `<tr><td>${UNIT[k]}</td>${vals.map((v) => `<td class="${v === best ? "best" : ""}">${v.toFixed(3)}%</td>`).join("")}<td>${r.n}</td></tr>`;
    });
    $("cmp-table").innerHTML = `<thead><tr><th>주기</th><th>btcgpt.info</th><th>기준선</th><th>Ridge</th><th>LightGBM</th><th>표본</th></tr></thead><tbody>${rows.join("")}</tbody>`;
  }
}

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    freq = b.dataset.freq;
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
    render();
  })
);

pollReport().then(pollLive);
setInterval(pollLive, 5000);
setInterval(tick, 1000);
