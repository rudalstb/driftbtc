// 방문자 수 집계 (Vercel 서버리스 함수 + Upstash Redis)
//
// 사이트가 열릴 때(그리고 열려 있는 동안 3분마다) 호출된다.
// - 순 방문자: 브라우저마다 만든 임의의 번호(vid)를 HyperLogLog 로 센다. IP 등 개인정보는 저장하지 않는다
// - 페이지 조회수: 페이지를 연 횟수
// - 지금 보는 중: 최근 5분 안에 신호를 보낸 브라우저 수
//
// 무료 Upstash 는 디스크 저장이 없어 드물게 0 으로 초기화될 수 있다.
// 그래서 매시간 GitHub Actions(visits.py)가 site/data/visits.json 에 백업하고,
// 여기서 초기화를 감지하면(init 키 없음) 그 백업 값을 기본값(base)으로 깔고 이어서 센다.
//
// 연결 정보는 두 가지를 지원한다.
// - Redis Cloud 등 일반 Redis: REDIS_URL (redis://...) → 직접 연결 (지금 연결된 방식)
// - Upstash: ..._REST_API_URL / ..._REST_API_TOKEN → HTTP 요청
import { createClient } from "redis";

const ORIGIN = "https://rudalstb.github.io";
const BACKUP_URL = "https://rudalstb.github.io/driftbtc/data/visits.json";
const ONLINE_MS = 5 * 60 * 1000;
const DAY_TTL = 60 * 60 * 24 * 40; // 날짜별 키는 40일 뒤 자동 삭제

const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

// 한국 시간 기준 날짜 (YYYY-MM-DD)
const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

function redisConfig() {
  const env = process.env;
  if (env.REDIS_URL) return { tcp: env.REDIS_URL };
  const urlKey =
    Object.keys(env).find((k) => /REST_API_URL$/.test(k) && env[k]) ||
    (env.UPSTASH_REDIS_REST_URL && "UPSTASH_REDIS_REST_URL") ||
    // 접두사를 바꾼 경우: 값이 https://....upstash.io 인 ..._URL 변수
    Object.keys(env).find((k) => /_URL$/.test(k) && /^https:\/\/[^/]+\.upstash\.io/.test(env[k] || ""));
  if (!urlKey) return null;
  const tokenKey = urlKey.replace(/URL$/, "TOKEN");
  const token = env[tokenKey] || env.UPSTASH_REDIS_REST_TOKEN;
  return token ? { url: env[urlKey].replace(/\/$/, ""), token } : null;
}

// 일반 Redis 연결은 함수가 살아 있는 동안 재사용한다
let tcpClient = null;
async function tcp(url) {
  if (!tcpClient) {
    // 무한 재연결 대신 바로 실패하고, 끊기면 다음 요청 때 새로 연결한다
    const c = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false } });
    c.on("error", () => {
      tcpClient = null;
    });
    c.on("end", () => {
      tcpClient = null;
    });
    tcpClient = c.connect().then(() => c).catch((e) => {
      tcpClient = null;
      throw e;
    });
  }
  return tcpClient;
}

