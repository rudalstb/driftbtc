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
// 연결 정보 환경변수는 Upstash 를 연결할 때 자동으로 들어온다. 접두사가 달라도 찾도록
// 이름이 ..._REST_API_URL / ..._REST_API_TOKEN 으로 끝나는 변수를 쓴다.

const ORIGIN = "https://rudalstb.github.io";
const BACKUP_URL = "https://rudalstb.github.io/driftbtc/data/visits.json";
const ONLINE_MS = 5 * 60 * 1000;
const DAY_TTL = 60 * 60 * 24 * 40; // 날짜별 키는 40일 뒤 자동 삭제

const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

// 한국 시간 기준 날짜 (YYYY-MM-DD)
const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

function redisConfig() {
  const env = process.env;
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

async function redis(cfg, commands) {
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
  if (!cfg) {
    // 원인 파악용: 저장소 관련 환경변수 '이름'만 보여준다 (값은 절대 내보내지 않음)
    const names = Object.keys(process.env).filter((k) => /REDIS|KV|UPSTASH|STORAGE/i.test(k));
    return new Response(JSON.stringify({ enabled: false, env_names: names }), { headers });
  }

  const q = new URL(request.url).searchParams;
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
