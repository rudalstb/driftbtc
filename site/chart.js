// 📈 차트 탭: 바이낸스 BTC/USDT 캔들 + 이 사이트의 예측 범위(68%·95%)와 롱/숏 관점 마커를 겹쳐 그린다.
// 라이브러리(TradingView Lightweight Charts, 아파치 2.0)는 탭을 처음 열 때만 불러온다.

const TV_LIB = "https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js";
const TV_INTERVALS = [
  { k: "1m", name: "1분", fq: "1h", sec: 60 },
  { k: "5m", name: "5분", fq: "1h", sec: 300 },
  { k: "15m", name: "15분", fq: "1h", sec: 900 },
  { k: "30m", name: "30분", fq: "1h", sec: 1800 },
  { k: "1h", name: "1시간", fq: "1h", sec: 3600 },
  { k: "4h", name: "4시간", fq: "1h", sec: 14400 },
  { k: "1d", name: "1일", fq: "1d", sec: 86400 },
  { k: "1w", name: "1주", fq: "1w", sec: 604800 },
  { k: "1M", name: "1달", fq: "1w", sec: 2592000 },
];
const WS_HOST = "wss://stream.binance.com:9443/ws";
// 종목: 바이낸스(BTC·ETH)는 웹소켓 실시간, 나스닥100 선물은 야후(약 10~15분 지연)를 15초마다 폴링
const TV_SYMBOLS = {
  btc: { name: "BTC/USDT", src: "binance", pair: "BTCUSDT", stream: "btcusdt", precision: 0, minMove: 1, live: () => live, overlays: true },
  eth: { name: "ETH/USDT", src: "binance", pair: "ETHUSDT", stream: "ethusdt", precision: 2, minMove: 0.01, live: () => eth?.price, overlays: false },
  nq: { name: "나스닥100 선물", src: "yahoo", precision: 2, minMove: 0.25, live: () => null, overlays: false },
};
const YAHOO_IV = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "1h", "1d": "1d", "1w": "1wk", "1M": "1mo" };
const tvActive = () => typeof activeTab !== "undefined" && activeTab === "home"; // 차트는 홈 탭에 있다
let tvSymbol = "btc";
try { tvSymbol = TV_SYMBOLS[localStorage.getItem("driftbtc_tv_sym")] ? localStorage.getItem("driftbtc_tv_sym") : "btc"; } catch (e) {}
const tvSym = () => TV_SYMBOLS[tvSymbol];
const KLINE_HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"];
let tvInterval = "1h";
let tvShow = { band: true, marks: true };
try { tvInterval = localStorage.getItem("driftbtc_tv_iv") || "1h"; } catch (e) {}
let tvChart = null, tvCandles = null, tvVolume = null, tvLines = [];
let tvLoaded = false, tvLoading = null, tvCandleData = [], tvTimer = null;
let tvWs = null, tvWsIv = null, tvWsOk = false;
let tvAuto = true, tvHover = false, tvLastTick = 0, tvFirstLoad = true; // 자동: 최신 봉을 따라가고, 간격을 바꾸면 보기를 초기화
try { tvAuto = localStorage.getItem("driftbtc_tv_auto") !== "0"; } catch (e) {}

function tvLoadLib() {
  if (window.LightweightCharts) return Promise.resolve();
  if (!tvLoading) tvLoading = new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = TV_LIB; s.onload = ok; s.onerror = () => no(new Error("차트 라이브러리를 불러오지 못했어요"));
    document.head.appendChild(s);
  });
  return tvLoading;
}

