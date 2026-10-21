// 나스닥100 선물(NQ=F) 캔들 중계 (Vercel 서버리스 함수)
// 야후 파이낸스 차트 API 는 브라우저에서 직접 부르면 막혀서(CORS) 서버에서 받아 전달한다. 약 10~15분 지연 시세.
// GET ?interval=1m|5m|15m|30m|1h|1d|1wk|1mo  → [{time(초), open, high, low, close, volume}, ...] 최근 500개
const ORIGINS = ["https://rudalstb.github.io", "https://btcagentai.com", "https://www.btcagentai.com"];
const pickOrigin = (request) => { const o = request?.headers?.get("origin"); return ORIGINS.includes(o) ? o : ORIGINS[0]; };
const RANGE = { "1m": "5d", "5m": "30d", "15m": "60d", "30m": "60d", "1h": "180d", "1d": "3y", "1wk": "10y", "1mo": "max" };
const CACHE_MS = 15000;
const cache = {}; // interval → { at, body }

export async function GET(request) {
  const headers = {
    "Access-Control-Allow-Origin": pickOrigin(request),
    "Access-Control-Allow-Methods": "GET",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  const iv = new URL(request.url).searchParams.get("interval") || "1h";
  if (!RANGE[iv]) return new Response(JSON.stringify({ error: "지원하지 않는 간격" }), { status: 400, headers });
  const c = cache[iv];
  if (c && Date.now() - c.at < CACHE_MS) return new Response(c.body, { headers });
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/NQ%3DF?interval=${iv}&range=${RANGE[iv]}&includePrePost=true`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) throw new Error(j?.chart?.error?.description || "야후 응답 없음");
    const q = res.indicators?.quote?.[0] || {};
    const out = [];
    (res.timestamp || []).forEach((t, i) => {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], cl = q.close?.[i];
      if (o == null || h == null || l == null || cl == null) return;
      out.push({ time: t, open: o, high: h, low: l, close: cl, volume: q.volume?.[i] || 0 });
    });
    const body = JSON.stringify({ symbol: "NQ=F", interval: iv, delayed: true, candles: out.slice(-500) });
    cache[iv] = { at: Date.now(), body };
    return new Response(body, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers });
  }
}
