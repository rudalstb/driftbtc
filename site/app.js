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
let titleArrow = "";
let chart = null;

const $ = (id) => document.getElementById(id);
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
const pct = (v, d = 2) => {
  const s = Math.abs(v).toFixed(d);
  return (Number(s) === 0 ? "" : v > 0 ? "+" : "-") + s + "%";
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// 그래프 축용 짧은 시각: 1시간은 "10/12 05시", 그 외는 "10/12" (한국 시간)
function fmtTime(iso, f) {
  const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const md = `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
  return f === "1h" ? `${md} ${String(kst.getUTCHours()).padStart(2, "0")}시` : md;
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
      const prev = live;
      live = parseFloat((await r.json()).price);
      $("live-price").textContent = usd(live);
      // 가격이 그대로면 직전 방향 표시를 유지한다
      if (prev != null && Math.round(prev) !== Math.round(live)) titleArrow = live > prev ? " ▲" : " ▼";
      document.title = `${usd(live)}${titleArrow} · DriftBTC`;
      renderLive();
      return;
    } catch (e) {}
  }
  $("live-price").textContent = "연결 실패";
}

// "얼마나 움직일까?" 카드: 예측 변동성을 매매에 바로 쓰는 숫자로 바꿔 보여준다
// 손절·익절 거리 (주기별)
const TOUCH_LEVELS = { "1h": [0.3, 0.5, 1, 2], "1d": [1, 2, 3, 5], "1w": [3, 5, 10, 15] };
let lastPositions = [];

// 다음 캔들 수익률 표준편차 (68% 상단 = price * exp(0.9945 * sigma))
const nextSigma = (f) => Math.log(f.next.hi68 / f.price) / 0.9945;

// 기간 안에 ±d 거리에 한 번이라도 닿을 확률 (무작위 행보 근사, 반사 원리: 2 × 끝에서 넘어 있을 확률)
const touchProb = (d, sigma) => Math.min(1, 2 * (1 - normCdf(d / sigma)));

function renderMove(f) {
  const n = f.next;
  const s = nextSigma(f);
  const w68 = n.hi68 - f.price, w95 = n.hi95 - f.price;
  $("move68").textContent = `±${usd(w68)} (±${(s * 0.9945 * 100).toFixed(2)}%)`;
  $("move95").textContent = `크게 움직여도 ±${usd(w95)} (±${((n.hi95 / f.price - 1) * 100).toFixed(2)}%) 안이에요 (95%)`;

  // 최근 기록 대비 지금 변동성 수준
  const past = f.history.map((h) => Math.log(h.hi95 / h.lo95) / (2 * 1.96)).filter((v) => v > 0);
  const rank = past.filter((v) => v < s).length / past.length;
  const [badge, cls] = rank < 0.33 ? ["🟢 평소보다 잔잔", "calm"] : rank < 0.67 ? ["🟡 평소 수준", "mid"] : ["🔴 평소보다 요동", "wild"];
  $("vol-badge").textContent = badge;
  $("vol-badge").className = "vol-badge " + cls;

  const levels = TOUCH_LEVELS[freq];
  renderTouchTable(f);
  const safe = levels.find((d) => touchProb(d / 100, s) < 0.2);
  const tight = levels[0];
  $("touch-note").innerHTML =
    `손절을 <b>-${tight}%</b>에 두면 그냥 흔들림에도 걸릴 확률이 <b>${(touchProb(tight / 100, s) * 100).toFixed(0)}%</b>예요.` +
    (safe ? ` 닿을 확률이 20% 아래로 떨어지는 건 <b>±${safe}%</b>부터예요.` : "");
  renderLeverage(f);
}

// 거리별 도달 확률 표: 지금 실시간 가격(없으면 기준가)에서 실제 위·아래 가격을 함께 보여준다
function renderTouchTable(f) {
  const s = nextSigma(f);
  const base = live ?? f.price;
  $("touch-table").innerHTML = TOUCH_LEVELS[freq]
    .map((d) => {
      const p = touchProb(d / 100, s);
      const cls = p >= 0.4 ? "neg" : p >= 0.15 ? "warn" : "pos";
      return `<div class="touch-row">
        <div><b>±${d}%</b><div class="touch-prices"><span class="pos">▲ ${usd(base * (1 + d / 100))}</span> <span class="neg">▼ ${usd(base * (1 - d / 100))}</span></div></div>
        <span class="touch-bar"><i style="width:${(p * 100).toFixed(0)}%"></i></span><b class="${cls}">${(p * 100).toFixed(0)}%</b></div>`;
    })
    .join("");
}

// 보유 중인 BTC 포지션의 레버리지로 '보통 손익 흔들림'을 환산 (없으면 10배 예시)
function renderLeverage(f) {
  const btc = lastPositions.filter((p) => p.symbol === "BTCUSDT");
  const lev = btc.length ? Math.max(...btc.map((p) => p.leverage)) : 10;
  const move = nextSigma(f) * 0.9945 * 100;
  $("lev-line").innerHTML = btc.length
    ? `지금 보유한 BTC 포지션(${lev}배) 기준으로는 보통 손익이 <b>±${(move * lev).toFixed(1)}%</b> 흔들려요.`
    : `${lev}배 레버리지라면 보통 손익이 <b>±${(move * lev).toFixed(1)}%</b> 흔들려요.`;
}

function renderLive() {
  if (!report || live == null) return;
  const f = report.forecasts[freq];
  const diff = (live / f.price - 1) * 100;
  $("live-in-band").innerHTML = `지금 ${usd(live)} · 기준가 ${usd(f.price)} 대비 ${pct(diff)}`;
  renderTouchTable(f);
}

function render() {
  const f = report.forecasts[freq];
  document.querySelectorAll(".unit").forEach((el) => (el.textContent = UNIT[freq]));
  const n = f.next;
  const endFmt = freq === "1h" ? clock : dayClock;
  $("range-end").textContent = `· ${endFmt(new Date(n.t))} KST까지`;
  renderMove(f);

  renderDirection(f);
  renderGame(f);
  $("cover").textContent = `최근 ${f.history.length}개 중 실제 가격이 95% 구간 안: ${(f.recent_cover95 * 100).toFixed(0)}%`;
  renderLive();
  renderChart(f);
  tick();
}

// 표준정규 누적분포 (Abramowitz-Stegun erf 근사)
function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

function renderDirection(f) {
  const n = f.next;
  // 다음 캔들 수익률 표준편차 (68% 상단 = price * exp(0.9945 * sigma))
  const sigma = Math.log(n.hi68 / f.price) / 0.9945;
  // 백테스트상 가장 보정이 잘 된(과신하지 않는) Ridge 기울기를 사용
  const pUp = Math.round(normCdf(f.lean_pct.ridge / 100 / sigma) * 100);
  $("dir-verdict").textContent = Math.abs(pUp - 50) <= 5 ? "사실상 반반" : pUp > 50 ? "약간 상승 쪽" : "약간 하락 쪽";
  $("p-up-bar").style.width = pUp + "%";
  $("p-up").textContent = `상승 ${pUp}%`;
  $("p-down").textContent = `하락 ${100 - pUp}%`;
  $("if-up").textContent = `${usd(n.hi68)} (${pct((n.hi68 / f.price - 1) * 100)})`;
  $("if-down").textContent = `${usd(n.lo68)} (${pct((n.lo68 / f.price - 1) * 100)})`;
  const s = report.summary?.[freq];
  $("dir-note").textContent =
    "비트코인의 방향은 누구도 꾸준히 맞히지 못해요." +
    (s ? ` 과거 3년 검증에서 방향 적중률은 ${(s.ridge.dir_acc * 100).toFixed(0)}% 수준이었어요.` : "") +
    " 대신 얼마나 움직일지는 잘 맞아요.";
}

// 🎲 롱/숏 게임 (실험): 1일·1주만 신호, 1시간은 수수료 때문에 신호 없음
let eqChart = null;

function renderGame(f) {
  const bt = report.signal_backtest?.[freq];
  const sig = report.signals?.[freq];
  const big = $("sig-big");
  const fmt = freq === "1h" ? clock : dayClock;

  if (!sig?.current) {
    big.className = "sig-big none";
    big.textContent = "—";
    $("sig-detail").textContent = "다음 갱신 때 첫 관점이 나와요.";
    $("live-record").textContent = "";
    $("hit-row").innerHTML = "";
  } else {
    const c = sig.current;
    const long = c.signal === "long";
    big.className = "sig-big " + (long ? "long" : "short");
    big.textContent = long ? "🟢 롱" : "🔴 숏";
    const pUp = Math.round(c.p_up * 100);
    $("sig-detail").innerHTML =
      `${long ? "상승" : "하락"} 확률 <b>${long ? pUp : 100 - pUp}%</b> · 기준가 ${usd(c.price)}<br>` +
      `<span class="muted">결과 확인 ${fmt(new Date(c.target))} KST</span>` +
      (freq === "1h" ? `<br><span class="muted">참고용 관점이에요. 매시간 포지션을 바꾸라는 뜻은 아니에요.</span>` : "");

    if (!sig.n) {
      $("live-record").innerHTML = `아직 결과가 나온 관점이 없어요. 첫 결과는 <b>${fmt(new Date(c.target))}</b>에 나와요.`;
      $("hit-row").innerHTML = "";
    } else {
      const streak = sig.streak >= 2 ? ` · ${sig.streak_hit ? "🔥" : "🥶"} ${sig.streak}연속 ${sig.streak_hit ? "적중" : "실패"}` : "";
      const money = (v) => `<b class="${v >= 0 ? "pos" : "neg"}">${pct(v, 1)}</b>`;
      $("live-record").innerHTML =
        `적중 <b>${sig.hits}/${sig.n}</b> (${(sig.hit_rate * 100).toFixed(0)}%)${streak}<br>` +
        (sig.gross_pct != null ? `방향대로 들고 있었다면 ${money(sig.gross_pct)} · ` : "") +
        `매번 바꿨다면 수수료 후 ${money(sig.return_pct)} ` +
        `<span class="muted">(같은 기간 항상 롱 ${pct(sig.always_long_pct, 1)}` +
        (sig.always_short_pct != null ? ` · 항상 숏 ${pct(sig.always_short_pct, 1)}` : "") + `)</span>`;
      $("hit-row").innerHTML = sig.recent
        .map((r) => `<span title="${fmt(new Date(r.t))} ${r.signal === "long" ? "롱" : "숏"} ${pct(r.ret_pct, 2)}">${r.hit ? "✅" : "❌"}</span>`)
        .join("");
    }
  }

  if (!bt) return;
  const ym = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}`; };
  $("bt-period").textContent = `${ym(bt.start)}~${ym(bt.end)}`;
  const cell = (v) => `<td class="${v >= 0 ? "pos" : "neg"}">${pct(v, 0)}</td>`;
  const row = (name, s) =>
    `<tr><td>${name}</td>${cell(s.gross_return_pct ?? s.return_pct)}${cell(s.return_pct)}` +
    `<td>${s.max_drawdown_pct.toFixed(0)}%</td><td>${(s.hit_rate * 100).toFixed(1)}%</td></tr>`;
  $("sig-table").innerHTML =
    `<thead><tr><th></th><th>수수료 전</th><th>수수료 후</th><th>최대 손실 구간</th><th>적중률</th></tr></thead><tbody>` +
    row("관점대로", bt.signal) + row("항상 롱", bt.always_long) + (bt.always_short ? row("항상 숏", bt.always_short) : "") + `</tbody>`;
  const flips = bt.signal.flips.toLocaleString();
  $("sig-note").textContent =
    freq === "1w" && bt.signal.flips === 0
      ? "주간 관점은 과거 3년 내내 '롱'이었어요. 그래서 항상 롱과 결과가 같아요."
      : freq === "1h"
        ? `방향만 보면 수수료 전 ${pct(bt.signal.gross_return_pct, 0)}였지만, 매시간 롱↔숏을 ${flips}번 바꾸면 수수료로 ${pct(bt.signal.return_pct, 0)}가 돼요. 진입 방향 참고용으로만 보세요.`
        : `관점이 롱↔숏으로 ${flips}번 바뀌었어요. 과거 성적이 앞으로도 같다는 보장은 없어요.`;

  const labels = bt.series.map((p) => ym(p.t));
  const data = {
    labels,
    datasets: [
      { label: "관점대로 (수수료 후)", data: bt.series.map((p) => p.signal), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 },
      { label: "항상 롱", data: bt.series.map((p) => p.long), borderColor: css("--up"), borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] },
      ...(bt.series[0]?.short != null
        ? [{ label: "항상 숏", data: bt.series.map((p) => p.short), borderColor: css("--down"), borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] }]
        : []),
    ],
  };
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: css("--muted"), boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (i) => `${i.dataset.label} ${pct((i.raw - 1) * 100, 0)}` } },
    },
    scales: {
      x: { ticks: { color: css("--muted"), maxTicksLimit: 4, maxRotation: 0 }, grid: { display: false } },
      y: { position: "right", ticks: { color: css("--muted"), callback: (v) => pct((v - 1) * 100, 0) }, grid: { color: css("--border") } },
    },
  };
  if (eqChart) eqChart.destroy();
  eqChart = new Chart($("eq-chart"), { type: "line", data, options: opts });
}

