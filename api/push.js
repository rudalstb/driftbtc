// 🔔 급변 푸시 알림 (Vercel 서버리스 함수 + Redis + 웹 푸시)
//
// 방문자가 원하면 사이트를 닫아 둬도 "⚡ 5분 ±1% 급변" 을 휴대폰·PC 알림으로 받는다.
// 규칙은 메인 화면 줄(site/jumps.js)·감시기(worker/watch.js)와 같다: 5분 수익률이 ±1% 를 처음 넘은 1분봉, 그 전 30분 안에 넘은 적 없음.
//
// GET                                   → {key: 발송용 공개 키, n: 구독 수}
// POST {action:"sub", sub}               → 구독 저장 (브라우저가 만든 푸시 주소·암호 키만, 개인정보 없음)
// POST {action:"unsub", endpoint}        → 구독 삭제
// POST {action:"check"}                  → Cloudflare 감시기가 1분마다 부름. 여기서 직접 1분봉을 보고 새 급변이면 모두에게 보냄
//                                          (누가 불러도 결과는 같고, 같은 급변은 한 번만, 1분에 한 번만 계산 → 비밀 값이 필요 없다)
// 발송 키(VAPID)는 처음 쓸 때 만들어 Redis 에 보관한다.
import { createHash } from "node:crypto";
import webpush from "web-push";
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

const SITE = "https://btc.rudals.app/";
const M = 60_000, PCT = 0.01, WIN = 5, COOL = 30;
const MAX_SUBS = 20000;
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);

async function vapid(cfg) {
  let [v] = await redis(cfg, [["GET", "push:vapid"]]);
  if (!v) {
    const k = webpush.generateVAPIDKeys();
    await redis(cfg, [["SET", "push:vapid", JSON.stringify(k), "NX"]]);
    [v] = await redis(cfg, [["GET", "push:vapid"]]);
  }
  return JSON.parse(v);
}

// 마감된 1분봉 [{t, c}] 오래된 순
async function klines() {
  for (const host of ["https://api.binance.com", "https://data-api.binance.vision"]) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=45`, { cache: "no-store" });
      if (!r.ok) continue;
      const now = Date.now();
      return (await r.json()).map((x) => ({ t: +x[0], c: +x[4] })).filter((x) => x.t + M <= now);
    } catch (e) { /* 다음 주소 */ }
  }
  return null;
}

// 최근 3개 1분봉 가운데 새 급변 (감시기가 한두 번 빠져도 놓치지 않게)
function jumps(k) {
  const mv = (i) => (i >= WIN && k[i].t - k[i - WIN].t === WIN * M ? k[i].c / k[i - WIN].c - 1 : 0);
  const out = [];
  for (let i = Math.max(WIN + 1, k.length - 3); i < k.length; i++) {
    const m = mv(i);
    if (Math.abs(m) < PCT) continue;
    let quiet = true;
    for (let j = Math.max(0, i - COOL); j < i; j++) if (Math.abs(mv(j)) >= PCT) { quiet = false; break; }
    if (quiet) out.push({ t: k[i].t, m, price: k[i].c });
  }
  return out;
}

async function base() {
  try {
    const d = await (await fetch(SITE + "data/jumps_stats.json", { cache: "no-store" })).json();
    const a = d.groups.all.h30;
    return `1년 기준 30분 뒤 이어짐 ${Math.round(a.cont)}% · 되돌림 ${Math.round(a.rev)}%`;
  } catch (e) { return ""; }
}

async function broadcast(cfg, payload) {
  const keys = await vapid(cfg);
  webpush.setVapidDetails(SITE, keys.publicKey, keys.privateKey);
  const [all] = await redis(cfg, [["HGETALL", "push:subs"]]);
  const entries = [];
  if (Array.isArray(all)) for (let i = 0; i + 1 < all.length; i += 2) entries.push([all[i], all[i + 1]]);
  else entries.push(...Object.entries(all || {}));
  let ok = 0;
  const gone = [];
  const body = JSON.stringify(payload);
  for (let i = 0; i < entries.length; i += 50) {
    await Promise.all(entries.slice(i, i + 50).map(async ([id, s]) => {
      try { await webpush.sendNotification(JSON.parse(s), body, { TTL: 900, urgency: "high" }); ok++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) gone.push(id); }
    }));
  }
  if (gone.length) await redis(cfg, [["HDEL", "push:subs", ...gone]]);
  return { sent: ok, removed: gone.length, total: entries.length };
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: headers(request) });
}

export async function GET(request) {
  const cfg = redisConfig();
  if (!cfg) return json(request, { error: "저장소 없음" }, 503);
  try {
    const keys = await vapid(cfg);
    const [n] = await redis(cfg, [["HLEN", "push:subs"]]);
    return json(request, { key: keys.publicKey, n: Number(n) || 0 });
  } catch (e) {
    return json(request, { error: String(e.message || e) }, 500);
  }
}

export async function POST(request) {
  const cfg = redisConfig();
  if (!cfg) return json(request, { error: "저장소 없음" }, 503);
  let b;
  try { b = await request.json(); } catch (e) { return json(request, { error: "잘못된 요청" }, 400); }
  try {
    if (b.action === "sub") {
      const s = b.sub || {};
      if (!/^https:\/\/[^\s]{10,800}$/.test(s.endpoint || "") || !s.keys?.p256dh || !s.keys?.auth || JSON.stringify(s).length > 1500)
        return json(request, { error: "구독 정보가 올바르지 않아요" }, 400);
      const [n] = await redis(cfg, [["HLEN", "push:subs"]]);
      if (Number(n) >= MAX_SUBS) return json(request, { error: "구독이 가득 찼어요" }, 429);
      await redis(cfg, [["HSET", "push:subs", sha(s.endpoint), JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } })]]);
      return json(request, { ok: true });
    }
    if (b.action === "unsub") {
      if (b.endpoint) await redis(cfg, [["HDEL", "push:subs", sha(String(b.endpoint))]]);
      return json(request, { ok: true });
    }
    if (b.action === "check") {
      const minute = Math.floor(Date.now() / M);
      const [first] = await redis(cfg, [["SET", `push:check:${minute}`, "1", "NX", "EX", "120"]]);
      if (!first) return json(request, { skipped: "이번 분은 이미 확인함" });
      const k = await klines();
      if (!k || k.length < 40) return json(request, { error: "1분봉을 받지 못함" }, 502);
      const found = jumps(k);
      const res = [];
      for (const j of found) {
        const [fresh] = await redis(cfg, [["SET", `push:sent:${j.t}`, "1", "NX", "EX", "7200"]]);
        if (!fresh) continue;
        const up = j.m > 0;
        const b30 = await base();
        res.push(await broadcast(cfg, {
          title: `⚡ 비트코인 5분 ${up ? "▲" : "▼"}${(Math.abs(j.m) * 100).toFixed(1)}% 급${up ? "등" : "락"}`,
          body: `$${Math.round(j.price).toLocaleString("en-US")}${b30 ? " · " + b30 + " (참고용)" : ""}`,
          url: SITE + "#home",
          tag: "jump-" + j.t,
        }));
      }
      return json(request, { ok: true, price: k[k.length - 1].c, jumps: found.length, sent: res });
    }
    return json(request, { error: "알 수 없는 요청" }, 400);
  } catch (e) {
    return json(request, { error: String(e.message || e) }, 500);
  }
}
export { jumps };
