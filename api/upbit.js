// 업비트 원화 시세 중계 (Vercel 서버리스 함수). 업비트 거래내역 계산기가 '지금 평가손익'을 낼 때 쓴다.
// 업비트 API 는 브라우저에서 직접 부르면 막혀서(CORS) 서버에서 받아 전달한다. 공개 시세만, 키 없음.
// GET ?markets=KRW-BTC,KRW-XRP (최대 100개) → { prices: { "KRW-BTC": 108903000, ... } }
// &names=1 을 붙이면 원화 마켓 코인 한글 이름도 함께 → { names: { BTC: "비트코인", ... } } (6시간 보관)
const ORIGINS = ["https://rudalstb.github.io", "https://btcagentai.com", "https://www.btcagentai.com"];
const pickOrigin = (request) => { const o = request?.headers?.get("origin"); return ORIGINS.includes(o) ? o : ORIGINS[0]; };
const cache = new Map(); // market → { at, price }
const CACHE_MS = 5000;
let names = null, namesAt = 0;
async function loadNames() {
  if (names && Date.now() - namesAt < 6 * 3600e3) return names;
  try {
    const r = await fetch("https://api.upbit.com/v1/market/all?isDetails=false", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(String(r.status));
    const out = {};
    for (const x of await r.json()) if (x.market.startsWith("KRW-") && x.korean_name) out[x.market.slice(4)] = x.korean_name;
    names = out; namesAt = Date.now();
  } catch (e) {}
  return names || {};
}

export async function GET(request) {
  const headers = { "Access-Control-Allow-Origin": pickOrigin(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const params = new URL(request.url).searchParams;
  const namesP = params.get("names") === "1" ? loadNames() : null;
  const want = [...new Set((new URL(request.url).searchParams.get("markets") || "").split(",").map((m) => m.trim().toUpperCase()))]
    .filter((m) => /^KRW-[A-Z0-9]{1,15}$/.test(m)).slice(0, 100);
  if (!want.length && namesP) return new Response(JSON.stringify({ prices: {}, names: await namesP }), { headers });
  if (!want.length) return new Response(JSON.stringify({ error: "markets 가 필요해요 (예: KRW-BTC)" }), { status: 400, headers });
  const now = Date.now();
  const stale = want.filter((m) => !(cache.get(m) && now - cache.get(m).at < CACHE_MS));
  if (stale.length) {
    // 업비트는 상장되지 않은 마켓이 하나라도 섞이면 전체 요청을 거부하므로, 실패하면 하나씩 다시 받는다
    const fetchMarkets = async (list) => {
      const r = await fetch(`https://api.upbit.com/v1/ticker?markets=${list.join(",")}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) throw new Error(String(r.status));
      for (const x of await r.json()) cache.set(x.market, { at: Date.now(), price: x.trade_price });
    };
    try { await fetchMarkets(stale); }
    catch (e) { await Promise.allSettled(stale.map((m) => fetchMarkets([m]))); }
  }
  const prices = {};
  for (const m of want) if (cache.get(m)) prices[m] = cache.get(m).price;
  const body = { prices, missing: want.filter((m) => !(m in prices)) };
  if (namesP) body.names = await namesP;
  return new Response(JSON.stringify(body), { headers });
}
