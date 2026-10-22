// 📸 시장 지표 스냅샷 (Vercel 서버리스 함수, 서울 리전). GitHub Actions(collector.py)가 매시간 불러 저장한다.
// 바이낸스 선물 API 는 미국 서버에서 막히므로 여기서 대신 받는다. 키 없이 공개 데이터만.
const ORIGINS = ["https://rudalstb.github.io", "https://btcagentai.com", "https://www.btcagentai.com"];
const pickOrigin = (request) => { const o = request?.headers?.get("origin"); return ORIGINS.includes(o) ? o : ORIGINS[0]; };
const FAPI = "https://fapi.binance.com";
const J = async (url, opt) => { const r = await fetch(url, { ...opt, headers: { "User-Agent": "Mozilla/5.0", ...(opt?.headers || {}) } }); if (!r.ok) throw new Error(`${url.split("?")[0]} ${r.status}`); return r.json(); };
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e.message || e) }; } };

export async function GET(request) {
  const headers = { "Access-Control-Allow-Origin": pickOrigin(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const [prem, oi, lsr, top, taker, spotB, cb, fng, dvol, opts, upbit, fx] = await Promise.all([
    safe(() => J(`${FAPI}/fapi/v1/premiumIndex?symbol=BTCUSDT`)),
    safe(() => J(`${FAPI}/fapi/v1/openInterest?symbol=BTCUSDT`)),
    safe(() => J(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1`)),
    safe(() => J(`${FAPI}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1`)),
    safe(() => J(`${FAPI}/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=1h&limit=1`)),
    safe(() => J(`https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT`)),
    safe(() => J(`https://api.exchange.coinbase.com/products/BTC-USD/ticker`)),
    safe(() => J(`https://api.alternative.me/fng/?limit=1&format=json`)),
    safe(() => J(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=3600&start_timestamp=${Date.now() - 7200e3}&end_timestamp=${Date.now()}`)),
    safe(() => J(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option`)),
    safe(() => J(`https://api.upbit.com/v1/ticker?markets=KRW-BTC`)),
    safe(() => J(`https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1m&range=1d`)),
  ]);
  // 옵션: 풋/콜 미결제약정 비율 (데리빗 전체 만기 합)
  let pcr = null, optOi = null;
  if (Array.isArray(opts.result)) {
    let c = 0, p = 0;
    for (const o of opts.result) { const oi = Number(o.open_interest) || 0; if (/-C$/.test(o.instrument_name)) c += oi; else if (/-P$/.test(o.instrument_name)) p += oi; }
    pcr = c ? p / c : null; optOi = c + p;
  }
  const dv = Array.isArray(dvol.result?.data) && dvol.result.data.length ? dvol.result.data[dvol.result.data.length - 1][4] : null;
  const fxRate = fx?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  const spot = Number(spotB.price) || null, cbp = Number(cb.price) || null, up = upbit?.[0]?.trade_price ?? null;
  const out = {
    t: Date.now(),
    price: spot,
    mark: Number(prem.markPrice) || null,
    funding: prem.lastFundingRate != null ? Number(prem.lastFundingRate) : null,
    oi_btc: Number(oi.openInterest) || null,
    ls_all_long: lsr?.[0]?.longAccount != null ? Number(lsr[0].longAccount) : null,
    ls_top_long: top?.[0]?.longAccount != null ? Number(top[0].longAccount) : null,
    taker_ratio: taker?.[0]?.buySellRatio != null ? Number(taker[0].buySellRatio) : null,
    coinbase_premium_pct: spot && cbp ? (cbp / spot - 1) * 100 : null,
    kimp_pct: spot && up && fxRate ? (up / (spot * fxRate) - 1) * 100 : null,
    fng: fng?.data?.[0]?.value != null ? Number(fng.data[0].value) : null,
    dvol: dv != null ? Number(dv) : null,
    opt_pcr: pcr,
    opt_oi_btc: optOi,
    errors: Object.entries({ prem, oi, lsr, top, taker, spotB, cb, fng, dvol, opts, upbit, fx }).filter(([, v]) => v?.error).map(([k, v]) => `${k}: ${v.error}`),
  };
  return new Response(JSON.stringify(out), { headers });
}
