// 💰 운영자 개인 지갑 현황판 (비밀번호로 잠긴 페이지 · 공개 사이트 어디에도 링크 없음)
//
// GET  /api/wallet                         → 잠긴 페이지(HTML). 비밀번호를 넣어야 내용이 보인다
// POST {action:"login", password}           → 맞으면 30일짜리 출입증(token). 15분에 5번 틀리면 잠금
// GET  ?data=1  (Authorization: Bearer 출입증) → 업비트 + 비트겟 현황
// POST {action:"push", upbit}  (X-Sync-Key)  → 집 컴퓨터의 동기화 프로그램이 업비트 보유·체결 내역을 올린다
//
// 업비트 키는 허용 IP 가 필요해서 서버에 두지 않는다 — 집 컴퓨터(private/wallet/sync.py)가 조회해 올리고,
// 여기서는 업비트 공개 시세로 평가금액을 실시간 계산한다. 비트겟은 이미 서버에 있는 키로 바로 읽는다.
// Vercel 환경 변수: WALLET_PASSWORD (페이지 비밀번호), WALLET_SYNC_KEY (동기화 프로그램 전용 열쇠)
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redisConfig, redis } from "../lib/redis.js";
import { bitgetGet } from "../worker/positions.js";
import { env as bitgetEnv } from "./positions.js";

