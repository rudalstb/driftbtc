// 달러→원화 환율 + 업비트 원화 가격 중계 (김치 프리미엄 계산·원화 표시용)
// 둘 다 브라우저에서 직접 부르면 막혀서(CORS) 서버에서 받아 전달한다.
//
// 환율 1순위: 야후 파이낸스 USD/KRW (1분 단위), 2순위: open.er-api.com (하루 1번) — 1분 동안 재사용
// 업비트: KRW-BTC·KRW-ETH 현재가 — 3초 동안 재사용
// 나스닥100 선물(NQ=F): 야후 파이낸스 (약 10분 지연) — 30초 동안 재사용

const ORIGIN = "https://rudalstb.github.io";
const CACHE_MS = 60 * 1000;
let cache = { at: 0, fx: null };
const UPBIT_MS = 3000;
let upbitCache = { at: 0, price: null, eth: null };

async function upbitPrice() {
  if (Date.now() - upbitCache.at < UPBIT_MS && upbitCache.price) return upbitCache.price;
  try {
    const r = await fetch("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH");
    const list = await r.json();
    const price = list?.find((x) => x.market === "KRW-BTC")?.trade_price;
    const eth = list?.find((x) => x.market === "KRW-ETH")?.trade_price;
    if (price) upbitCache = { at: Date.now(), price, eth };
  } catch (e) {}
  return upbitCache.price;
}

const NQ_MS = 30 * 1000;
let nqCache = { at: 0, nq: null };

async function nasdaq() {
  if (Date.now() - nqCache.at < NQ_MS && nqCache.nq) return nqCache.nq;
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/NQ%3DF?interval=1m&range=1d", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    if (m?.regularMarketPrice && m?.chartPreviousClose) {
      nqCache = {
        at: Date.now(),
        nq: { price: m.regularMarketPrice, prev: m.chartPreviousClose, time: m.regularMarketTime * 1000 },
      };
    }
  } catch (e) {}
  return nqCache.nq;
}

const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

async function yahoo() {
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1m&range=1d", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const m = (await r.json())?.chart?.result?.[0]?.meta;
  if (!m?.regularMarketPrice) throw new Error("야후 응답 없음");
  return { rate: m.regularMarketPrice, time: m.regularMarketTime * 1000, source: "yahoo" };
}

async function erApi() {
  const r = await fetch("https://open.er-api.com/v6/latest/USD");
  const j = await r.json();
  if (!j?.rates?.KRW) throw new Error("환율 응답 없음");
  return { rate: j.rates.KRW, time: j.time_last_update_unix * 1000, source: "er-api" };
}

export async function GET() {
  if (!cache.fx || Date.now() - cache.at > CACHE_MS) {
    for (const f of [yahoo, erApi]) {
      try {
        cache = { at: Date.now(), fx: await f() };
        break;
      } catch (e) {}
    }
  }
  const [upbit, nq] = await Promise.all([upbitPrice(), nasdaq()]);
  if (!cache.fx && !upbit) return new Response(JSON.stringify({ error: "환율과 업비트 가격을 받지 못했어요" }), { status: 502, headers });
  return new Response(JSON.stringify({ ...(cache.fx || {}), upbit, upbit_eth: upbitCache.eth, nq }), { headers });
}
