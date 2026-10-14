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

// 카피트레이딩 팔로워 계좌: 프로젝트(따라 하는 트레이더)마다 잔고와 포지션을 일반 키로 읽는다
// current-positions 는 마크가격·미실현손익을 주지 않아 공개 시세로 직접 계산한다
const COPY_CACHE_MS = 20000; // 포지션 조회가 초당 1회 제한이라 카피 정보는 20초에 한 번만
let copyCache = { at: 0, data: null };
const lastGood = new Map(); // 프로젝트별 마지막 성공 값 (일시적인 호출 제한 때 대신 보여줌)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 호출 제한(429)이면 잠깐 기다렸다가 다시 시도
async function getRetry(env, path, params, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return await get(env, path, params);
    } catch (e) {
      if (i + 1 >= tries || !/429/.test(String(e.message))) throw e;
      await sleep(1200 * (i + 1));
    }
  }
}

async function markPrices() {
  const res = await fetch(HOST + "/api/v2/mix/market/tickers?productType=USDT-FUTURES");
  const body = await res.json().catch(() => ({}));
  const map = {};
  for (const t of body.data || []) map[t.symbol] = num(t.markPrice) ?? num(t.lastPr);
  return map;
}

async function readCopy(env) {
  const projects = env.COPY_PROJECTS || [];
  if (!projects.length) return null;
  if (copyCache.data && Date.now() - copyCache.at < COPY_CACHE_MS) return copyCache.data;
  const marks = await markPrices().catch(() => ({}));
  const out = { equity: 0, available: 0, unrealized_pnl: 0, projects: [], positions: [], errors: [] };
  for (const [i, id] of projects.entries()) {
    let project, positions;
    try {
      const c = (await getRetry(env, "/api/v3/copy/futures/current-copy", { projectId: id })) || {};
      if (i) await sleep(1100); // current-positions: 초당 1회 제한
      const cp = await getRetry(env, "/api/v3/copy/futures/current-positions", { projectId: id });
      project = {
        id, trader: c.eliteTrader, value: num(c.estValue), available: num(c.available),
        net_profit: num(c.estNetProfit), investment: num(c.currentInvestment), profit_share: num(c.profitShare),
      };
      positions = (cp?.list || []).map((p) => {
        const size = num(p.total), entry = num(p.avgPrice), lev = num(p.leverage) || 1;
        const mark = marks[p.symbol] ?? null;
        const dir = p.posSide === "short" ? -1 : 1;
        const upnl = mark != null && size != null && entry != null ? (mark - entry) * size * dir : null;
        const margin = size != null && entry != null ? (entry * size) / lev : null;
        return {
          source: "copy", trader: c.eliteTrader, symbol: p.symbol, side: p.posSide, size, leverage: lev,
          margin_mode: p.marginMode, entry, mark, liq: null, margin, upnl,
          roe_pct: upnl != null && margin ? (upnl / margin) * 100 : null, opened: num(p.createdTime),
        };
      });
      lastGood.set(id, { project, positions });
    } catch (e) {
      out.errors.push(`${id}: ${String(e.message || e).slice(0, 120)}`);
      // 일시적인 실패면 마지막으로 성공한 값을 대신 쓴다 (팔로우를 끊은 경우엔 이전 값이 없어 건너뜀)
      const prev = lastGood.get(id);
      if (!prev) continue;
      project = { ...prev.project, stale: true };
      positions = prev.positions;
    }
    out.equity += project.value || 0;
    out.available += project.available || 0;
    out.projects.push(project);
    for (const p of positions) {
      if (p.upnl != null) out.unrealized_pnl += p.upnl;
      out.positions.push(p);
    }
  }
  copyCache = { at: Date.now(), data: out };
  return out;
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
          if (copy.projects.length) d.account.equity = (d.account.equity || 0) + copy.equity;
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
