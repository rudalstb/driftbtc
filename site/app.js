// api.binance.com 은 일부 지역(미국 등)에서 차단되므로 시세 전용 도메인으로 대체
const TICKERS = [
  "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
  "https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT",
];
const UNIT = { "1h": "1시간", "1d": "1일", "1w": "1주" };
const MODEL_NAME = { naive: "기준선", drift: "Drift", ridge: "Ridge", lgbm: "LightGBM" };

let report = null;
let freq = "1h";
let live = null;
let titleArrow = "";
let chart = null;

const $ = (id) => document.getElementById(id);
// 💱 표시 통화: 달러(USD) 또는 원화(KRW, 환율 환산). 환율을 아직 못 받았으면 달러로 보여준다
let CUR = "USD";
try {
  if (localStorage.getItem("driftbtc_cur") === "KRW") CUR = "KRW";
} catch (e) {}
let FX = null; // 1달러 = FX 원
const krw = () => CUR === "KRW" && FX;
const usd = (v) => (krw() ? "₩" + Math.round(v * FX).toLocaleString("ko-KR") : "$" + Math.round(v).toLocaleString("en-US"));
// 그래프 축용 짧은 금액: $83.5k / 1.12억
const axisMoney = (v) =>
  krw()
    ? (v * FX >= 1e8 ? (v * FX / 1e8).toFixed(v * FX >= 1e9 ? 1 : 2) + "억" : Math.round(v * FX / 1e4).toLocaleString("ko-KR") + "만")
    : "$" + (v / 1000).toFixed(v < 1e5 ? 1 : 0) + "k";
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
  renderMeta();
  renderTables();
  render();
  document.dispatchEvent(new CustomEvent("reportloaded"));
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
      const j = await r.json();
      live = parseFloat(j.lastPrice ?? j.price);
      if (j.priceChangePercent != null) $("btc-chg").innerHTML = chgTag(Number(j.priceChangePercent));
      $("live-price").textContent = usd(live);
      // 가격이 그대로면 직전 방향 표시를 유지한다
      if (prev != null && Math.round(prev) !== Math.round(live)) titleArrow = live > prev ? " ▲" : " ▼";
      document.title = `${usd(live)}${titleArrow} · BTC Agent`;
      renderLive();
      renderKimp();
      renderCalc();
      return;
    } catch (e) {}
  }
  $("live-price").textContent = "연결 실패";
}

// 🇰🇷 김치 프리미엄 = 업비트 원화 가격 ÷ (바이낸스 달러 가격 × 환율) − 1
let upbit = null;
let upbitEth = null;
let nq = null; // 나스닥100 선물 { price, prev, time }

// 환율과 업비트 가격은 Vercel 중계(api/fx.js)에서 함께 받는다 (업비트를 브라우저에서 직접 부르면 막힘)
async function loadFx() {
  if (!window.FX_URL) return;
  try {
    const r = await fetch(window.FX_URL, { cache: "no-store" });
    const j = await r.json();
    if (j.upbit) upbit = j.upbit;
    if (j.upbit_eth) upbitEth = j.upbit_eth;
    if (j.nq) nq = j.nq;
    if (j.rate) {
      const first = FX == null;
      FX = j.rate;
      if (first && CUR === "KRW") rerenderAll(); // 원화를 골라 둔 상태면 환율을 받자마자 다시 그림
    }
    renderKimp();
    renderEth();
    renderNq();
  } catch (e) {}
}

// 나스닥100 선물: 지수 포인트라 통화 표시와 상관없이 숫자 그대로 (야후 무료 시세라 약 10분 지연)
function renderNq() {
  if (!nq) return;
  const c = (nq.price / nq.prev - 1) * 100;
  $("nq-price").textContent = nq.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $("nq-chg").innerHTML = chgTag(c, "전일 대비");
  const k = new Date(nq.time + 9 * 3600 * 1000);
  const hm = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
  const stale = Date.now() - nq.time > 60 * 60 * 1000; // 1시간 넘게 체결이 없으면 쉬는 시간
  $("nq-time").innerHTML = stale
    ? `<span class="muted">${k.getUTCMonth() + 1}/${k.getUTCDate()} ${hm} 기준<br>지금은 거래 쉬는 시간</span>`
    : `<span class="muted">${hm} 기준<br>약 10분 지연</span>`;
}