async function tvFetchKlines(iv) {
  const sym = tvSym();
  if (sym.src === "yahoo") {
    if (!window.NQ_URL) throw new Error("나스닥 캔들 중계 주소가 없어요");
    const r = await fetch(`${window.NQ_URL}?interval=${YAHOO_IV[iv]}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "나스닥 캔들을 받지 못했어요");
    return j.candles;
  }
  for (const host of KLINE_HOSTS) {
    try {
      // 바이낸스는 모르는 인자를 거부하므로 캐시 방지는 cache: "no-store" 로만
      const r = await fetch(`${host}/api/v3/klines?symbol=${sym.pair}&interval=${iv}&limit=500`, { cache: "no-store" });
      if (!r.ok) continue;
      return (await r.json()).map((k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    } catch (e) {}
  }
  throw new Error("캔들 데이터를 받지 못했어요");
}

function tvTheme() {
  return {
    layout: { background: { type: "solid", color: css("--card") }, textColor: css("--muted"), fontFamily: "inherit" },
    grid: { vertLines: { color: css("--border") }, horzLines: { color: css("--border") } },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: css("--border") },
    timeScale: {
      borderColor: css("--border"), timeVisible: true, secondsVisible: false,
      // 라이브러리는 눈금을 UTC 로 찍으므로 한국 시간으로 바꿔 표시한다
      tickMarkFormatter: (t, type) => {
        const d = new Date(t * 1000);
        const kst = new Date(d.getTime() + 9 * 3600e3);
        const hh = String(kst.getUTCHours()).padStart(2, "0"), mm = String(kst.getUTCMinutes()).padStart(2, "0");
        if (type === 0) return `${kst.getUTCFullYear()}년`;
        if (type === 1) return `${kst.getUTCMonth() + 1}월`;
        if (type === 2) return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}`;
        return `${hh}:${mm}`;
      },
    },
    localization: { locale: "ko-KR", timeFormatter: (t) => new Date(t * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) },
    autoSize: true,
  };
}

function tvCreate() {
  const el = $("tv-chart");
  if (tvChart) { tvChart.remove(); tvChart = null; }
  tvChart = LightweightCharts.createChart(el, tvTheme());
  tvCandles = tvChart.addCandlestickSeries({ upColor: css("--up"), downColor: css("--down"), borderVisible: false, wickUpColor: css("--up"), wickDownColor: css("--down"), priceFormat: { type: "price", precision: tvSym().precision, minMove: tvSym().minMove } });
  tvVolume = tvChart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
  tvChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  tvChart.subscribeCrosshairMove((p) => {
    const c = p?.seriesData?.get(tvCandles);
    const leg = $("tv-legend");
    if (!c) { tvHover = false; tvLiveLegend(); return; }
    tvHover = true;
    const chg = ((c.close / c.open - 1) * 100).toFixed(2);
    leg.innerHTML = `시 ${c.open.toLocaleString("en-US")} · 고 ${c.high.toLocaleString("en-US")} · 저 ${c.low.toLocaleString("en-US")} · 종 <b>${c.close.toLocaleString("en-US")}</b> <span class="${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "+" : ""}${chg}%</span>`;
  });
}

// 마우스를 올리지 않았을 때 범례: 현재가 · 마지막 체결 시각 (틱마다 갱신돼서 실시간임이 보인다)
function tvLiveLegend() {
  if (tvHover) return;
  const leg = $("tv-legend");
  const last = tvCandleData[tvCandleData.length - 1];
  if (!leg || !last) return;
  const t = tvLastTick ? new Date(tvLastTick).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) : "";
  const chg = ((last.close / last.open - 1) * 100).toFixed(2);
  leg.innerHTML = `현재 <b>${last.close.toLocaleString("en-US")}</b> <span class="${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "+" : ""}${chg}%</span> <span class="muted">(이번 봉) · 마지막 체결 ${t}</span>`;
}

// 보기 초기화: 최근 봉 120개가 꽉 차게, 오른쪽에 여백 조금
function tvFit() {
  if (!tvChart || !tvCandleData.length) return;
  // 예측 선이 캔들 앞뒤로 시각 점을 더 만들기 때문에 봉 번호가 아니라 '시각'으로 보기 범위를 잡는다
  const iv = TV_INTERVALS.find((x) => x.k === tvInterval);
  const last = tvCandleData[tvCandleData.length - 1].time;
  const ts = tvChart.timeScale();
  ts.resetTimeScale();
  const range = { from: last - 120 * iv.sec, to: last + 8 * iv.sec };
  ts.setVisibleRange(range);
  // 초기화가 한 프레임 뒤에 적용되는 경우가 있어 한 번 더
  requestAnimationFrame(() => { try { ts.setVisibleRange(range); } catch (e) {} });
}

// 자동 따라가기: 새 봉이 생기면 보기 창을 한 칸 오른쪽으로 민다 (확대 정도는 유지)
function tvFollow() {
  if (!tvAuto || !tvChart) return;
  const iv = TV_INTERVALS.find((x) => x.k === tvInterval);
  const last = tvCandleData[tvCandleData.length - 1].time;
  const r = tvChart.timeScale().getVisibleRange();
  if (!r) return tvFit();
  const width = r.to - r.from;
  tvChart.timeScale().setVisibleRange({ from: last + 8 * iv.sec - width, to: last + 8 * iv.sec });
}

