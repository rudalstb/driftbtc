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
const HISTORY_CACHE_MS = 60000; // 90일 전체 기록은 1분에 한 번만 새로 받는다
let historyCache = { at: 0, body: null };
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
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch {}
  if (body.code !== "00000") {
    // 원인 파악용: HTTP 상태, 비트겟 코드/메시지, (JSON 이 아니면) 응답 앞부분. 키 값은 들어가지 않는다
    const detail = body.code ? `${body.code} ${body.msg || ""}` : text.replace(/\s+/g, " ").slice(0, 160);
    const err = new Error(`${path}: HTTP ${res.status} ${detail}`.trim());
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

const histUta = (h) => ({
  id: h.positionId, symbol: h.symbol, side: h.posSide, entry: num(h.openPriceAvg), exit: num(h.closePriceAvg),
  size: num(h.closeTotalPos), pnl: num(h.cumRealisedPnl), net: num(h.netProfit),
  fees: cost(h.openFeeTotal, h.closeFeeTotal, h.totalFunding),
  opened: num(h.createdTime), closed: num(h.updatedTime),
});
const histClassic = (h) => ({
  id: h.positionId, symbol: h.symbol, side: h.holdSide, entry: num(h.openAvgPrice), exit: num(h.closeAvgPrice),
  size: num(h.closeTotalPos), pnl: num(h.pnl), net: num(h.netProfit),
  fees: cost(h.openFee, h.closeFee, h.totalFunding),
  opened: num(h.ctime), closed: num(h.utime),
});

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
    history: (hist?.list || []).map(histUta),
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
    history: (hist?.list || []).map(histClassic),
  };
}

// 최근 90일 청산 기록 전체 (월별 성적용)
// 통합 계정: 한 번에 최대 30일 구간, 100건씩 cursor 로 이어 받기
// 기존 계정: 최근 3개월을 100건씩 idLessThan 으로 이어 받기
const DAY = 86400000;

async function historyUtaAll(env) {
  const out = [];
  const now = Date.now();
  for (let end = now; end > now - 89 * DAY; end -= 29 * DAY) {
    const start = Math.max(end - 29 * DAY, now - 89 * DAY);
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      const params = { category: "USDT-FUTURES", startTime: String(start), endTime: String(end), limit: "100" };
      if (cursor) params.cursor = cursor;
      const d = await get(env, "/api/v3/position/history-position", params);
      const list = d?.list || [];
      out.push(...list.map(histUta));
      if (list.length < 100 || !d.cursor || d.cursor === cursor) break;
      cursor = d.cursor;
    }
  }
  return out;
}

async function historyClassicAll(env) {
  const out = [];
  const now = Date.now();
  let idLessThan = "";
  for (let page = 0; page < 30; page++) {
    const params = { productType: "USDT-FUTURES", startTime: String(now - 89 * DAY), endTime: String(now), limit: "100" };
    if (idLessThan) params.idLessThan = idLessThan;
    const d = await get(env, "/api/v2/mix/position/history-position", params);
    const list = d?.list || [];
    out.push(...list.map(histClassic));
    if (list.length < 100 || !d.endId || d.endId === idLessThan) break;
    idLessThan = d.endId;
  }
  return out;
}

async function readHistoryAll(env) {
  if (!mode) await read(env); // 계정 종류부터 확인
  const list = mode === "uta" ? await historyUtaAll(env) : await historyClassicAll(env);
  // 구간 경계에서 겹친 기록 제거 후 최신순 정렬
  const seen = new Set();
  return list
    .filter((h) => (h.id ? !seen.has(h.id) && seen.add(h.id) : true))
    .sort((a, b) => (b.closed || 0) - (a.closed || 0));
}

// 카피트레이딩(엘리트 트레이더) 계좌: 비트겟은 별도의 "Elite trade API key" 로만 읽을 수 있다
const copyEnv = (env) => ({
  BITGET_API_KEY: env.BITGET_COPY_API_KEY,
  BITGET_API_SECRET: env.BITGET_COPY_API_SECRET,
  BITGET_PASSPHRASE: env.BITGET_COPY_PASSPHRASE,
});