// Ξ 이더리움 실시간 시세 한 줄 (예측은 비트코인 전용, 이더리움은 시세만)
let eth = null; // { price, chg }

async function pollEth() {
  for (const host of ["https://api.binance.com", "https://data-api.binance.vision"]) {
    try {
      const r = await fetch(host + "/api/v3/ticker/24hr?symbol=ETHUSDT", { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      eth = { price: Number(j.lastPrice), chg: Number(j.priceChangePercent) };
      renderEth();
      return;
    } catch (e) {}
  }
}

// 카드 제목 옆 24시간 등락률
const chgTag = (c, name = "24시간") => `<span class="muted">${name}</span> <b class="${c >= 0 ? "pos" : "neg"}">${pct(c, 2)}</b>`;

function renderEth() {
  if (!eth) return;
  $("eth-price").textContent = usd(eth.price);
  $("eth-chg").innerHTML = chgTag(eth.chg);
  if (!upbitEth) return;
  let html = `업비트 <b>₩${Math.round(upbitEth).toLocaleString("ko-KR")}</b>`;
  if (FX) {
    const p = (upbitEth / (eth.price * FX) - 1) * 100;
    html += `<br>김프 <b class="${p >= 0 ? "pos" : "neg"}">${pct(p, 2)}</b>`;
  }
  $("eth-kimp").innerHTML = html;
}

// BTC 카드 아래 회색 줄: 환율 · 예측 생성 시각 (10/14 17:33)
function renderMeta() {
  const parts = [];
  if (FX) parts.push(`환율 ₩${FX.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}`);
  if (report) {
    const k = new Date(new Date(report.generated_at).getTime() + 9 * 3600 * 1000);
    const hm = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
    parts.push(`예측 생성 ${k.getUTCMonth() + 1}/${k.getUTCDate()} ${hm}`);
  }
  $("generated").innerHTML = parts.join("<br>");
}

function renderKimp() {
  const el = $("kimp");
  renderMeta();
  if (!upbit) return;
  let html = `업비트 <b>₩${Math.round(upbit).toLocaleString("ko-KR")}</b>`;
  if (FX && live) {
    const p = (upbit / (live * FX) - 1) * 100;
    html += `<br>김프 <b class="${p >= 0 ? "pos" : "neg"}">${pct(p, 2)}</b>`;
  }
  el.innerHTML = html;
}

// 통화를 바꾸면 금액이 들어간 화면을 모두 다시 그린다
let lastPosData = null;
function rerenderAll() {
  document.querySelectorAll("#cur-toggle button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cur === CUR));
  if (live != null) {
    $("live-price").textContent = usd(live);
    document.title = `${usd(live)}${titleArrow} · BTC Agent`;
  }
  if (report) {
    render();
    renderTables();
  }
  if (lastPosData) renderPositions(lastPosData);
  window.renderAnalysis?.(); // 통화가 바뀌면 분석 금액도 다시
  renderKimp();
  renderEth();
  syncCalcInput();
  renderCalc();
  window.renderRisk?.(true);
  window.renderAvg?.(true);
  if (lastFutures) renderFutures(lastFutures);
}

document.querySelectorAll("#cur-toggle button").forEach((b) =>
  b.addEventListener("click", () => {
    CUR = b.dataset.cur;
    try {
      localStorage.setItem("driftbtc_cur", CUR);
    } catch (e) {}
    rerenderAll();
  })
);

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

// 🧭 맨 위 한 줄 요약: 가격 · 오늘 95% 범위 · 신호등 · 1일 관점
function renderBrief() {
  const el = $("brief");
  if (!el || !report) return;
  const f = report.forecasts["1d"];
  const n = f?.next;
  const st = window.filterState;
  const light = st ? { red: "🔴 쉬는 구간", yellow: "🟡 주의 구간", green: "🟢 들어가도 되는 구간" }[st.level] : "⚪ 신호등 확인 중";
  const sig = report.signals?.["1d"]?.current;
  const parts = [
    live != null ? `지금 <b>${usd(live)}</b>` : "",
    n ? `오늘 95% 범위 <b>${usd(n.lo95)} ~ ${usd(n.hi95)}</b>` : "",
    `<a href="#market" class="plain">${light}</a>`,
    sig ? `1일 관점 ${sideTag(sig.signal)}` : "",
  ].filter(Boolean);
  el.innerHTML = parts.join(`<span class="muted"> · </span>`);
}
window.renderBrief = renderBrief;

function renderLive() {
  if (!report || live == null) return;
  renderBrief();
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
  renderBrief();
  renderMove(f);

  renderDirection(f);
  renderGame(f);
  $("cover").textContent = `최근 ${f.history.length}개 중 실제 가격이 95% 구간 안: ${(f.recent_cover95 * 100).toFixed(0)}%`;
  renderLive();
  if ($("chart")) renderChart(f); // 옛 가격 차트 카드는 홈의 실시간 차트로 대체됨
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
        `매번 바꿨다면 비용 후 ${money(sig.return_pct)} ` +
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
    `<thead><tr><th></th><th>비용 전</th><th>비용 후</th><th>최대 손실 구간</th><th>적중률</th></tr></thead><tbody>` +
    row("관점대로", bt.signal) + row("항상 롱", bt.always_long) + (bt.always_short ? row("항상 숏", bt.always_short) : "") + `</tbody>`;
  const flips = bt.signal.flips.toLocaleString();
  const s = bt.signal;
  const costLine = s.cost_fee_pct != null
    ? ` 비용 가정: 수수료 0.05%·슬리피지 0.02%(편도), 펀딩 0.01%/8시간 → 관점대로 했을 때 비용 합계 ${(s.cost_fee_pct + s.cost_slip_pct + s.cost_funding_pct).toFixed(1)}% (수수료 ${s.cost_fee_pct.toFixed(1)} · 슬리피지 ${s.cost_slip_pct.toFixed(1)} · 펀딩 ${s.cost_funding_pct.toFixed(1)}).`
    : "";
  $("sig-note").textContent =
    (freq === "1w" && bt.signal.flips === 0
      ? "주간 관점은 과거 3년 내내 '롱'이었어요. 그래서 항상 롱과 결과가 같아요."
      : freq === "1h"
        ? `방향만 보면 비용 전 ${pct(bt.signal.gross_return_pct, 0)}였지만, 매시간 롱↔숏을 ${flips}번 바꾸면 비용 때문에 ${pct(bt.signal.return_pct, 0)}가 돼요. 진입 방향 참고용으로만 보세요.`
        : `관점이 롱↔숏으로 ${flips}번 바뀌었어요. 과거 성적이 앞으로도 같다는 보장은 없어요.`) + costLine;

  const labels = bt.series.map((p) => ym(p.t));
  const data = {
    labels,
    datasets: [
      { label: "관점대로 (비용 후)", data: bt.series.map((p) => p.signal), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 },
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
  renderPaper();
}

// 💵 가상 계좌: forecast.json 의 paper[freq] (paper.py 가 매시간 1시간 종가로 평가)
let paperChart = null;

function renderPaper() {
  const box = $("paper-box");
  const p = report.paper?.[freq];
  if (!p) {
    box.innerHTML = `<div class="mp-empty">아직 평가할 관점이 없어요. 첫 관점이 나오면 매시간 평가해요.</div>`;
    return;
  }
  const diff = p.return_pct - p.hold_return_pct;
  const c = p.costs;
  const tile = (k, v, sub = "") => `<div class="rk-tile"><div class="label">${k}</div><div class="rk-val">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;
  const lab = (t) => { const d = new Date(new Date(t).getTime() + 9 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const sinceTxt = lab(p.since);
  const tiles =
    tile("지금 자산", `<b>${money(p.equity)}</b>`, `<span class="${p.return_pct >= 0 ? "pos" : "neg"}">${pct(p.return_pct, 2)}</span> · ${sinceTxt}부터`) +
    tile("들고만 있었다면", `<b>${money(p.hold_equity)}</b>`, `<span class="${p.hold_return_pct >= 0 ? "pos" : "neg"}">${pct(p.hold_return_pct, 2)}</span> · 관점 쪽이 <span class="${diff >= 0 ? "pos" : "neg"}">${pct(diff, 2)}p</span>`) +
    tile("최대 낙폭", `<span class="neg">${p.max_drawdown_pct.toFixed(1)}%</span>`, `거래 ${p.trades}번${p.win_rate != null ? ` · 승률 ${Math.round(p.win_rate * 100)}%` : ""}`) +
    tile("낸 비용", `<b>${money(p.cost_total)}</b>`, `수수료 ${money(c.fee)} · 슬리피지 ${money(c.slip)} · 펀딩 ${money(c.funding)}${c.funding < 0 ? " (받음)" : ""}`) +
    (p.filtered ? tile("🚦 필터 적용 시", `<b>${money(p.filtered.equity)}</b>`, `<span class="${p.filtered.return_pct >= 0 ? "pos" : "neg"}">${pct(p.filtered.return_pct, 2)}</span> · 관점대로보다 <span class="${p.filtered.return_pct - p.return_pct >= 0 ? "pos" : "neg"}">${pct(p.filtered.return_pct - p.return_pct, 2)}p</span> · 쉰 시간 ${p.filtered.rest_hours}h`) : "");
  const o = p.open;
  const openLine = o
    ? `<div class="rk-line">지금 ${sideTag(o.side)} 보유 중 · 진입 ${usd(o.entry)} · ${o.hours}시간째 · 평가 <b class="${o.pnl_pct >= 0 ? "pos" : "neg"}">${pct(o.pnl_pct, 2)}</b></div>`
    : "";
  const recent = p.recent?.length
    ? `<div class="paper-recent">${[...p.recent].reverse().map((t) => `<span>${sideTag(t.side)} <span class="muted">${lab(t.open_t)}</span> <b class="${t.pnl_pct >= 0 ? "pos" : "neg"}">${pct(t.pnl_pct, 2)}</b></span>`).join("")}</div>`
    : "";
  box.innerHTML = `<div class="rk-tiles paper-tiles">${tiles}</div>${openLine}` +
    `<details class="more"><summary>자산 곡선 · 최근 거래 · 규칙 보기</summary><div class="eq-wrap"><canvas id="paper-chart"></canvas></div>${recent}` +
    `<div class="muted small">레버리지 1배, 자산 전부를 관점 방향으로. 관점이 바뀔 때만 매매하고 수수료 0.05%·슬리피지 0.02%(편도), 펀딩 0.01%/8시간(롱이 냄)을 가정해요. 실제 체결과는 다를 수 있어요.</div></details>`;

  const data = {
    labels: p.series.map((x) => lab(x.t)),
    datasets: [
      { label: "관점대로", data: p.series.map((x) => x.v), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 },
      { label: "들고만 있기", data: p.series.map((x) => x.hold), borderColor: css("--muted"), borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] },
      ...(p.series[0]?.f != null ? [{ label: "필터 적용 (쉬는 구간엔 현금)", data: p.series.map((x) => x.f), borderColor: css("--up"), borderWidth: 1.5, pointRadius: 0 }] : []),
    ],
  };
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: css("--muted"), boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (i) => `${i.dataset.label} ${money(i.raw)}` } },
    },
    scales: {
      x: { ticks: { color: css("--muted"), maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
      y: { position: "right", ticks: { color: css("--muted"), callback: (v) => money(v) }, grid: { color: css("--border") } },
    },
  };
  if (paperChart) paperChart.destroy();
  paperChart = new Chart($("paper-chart"), { type: "line", data, options: opts });
  window.renderFilter?.();
}

// 📊 운영자 실전 포지션: Cloudflare Worker 가 비트겟 조회 전용 키로 읽어 정리한 값을 받는다
const num = (v, d = 2) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => (krw() ? (v < 0 ? "-₩" : "₩") + Math.round(Math.abs(v) * FX).toLocaleString("ko-KR") : (v < 0 ? "-$" : "$") + num(Math.abs(v)));
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
    if (!lastPosData) {
      // 한 번도 못 받았으면 카드를 비워 둔 채 숨기지 말고 상태를 알려 준다
      $("mypos").hidden = false;
      $("mp-positions-m").innerHTML = `<div class="mp-empty">운영자 계좌 정보를 지금은 받을 수 없어요. 1분 안에 다시 시도해요.</div>`;
      $("mp-positions").innerHTML = `<tbody><tr><td class="mp-empty">운영자 계좌 정보를 지금은 받을 수 없어요. 1분 안에 다시 시도해요.</td></tr></tbody>`;
    }
  }
}

function renderPositions(d) {
  lastPosData = d;
  window.renderRisk?.(true); // 총 자산이 들어오면 리스크 계산기 잔고 기본값으로
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
  window.renderAnalysis?.();
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
// 입금·출금은 비트겟 지갑 기록(data/flows.json, 매시간 저장)에서 자동 집계. 파일이 없으면 config.js 의 OPERATOR 값으로
let flowsData = null; // { updated, records: [{kind, coin, size, fee, t}] }

async function loadFlows() {
  try {
    const r = await fetch("data/flows.json?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) flowsData = await r.json();
  } catch (e) {}
  if (lastPosData) renderSeed(lastPosData.account?.equity);
}

// 설정한 시작일(OPERATOR.since) 이후의 달러 입금·출금 합계
function flowSummary() {
  const o = window.OPERATOR || {};
  if (!flowsData?.records?.length) return null;
  const since = o.since ? Date.parse(o.since) : 0;
  const stable = new Set(["USDT", "USDC", "USD"]);
  const f = { deposits_usd: 0, withdrawals_usd: 0, deposit_n: 0, withdrawal_n: 0, other: 0, last_withdrawal: null, errors: [] };
  for (const r of flowsData.records) {
    if (!r.t || r.t < since) continue;
    if (!stable.has(r.coin)) { f.other++; continue; }
    if (r.kind === "deposit") { f.deposits_usd += r.size; f.deposit_n++; }
    else { f.withdrawals_usd += r.size; f.withdrawal_n++; f.last_withdrawal = Math.max(f.last_withdrawal || 0, r.t); }
  }
  return f;
}

function renderSeed(equity) {
  const o = window.OPERATOR || {};
  const box = $("mp-seed");
  const f = flowSummary();
  const auto = o.autoFlows === true && f && (f.deposits_usd > 0 || f.withdrawals_usd > 0);
  const seed = auto && f.deposits_usd > 0 ? f.deposits_usd : o.seed;
  const withdrawn = auto ? f.withdrawals_usd : o.withdrawn || 0;
  if (!seed) return;
  box.hidden = false;
  const d = (ms) => { const k = new Date(ms + 9 * 3600e3); return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`; };
  let total = "";
  if (equity != null) {
    const profit = withdrawn + equity - seed;
    total = `<div class="seed-total">총 수익 ${signed(profit)} <span class="${profit >= 0 ? "pos" : "neg"}">(${pct((profit / seed) * 100, 0)})</span>
      <span class="muted small">= 누적 출금 ${usd(withdrawn)} + 현재 자산 ${money(equity)} − 누적 입금 ${usd(seed)}</span></div>`;
  }
  const src = auto
    ? `<span class="muted small">· 비트겟 입출금 기록 자동 집계 (입금 ${f.deposit_n}건 · 출금 ${f.withdrawal_n}건${f.last_withdrawal ? ` · 마지막 출금 ${d(f.last_withdrawal)}` : ""})${f.other ? ` · 달러 외 코인 ${f.other}건은 제외` : ""}</span>`
    : `<span class="muted small">· 운영자가 직접 적은 값</span>`;
  box.innerHTML = `<div>🏁 누적 입금 <b>${usd(seed)}</b> · 누적 출금 <b class="pos">${usd(withdrawn)}</b> ${src}</div>${total}`;
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
  loadFlows();
  try {
    const r = await fetch("data/trades.json?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) archive = await r.json();
  } catch (e) {}
  renderHistory();
  renderMonthly();
  window.renderAnalysis?.();
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
        ticks: { color: css("--muted"), callback: (v) => axisMoney(v) },
        grid: { color: css("--border") },
      },
    },
  };

  if (chart) chart.destroy();
  chart = new Chart($("chart"), { type: "line", data: { labels, datasets }, options: opts, plugins: [endLabels] });
}

// 정확도 한눈에 보기: 범위 적중, 방향 적중
function renderAccuracySummary() {
  const s = report.summary;
  const F = ["1h", "1d", "1w"];
  const cards = [];
  if (s) {
    const cover = F.filter((k) => s[k]).map((k) => `<div><span class="muted">${UNIT[k]}</span><b class="pos">${Math.round(s[k].garch_sigma.cover_2sigma * 100)}%</b></div>`).join("");
    cards.push(`<div class="acc-card"><div class="acc-title">✅ 움직이는 범위는 잘 맞아요</div>
      <div class="muted small">"거의 확실한 범위" 안에 실제 가격이 들어온 비율 · 목표 95%</div>
      <div class="acc-nums">${cover}</div><div class="small">100번 중 약 <b>95번</b>은 범위 안에 들어왔어요.</div></div>`);
    const dir = F.filter((k) => s[k]).map((k) => `<div><span class="muted">${UNIT[k]}</span><b>${Math.round(s[k].ridge.dir_acc * 100)}%</b></div>`).join("");
    cards.push(`<div class="acc-card"><div class="acc-title">🎲 오를지 내릴지는 누구도 못 맞혀요</div>
      <div class="muted small">다음에 오를지 내릴지 맞힌 비율 · 50%면 동전 던지기</div>
      <div class="acc-nums">${dir}</div><div class="small">사실상 <b>동전 던지기 수준</b>이에요. 그래서 방향보다 범위를 보세요.</div></div>`);
  }
  const lr = report.live_record;
  if (lr && F.some((k) => lr[k]?.n)) {
    const rows = F.filter((k) => lr[k]?.n).map((k) => {
      const r = lr[k];
      return `<div class="acc-vs"><span class="muted">${UNIT[k]}</span><span>95% 범위 <b class="pos">${Math.round((r.hit95 / r.n) * 100)}%</b> <span class="muted">· 68% ${Math.round((r.hit68 / r.n) * 100)}%</span></span><span class="muted">${r.n}번</span></div>`;
    }).join("");
    const h = lr["1h"];
    const dots = h?.recent?.length
      ? `<div class="live-dots" title="최근 1시간 예측">${h.recent.map((x) => `<i class="d${x.r}"></i>`).join("")}</div>`
      : "";
    const since = h?.since ? new Date(h.since).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }) : "";
    cards.push(`<div class="acc-card"><div class="acc-title">📈 실제 운영 기록</div>
      <div class="muted small">사이트를 연 뒤(${since}부터) 실제로 낸 예측이 범위 안에 들어온 비율 · 매시간 채점</div>
      ${rows}${dots}<div class="muted small">점: 최근 1시간 예측 (초록 68% 안 · 노랑 95% 안 · 빨강 밖)</div></div>`);
  }
  $("acc-summary").innerHTML = cards.join("");
}

