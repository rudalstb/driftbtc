// 💥 실시간 강제 청산 (진입 분석 탭): 바이낸스 선물 공개 청산 스트림(!forceOrder@arr)을 브라우저에서 바로 받아 모은다.
// - SELL 청산 = 롱 포지션이 강제로 정리됨, BUY 청산 = 숏 포지션이 정리됨
// - 바이낸스는 코인마다 1초에 가장 큰 1건만 보내 주므로 실제 총액보다 적게 잡힌다 (흐름·쏠림을 보는 용도)
// - 최근 1시간 기록은 이 브라우저에만 저장해, 잠깐 나갔다 와도 이어서 보인다 (서버로 보내지 않음)

// 2026년 바이낸스 선물 웹소켓 주소 개편: 시세·청산 스트림은 /market 경로 (옛 /ws 경로는 연결만 되고 데이터가 안 옴)
const LIQ_WS = "wss://fstream.binance.com/market/ws/!forceOrder@arr";
const LIQ_KEY = "driftbtc_liq";
const LIQ_KEEP_MS = 60 * 60 * 1000;
const LIQ_BIG = 100000; // 이 이상은 목록에서 굵게
let liqWs = null, liqList = [], liqScope = "all", liqStarted = 0, liqRetry = 0, liqTimer = null;

try {
  const s = JSON.parse(localStorage.getItem(LIQ_KEY) || "null");
  if (s && Array.isArray(s.list)) {
    liqList = s.list.filter((x) => Date.now() - x.t < LIQ_KEEP_MS);
    liqStarted = liqList.length ? Math.max(s.started || 0, Date.now() - LIQ_KEEP_MS) : 0;
  }
  liqScope = localStorage.getItem(LIQ_KEY + "_scope") || "all";
} catch (e) {}

function liqSave() {
  try { localStorage.setItem(LIQ_KEY, JSON.stringify({ started: liqStarted, list: liqList.slice(-3000) })); } catch (e) {}
}

function liqConnect() {
  if (liqWs || document.hidden) return;
  try { liqWs = new WebSocket(LIQ_WS); } catch (e) { return; }
  liqWs.onopen = () => { liqRetry = 0; if (!liqStarted) liqStarted = Date.now(); liqRender(); };
  liqWs.onmessage = (ev) => {
    let j;
    try { j = JSON.parse(ev.data); } catch (e) { return; }
    for (const m of Array.isArray(j) ? j : [j]) {
      const o = m?.o;
      if (!o || !o.s) continue;
      const qty = Number(o.z || o.q), price = Number(o.ap || o.p);
      if (!(qty > 0 && price > 0)) continue;
      liqList.push({ t: Number(o.T || m.E || Date.now()), s: o.s, long: o.S === "SELL", usd: qty * price, p: price });
    }
  };
  liqWs.onclose = () => {
    liqWs = null;
    liqRender();
    if (!document.hidden) setTimeout(liqConnect, Math.min(30000, 2000 * 2 ** liqRetry++));
  };
  liqWs.onerror = () => { try { liqWs?.close(); } catch (e) {} };
}

const liqMoney = (v) => (v >= 1e6 ? "$" + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "K" : "$" + Math.round(v));
const liqCoin = (s) => s.replace(/USDT$|USDC$|BUSD$/, "");

function liqSum(list, ms) {
  const from = Date.now() - ms;
  let L = 0, S = 0, n = 0;
  for (const x of list) if (x.t >= from) { n++; if (x.long) L += x.usd; else S += x.usd; }
  return { L, S, n };
}

