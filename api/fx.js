// 달러→원화 환율 중계 (김치 프리미엄 계산·원화 표시용)
//
// 1순위: 야후 파이낸스 USD/KRW (1분 단위, 브라우저에서는 직접 못 불러서 서버에서 받는다)
// 2순위: open.er-api.com (하루 1번 갱신) — 1순위가 실패할 때만
// 1분 동안은 받아 둔 값을 재사용한다.

const ORIGIN = "https://rudalstb.github.io";
const CACHE_MS = 60 * 1000;
let cache = { at: 0, body: null };

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
  if (!cache.body || Date.now() - cache.at > CACHE_MS) {
    let fx = null;
    for (const f of [yahoo, erApi]) {
      try {
        fx = await f();
        break;
      } catch (e) {}
    }
    if (!fx) {
      if (cache.body) return new Response(cache.body, { headers }); // 둘 다 실패하면 마지막 값
      return new Response(JSON.stringify({ error: "환율을 받지 못했어요" }), { status: 502, headers });
    }
    cache = { at: Date.now(), body: JSON.stringify(fx) };
  }
  return new Response(cache.body, { headers });
}