function renderTables() {
  renderAccuracySummary();
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
loadFx();
setInterval(loadFx, 10 * 1000); // 업비트 가격 때문에 10초마다 (환율은 서버에서 1분 단위)
document.querySelectorAll("#cur-toggle button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cur === CUR));
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
      `<span class="dot"></span> 지금 <b>${n(v.online)}</b>명 보는 중 · 오늘 <b>${n(v.today)}</b>명 · 어제 ${n(v.yesterday)}명 · 누적 <b>${n(v.total)}</b>명`;
  } catch (e) {}
}

pingVisit(true);
// 페이지를 보고 있는 동안 3분마다 '보는 중' 신호 (다른 탭에 가 있으면 보내지 않음)
setInterval(() => {
  if (document.visibilityState === "visible") pingVisit(false);
}, 3 * 60 * 1000);

// 🎯 "이 가격 될까?" 계산기: 기간별 예측 변동성으로 목표 가격 도달 확률을 계산한다
// 기간 = 예측 주기:캔들 수 (예: "1h:24" = 1시간 예측의 24번째 캔들까지)
let calcTargetUsd = null;

function calcSigma(key) {
  const [fq, k] = key.split(":");
  const f = report?.forecasts?.[fq];
  const p = f?.future?.[Number(k) - 1];
  return p ? Math.log(p.hi68 / f.price) / 0.9945 : null;
}

