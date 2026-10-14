// 방문자 수 집계 (Vercel 서버리스 함수 + Upstash Redis)
//
// 사이트가 열릴 때(그리고 열려 있는 동안 3분마다) 호출된다.
// - 순 방문자: 브라우저마다 만든 임의의 번호(vid)를 HyperLogLog 로 센다. IP 등 개인정보는 저장하지 않는다
// - 페이지 조회수: 페이지를 연 횟수
// - 지금 보는 중: 최근 5분 안에 신호를 보낸 브라우저 수
//
// 필요한 환경변수 (Vercel → Storage 에서 Upstash Redis 를 연결하면 자동으로 들어온다):
//   KV_REST_API_URL / KV_REST_API_TOKEN  또는  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

const ORIGIN = "https://rudalstb.github.io";
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

async function redis(commands) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(url.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  return (await res.json()).map((r) => r.result);
}

export async function GET(request) {
  if (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)) {
    return new Response(JSON.stringify({ enabled: false }), { headers });
  }
  const q = new URL(request.url).searchParams;
  // 브라우저 번호: 영문·숫자 8~40자만 허용
  const vid = /^[a-zA-Z0-9]{8,40}$/.test(q.get("vid") || "") ? q.get("vid") : null;
  const isNewView = q.get("view") === "1"; // 페이지를 새로 연 경우만 조회수 +1 (3분마다 오는 신호는 제외)
  const now = Date.now();
  const today = kstDate(now), yesterday = kstDate(now - 86400000);

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
  ];

  try {
    const r = await redis([...cmds, ...reads]);
    const [todayUv, yesterdayUv, totalUv, todayPv, totalPv, online] = r.slice(cmds.length).map((v) => Number(v) || 0);
    return new Response(JSON.stringify({ enabled: true, online, today: todayUv, yesterday: yesterdayUv, total: totalUv, today_views: todayPv, total_views: totalPv }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ enabled: true, error: String(e.message || e) }), { status: 502, headers });
  }
}