function tvSetAuto(on) {
  tvAuto = on;
  try { localStorage.setItem("driftbtc_tv_auto", on ? "1" : "0"); } catch (e) {}
  const b = $("tv-auto");
  if (b) b.setAttribute("aria-pressed", String(on));
  if (on) tvFit();
}

function tvDrawOverlays() {
  for (const l of tvLines) tvChart.removeSeries(l);
  tvLines = [];
  if (!tvCandles) return;
  const iv = TV_INTERVALS.find((x) => x.k === tvInterval);
  const f = report?.forecasts?.[iv.fq];
  const overlays = tvSym().overlays;
  if (overlays && tvShow.band && f) {
    // "2026-10-20 10:00:00+00:00" 처럼 공백이 든 형식도 읽히도록
    const toSec = (t) => Math.floor(new Date(String(t).replace(" ", "T")).getTime() / 1000);
    const nowT = toSec(f.as_of);
    const line = (raw, color, dashed, title) => {
      const data = raw.filter((d) => Number.isFinite(d.time) && Number.isFinite(d.value));
      if (data.length < 2) return;
      const s = tvChart.addLineSeries({ color, lineWidth: dashed ? 1 : 2, lineStyle: dashed ? 2 : 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title });
      s.setData(data);
      tvLines.push(s);
    };
    // 앞으로의 범위: 현재가에서 시작해 퍼져 나가는 4개 선
    const fut = f.future.map((p) => ({ ...p, t: toSec(p.t) }));
    const start = { t: nowT, lo95: f.price, hi95: f.price, lo68: f.price, hi68: f.price };
    const pts = [start, ...fut];
    line(pts.map((p) => ({ time: p.t, value: p.hi95 })), css("--accent"), true, "95% 위");
    line(pts.map((p) => ({ time: p.t, value: p.lo95 })), css("--accent"), true, "95% 아래");
    line(pts.map((p) => ({ time: p.t, value: p.hi68 })), css("--accent"), false, "68% 위");
    line(pts.map((p) => ({ time: p.t, value: p.lo68 })), css("--accent"), false, "68% 아래");
    // 과거에 예측했던 95% 범위 (맞았는지 눈으로 확인)
    const hist = (f.history || []).map((p) => ({ ...p, t: toSec(p.t) })).filter((p) => p.t < nowT);
    if (hist.length) {
      line(hist.map((p) => ({ time: p.t, value: p.hi95 })), "rgba(139,148,158,0.7)", true, "지난 예측 95% 위");
      line(hist.map((p) => ({ time: p.t, value: p.lo95 })), "rgba(139,148,158,0.7)", true, "지난 예측 95% 아래");
    }
  }
  // 롱/숏 관점 마커 (최근 채점된 관점)
  const rec = overlays ? report?.signals?.[iv.fq]?.recent || [] : [];
  if (tvShow.marks && rec.length) {
    const marks = rec.map((r) => {
      const t = Math.floor(new Date(String(r.t).replace(" ", "T")).getTime() / 1000) - iv.sec * (iv.fq === "1h" ? 1 : 0);
      if (!Number.isFinite(t)) return null; // 1시간 관점은 결과 캔들 바로 앞
      // 그 시각이 속한 봉(마지막으로 시작한 봉)에 붙인다 — 달봉처럼 간격이 일정하지 않아도 됨
      let bucket = null;
      for (let i = tvCandleData.length - 1; i >= 0; i--) if (tvCandleData[i].time <= t) { bucket = tvCandleData[i].time; break; }
      if (bucket == null) return null;
      return { time: bucket, position: r.signal === "long" ? "belowBar" : "aboveBar", color: r.signal === "long" ? css("--up") : css("--down"), shape: r.signal === "long" ? "arrowUp" : "arrowDown", text: `${r.signal === "long" ? "롱" : "숏"}${r.hit ? "✓" : "✗"}` };
    });
    const uniq = new Map();
    for (const m of marks) if (m) uniq.set(m.time, m);
    tvCandles.setMarkers([...uniq.values()].sort((a, b) => a.time - b.time));
  } else {
    tvCandles.setMarkers([]);
  }
}