// 📊 운영자 실전 포지션: Cloudflare Worker 가 비트겟 조회 전용 키로 읽어 정리한 값을 받는다
const num = (v, d = 2) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => (v < 0 ? "-$" : "$") + num(Math.abs(v));
const signed = (v) => `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${money(v).replace("-", "−")}</span>`;
const sideTag = (s) => `<span class="side-${s}">${s === "long" ? "롱" : "숏"}</span>`;
const copyTag = (p) => (p.source === "copy" ? ` <span class="copy-tag">카피${p.trader ? " · " + p.trader : ""}</span>` : "");
const shortTime = (ms) =>
  new Date(Number(ms)).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
let posUpdated = 0;

async function pollPositions() {
  if (!window.POSITIONS_URL) return;
  try {
    const r = await fetch(window.POSITIONS_URL, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || r.status);
    renderPositions(d);
  } catch (e) {
    $("mp-updated").textContent = "연결 실패, 다시 시도 중…";
  }
}

function renderPositions(d) {
  $("mypos").hidden = false;
  posUpdated = d.updated;
  const a = d.account || {};
  $("mp-equity").textContent = a.equity != null ? money(a.equity) : "—";
  // 카피트레이딩 계좌가 연결돼 있으면 총 자산을 일반 / 카피로 나눠 보여준다
  $("mp-equity-split").textContent =
    d.copy && d.copy.projects?.length && a.main_equity != null ? `일반 ${money(a.main_equity)} · 카피 ${money(d.copy.equity)}` : "";
  renderCopyProjects(d.copy);
  renderSeed(a.equity);
  $("mp-available").textContent = a.available != null ? money(a.available) : "—";
  $("mp-upnl").innerHTML = a.unrealized_pnl != null ? signed(a.unrealized_pnl) : "—";

  const pos = d.positions || [];
  lastPositions = pos;
  if (report) renderLeverage(report.forecasts[freq]);
  // 내 포지션과 카피 포지션을 나눠서 보여준다
  const mine = pos.filter((p) => p.source !== "copy");
  const copied = pos.filter((p) => p.source === "copy");
  renderPosGroup("mp-positions", "mp-positions-m", "mp-pos-sum", mine, false, "지금은 내 포지션이 없어요 (관망 중)");
  renderPosGroup("mp-copypos", "mp-copypos-m", "mp-copypos-sum", copied, true, "지금은 카피 포지션이 없어요");
  $("mp-copypos-wrap").hidden = !d.copy?.projects?.length;

  recentHistory = d.history || [];
  renderHistory();
  renderMonthly();
}