function renderCalc() {
  const el = $("calc-result");
  $("calc-unit").textContent = krw() ? "(₩)" : "($)";
  if (!report || live == null) {
    el.innerHTML = `<span class="muted">가격을 불러오는 중…</span>`;
    return;
  }
  if (!calcTargetUsd) {
    el.innerHTML = `<span class="muted">목표 가격을 넣거나 위의 % 버튼을 눌러 보세요.</span>`;
    return;
  }
  const sel = $("calc-period");
  const label = sel.options[sel.selectedIndex].text;
  const sigma = calcSigma(sel.value);
  if (!sigma) return;
  const d = Math.log(calcTargetUsd / live);
  const z = Math.abs(d) / sigma;
  // 기간 안에 한 번이라도 닿을 확률 (무작위 행보 근사, 반사 원리) / 기간이 끝났을 때 그 가격 너머에 있을 확률
  const touch = d === 0 ? 1 : Math.min(1, 2 * (1 - normCdf(z)));
  const end = 1 - normCdf(z);
  const up = d >= 0;
  const p = Math.round(touch * 100);
  const [word, cls] = p >= 50 ? ["충분히 가능해요", "pos"] : p >= 20 ? ["가능성 있어요", "warn"] : p >= 5 ? ["쉽지 않아요", "warn"] : ["거의 어려워요", "neg"];
  el.innerHTML =
    `<div class="muted small">지금 ${usd(live)} → 목표 <b>${usd(calcTargetUsd)}</b> (${pct(d * 100, 2)})</div>` +
    `<div class="calc-big"><b>${label}</b> 안에 한 번이라도 닿을 확률 <b class="${cls}">${p}%</b> <span class="${cls}">${word}</span></div>` +
    `<div class="small">${label} 뒤에 그 가격 ${up ? "이상" : "이하"}일 확률 <b>${Math.round(end * 100)}%</b></div>` +
    `<div class="muted small">예측 범위(변동성)로 계산한 근사치예요. 큰 뉴스가 있으면 더 크게 움직일 수 있어요.</div>`;
}

