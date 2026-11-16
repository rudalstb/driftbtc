// 📜 과거와 비교 카드 (진입 분석 탭): site/data/history.json (history.py 가 매시간 갱신, 마감된 일봉 기준)
// 닮은꼴 과거 10개 겹쳐 보기 + 그 뒤 7일·30일 결과, 지금 해당하는 조건별 과거 통계, 고점 대비 낙폭.
// 항상 '평소(모든 날)'와 나란히 보여 주고, 표본이 적거나 차이가 우연 범위면 그렇게 적는다. app.js 의 $, css, usd 를 쓴다.
let histData = null, histChart = null;

const hPct = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}%`);
const hCls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const hDate = (s) => { const [y, m, d] = s.split("-"); return `${y}. ${+m}. ${+d}.`; };

async function loadHistory() {
  if (histData) return renderHistoryCard();
  try {
    const r = await fetch("data/history.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    histData = await r.json();
    renderHistoryCard();
  } catch (e) {}
}

function renderHistoryCard() {
  const d = histData, box = $("hist-box");
  if (!d || !box) return;
  $("history").hidden = false;
  const a = d.analogs, dd = d.drawdown;
  $("hist-asof").textContent = `${hDate(d.as_of)} 마감 기준 · ${d.since.slice(0, 4)}년 이후 ${d.days.toLocaleString()}일`;

  // 1) 고점 대비 낙폭 한 줄
  const ddLine = dd.now > -3
    ? `지금은 최고점(${usd(dd.ath)}) 근처예요.`
    : `최고점 ${usd(dd.ath)}(${hDate(dd.ath_date)}) 대비 <b class="neg">${hPct(dd.now)}</b>, ${dd.days_since_ath}일째 · ` +
      (dd.deeper_count
        ? `이보다 깊게 빠진 적 <b>${dd.deeper_count}번</b>, 이 깊이에서 전고점 회복까지 중간값 <b>${dd.recover_median_days}일</b> (짧게는 ${dd.recover_min_days}일, 길게는 ${dd.recover_max_days}일)`
        : `${d.since.slice(0, 4)}년 이후 이보다 깊게 빠진 적은 없어요`);

  // 2) 닮은꼴 결과 요약
  const sum = (o, b, label) =>
    `<div class="ana-tile"><div class="label">${label} 뒤</div><div class="ana-val">${o.n}번 중 ${Math.round((o.up * o.n) / 100)}번 상승</div>` +
    `<div class="muted small">중간값 <span class="${hCls(o.median)}">${hPct(o.median)}</span> · 최악 ${hPct(o.worst)} · 최고 ${hPct(o.best)}</div>` +
    `<div class="muted small">평소: ${b.up}% 상승 · 중간값 ${hPct(b.median)}</div></div>`;

  const rows = a.items.map((x) =>
    `<tr><td>${hDate(x.date)}</td><td class="hide-m">${usd(x.price)}</td><td>${Math.round(x.corr * 100)}%</td>` +
    `<td class="${hCls(x.fwd7)}">${hPct(x.fwd7)}</td><td class="${hCls(x.fwd30)}">${hPct(x.fwd30)}</td></tr>`).join("");

  // 3) 조건별 통계
  const b = d.baseline;
  const vcls = (v) => (v.includes("오름") ? "pos" : v.includes("내림") ? "neg" : "muted");
  const crow = d.conditions.map((c) =>
    `<tr><td><b>${c.name}</b><div class="muted small">${c.next7.n.toLocaleString()}일${c.next7.n < 30 ? " · 표본 적음" : ""}</div></td>` +
    `<td>${c.next1.up ?? "—"}%<div class="muted small">평소 ${b.next1_up}%</div></td>` +
    `<td>${c.next7.up ?? "—"}%<div class="muted small">평소 ${b.next7_up}%</div></td>` +
    `<td class="hide-m ${hCls(c.next7.median)}">${hPct(c.next7.median)}<div class="muted small">평소 ${hPct(b.next7_median)}</div></td>` +
    `<td><span class="${vcls(c.verdict)}">${c.verdict}</span></td></tr>`).join("");

  box.innerHTML =
    `<p class="hist-dd">${ddLine}</p>` +
    `<div class="label game-sub">🔍 최근 ${a.window}일 흐름과 가장 닮은 과거 ${a.items.length}번</div>` +
    `<div class="hist-chart-wrap"><canvas id="hist-chart"></canvas></div>` +
    `<div class="muted small">주황 굵은 선 = 지금까지 ${a.window}일 · 회색 = 닮은 과거 구간(그날을 0%로 맞춤) · 주황 점선 = 그 뒤 흐름의 중간값</div>` +
    `<div class="ana-tiles hist-tiles">${sum(a.fwd7, a.base7, "7일")}${sum(a.fwd30, a.base30, "30일")}</div>` +
    `<details class="more"><summary>닮은 과거 ${a.items.length}번 자세히</summary><div class="table-wrap"><table class="compact"><thead><tr><th>날짜</th><th class="hide-m">그때 가격</th><th>닮은 정도</th><th>7일 뒤</th><th>30일 뒤</th></tr></thead><tbody>${rows}</tbody></table></div></details>` +
    `<div class="label game-sub">📊 지금 같은 날, 그다음엔?</div>` +
    (d.conditions.length
      ? `<div class="table-wrap"><table class="compact hist-cond"><thead><tr><th>지금 해당하는 조건</th><th>다음 날 상승</th><th>7일 뒤 상승</th><th class="hide-m">7일 뒤 중간값</th><th>판정</th></tr></thead><tbody>${crow}</tbody></table></div>`
      : `<p class="muted small">지금은 눈에 띄는 조건(연속 등락·급등락·큰 낙폭·변동성 극단)이 없어요.</p>`) +
    `<p class="muted small">일수는 조건이 맞았던 날을 모두 센 것이라 붙어 있는 날이 겹쳐 있어요. '판정'은 7일 뒤 상승 비율이 평소와 우연으로 보기 어려울 만큼(표준오차 2배 이상) 다를 때만 다르다고 적어요. 과거 통계는 미래를 보장하지 않고, BTC Agent 의 예측 모델에는 넣지 않았어요.</p>`;
  drawHistChart();
}

function drawHistChart() {
  const a = histData?.analogs, el = $("hist-chart");
  if (!a || !el) return;
  const w = a.window, labels = a.paths[0].map((_, i) => i - w);
  const grey = css("--muted") || "#8b949e", orange = css("--accent") || "#f7931a";
  const datasets = [
    ...a.paths.map((p) => ({ data: p, borderColor: grey + "55", borderWidth: 1, pointRadius: 0, tension: 0.2 })),
    { data: [...Array(w).fill(null), ...a.median_path], borderColor: orange, borderWidth: 2, borderDash: [5, 4], pointRadius: 0 },
    { data: a.now_path, borderColor: orange, borderWidth: 3, pointRadius: 0 },
  ];
  if (histChart) histChart.destroy();
  histChart = new Chart(el, {
    type: "line", data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { ticks: { color: grey, maxTicksLimit: 7, callback: (v, i) => { const n = labels[i]; return n === 0 ? "오늘" : n > 0 ? `+${n}일` : `${n}일`; } }, grid: { color: grey + "22" } },
        y: { ticks: { color: grey, callback: (v) => `${v > 0 ? "+" : ""}${v}%` }, grid: { color: grey + "22" } },
      },
    },
  });
}

document.addEventListener("tabshown", (e) => { if (e.detail === "market") loadHistory(); });
if (typeof activeTab !== "undefined" && activeTab === "market") loadHistory();