// 🤝 카피트레이딩: 트레이더별 원금 → 현재 금액, 손익과 수익률
// 원금은 비트겟의 누적 투자 금액, config.js 의 COPY_PRINCIPAL 에 값이 있으면 그 값을 쓴다
function renderCopyProjects(copy) {
  const el = $("mp-copy");
  const list = copy?.projects || [];
  if (!list.length) {
    el.innerHTML = "";
    return;
  }
  const override = window.COPY_PRINCIPAL || {};
  let totP = 0, totV = 0, totVKnown = 0, unknown = 0;
  const items = list.map((p) => {
    const principal = override[p.id] ?? p.investment;
    const value = p.value || 0;
    totV += value;
    if (!principal) {
      unknown++;
      return `<div class="copy-item"><b>${p.trader || p.id}</b>
        <span>${money(value)}</span>
        <span class="muted small">원금 정보 없음 <span title="비트겟이 원금을 0으로 줍니다. 원금을 출금한 경우일 수 있어요.">ⓘ</span></span></div>`;
    }
    totP += principal;
    totVKnown += value;
    const pnl = value - principal;
    return `<div class="copy-item"><b>${p.trader || p.id}</b>
      <span class="muted small">원금 ${money(principal)} → <b class="plain">${money(value)}</b></span>
      <span>${signed(pnl)} <span class="${pnl >= 0 ? "pos" : "neg"} small">(${pct((pnl / principal) * 100, 1)})</span></span></div>`;
  });
  const totPnl = totVKnown - totP; // 원금을 아는 트레이더만으로 계산
  const known = list.length - unknown;
  el.innerHTML =
    `<div class="label game-sub">🤝 카피트레이딩 (팔로우 ${list.length}명)</div>` +
    `<div class="copy-total">원금 <b>${money(totP)}</b>${unknown ? `<span class="muted small"> (원금 모르는 ${unknown}명 제외)</span>` : ""} · 현재 <b>${money(totV)}</b>` +
    (known ? ` · 손익 ${signed(totPnl)}` : "") + `</div>` +
    `<div class="copy-list">${items.join("")}</div>`;
}