// 통화를 바꾸면 입력칸의 숫자도 그 통화로 바꿔 보여준다
function syncCalcInput() {
  if (calcTargetUsd == null) return;
  $("calc-target").value = krw() ? Math.round(calcTargetUsd * FX) : Math.round(calcTargetUsd);
}

$("calc-target").addEventListener("input", (e) => {
  const v = parseFloat(e.target.value);
  calcTargetUsd = v > 0 ? (krw() ? v / FX : v) : null;
  renderCalc();
});
$("calc-period").addEventListener("change", renderCalc);
document.querySelectorAll("#calc-quick button").forEach((b) =>
  b.addEventListener("click", () => {
    if (live == null) return;
    calcTargetUsd = live * (1 + Number(b.dataset.p) / 100);
    syncCalcInput();
    renderCalc();
  })
);

// 📊 선물 시장 지표 (바이낸스 공개 데이터, 1분마다)
const FAPI = "https://fapi.binance.com";
const getJson = async (path) => (await fetch(FAPI + path, { cache: "no-store" })).json();
let lastFutures = null;

async function loadFutures() {
  try {
    const [prem, oiHist, lsr, top, taker] = await Promise.all([
      getJson("/fapi/v1/premiumIndex?symbol=BTCUSDT"),
      getJson("/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25"),
      getJson("/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1"),
      getJson("/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1"),
      getJson("/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=1h&limit=1"),
    ]);
    renderFutures({ prem, oiHist, lsr: lsr[0], top: top[0], taker: taker[0] });
  } catch (e) {
    // 바이낸스 선물이 막힌 지역·일시 장애: 한 번도 못 받았으면 이유를 보여 준다
    if (!lastFutures) {
      $("futures").hidden = false;
      $("fut-grid").innerHTML = `<div class="mp-empty">선물 지표를 지금은 받을 수 없어요. 바이낸스 선물 접속이 막힌 지역이거나 일시 장애일 수 있어요. 신호등은 변동성·발표 일정만으로 판정합니다.</div>`;
    }
  }
}