async function tvLoad() {
  const note = $("tv-note");
  try {
    tvCandleData = await tvFetchKlines(tvInterval);
    tvCandles.setData(tvCandleData.map(({ volume, ...c }) => c));
    tvVolume.setData(tvCandleData.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(63,185,80,0.35)" : "rgba(248,81,73,0.35)" })));
    tvDrawOverlays();
    tvLiveLegend();
    if (tvAuto || tvFirstLoad) tvFit();
    tvFirstLoad = false;
    note.textContent = "";
  } catch (e) {
    note.textContent = e.message + (tvSym().src === "binance" ? " (바이낸스 접속이 막힌 지역이면 차트가 안 나올 수 있어요)" : "");
  }
}

// 📡 실시간: 바이낸스 웹소켓(kline 스트림)으로 마지막 봉을 바로바로 갱신. 끊기면 3초 뒤 다시 연결하고, 그동안은 시세 폴링으로 대신
function tvConnect() {
  tvDisconnect();
  const iv = tvInterval;
  tvWsIv = iv;
  if (tvSym().src !== "binance") return; // 나스닥은 폴링
  try {
    tvWs = new WebSocket(`${WS_HOST}/${tvSym().stream}@kline_${iv}`);
  } catch (e) { return; }
  tvWs.onopen = () => { tvWsOk = true; tvStatus(); };
  tvWs.onmessage = (ev) => {
    if (tvWsIv !== tvInterval || !tvCandles) return;
    const k = JSON.parse(ev.data).k;
    if (!k) return;
    const c = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
    const last = tvCandleData[tvCandleData.length - 1];
    const isNew = !last || c.time > last.time;
    if (isNew) tvCandleData.push(c);
    else if (c.time === last.time) Object.assign(last, c);
    else return;
    tvCandles.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
    tvVolume.update({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(63,185,80,0.35)" : "rgba(248,81,73,0.35)" });
    tvLastTick = Date.now();
    tvLiveLegend();
    if (tvAuto && isNew) tvFollow(); // 새 봉이 생기면 보기 창을 따라 민다
  };
  tvWs.onclose = () => { tvWsOk = false; tvStatus(); if (tvActive() && tvWsIv === tvInterval) setTimeout(() => { if (tvActive() && !tvWsOk) tvConnect(); }, 3000); };
  tvWs.onerror = () => { try { tvWs.close(); } catch (e) {} };
}

function tvDisconnect() {
  if (tvWs) { const w = tvWs; tvWs = null; tvWsOk = false; w.onclose = null; try { w.close(); } catch (e) {} }
  tvStatus();
}

function tvStatus() {
  const el = $("tv-live");
  if (el) el.innerHTML = tvWsOk ? `<span class="pos">● 실시간</span>` : tvSym().src === "yahoo" ? `<span class="muted">○ 15초마다 · 야후 시세 약 10~15분 지연</span>` : `<span class="muted">○ 5초마다</span>`;
}

// 🩺 자가 점검(10초마다): 화면의 마지막 봉이 봉 간격 2개 넘게 오래됐으면 데이터를 다시 받고 웹소켓도 다시 연결한다
let tvHealing = false;
async function tvHealthCheck() {
  if (!tvLoaded || !tvActive() || tvHealing) return;
  const iv = TV_INTERVALS.find((x) => x.k === tvInterval);
  const d = tvCandles?.data?.() || [];
  const lastT = d.length ? d[d.length - 1].time : 0;
  // 야후 시세는 원래 10~15분 늦으므로 25분 넘게 멈춘 경우만 이상으로 본다
  const limit = tvSym().src === "yahoo" ? Math.max(2 * iv.sec, 25 * 60) : Math.max(2 * iv.sec, 180);
  const stale = lastT && Date.now() / 1000 - lastT > limit;
  const el = $("tv-stale");
  if (el) el.textContent = stale ? ` · 마지막 봉 ${Math.round((Date.now() / 1000 - lastT) / 60)}분 전 — 다시 받는 중` : "";
  if (!stale) return;
  tvHealing = true;
  try { await tvLoad(); tvConnect(); } finally { tvHealing = false; }
}
setInterval(tvHealthCheck, 10000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && tvLoaded && tvActive()) { tvLoad(); tvConnect(); } });

// 웹소켓이 끊겨 있을 때만: 실시간 가격으로 마지막 캔들을 갱신
function tvTick() {
  if (tvWsOk) return;
  const live = tvSym().live();
  if (!tvCandles || !tvCandleData.length || live == null) return;
  const iv = TV_INTERVALS.find((x) => x.k === tvInterval);
  const last = tvCandleData[tvCandleData.length - 1];
  const bucket = Math.floor(Date.now() / 1000 / iv.sec) * iv.sec;
  if (bucket > last.time) {
    const c = { time: bucket, open: live, high: live, low: live, close: live, volume: 0 };
    tvCandleData.push(c);
    tvCandles.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
  } else {
    last.close = live; last.high = Math.max(last.high, live); last.low = Math.min(last.low, live);
    tvCandles.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close });
  }
  tvLastTick = Date.now();
  tvLiveLegend();
}