// 🏁 시드·출금 요약: 총 수익 = 누적 출금 + 현재 자산 − 시드 (값은 config.js 의 OPERATOR)
function renderSeed(equity) {
  const o = window.OPERATOR;
  const box = $("mp-seed");
  if (!o || !o.seed) return;
  box.hidden = false;
  const withdrawn = o.withdrawn || 0;
  let total = "";
  if (equity != null) {
    const profit = withdrawn + equity - o.seed;
    total = `<div class="seed-total">총 수익 ${signed(profit)} <span class="${profit >= 0 ? "pos" : "neg"}">(${pct((profit / o.seed) * 100, 0)})</span>
      <span class="muted small">= 출금 ${usd(withdrawn)} + 현재 자산 ${money(equity)} − 시드 ${usd(o.seed)}</span></div>`;
  }
  box.innerHTML = `<div>🏁 시드 <b>${usd(o.seed)}</b>로 시작 · 누적 출금 <b class="pos">${usd(withdrawn)}</b></div>${total}`;
}

// 🧾 최근 청산 기록: 보관 기록 + 실시간 최근 기록을 합쳐 7일/30일/90일 기간으로 보여준다
let histDays = 7;

function mergedTrades() {
  const all = new Map();
  for (const t of [...archive.trades, ...recentHistory]) {
    if (!t.closed) continue;
    all.set(t.id || `${t.symbol}-${t.closed}`, t);
  }
  return [...all.values()].sort((a, b) => b.closed - a.closed);
}

