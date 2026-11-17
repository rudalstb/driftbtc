// 🎯 이번 주 범위 맞히기 (Vercel 서버리스 함수 + Redis)
//
// 방문자가 "이번 주 비트코인 종가가 들어올 범위"를 고르고, 주가 끝나면 AI(사이트의 1주 68% 예측 범위)와 같은 잣대로 채점한다.
// - 주(週): 월요일 09:00 KST(= 00:00 UTC)에 시작, 다음 월요일 09:00 KST 의 가격(바이낸스 BTCUSDT 주봉 종가)이 정답
// - 참가 마감: 수요일 09:00 KST (시작 뒤 48시간). 마감 전에는 몇 번이든 고칠 수 있다
// - 점수: 종가가 범위 안이면 100 × (AI 범위 폭 ÷ 내 범위 폭), 최대 300 / 밖이면 0. AI 자신은 맞히면 100
// 로그인·닉네임 없이 익명. 브라우저가 만든 임의 번호(vid)의 해시로만 구분하고 IP 는 저장하지 않는다 (도배 방지용 주간 해시만).
//
// GET  ?vid=...            → 이번 주 상태(마감·참가 수·내 범위·AI 범위) + 지난주 결과(정답·순위 10위·내 순위)
// POST {vid, lo, hi}       → 이번 주 범위 제출/수정
import { createHash } from "node:crypto";
import { redisConfig, redis } from "../lib/redis.js";

const ORIGINS = ["https://rudalstb.github.io", "https://btc.rudals.app"];
const pickOrigin = (request) => { const o = request?.headers?.get("origin"); return ORIGINS.includes(o) ? o : ORIGINS[0]; };
const headers = (request) => ({
  "Access-Control-Allow-Origin": pickOrigin(request),
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
});
const json = (request, body, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(request) });

const H = 3600 * 1000, D = 24 * H, W = 7 * D;
const OPEN_MS = 48 * H;          // 참가 마감: 주 시작 뒤 48시간
const TTL = 120 * 86400;         // 기록 보관 120일
const MAX_SCORE = 300;
const FORECAST = "https://btc.rudals.app/data/forecast.json";
const BINANCE = ["https://data-api.binance.vision", "https://api.binance.com"];
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const validVid = (v) => /^[a-zA-Z0-9]{8,40}$/.test(v || "");

// 이번 주 월요일 00:00 UTC (ms)
function weekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // 월=0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * D;
}
const wkId = (ms) => new Date(ms).toISOString().slice(0, 10);