const TOKEN_DAYS = 30, MAX_FAILS = 5, LOCK_SEC = 15 * 60, MAX_PUSH = 300_000;
const H = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: H });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const same = (a, b) => { const x = Buffer.from(sha(String(a))), y = Buffer.from(sha(String(b))); return timingSafeEqual(x, y); };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// 출입증 서명 열쇠: 비밀번호가 바뀌면 예전 출입증은 모두 무효
const secret = () => sha("wallet:" + (process.env.WALLET_PASSWORD || "") + ":" + (process.env.BITGET_API_SECRET || ""));
const makeToken = () => { const exp = Date.now() + TOKEN_DAYS * 86400e3; return `${exp}.${createHmac("sha256", secret()).update(String(exp)).digest("hex")}`; };
const validToken = (t) => {
  const [exp, sig] = String(t || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, createHmac("sha256", secret()).update(exp).digest("hex"));
};
const clientIp = (request) => (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";

let page = null;
export async function GET(request) {
  const url = new URL(request.url);
  if (!url.searchParams.get("data")) {
    page ??= readFileSync(join(process.cwd(), "lib", "wallet.html"), "utf8");
    return new Response(page, { headers: { ...H, "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" } });
  }
  if (!process.env.WALLET_PASSWORD) return json({ error: "Vercel 에 WALLET_PASSWORD 가 아직 없어요" }, 503);
  if (!validToken((request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""))) return json({ error: "login" }, 401);
  return json(await snapshot());
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch (e) { return json({ error: "형식 오류" }, 400); }
  const cfg = redisConfig();

  if (body.action === "login") {
    if (!process.env.WALLET_PASSWORD) return json({ error: "Vercel 에 WALLET_PASSWORD 가 아직 없어요" }, 503);
    const key = "wallet:fail:" + sha(clientIp(request)).slice(0, 20);
    const fails = cfg ? Number((await redis(cfg, [["GET", key]]))[0] || 0) : 0;
    if (fails >= MAX_FAILS) return json({ error: "여러 번 틀려서 15분 동안 잠겼어요" }, 429);
    if (!same(body.password || "", process.env.WALLET_PASSWORD)) {
      if (cfg) await redis(cfg, [["INCR", key], ["EXPIRE", key, LOCK_SEC]]);
      await new Promise((r) => setTimeout(r, 600));
      return json({ error: `비밀번호가 틀렸어요 (${MAX_FAILS - fails - 1}번 남음)` }, 401);
    }
    if (cfg) await redis(cfg, [["DEL", key]]);
    return json({ token: makeToken() });
  }

  if (body.action === "push") {
    const k = process.env.WALLET_SYNC_KEY;
    if (!k || !same(request.headers.get("x-sync-key") || "", k)) return json({ error: "동기화 열쇠가 맞지 않아요" }, 401);
    if (!cfg) return json({ error: "Redis 없음" }, 503);
    const up = body.upbit || {};
    const clean = {
      at: Date.now(),
      accounts: (up.accounts || []).slice(0, 300).map((a) => ({ currency: String(a.currency).slice(0, 20), balance: num(a.balance), locked: num(a.locked), avg_buy_price: num(a.avg_buy_price) })),
      orders: (up.orders || []).slice(0, 200),
      error: up.error ? String(up.error).slice(0, 300) : undefined,
    };
    // 업비트 조회가 실패해 오류만 올라오면 마지막으로 받은 보유 내역은 그대로 두고 오류만 붙인다
    if (clean.error && !clean.accounts.length) {
      const prev = (await redis(cfg, [["GET", "wallet:upbit"]]))[0];
      if (prev) Object.assign(clean, { ...JSON.parse(prev), error: clean.error });
    }
    const s = JSON.stringify(clean);
    if (s.length > MAX_PUSH) return json({ error: "너무 커요" }, 413);
    await redis(cfg, [["SET", "wallet:upbit", s]]);
    return json({ ok: true });
  }
  return json({ error: "알 수 없는 요청" }, 400);
}

// ─── 현황 계산 ───────────────────────────────────────────
let names = { at: 0, map: {} };
async function upbitNames() {
  if (Date.now() - names.at > 6 * 3600e3) {
    try {
      const r = await fetch("https://api.upbit.com/v1/market/all?isDetails=false", { headers: { "User-Agent": "Mozilla/5.0" } });
      const map = {};
      for (const x of await r.json()) if (x.market.startsWith("KRW-")) map[x.market.slice(4)] = x.korean_name;
      names = { at: Date.now(), map };
    } catch (e) {}
  }
  return names.map;
}
async function upbitPrices(coins) {
  const out = {};
  for (let i = 0; i < coins.length; i += 90) {
    try {
      const r = await fetch(`https://api.upbit.com/v1/ticker?markets=${coins.slice(i, i + 90).map((c) => "KRW-" + c).join(",")}`, { headers: { "User-Agent": "Mozilla/5.0" } });
      for (const x of await r.json()) out[x.market.slice(4)] = { price: x.trade_price, change: (x.signed_change_rate || 0) * 100 };
    } catch (e) {}
  }
  return out;
}

async function readUpbit() {
  const cfg = redisConfig();
  const raw = cfg ? (await redis(cfg, [["GET", "wallet:upbit"]]))[0] : null;
  if (!raw) return { setup: true };
  const snap = JSON.parse(raw);
  const map = await upbitNames();
  const coins = snap.accounts.map((a) => a.currency).filter((c) => c !== "KRW" && map[c]);
  const prices = await upbitPrices([...new Set([...coins, "USDT"])]);
  const krw = snap.accounts.find((a) => a.currency === "KRW") || {};
  const rows = snap.accounts.filter((a) => a.currency !== "KRW").map((a) => {
    const qty = a.balance + a.locked, avg = a.avg_buy_price, p = prices[a.currency];
    const value = p ? qty * p.price : null, cost = qty * avg;
    return { coin: a.currency, name: map[a.currency] || "", qty, avg, price: p?.price ?? null, change: p?.change ?? null, value, cost,
      pnl: value != null && avg ? value - cost : null, pct: value != null && cost ? (value / cost - 1) * 100 : null };
  }).filter((r) => (r.value ?? r.cost) >= 1).sort((a, b) => (b.value || 0) - (a.value || 0));
  const cash = krw.balance + krw.locked || 0;
  const coinValue = rows.reduce((s, r) => s + (r.value || 0), 0);
  const counted = rows.filter((r) => r.pnl != null);
  return {
    synced: snap.at, sync_error: snap.error, cash, coins: rows, coin_value: coinValue, total: cash + coinValue,
    pnl: counted.reduce((s, r) => s + r.pnl, 0), cost: counted.reduce((s, r) => s + r.cost, 0),
    orders: snap.orders.map((o) => ({ ...o, name: map[o.coin] || "" })), usdt_krw: prices.USDT?.price ?? null,
  };
}

async function readBitget(origin) {
  const out = {};
  try {
    const r = await fetch(origin + "/api/positions", { headers: { origin: "https://rudalstb.github.io" } });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    Object.assign(out, { account: d.account, positions: d.positions || [], history: (d.history || []).slice(0, 20) });
  } catch (e) { out.error = "선물 계좌: " + (e.message || e); }
  try {
    const a = await bitgetGet(bitgetEnv(), "/api/v3/account/assets");
    out.assets = (a.assets || []).map((x) => ({ coin: x.coin, qty: num(x.equity ?? x.balance), usd: num(x.usdValue ?? x.usdtValue) || null }))
      .filter((x) => x.qty > 0 && (x.usd == null || x.usd >= 0.5)).sort((p, q) => (q.usd || 0) - (p.usd || 0));
  } catch (e) { out.assets_error = String(e.message || e); }
  return out;
}

async function snapshot() {
  const origin = "https://" + (process.env.VERCEL_PROJECT_PRODUCTION_URL || "driftbtc.vercel.app");
  const [upbit, bitget] = await Promise.all([readUpbit().catch((e) => ({ error: String(e.message || e) })), readBitget(origin)]);
  let rate = upbit.usdt_krw;
  if (!rate) rate = (await upbitPrices(["USDT"])).USDT?.price ?? null;
  return { at: Date.now(), upbit, bitget, usdt_krw: rate };
}