async function redis(cfg, commands) {
  if (cfg.tcp) {
    const c = await tcp(cfg.tcp);
    // 동시에 보내면 자동으로 한 번에 묶여 전송된다
    return Promise.all(commands.map((cmd) => c.sendCommand(cmd.map(String))));
  }
  const res = await fetch(cfg.url + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  return (await res.json()).map((r) => r.result);
}

// Redis 가 비어 있으면(처음 연결 또는 초기화) 마지막 백업을 기본값으로 깐다
async function restoreIfEmpty(cfg, today, yesterday) {
  let b = {};
  try {
    const r = await fetch(BACKUP_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (r.ok) b = await r.json();
  } catch (e) {}
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const cmds = [
    ["SET", "base:uv", n(b.total)],
    ["SET", "base:pv", n(b.total_views)],
  ];
  // 백업이 오늘·어제 것이면 날짜별 값도 이어 붙인다
  if (b.date === today) {
    cmds.push(["SET", `base:uv:${today}`, n(b.today), "EX", DAY_TTL], ["SET", `base:pv:${today}`, n(b.today_views), "EX", DAY_TTL]);
    cmds.push(["SET", `base:uv:${yesterday}`, n(b.yesterday), "EX", DAY_TTL]);
  } else if (b.date === yesterday) {
    cmds.push(["SET", `base:uv:${yesterday}`, n(b.today), "EX", DAY_TTL]);
  }
  cmds.push(["SET", "init", new Date().toISOString()]);
  await redis(cfg, cmds);
  return Boolean(b.total);
}

export async function GET(request) {
  const cfg = redisConfig();
  if (!cfg) return new Response(JSON.stringify({ enabled: false }), { headers });

  const q = new URL(request.url).searchParams;
  const now0 = Date.now();
  // 화면 이용 집계: 영역 이름(영문·숫자·-·_ 40자 이내)과 횟수만 센다
  const sec = /^[a-zA-Z0-9_-]{1,40}$/.test(q.get("sec") || "") ? q.get("sec") : null;
  if (sec) {
    try {
      const d = kstDate(now0);
      await redis(cfg, [["HINCRBY", `sec:${d}`, sec, 1], ["EXPIRE", `sec:${d}`, DAY_TTL]]);
    } catch (e) {}
    return new Response(JSON.stringify({ ok: true }), { headers });
  }
  if (q.get("stats") === "1") {
    try {
      const days = [...Array(7)].map((_, i) => kstDate(now0 - i * 86400000)).reverse();
      const res = await redis(cfg, [...days.map((d) => ["HGETALL", `sec:${d}`]), ["PFCOUNT", `uv:${days[6]}`], ["PFCOUNT", `uv:${days[5]}`]]);
      const toObj = (arr) => {
        if (!arr) return {};
        if (!Array.isArray(arr)) return Object.fromEntries(Object.entries(arr).map(([k, v]) => [k, Number(v)]));
        const o = {};
        for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]);
        return o;
      };
      return new Response(JSON.stringify({ days: days.map((d, i) => ({ date: d, sections: toObj(res[i]) })), today: Number(res[7]) || 0, yesterday: Number(res[8]) || 0 }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers });
    }
  }
  // 브라우저 번호: 영문·숫자 8~40자만 허용
  const vid = /^[a-zA-Z0-9]{8,40}$/.test(q.get("vid") || "") ? q.get("vid") : null;
  const isNewView = q.get("view") === "1"; // 페이지를 새로 연 경우만 조회수 +1 (3분마다 오는 신호는 제외)
  const now = Date.now();
  const today = kstDate(now), yesterday = kstDate(now - 86400000);

  try {
    let restored = false;
    const [init] = await redis(cfg, [["GET", "init"]]);
    if (!init) restored = await restoreIfEmpty(cfg, today, yesterday);

    const cmds = [];
    if (vid) {
      cmds.push(["PFADD", `uv:${today}`, vid], ["EXPIRE", `uv:${today}`, DAY_TTL], ["PFADD", "uv:all", vid]);
      cmds.push(["ZADD", "online", now, vid]);
    }
    if (isNewView) cmds.push(["INCR", `pv:${today}`], ["EXPIRE", `pv:${today}`, DAY_TTL], ["INCR", "pv:all"]);
    cmds.push(["ZREMRANGEBYSCORE", "online", 0, now - ONLINE_MS]);
    const reads = [
      ["PFCOUNT", `uv:${today}`], ["PFCOUNT", `uv:${yesterday}`], ["PFCOUNT", "uv:all"],
      ["GET", `pv:${today}`], ["GET", "pv:all"], ["ZCARD", "online"],
      ["GET", "base:uv"], ["GET", "base:pv"], ["GET", `base:uv:${today}`], ["GET", `base:pv:${today}`], ["GET", `base:uv:${yesterday}`],
    ];
    const r = (await redis(cfg, [...cmds, ...reads])).slice(cmds.length).map((v) => Number(v) || 0);
    const [uvT, uvY, uvAll, pvT, pvAll, online, bUv, bPv, bUvT, bPvT, bUvY] = r;
    return new Response(
      JSON.stringify({
        enabled: true, date: today, online,
        today: uvT + bUvT, yesterday: uvY + bUvY, total: uvAll + bUv,
        today_views: pvT + bPvT, total_views: pvAll + bPv,
        ...(restored ? { restored: true } : {}),
      }),
      { headers },
    );
  } catch (e) {
    return new Response(JSON.stringify({ enabled: true, error: String(e.message || e) }), { status: 502, headers });
  }
}

// 화면 이용 집계는 navigator.sendBeacon(POST) 으로 오므로 같은 처리기를 쓴다
export async function POST(request) {
  return GET(request);
}