function renderFutures(f) {
  lastFutures = f;
  setTimeout(() => window.renderFilter?.(), 0);
  $("futures").hidden = false;
  const fr = Number(f.prem.lastFundingRate) * 100;
  const nextMin = Math.max(0, Math.round((Number(f.prem.nextFundingTime) - Date.now()) / 60000));
  const first = f.oiHist[0], last = f.oiHist[f.oiHist.length - 1];
  const oiBtc = Number(last.sumOpenInterest), oiUsd = Number(last.sumOpenInterestValue);
  const oiChg = (oiBtc / Number(first.sumOpenInterest) - 1) * 100;
  const longP = Number(f.lsr.longAccount) * 100, topLong = Number(f.top.longAccount) * 100;
  const tk = Number(f.taker.buySellRatio);
  const bar = (l) => `<div class="ls-bar"><i style="width:${l.toFixed(1)}%"></i></div><div class="ls-label"><span class="pos">롱 ${l.toFixed(0)}%</span><span class="neg">숏 ${(100 - l).toFixed(0)}%</span></div>`;
  const big = (v) => (krw() ? (v * FX / 1e12).toFixed(1) + "조 원" : "$" + (v / 1e9).toFixed(2) + "B");
  const tiles = [
    {
      t: "펀딩비", v: `<b class="${fr >= 0 ? "pos" : "neg"}">${fr >= 0 ? "+" : ""}${fr.toFixed(4)}%</b>`,
      sub: `다음 정산까지 ${Math.floor(nextMin / 60)}시간 ${nextMin % 60}분`,
      x: fr > 0.03 ? "롱이 숏에게 많이 내는 중 → 롱 과열 주의" : fr > 0 ? "롱이 숏에게 조금 내는 중 (보통 수준)" : fr < -0.01 ? "숏이 롱에게 내는 중 → 숏 과열 주의" : "숏이 롱에게 조금 내는 중",
    },
    {
      t: "미결제약정", v: `<b>${oiBtc.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} BTC</b>`,
      sub: `${big(oiUsd)} · 24시간 <span class="${oiChg >= 0 ? "pos" : "neg"}">${pct(oiChg, 1)}</span>`,
      x: oiChg > 3 ? "새 포지션이 빠르게 늘고 있어요 → 큰 움직임 가능" : oiChg < -3 ? "포지션 정리가 많아요 → 청산·이탈 진행 중" : "포지션 규모가 크게 변하지 않았어요",
    },
    { t: "롱/숏 비율 (전체 계정)", v: bar(longP), x: longP > 65 ? "롱 쏠림이 커요 → 하락 시 연쇄 청산 주의" : longP < 35 ? "숏 쏠림이 커요 → 상승 시 숏 스퀴즈 주의" : "한쪽으로 크게 쏠리지 않았어요" },
    { t: "롱/숏 비율 (상위 트레이더 포지션)", v: bar(topLong), x: "큰손 계좌들의 포지션 방향이에요" },
    {
      t: "매수/매도 체결 비율 (1시간)", v: `<b class="${tk >= 1 ? "pos" : "neg"}">${tk.toFixed(2)}</b>`,
      x: tk >= 1.1 ? "시장가 매수가 강해요" : tk <= 0.9 ? "시장가 매도가 강해요" : "매수·매도가 비슷해요",
    },
  ];
  $("fut-grid").innerHTML = tiles
    .map((x) => `<div class="fut-tile" title="${x.x.replace(/"/g, "'")}"><div class="label">${x.t}</div><div class="fut-val">${x.v}</div>${x.sub ? `<div class="small">${x.sub}</div>` : ""}</div>`)
    .join("");
  $("fut-updated").textContent = new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }) + " 기준";
}

loadFutures();
setInterval(loadFutures, 60 * 1000);
renderCalc();

pollEth();
setInterval(pollEth, 5000);

// ✉️ 문의 메일 링크: 주소를 그대로 적어 두면 스팸 수집기에 긁히므로 열 때 조립한다
document.querySelectorAll("a.mail").forEach((a) => {
  const addr = `${a.dataset.u}@${a.dataset.d}`;
  a.href = `mailto:${addr}?subject=${encodeURIComponent("[BTC Agent] 문의")}`;
  if (!a.textContent.trim()) a.textContent = addr;
});

// ✈️ 텔레그램 채널 버튼 (config.js 의 TELEGRAM_URL 이 있을 때만)
if (window.TELEGRAM_URL) {
  $("tg-link").href = window.TELEGRAM_URL;
  $("tg-link").hidden = false;
}

// 나스닥 시세가 40초 넘게 안 오면 이유를 보여 준다
setTimeout(() => { if (!nq && $("nq-price").textContent === "—") $("nq-time").innerHTML = `<span class="muted">지금은 시세를 받을 수 없어요</span>`; }, 40000);