function renderHistory() {
  const from = Date.now() - histDays * 86400000;
  const hist = mergedTrades().filter((t) => t.closed >= from);
  document.querySelectorAll("#hist-period button").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.days) === histDays));
  const empty = `최근 ${histDays}일 동안 청산 기록이 없어요`;

  $("mp-history").innerHTML = hist.length
    ? `<thead><tr><th>종목</th><th>방향</th><th>진입가</th><th>청산가</th><th>수량</th><th>순손익</th><th>수수료·펀딩</th><th>청산 시각</th></tr></thead><tbody>` +
      hist.map((h) => `<tr><td>${h.symbol}</td><td>${sideTag(h.side)}</td><td>${num(h.entry)}</td><td>${num(h.exit)}</td><td>${h.size}</td>
        <td>${signed(h.net)}</td><td>${money(h.fees)}</td><td>${shortTime(h.closed)}</td></tr>`).join("") +
      `</tbody>` + historyTotal(hist)
    : `<tbody><tr><td class="mp-empty">${empty}</td></tr></tbody>`;

  if (!hist.length) {
    $("mp-history-m").innerHTML = `<div class="mp-empty">${empty}</div>`;
    return;
  }
  const t = historyStats(hist);
  $("mp-history-m").innerHTML =
    `<div class="pcard total"><div class="pcard-head"><div><b>합계 ${hist.length}건</b> · <span class="pos">${t.wins}승</span> <span class="neg">${t.losses}패</span> <span class="muted">(승률 ${t.rate}%)</span></div>
      <div class="pcard-pnl">${signed(t.net)}<span class="muted">수수료 ${money(t.fees)}</span></div></div></div>` +
    hist.map((h) => `<div class="hrow">
        <div><b>${h.symbol}</b> ${sideTag(h.side)}<div class="muted small">${num(h.entry)} → ${num(h.exit)} · ${h.size}</div></div>
        <div class="hrow-r">${signed(h.net)}<div class="muted small">${shortTime(h.closed)}</div></div>
      </div>`).join("");
}