async function tvOpen() {
  if (!$("tv-chart")) return;
  if (!tvLoaded) {
    $("tv-note").textContent = "차트를 불러오는 중…";
    try { await tvLoadLib(); } catch (e) { $("tv-note").textContent = e.message; return; }
    tvCreate();
    tvLoaded = true;
    tvBindToolbar();
    clearInterval(tvTimer);
    tvTimer = setInterval(() => { if (tvActive()) tvTick(); }, 5000);
    setInterval(() => { if (tvActive() && !tvWsOk && tvSym().src !== "yahoo") tvLoad(); }, 60000); // 웹소켓이 없을 때만 다시 받기
    setInterval(() => { if (tvActive() && tvSym().src === "yahoo") tvLoad(); }, 15000); // 나스닥은 15초마다
  }
  await tvLoad();
  tvConnect();
}

function tvApplySymbolUi() {
  const sym = tvSym();
  document.querySelectorAll("#tv-sym button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sym === tvSymbol));
  $("tv-title").textContent = `📈 ${sym.name} 차트`;
  $("tv-toggles").hidden = !sym.overlays; // 예측 범위·관점은 비트코인 전용
  const b4 = document.querySelector('#tv-iv button[data-iv="4h"]');
  if (b4) b4.title = sym.src === "yahoo" ? "나스닥은 4시간봉이 없어 1시간봉으로 보여줘요" : "";
}

function tvSetSymbol(k) {
  if (!TV_SYMBOLS[k]) return;
  tvSymbol = k;
  try { localStorage.setItem("driftbtc_tv_sym", k); } catch (e) {}
  tvApplySymbolUi();
  tvCandles.applyOptions({ priceFormat: { type: "price", precision: tvSym().precision, minMove: tvSym().minMove } });
  tvCandles.setData([]); tvVolume.setData([]); tvCandleData = [];
  tvFirstLoad = true;
  tvLoad().then(tvConnect);
}

function tvBindToolbar() {
  document.querySelectorAll("#tv-sym button").forEach((b) => b.addEventListener("click", () => tvSetSymbol(b.dataset.sym)));
  tvApplySymbolUi();
  document.querySelectorAll("#tv-iv button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.iv === tvInterval);
    b.addEventListener("click", () => {
      tvInterval = b.dataset.iv;
      try { localStorage.setItem("driftbtc_tv_iv", tvInterval); } catch (e) {}
      document.querySelectorAll("#tv-iv button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.iv === tvInterval));
      tvFirstLoad = true; // 간격을 바꾸면 보기를 항상 초기화
      tvLoad().then(tvConnect);
    });
  });
  $("tv-auto")?.addEventListener("click", () => tvSetAuto(!tvAuto));
  tvSetAuto(tvAuto);
  const el = $("tv-chart");
  const manual = () => { if (tvAuto) { tvAuto = false; try { localStorage.setItem("driftbtc_tv_auto", "0"); } catch (e) {} $("tv-auto")?.setAttribute("aria-pressed", "false"); } };
  el.addEventListener("wheel", manual, { passive: true });
  el.addEventListener("pointerdown", manual);
  el.addEventListener("touchstart", manual, { passive: true });
  document.querySelectorAll("#tv-toggles input").forEach((c) => {
    c.checked = tvShow[c.dataset.key];
    c.addEventListener("change", () => { tvShow[c.dataset.key] = c.checked; tvDrawOverlays(); });
  });
}

document.addEventListener("tabshown", (e) => {
  if (e.detail === "home") { tvOpen(); if (tvLoaded && tvAuto) setTimeout(tvFit, 120); }
  else if (tvLoaded) tvDisconnect();
});
// 페이지를 차트 탭으로 바로 열었을 때 (탭 초기화가 이 스크립트보다 먼저 끝남)
if (typeof activeTab !== "undefined" && tvActive()) tvOpen();
// 예측이 새로 오면 겹쳐 그린 선도 갱신
document.addEventListener("reportloaded", () => { if (tvLoaded && tvActive()) tvDrawOverlays(); });
// 밝은/어두운 테마가 바뀌면 색도 다시
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { if (tvLoaded) { tvCreate(); tvLoad(); } });