async function readCopy(env) {
  if (!env.BITGET_COPY_API_KEY || !env.BITGET_COPY_API_SECRET || !env.BITGET_COPY_PASSPHRASE) return null;
  const ce = copyEnv(env);
  const [pos, overview, transfer] = await Promise.allSettled([
    get(ce, "/api/v3/copy/futures/position-summary"),
    get(ce, "/api/v3/copy/futures/portfolio-overview", { period: "30D" }),
    get(ce, "/api/v3/copy/futures/max-transferable", { coin: "USDT" }),
  ]);
  const errors = [pos, overview, transfer].filter((r) => r.status === "rejected").map((r) => String(r.reason?.message || r.reason));
  const ov = overview.status === "fulfilled" ? overview.value || {} : {};
  const tr = transfer.status === "fulfilled" ? transfer.value || {} : {};
  const list = pos.status === "fulfilled" ? (Array.isArray(pos.value) ? pos.value : pos.value?.list || []) : [];
  const positions = list.map((p) => ({
    source: "copy", symbol: p.symbol, side: p.holdSide, size: num(p.holdSize), leverage: num(p.leverage),
    margin_mode: p.marginMode, entry: num(p.avgPrice), mark: num(p.markPrice), liq: liq(p.liqPrice),
    margin: num(p.margin), upnl: num(p.unrealizedPnl),
    roe_pct: roe(num(p.unrealizedPnl), num(p.margin), num(p.roi)),
    opened: null,
  }));
  const upnl = positions.reduce((a, p) => a + (p.upnl || 0), 0);
  return {
    equity: num(ov.asset),
    available: num(tr.available),
    unrealized_pnl: positions.length ? upnl : 0,
    roi_30d_pct: ov.roi != null ? num(ov.roi) * (Math.abs(num(ov.roi)) <= 5 ? 100 : 1) : null,
    total_profit: num(ov.totalProfit),
    positions,
    errors,
  };
}

async function read(env) {
  let utaError = null;
  if (mode !== "classic") {
    try {
      const d = await readUta(env);
      mode = "uta";
      return d;
    } catch (e) {
      if (mode === "uta") throw e; // 통합 계정으로 확인된 뒤의 오류는 그대로 알린다
      utaError = e;
    }
  }
  try {
    const d = await readClassic(env);
    mode = "classic";
    return d;
  } catch (e) {
    // 두 방식 모두 실패하면 둘 다 보여준다
    throw new Error(utaError ? `[통합] ${utaError.message} | [기존] ${e.message}` : e.message);
  }
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
      // ?history=all : 최근 90일 청산 기록 전체 (월별 성적 보관용)
      if (new URL(request.url).searchParams.get("history") === "all") {
        if (!historyCache.body || Date.now() - historyCache.at > HISTORY_CACHE_MS) {
          const history = await readHistoryAll(env);
          historyCache = { at: Date.now(), body: JSON.stringify({ updated: Date.now(), mode, count: history.length, history }) };
        }
        return new Response(historyCache.body, { headers: cors });
      }
      if (!cache.body || Date.now() - cache.at > CACHE_MS) {
        const d = await read(env);
        let copy = null;
        try {
          copy = await readCopy(env);
        } catch (e) {
          copy = { errors: [String(e.message || e)], positions: [] };
        }
        if (copy) {
          d.positions = [...d.positions.map((p) => ({ source: "main", ...p })), ...copy.positions];
          // 총 자산 = 일반(통합) 계좌 + 카피트레이딩 계좌
          d.account.main_equity = d.account.equity;
          if (copy.equity != null) d.account.equity = (d.account.equity || 0) + copy.equity;
          d.account.unrealized_pnl = (d.account.unrealized_pnl || 0) + (copy.unrealized_pnl || 0);
        }
        cache = { at: Date.now(), body: JSON.stringify({ updated: Date.now(), mode, ...d, copy: copy && { ...copy, positions: undefined } }) };
      }
      return new Response(cache.body, { headers: cors });
    } catch (e) {
      // 오류 메시지에는 비트겟 응답 코드만 담기고 키 값은 들어가지 않는다
      // 어느 지역 Cloudflare 서버에서 요청했는지도 함께 (지역 차단 여부 확인용)
      return new Response(JSON.stringify({ error: String(e.message || e), colo: request.cf?.colo, country: request.cf?.country }), { status: 502, headers: cors });
    }
  },
};