document.querySelectorAll("#hist-period button").forEach((b) =>
  b.addEventListener("click", () => {
    histDays = Number(b.dataset.days);
    renderHistory();
  })
);

// 📅 월별 성적: 저장소에 쌓아 둔 청산 기록(data/trades.json) + 실시간 최근 기록을 합쳐 한국 시간 월 단위로 집계
let archive = { since: null, trades: [] };
let recentHistory = [];

async function loadTrades() {
  try {
    const r = await fetch("data/trades.json?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) archive = await r.json();
  } catch (e) {}
  renderHistory();
  renderMonthly();
}

const kstMonth = (ms) => {
  const d = new Date(Number(ms) + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

function renderMonthly() {
  const all = new Map();
  for (const t of [...archive.trades, ...recentHistory]) if (t.id && t.closed) all.set(t.id, t);
  const el = $("mp-monthly");
  if (!all.size) {
    el.innerHTML = `<div class="mp-empty">기록을 모으는 중이에요</div>`;
    return;
  }
  const months = new Map();
  for (const t of all.values()) {
    const k = kstMonth(t.closed);
    const m = months.get(k) || { n: 0, win: 0, loss: 0, net: 0, fees: 0 };
    m.n++;
    if (t.net > 0) m.win++;
    else if (t.net < 0) m.loss++;
    m.net += t.net || 0;
    m.fees += t.fees || 0;
    months.set(k, m);
  }
  const keys = [...months.keys()].sort().reverse();
  const maxAbs = Math.max(...keys.map((k) => Math.abs(months.get(k).net)), 1);
  const tot = { n: 0, win: 0, loss: 0, net: 0, fees: 0 };
  for (const m of months.values()) for (const k in tot) tot[k] += m[k];
  const rate = (m) => (m.win + m.loss ? Math.round((m.win / (m.win + m.loss)) * 100) + "%" : "—");
  const label = (k) => `${k.slice(0, 4)}년 ${Number(k.slice(5))}월`;
  const bar = (v) => `<span class="mbar"><i class="${v >= 0 ? "up" : "down"}" style="width:${Math.round((Math.abs(v) / maxAbs) * 100)}%"></i></span>`;
  el.innerHTML =
    `<div class="table-wrap"><table class="compact monthly"><thead><tr><th>월</th><th>거래</th><th>승률</th><th>순손익</th><th class="hide-m">수수료·펀딩</th></tr></thead><tbody>` +
    keys.map((k) => {
      const m = months.get(k);
      return `<tr><td>${label(k)}</td><td>${m.n}건 <span class="muted small"><span class="pos">${m.win}승</span> <span class="neg">${m.loss}패</span></span></td>
        <td>${rate(m)}</td><td>${signed(m.net)}${bar(m.net)}</td><td class="hide-m">${money(m.fees)}</td></tr>`;
    }).join("") +
    `</tbody><tfoot><tr class="total-row"><td>전체</td><td>${tot.n}건 <span class="muted small"><span class="pos">${tot.win}승</span> <span class="neg">${tot.loss}패</span></span></td>
      <td>${rate(tot)}</td><td>${signed(tot.net)}</td><td class="hide-m">${money(tot.fees)}</td></tr></tfoot></table></div>`;
  const since = archive.since || Math.min(...[...all.values()].map((t) => t.closed));
  $("mp-monthly-since").textContent = `· ${shortTime(since).split(" ").slice(0, 2).join(" ")}부터 기록 (가장 오래된 달은 일부만 포함)`;
}

// 모바일: 표 대신 포지션 하나당 카드 하나 (가로 스크롤 없음)
const mode = (m) => (m === "isolated" ? "격리" : m === "crossed" ? "교차" : "");
const kv = (k, v) => `<div><span class="muted">${k}</span><b>${v}</b></div>`;

// 포지션 묶음 하나(내 포지션 / 카피 포지션)를 PC 표 + 모바일 카드로 그린다
function renderPosGroup(tableId, cardsId, sumId, list, isCopy, emptyText) {
  const upnl = list.reduce((a, p) => a + (p.upnl || 0), 0);
  $(sumId).innerHTML = list.length ? `· ${list.length}개 · 미실현 ${signed(upnl)}` : "";
  const trader = (p) => (isCopy ? `<td class="muted">${p.trader || "—"}</td>` : "");
  $(tableId).innerHTML = list.length
    ? `<thead><tr><th>종목</th>${isCopy ? "<th>트레이더</th>" : ""}<th>방향</th><th>레버리지</th><th>수량</th><th>진입가</th><th>현재가</th>${isCopy ? "" : "<th>청산가</th>"}<th>증거금</th><th>손익</th><th>수익률</th><th>진입</th></tr></thead><tbody>` +
      list.map((p) => `<tr><td>${p.symbol}</td>${trader(p)}<td>${sideTag(p.side)}</td><td>${p.leverage}x ${mode(p.margin_mode)}</td>
        <td>${p.size}</td><td>${num(p.entry)}</td><td>${p.mark != null ? num(p.mark) : "—"}</td>${isCopy ? "" : `<td>${p.liq ? num(p.liq) : "—"}</td>`}<td>${p.margin != null ? money(p.margin) : "—"}</td>
        <td>${p.upnl != null ? signed(p.upnl) : "—"}</td><td class="${p.roe_pct >= 0 ? "pos" : "neg"}">${p.roe_pct != null ? pct(p.roe_pct, 2) : "—"}</td><td>${p.opened ? shortTime(p.opened) : "—"}</td></tr>`).join("") +
      `</tbody>`
    : `<tbody><tr><td class="mp-empty">${emptyText}</td></tr></tbody>`;
  $(cardsId).innerHTML = list.length
    ? list.map((p) => `<div class="pcard">
        <div class="pcard-head">
          <div><b>${p.symbol}</b> ${sideTag(p.side)} <span class="muted">${p.leverage}x ${mode(p.margin_mode)}</span>${isCopy && p.trader ? `<div class="muted small">${p.trader}</div>` : ""}</div>
          <div class="pcard-pnl">${p.upnl != null ? signed(p.upnl) : "—"}<span class="${p.roe_pct >= 0 ? "pos" : "neg"}">${p.roe_pct != null ? pct(p.roe_pct, 2) : ""}</span></div>
        </div>
        <div class="pcard-grid">
          ${kv("진입가", num(p.entry))}${kv("현재가", p.mark != null ? num(p.mark) : "—")}
          ${isCopy ? "" : kv("청산가", p.liq ? num(p.liq) : "—")}${kv("증거금", p.margin != null ? money(p.margin) : "—")}
          ${kv("수량", p.size)}${kv("진입", p.opened ? shortTime(p.opened) : "—")}
        </div></div>`).join("")
    : `<div class="mp-empty">${emptyText}</div>`;
}

// 최근 청산 기록 합계: 승패, 순손익 합계, 수수료·펀딩 합계
function historyStats(hist) {
  const wins = hist.filter((h) => h.net > 0).length;
  const losses = hist.filter((h) => h.net < 0).length;
  const net = hist.reduce((a, h) => a + (h.net || 0), 0);
  const fees = hist.reduce((a, h) => a + (h.fees || 0), 0);
  const rate = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;
  return { wins, losses, net, fees, rate };
}

function historyTotal(hist) {
  const t = historyStats(hist);
  return `<tfoot><tr class="total-row"><td colspan="5">합계 ${hist.length}건 · <span class="pos">${t.wins}승</span> <span class="neg">${t.losses}패</span> (승률 ${t.rate}%)</td>
    <td>${signed(t.net)}</td><td>${money(t.fees)}</td><td></td></tr></tfoot>`;
}

setInterval(() => {
  if (posUpdated) $("mp-updated").textContent = `${Math.max(0, Math.round((Date.now() - posUpdated) / 1000))}초 전 업데이트`;
}, 1000);

// 그래프에는 최근 구간만 확대해서 보여준다
const PAST = { "1h": 48, "1d": 60, "1w": 52 };
const AHEAD = { "1h": 12, "1d": 14, "1w": 8 };

// 예측 부채꼴 끝에 '오르면 / 내리면' 가격을 직접 적는다
const endLabels = {
  id: "endLabels",
  afterDatasetsDraw(c) {
    const { ctx } = c;
    const items = [[5, "오르면", css("--up")], [4, "내리면", css("--down")]];
    ctx.save();
    ctx.font = "600 12px -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif";
    ctx.textAlign = "right";
    for (const [idx, word, color] of items) {
      const pts = c.getDatasetMeta(idx).data;
      const last = pts[pts.length - 1];
      const v = c.data.datasets[idx].data.at(-1);
      if (!last || v == null) continue;
      ctx.fillStyle = color;
      ctx.textBaseline = idx === 5 ? "bottom" : "top";
      ctx.fillText(`${word} ${usd(v)}`, last.x - 4, last.y + (idx === 5 ? -4 : 4));
    }
    ctx.restore();
  },
};

function renderChart(f) {
  const hist = f.history.slice(-PAST[freq]);
  const fut = f.future.slice(0, AHEAD[freq]);
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
      borderColor: css("--text"), borderWidth: 2.5, tension: 0.15,
      pointRadius: (c) => (c.dataIndex === H - 1 ? 4 : 0), pointBackgroundColor: css("--accent"),
    },
  ];

  // 세로축은 실제 가격과 '가능성 높음(68%)' 범위에 맞춘다 (95% 범위는 잘려도 됨)
  const vals = [...hist.map((h) => h.actual), ...fut.map((p) => p.lo68), ...fut.map((p) => p.hi68)];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const padY = (hi - lo) * 0.08;

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
      x: { ticks: { color: css("--muted"), maxTicksLimit: innerWidth < 720 ? 3 : 8, maxRotation: 0, autoSkipPadding: 16 }, grid: { display: false } },
      y: {
        position: "right",
        min: lo - padY,
        max: hi + padY,
        ticks: { color: css("--muted"), callback: (v) => "$" + (v / 1000).toFixed(v < 1e5 ? 1 : 0) + "k" },
        grid: { color: css("--border") },
      },
    },
  };

  if (chart) chart.destroy();
  chart = new Chart($("chart"), { type: "line", data: { labels, datasets }, options: opts, plugins: [endLabels] });
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
pollPositions();
setInterval(pollPositions, 5000);
if (window.POSITIONS_URL) {
  loadTrades();
  setInterval(loadTrades, 10 * 60 * 1000);
}