async function binance(path) {
  for (const h of BINANCE) {
    try {
      const r = await fetch(h + path, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

// AI 범위: 이번 주 시작 시점의 사이트 1주 예측(68%)을 처음 본 값으로 고정 저장
async function ensureAi(cfg, wk) {
  const key = `week:${wkId(wk)}:ai`;
  const [have] = await redis(cfg, [["GET", key]]);
  if (have) return JSON.parse(have);
  try {
    const r = await fetch(FORECAST + "?t=" + Date.now(), { cache: "no-store" });
    const f = (await r.json())?.forecasts?.["1w"];
    if (!f || Date.parse(f.as_of) !== wk) return null; // 아직 이번 주 예측이 안 나옴
    const ai = { lo: f.next.lo68, hi: f.next.hi68, price: f.price };
    await redis(cfg, [["SET", key, JSON.stringify(ai), "NX", "EX", TTL]]);
    return ai;
  } catch {
    return null;
  }
}

const parseEntries = (raw) => {
  const out = [];
  if (!raw) return out;
  const pairs = Array.isArray(raw) ? raw.reduce((a, v, i) => (i % 2 ? a : [...a, [v, raw[i + 1]]]), []) : Object.entries(raw);
  for (const [k, v] of pairs) { try { out.push({ id: k, ...JSON.parse(v) }); } catch {} }
  return out;
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// 끝난 주 채점 (한 번 계산하면 저장)
async function result(cfg, wk) {
  const id = wkId(wk);
  const [cached] = await redis(cfg, [["GET", `week:${id}:result`]]);
  if (cached) return JSON.parse(cached);
  if (Date.now() < wk + W + 2 * 60 * 1000) return null;
  const k = await binance(`/api/v3/klines?symbol=BTCUSDT&interval=1w&startTime=${wk}&limit=1`);
  if (!k?.[0] || Number(k[0][0]) !== wk) return null;
  const close = Number(k[0][4]);
  const [raw, aiRaw] = await redis(cfg, [["HGETALL", `week:${id}:entries`], ["GET", `week:${id}:ai`]]);
  const ai = aiRaw ? JSON.parse(aiRaw) : null;
  const entries = parseEntries(raw);
  const aiW = ai ? ai.hi - ai.lo : null;
  const scored = entries.map((e) => {
    const hit = e.lo <= close && close <= e.hi;
    const score = hit ? (aiW ? Math.min(MAX_SCORE, Math.round((100 * aiW) / (e.hi - e.lo))) : 100) : 0;
    return { id: e.id, lo: e.lo, hi: e.hi, t: e.t, hit, score };
  }).sort((a, b) => b.score - a.score || (a.hi - a.lo) - (b.hi - b.lo) || a.t - b.t);
  const aiHit = ai ? ai.lo <= close && close <= ai.hi : null;
  const res = {
    wk: id, close, ai, ai_hit: aiHit, ai_score: aiHit ? 100 : 0,
    n: scored.length, hits: scored.filter((e) => e.hit).length,
    beat_ai: scored.filter((e) => e.score > (aiHit ? 100 : 0)).length,
    crowd: scored.length ? { lo: median(scored.map((e) => e.lo)), hi: median(scored.map((e) => e.hi)) } : null,
    ranks: scored.map((e, i) => ({ ...e, rank: i + 1 })),
  };
  await redis(cfg, [["SET", `week:${id}:result`, JSON.stringify(res), "EX", TTL]]);
  return res;
}

async function state(cfg, vid) {
  const now = Date.now();
  const wk = weekStart(now), id = wkId(wk);
  const me = vid ? sha(vid) : null;
  const [ai, [raw]] = await Promise.all([ensureAi(cfg, wk), redis(cfg, [["HGETALL", `week:${id}:entries`]])]);
  const entries = parseEntries(raw);
  const open = now < wk + OPEN_MS;
  const mine = me ? entries.find((e) => e.id === me) : null;
  const cur = {
    wk: id, start: wk, deadline: wk + OPEN_MS, close_at: wk + W, open, n: entries.length, ai,
    my: mine ? { lo: mine.lo, hi: mine.hi, t: mine.t } : null,
    // 마감 뒤에만 참가자 가운데값 공개 (마감 전 공개하면 따라 하기만 하게 됨)
    crowd: !open && entries.length ? { lo: median(entries.map((e) => e.lo)), hi: median(entries.map((e) => e.hi)) } : null,
  };
  const r = await result(cfg, wk - W);
  let last = null;
  if (r && r.n) { // 참가자가 없던 주(게임 시작 전 등)는 보여 주지 않는다
    const mineR = me ? r.ranks.find((e) => e.id === me) : null;
    last = { ...r, ranks: undefined,
      top: r.ranks.slice(0, 10).map((e) => ({ name: "익명 #" + e.id.slice(0, 4), lo: e.lo, hi: e.hi, score: e.score, hit: e.hit, rank: e.rank, mine: e.id === me })),
      me: mineR ? { rank: mineR.rank, score: mineR.score, hit: mineR.hit, lo: mineR.lo, hi: mineR.hi } : null };
  }
  return { enabled: true, now: cur, last };
}

export async function OPTIONS(request) {
  return new Response(null, { headers: headers(request) });
}

export async function GET(request) {
  const cfg = redisConfig();
  if (!cfg) return json(request, { enabled: false });
  const q = new URL(request.url).searchParams;
  const vid = validVid(q.get("vid")) ? q.get("vid") : null;
  try {
    return json(request, await state(cfg, vid));
  } catch (e) {
    return json(request, { enabled: true, error: String(e.message || e) }, 502);
  }
}

export async function POST(request) {
  const cfg = redisConfig();
  if (!cfg) return json(request, { enabled: false }, 503);
  let b = {};
  try { b = await request.json(); } catch { return json(request, { error: "잘못된 요청" }, 400); }
  const vid = validVid(b.vid) ? b.vid : null;
  if (!vid) return json(request, { error: "브라우저 번호가 없어요. 새로고침 뒤 다시 시도해 주세요." }, 400);
  const now = Date.now(), wk = weekStart(now), id = wkId(wk);
  if (now >= wk + OPEN_MS) return json(request, { error: "이번 주 참가는 마감됐어요 (수요일 오전 9시). 다음 주 월요일 오전 9시에 다시 열려요." }, 400);
  const lo = Math.round(Number(b.lo)), hi = Math.round(Number(b.hi));
  if (!(lo > 0 && hi > lo)) return json(request, { error: "아래 가격이 위 가격보다 작아야 해요" }, 400);
  if (hi / lo - 1 < 0.002) return json(request, { error: "범위가 너무 좁아요 (최소 0.2%)" }, 400);
  if (hi / lo - 1 > 0.5) return json(request, { error: "범위가 너무 넓어요 (최대 50%)" }, 400);
  const t = await binance("/api/v3/ticker/price?symbol=BTCUSDT");
  const px = Number(t?.price);
  if (px > 0 && (hi < px * 0.7 || lo > px * 1.3)) return json(request, { error: "지금 가격에서 너무 먼 범위예요" }, 400);
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ipKey = `week:${id}:ip:${sha(ip + id)}`; // 그 주에만 쓰는 해시, 원본 IP 는 저장하지 않는다
  const me = sha(vid);
  try {
    const [had] = await redis(cfg, [["HEXISTS", `week:${id}:entries`, me]]);
    if (!Number(had)) {
      const [n] = await redis(cfg, [["INCR", ipKey], ["EXPIRE", ipKey, 10 * 86400]]);
      if (Number(n) > 20) return json(request, { error: "같은 곳에서 너무 많이 참가했어요" }, 429);
    }
    await redis(cfg, [["HSET", `week:${id}:entries`, me, JSON.stringify({ lo, hi, t: now })], ["EXPIRE", `week:${id}:entries`, TTL]]);
    return json(request, { ok: true, ...(await state(cfg, vid)) });
  } catch (e) {
    return json(request, { error: String(e.message || e) }, 502);
  }
}
