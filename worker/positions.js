// DriftBTC 포지션 중계 Cloudflare Worker
//
// 비트겟 "조회 전용" API 키로 USDT-M 선물 포지션 / 자산 / 최근 청산 기록을 읽어
// 사이트가 쓰는 공통 형식으로 정리해 돌려준다. 키는 Worker 의 Secret 에만 있고
// 응답에는 절대 포함하지 않는다.
//
// 필요한 Secret (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets):
//   BITGET_API_KEY, BITGET_API_SECRET, BITGET_PASSPHRASE
// 선택 변수:
//   ALLOW_ORIGIN  (기본값 https://rudalstb.github.io)
//
// 통합 계정(UTA, v3 API)과 기존 계정(Classic, v2 API)을 자동으로 구분한다.

const HOST = "https://api.bitget.com";
const CACHE_MS = 3000; // 방문자가 많아도 비트겟 호출은 3초에 한 번
let cache = { at: 0, body: null };
let mode = null; // "uta" | "classic"

const num = (v) => (v === "" || v == null ? null : Number(v));
const sum = (...vs) => vs.reduce((a, v) => a + (num(v) || 0), 0);

async function sign(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function get(env, path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const ts = Date.now().toString();
  const prehash = ts + "GET" + path + (query ? "?" + query : "");
  const res = await fetch(HOST + path + (query ? "?" + query : ""), {
    headers: {
      "ACCESS-KEY": env.BITGET_API_KEY,
      "ACCESS-SIGN": await sign(env.BITGET_API_SECRET, prehash),
      "ACCESS-TIMESTAMP": ts,
      "ACCESS-PASSPHRASE": env.BITGET_PASSPHRASE,
      "Content-Type": "application/json",
      locale: "en-US",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (body.code !== "00000") {
    const err = new Error(`${path}: ${body.code || res.status} ${body.msg || ""}`.trim());
    err.code = body.code;
    throw err;
  }
  return body.data;
}

const roe = (upnl, margin, fallbackRate) =>
  margin > 0 ? (upnl / margin) * 100 : fallbackRate != null ? fallbackRate * 100 : null;
const liq = (v) => (num(v) > 0 ? num(v) : null);
// 수수료·펀딩은 비트겟이 '빠져나간 금액'을 음수로 준다 → 비용(양수)으로 바꾼다
const cost = (...vs) => -sum(...vs);

async function readUta(env) {
  const [assets, cur, hist] = await Promise.all([
    get(env, "/api/v3/account/assets"),
    get(env, "/api/v3/position/current-position", { category: "USDT-FUTURES" }),
    get(env, "/api/v3/position/history-position", { category: "USDT-FUTURES", limit: "20" }),
  ]);
  const usdt = (assets.assets || []).find((a) => a.coin === "USDT") || {};
  return {
    account: {
      equity: num(assets.accountEquity),
      available: num(usdt.available),
      unrealized_pnl: num(assets.unrealisedPnl),
    },
    positions: (cur?.list || []).map((p) => ({
      symbol: p.symbol, side: p.posSide, size: num(p.total), leverage: num(p.leverage),
      margin_mode: p.marginMode, entry: num(p.avgPrice), mark: num(p.markPrice), liq: liq(p.liquidationPrice),
      margin: num(p.positionBalance), upnl: num(p.unrealisedPnl),
      roe_pct: roe(num(p.unrealisedPnl), num(p.positionBalance), num(p.profitRate)),
      opened: num(p.createdTime),
    })),
    history: (hist?.list || []).map((h) => ({
      symbol: h.symbol, side: h.posSide, entry: num(h.openPriceAvg), exit: num(h.closePriceAvg),
      size: num(h.closeTotalPos), pnl: num(h.cumRealisedPnl), net: num(h.netProfit),
      fees: cost(h.openFeeTotal, h.closeFeeTotal, h.totalFunding),
      opened: num(h.createdTime), closed: num(h.updatedTime),
    })),
  };
}

async function readClassic(env) {
  const [accounts, cur, hist] = await Promise.all([
    get(env, "/api/v2/mix/account/accounts", { productType: "USDT-FUTURES" }),
    get(env, "/api/v2/mix/position/all-position", { productType: "USDT-FUTURES", marginCoin: "USDT" }),
    get(env, "/api/v2/mix/position/history-position", { productType: "USDT-FUTURES", limit: "20" }),
  ]);
  const acc = (accounts || []).find((a) => a.marginCoin === "USDT") || {};
  const positions = (cur || []).map((p) => ({
    symbol: p.symbol, side: p.holdSide, size: num(p.total), leverage: num(p.leverage),
    margin_mode: p.marginMode, entry: num(p.openPriceAvg), mark: num(p.markPrice), liq: liq(p.liquidationPrice),
    margin: num(p.marginSize), upnl: num(p.unrealizedPL),
    roe_pct: roe(num(p.unrealizedPL), num(p.marginSize)),
    opened: num(p.cTime),
  }));
  return {
    account: {
      equity: num(acc.accountEquity),
      available: num(acc.available),
      // 문서 예시에서 unrealizedPL 이 빈 문자열인 경우가 있어 포지션 합계로 대신한다
      unrealized_pnl: num(acc.unrealizedPL) ?? positions.reduce((a, p) => a + (p.upnl || 0), 0),
    },
    positions,
    history: (hist?.list || []).map((h) => ({
      symbol: h.symbol, side: h.holdSide, entry: num(h.openAvgPrice), exit: num(h.closeAvgPrice),
      size: num(h.closeTotalPos), pnl: num(h.pnl), net: num(h.netProfit),
      fees: cost(h.openFee, h.closeFee, h.totalFunding),
      opened: num(h.ctime), closed: num(h.utime),
    })),
  };
}

async function read(env) {
  if (mode !== "classic") {
    try {
      const d = await readUta(env);
      mode = "uta";
      return d;
    } catch (e) {
      if (mode === "uta") throw e; // 통합 계정으로 확인된 뒤의 오류는 그대로 알린다
    }
  }
  const d = await readClassic(env);
  mode = "classic";
  return d;
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "https://rudalstb.github.io",
      "Access-Control-Allow-Methods": "GET",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!env.BITGET_API_KEY || !env.BITGET_API_SECRET || !env.BITGET_PASSPHRASE) {
      return new Response(JSON.stringify({ error: "비트겟 키(Secret)가 설정되지 않았어요" }), { status: 500, headers: cors });
    }
    try {
      if (!cache.body || Date.now() - cache.at > CACHE_MS) {
        const d = await read(env);
        cache = { at: Date.now(), body: JSON.stringify({ updated: Date.now(), mode, ...d }) };
      }
      return new Response(cache.body, { headers: cors });
    } catch (e) {
      // 오류 메시지에는 비트겟 응답 코드만 담기고 키 값은 들어가지 않는다
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: cors });
    }
  },
};