function liqRender() {
  const box = $("liq-box");
  if (!box) return;
  liqList = liqList.filter((x) => Date.now() - x.t < LIQ_KEEP_MS);
  const list = liqScope === "btc" ? liqList.filter((x) => x.s === "BTCUSDT") : liqList;
  const on = liqWs && liqWs.readyState === 1;
  const mins = liqStarted ? Math.max(1, Math.round((Date.now() - liqStarted) / 60000)) : 0;
  const row = (name, ms) => {
    const { L, S, n } = liqSum(list, ms);
    const tot = L + S, lp = tot ? (L / tot) * 100 : 50;
    return `<div class="liq-row"><span class="muted">${name}</span>` +
      `<div class="liq-bar" title="롱 청산 ${Math.round(lp)}%"><i style="width:${tot ? lp : 0}%"></i><b style="width:${tot ? 100 - lp : 0}%"></b></div>` +
      `<span class="liq-amt"><span class="neg">롱 ${liqMoney(L)}</span> · <span class="pos">숏 ${liqMoney(S)}</span> <span class="muted">${n}건</span></span></div>`;
  };
  // 최근 5분 쏠림 한 줄
  const f5 = liqSum(list, 5 * 60000), big = liqScope === "btc" ? 500000 : 2000000;
  let mood = `<span class="muted">조용해요 — 최근 5분 큰 청산 쏠림 없음</span>`;
  if (f5.L > big && f5.L > 3 * f5.S) mood = `🔻 <b class="neg">롱이 대량으로 털리는 중</b> — 최근 5분 롱 청산 ${liqMoney(f5.L)}. 하락이 연쇄 청산을 부르는 구간, 바닥 잡기는 조심`;
  else if (f5.S > big && f5.S > 3 * f5.L) mood = `🔺 <b class="pos">숏이 대량으로 털리는 중</b> — 최근 5분 숏 청산 ${liqMoney(f5.S)}. 숏 스퀴즈로 급등이 이어질 수 있는 구간, 추격 매수는 조심`;
  else if (f5.L + f5.S > big) mood = `⚡ 양쪽 다 청산이 많아요 (최근 5분 ${liqMoney(f5.L + f5.S)}) — 위아래로 크게 흔드는 중`;
  const recent = list.filter((x) => x.usd >= 1000).slice(-8).reverse().map((x) => {
    const d = new Date(x.t + 9 * 3600 * 1000);
    const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
    return `<tr class="${x.usd >= LIQ_BIG ? "liq-big" : ""}"><td class="muted">${hm}</td><td>${liqCoin(x.s)}</td><td class="${x.long ? "neg" : "pos"}">${x.long ? "롱 청산" : "숏 청산"}</td><td>${liqMoney(x.usd)}</td><td class="muted hide-m">${x.p < 10 ? x.p.toPrecision(4) : Math.round(x.p).toLocaleString("en-US")}</td></tr>`;
  }).join("");
  box.innerHTML =
    `<div class="liq-head"><div class="period" id="liq-scope" role="group"><button data-k="all" aria-pressed="${liqScope === "all"}">🪙 전체 코인</button><button data-k="btc" aria-pressed="${liqScope === "btc"}">₿ 비트코인</button></div>` +
    `<span class="small">${on ? `<span class="pos">● 실시간</span>` : `<span class="muted">○ 연결 중…</span>`} <span class="muted">${mins ? `${mins >= 60 ? "최근 1시간" : mins + "분째"} 집계` : ""}</span></span></div>` +
    `<div class="liq-mood small">${mood}</div>` +
    row("5분", 5 * 60000) + row("15분", 15 * 60000) + row("1시간", 60 * 60000) +
    (recent ? `<div class="table-wrap"><table class="compact liq-table"><thead><tr><th>시각</th><th>코인</th><th>종류</th><th>금액</th><th class="hide-m">가격</th></tr></thead><tbody>${recent}</tbody></table></div><div class="muted small">목록은 $1,000 이상만 · 굵은 줄은 $10만 이상</div>`
      : `<p class="muted small">아직 들어온 청산이 없어요. 시장이 조용하면 몇 분씩 비어 있기도 해요.</p>`) +
    `<p class="muted small">바이낸스 선물 공개 청산 스트림이에요. 롱 청산 = 롱 포지션이 강제로 팔린 것(하락 압력), 숏 청산 = 숏이 강제로 사들여진 것(상승 압력). ` +
    `바이낸스는 코인마다 1초에 가장 큰 1건만 보내 줘서 <b>실제보다 적게</b> 잡혀요. 이 페이지를 연 동안 모으고, 최근 1시간은 이 브라우저에만 저장해요.</p>`;
  box.querySelectorAll("#liq-scope button").forEach((b) => b.addEventListener("click", () => {
    liqScope = b.dataset.k;
    try { localStorage.setItem(LIQ_KEY + "_scope", liqScope); } catch (e) {}
    liqRender();
  }));
}

function liqStart() {
  const card = $("liq-card");
  if (!card) return;
  card.hidden = false;
  liqConnect();
  liqRender();
  if (!liqTimer) liqTimer = setInterval(() => { if (typeof activeTab === "undefined" || activeTab === "market") liqRender(); liqSave(); }, 2000);
}

// 진입 분석 탭을 처음 열 때 연결을 시작하고, 다른 탭에 있어도 계속 모은다 (창을 숨기면 끊고 돌아오면 다시)
document.addEventListener("tabshown", (e) => { if (e.detail === "market") liqStart(); });
if (typeof activeTab !== "undefined" && activeTab === "market") liqStart();
document.addEventListener("visibilitychange", () => {
  if (!liqTimer) return;
  if (document.hidden) { try { liqWs?.close(); } catch (e) {} liqSave(); }
  else liqConnect();
});