// 👀 방문자 수: 브라우저마다 임의의 번호를 하나 만들어 같은 사람을 한 번만 센다 (개인정보 저장 없음)
function visitorId() {
  try {
    let id = localStorage.getItem("driftbtc_vid");
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("driftbtc_vid", id);
    }
    return id;
  } catch (e) {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

async function pingVisit(isNewView) {
  if (!window.VISIT_URL) return;
  try {
    const r = await fetch(`${window.VISIT_URL}?vid=${visitorId()}&view=${isNewView ? 1 : 0}`, { cache: "no-store" });
    const v = await r.json();
    if (!v.enabled || v.error) return;
    const n = (x) => Number(x).toLocaleString("ko-KR");
    $("visitors").hidden = false;
    $("visitors").innerHTML =
      `<span class="dot"></span> 지금 <b>${n(v.online)}</b>명 보는 중 · 오늘 <b>${n(v.today)}</b>명 · 어제 ${n(v.yesterday)}명 · 누적 <b>${n(v.total)}</b>명` +
      ` <span class="muted">(오늘 조회 ${n(v.today_views)}회)</span>`;
  } catch (e) {}
}

pingVisit(true);
// 페이지를 보고 있는 동안 3분마다 '보는 중' 신호 (다른 탭에 가 있으면 보내지 않음)
setInterval(() => {
  if (document.visibilityState === "visible") pingVisit(false);
}, 3 * 60 * 1000);
