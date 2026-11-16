// 📜 과거와 비교 카드 (진입 분석 탭): site/data/history.json (history.py 가 매시간 갱신, 마감된 일봉 기준)
// 닮은꼴 과거 10개 겹쳐 보기 + 그 뒤 7일·30일 결과, 지금 해당하는 조건별 과거 통계, 고점 대비 낙폭.
// 항상 '평소(모든 날)'와 나란히 보여 주고, 표본이 적거나 차이가 우연 범위면 그렇게 적는다. app.js 의 $, css, usd 를 쓴다.
// 같은 파일에서 🗓 발표 일정과 과거 반응(CPI·FOMC), 🇰🇷 김치 프리미엄 역사 카드도 그린다.
let histData = null, histChart = null, kimpChart = null;

const hPct = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}%`);
const hCls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const hDate = (s) => { const [y, m, d] = s.split("-"); return `${y}. ${+m}. ${+d}.`; };

async function loadHistory() {
  if (!histData) {
    try {
      const r = await fetch("data/history.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      histData = await r.json();
    } catch (e) { return; }
  }
  renderEventsCard();
  renderHistoryCard();
  renderKimpCard();
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

// 🗓 발표 일정과 과거 반응
function renderEventsCard() {
  const e = histData?.events, box = $("ev-box");
  if (!e || !e.cpi || !box) return;
  $("events-card").hidden = false;
  const kst = (iso) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const until = (iso) => {
    const h = (new Date(iso) - Date.now()) / 3600e3;
    return h < 0 ? `<span class="warn">방금 발표 · 반응 중</span>` : h < 24 ? `<span class="warn">${Math.round(h)}시간 뒤</span>` : `${Math.round(h / 24)}일 뒤`;
  };
  const up = (e.upcoming || []).map((u) => {
    const s = u.kind && e[u.kind];
    return `<li><b>${u.name}</b>${u.note ? ` <span class="muted small">(${u.note})</span>` : ""} · ${kst(u.t)} · ${until(u.t)}` +
      (s ? `<div class="muted small">지난 ${s.n}번: 발표 뒤 ${e.hours}시간 동안 보통 ±${s.abs_median}% 움직임 (평소 같은 시각 ±${s.base_abs_median}%의 <b>${s.ratio}배</b>)</div>` : "") + `</li>`;
  }).join("");
  const row = (k) => {
    const s = e[k];
    return `<tr><td><b>${s.name}</b><div class="muted small">${s.since.slice(0, 4)}년 이후 ${s.n}번</div></td>` +
      `<td>±${s.abs_median}%<div class="muted small">평소 ±${s.base_abs_median}%</div></td>` +
      `<td><b>${s.ratio}배</b></td>` +
      `<td>${s.big_share}%<div class="muted small">평소 ${s.base_big_share}%</div></td>` +
      `<td class="hide-m">${s.up}%</td></tr>`;
  };
  const recent = (k) => e[k].recent.slice(0, 8).map((r) => `<span class="ev-chip ${hCls(r.move)}">${r.date.slice(2).replace(/-/g, ".")} ${hPct(r.move)}</span>`).join("");
  const big = (k) => e[k].biggest.map((r) => `${hDate(r.date)} <span class="${hCls(r.move)}">${hPct(r.move)}</span>`).join(" · ");
  box.innerHTML =
    (up ? `<div class="label">다가오는 발표 (한국 시간)</div><ul class="ev-list">${up}</ul>` : "") +
    `<div class="label game-sub">과거 발표 때 비트코인 (발표 뒤 ${e.hours}시간)</div>` +
    `<div class="table-wrap"><table class="compact"><thead><tr><th>발표</th><th>보통 움직임</th><th>평소 대비</th><th>2% 넘게 움직인 비율</th><th class="hide-m">오른 비율</th></tr></thead><tbody>${row("cpi")}${row("fomc")}</tbody></table></div>` +
    `<div class="ev-recent"><span class="muted small">최근 CPI</span>${recent("cpi")}</div>` +
    `<div class="ev-recent"><span class="muted small">최근 FOMC</span>${recent("fomc")}</div>` +
    `<p class="muted small">가장 크게 움직인 날 — CPI: ${big("cpi")} / FOMC: ${big("fomc")}</p>` +
    `<p class="muted small">'보통 움직임'은 발표가 든 1시간 봉의 시가부터 ${e.hours}시간 뒤 종가까지 변동폭(절댓값)의 중간값이고, '평소'는 발표가 없던 같은 요일·같은 시각의 값이에요. 오른 비율은 50% 근처라 방향은 미리 알기 어렵고, <b>평소보다 크게 움직인다는 점</b>만 일관돼요. 발표 일정은 미국 노동통계국·연준 공식 일정 기준이에요.</p>`;
}

// 🇰🇷 김치 프리미엄 역사
function renderKimpCard() {
  const k = histData?.kimp, box = $("kh-box");
  if (!k || !box) return;
  $("kimp-hist").hidden = false;
  $("kh-asof").textContent = `${hDate(k.as_of)} 마감 기준 · ${k.since.slice(0, 4)}년 이후 ${k.days.toLocaleString()}일`;
  const rows = k.buckets.map((b) =>
    `<tr class="${b.now ? "kh-now" : ""}"><td><b>${b.name}</b>${b.now ? ' <span class="chip-now">지금</span>' : ""}<div class="muted small">${b.days.toLocaleString()}일 · 따로 떨어진 구간 ${b.episodes}번</div></td>` +
    `<td>${b.up ?? "—"}%<div class="muted small">평소 ${k.base.up}%</div></td>` +
    `<td class="${hCls(b.median)}">${hPct(b.median)}<div class="muted small">평소 ${hPct(k.base.median)}</div></td></tr>`).join("");
  const hot = k.buckets.find((b) => b.name.startsWith("5%"));
  box.innerHTML =
    `<p class="kh-line">어제 마감 김프 <b class="${k.now >= 5 ? "neg" : ""}">${hPct(k.now, 2)}</b> · ${k.since.slice(0, 4)}년 이후 날들 중 <b>상위 ${Math.max(1, 100 - k.now_rank)}%</b> 수준 (전체 중간값 ${hPct(k.median, 2)}, 최근 1년 평균 ${hPct(k.avg_1y, 2)})</p>` +
    `<div class="hist-chart-wrap"><canvas id="kh-chart"></canvas></div>` +
    `<p class="muted small">역대 최고: ${k.peaks.map((p) => `${hDate(p.date)} <b>${hPct(p.v, 1)}</b>`).join(" · ")} · 최저: ${hDate(k.min.date)} ${hPct(k.min.v, 1)} · 빨간 점선 = +5%</p>` +
    `<div class="label game-sub">김프 구간별, 그 뒤 ${k.fwd}일 비트코인</div>` +
    `<div class="table-wrap"><table class="compact"><thead><tr><th>김프 구간</th><th>${k.fwd}일 뒤 상승 비율</th><th>${k.fwd}일 뒤 중간값</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p class="muted small">김프 = 업비트 원화 가격 ÷ (바이낸스 달러 가격 × 원·달러 환율) − 1, 한국 시간 오전 9시 마감 일봉 기준. 환율 마감 시각이 조금 달라 하루 값에 ±1%p 정도 오차가 있어요. 같은 구간의 날은 서로 붙어 있어서(예: '5% 이상' ${hot ? hot.days : ""}일은 ${hot ? hot.episodes : ""}번의 구간) 독립된 사례는 '구간' 수만큼이라고 보는 게 정확해요. 과거 통계는 미래를 보장하지 않아요.</p>`;
  const el = $("kh-chart");
  const grey = css("--muted") || "#8b949e", orange = css("--accent") || "#f7931a";
  if (kimpChart) kimpChart.destroy();
  kimpChart = new Chart(el, {
    type: "line",
    data: { labels: k.weekly.t, datasets: [
      { data: k.weekly.v, borderColor: orange, borderWidth: 1.5, pointRadius: 0, fill: { target: { value: 0 }, above: orange + "33", below: "rgba(63,185,80,0.25)" } },
      { data: k.weekly.t.map(() => 5), borderColor: "#f85149", borderWidth: 1, borderDash: [4, 4], pointRadius: 0 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false, filter: (c) => c.datasetIndex === 0, callbacks: { label: (c) => `김프 ${hPct(c.parsed.y, 2)}` } } },
      scales: {
        x: { ticks: { color: grey, maxTicksLimit: 9, callback: (v, i) => k.weekly.t[i].slice(0, 4) }, grid: { display: false } },
        y: { ticks: { color: grey, callback: (v) => `${v}%` }, grid: { color: grey + "22" } },
      },
    },
  });
}

document.addEventListener("tabshown", (e) => { if (e.detail === "market") loadHistory(); });
if (typeof activeTab !== "undefined" && activeTab === "market") loadHistory();
