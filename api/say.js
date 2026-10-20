// 💬 오늘 한마디 · 롱/숏 투표 (Vercel 서버리스 함수 + Redis)
//
// 로그인·닉네임 없이 전부 익명. 브라우저가 스스로 만든 임의 번호(vid)로만 "내 표·내 글"을 구분하고,
// IP 는 저장하지 않는다 (도배 방지용으로 날짜별 해시만 하루 동안 보관).
//
// GET  ?day=YYYY-MM-DD&vid=...        → 오늘 투표 집계·내 표·한마디 목록(최신 50개)·어제 집계
// POST {action:"vote", vid, side}      → 하루 1표 (바꾸면 이전 표는 빠짐) · {action:"unvote"} 는 표 취소
// POST {action:"post", vid, text}      → 200자 이내, 링크·연락처·홍보·욕설 차단, 1분 1개 · 하루 20개
// POST {action:"report", vid, id}      → 신고 3번이면 자동 숨김
// POST {action:"delete", vid, id, key} → 내 글(같은 vid) 또는 운영자 키(ADMIN_KEY)로 삭제
import { createHash } from "node:crypto";
import { redisConfig, redis } from "../lib/redis.js";

const ORIGINS = ["https://rudalstb.github.io", "https://btcagentai.com", "https://www.btcagentai.com"];
const pickOrigin = (request) => { const o = request?.headers?.get("origin"); return ORIGINS.includes(o) ? o : ORIGINS[0]; };
const headers = (request) => ({
  "Access-Control-Allow-Origin": pickOrigin(request),
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
});
const json = (request, body, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(request) });

const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const DAY = 86400;
const POSTS_TTL = 30 * DAY, VOTES_TTL = 90 * DAY;
const MAX_LEN = 200, PER_MIN = 1, PER_DAY = 20, REPORT_HIDE = 3;
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const validVid = (v) => /^[a-zA-Z0-9]{8,40}$/.test(v || "");
const validDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

// 차단: 링크·연락처·홍보성 단어·심한 욕설 (짧은 익명 게시판이라 보수적으로)
const BLOCK = [
  /https?:\/\/|www\.|\.(com|net|kr|io|me|ly)\b|t\.me/i,
  /\d{2,3}[- .]?\d{3,4}[- .]?\d{4}/,
  /카톡|카카오톡|오픈 ?채팅|텔레 ?그램|텔레방|라인 ?아이디|디엠|dm 주|@[a-z0-9_]{4,}/i,
  /리딩|시그널 ?방|수익 ?보장|원금 ?보장|무료 ?체험|선물 ?방|입장 ?문의|상담 ?문의|추천인/i,
  /시발|씨발|씨빨|병신|새끼|좆|지랄|년아|놈아|ㅅㅂ|ㅄ|ㅂㅅ/,
];
const reasonFor = (t) => (BLOCK[0].test(t) || BLOCK[2].test(t) || BLOCK[3].test(t) ? "링크·연락처·홍보 문구는 올릴 수 없어요" : BLOCK[1].test(t) ? "전화번호 같은 숫자는 올릴 수 없어요" : BLOCK[4].test(t) ? "욕설은 올릴 수 없어요" : null);

async function readDay(cfg, day, vid, yday) {
  const [votes, my, raw, yvotes, hidden] = await redis(cfg, [
    ["HGETALL", `say:votes:${day}`],
    vid ? ["HGET", `say:voted:${day}`, sha(vid)] : ["PING"],
    ["LRANGE", `say:posts:${day}`, 0, 79],
    ["HGETALL", `say:votes:${yday}`],
    ["SMEMBERS", "say:hidden"],
  ]);
  const toObj = (arr) => {
    if (!arr) return {};
    if (!Array.isArray(arr)) return Object.fromEntries(Object.entries(arr).map(([k, v]) => [k, Number(v)]));
    const o = {};
    for (let i = 0; i < arr.length; i += 2) o[arr[i]] = Number(arr[i + 1]);
    return o;
  };
  const hid = new Set(hidden || []);
  const me = vid ? sha(vid) : null;
  const posts = (raw || []).map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter((p) => p && !hid.has(p.id))
    .slice(0, 50)
    .map((p) => ({ id: p.id, t: p.t, text: p.text, vote: p.vote || null, mine: me != null && p.v === me }));
  const v = toObj(votes), y = toObj(yvotes);
  return { day, votes: { long: v.long || 0, short: v.short || 0 }, my: typeof my === "string" ? my : null, posts,
    yesterday: { day: yday, long: y.long || 0, short: y.short || 0 } };
}

export async function OPTIONS(request) {
  return new Response(null, { headers: headers(request) });
}

export async function GET(request) {
  const cfg = redisConfig();
  if (!cfg) return json(request, { enabled: false });
  const q = new URL(request.url).searchParams;
  const now = Date.now();
  const day = validDay(q.get("day")) ? q.get("day") : kstDate(now);
  const vid = validVid(q.get("vid")) ? q.get("vid") : null;
  try {
    return json(request, { enabled: true, ...(await readDay(cfg, day, vid, kstDate(now - DAY * 1000))) });
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
  const now = Date.now();
  const day = kstDate(now);
  const me = sha(vid);
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ipKey = sha(ip + day); // 그날만 쓰는 해시, 원본 IP 는 어디에도 저장하지 않는다
  try {
    if (b.action === "vote") {
      const side = b.side === "long" ? "long" : b.side === "short" ? "short" : null;
      if (!side) return json(request, { error: "롱 또는 숏" }, 400);
      const [prev] = await redis(cfg, [["HGET", `say:voted:${day}`, me]]);
      const cmds = [];
      if (prev && prev !== side) cmds.push(["HINCRBY", `say:votes:${day}`, prev, -1]);
      if (prev !== side) cmds.push(["HINCRBY", `say:votes:${day}`, side, 1], ["HSET", `say:voted:${day}`, me, side]);
      cmds.push(["EXPIRE", `say:votes:${day}`, VOTES_TTL], ["EXPIRE", `say:voted:${day}`, VOTES_TTL]);
      await redis(cfg, cmds);
    } else if (b.action === "unvote") {
      const [prev] = await redis(cfg, [["HGET", `say:voted:${day}`, me]]);
      if (prev) await redis(cfg, [["HINCRBY", `say:votes:${day}`, prev, -1], ["HDEL", `say:voted:${day}`, me]]);
    } else if (b.action === "post") {
      const text = String(b.text || "").replace(/\s+/g, " ").trim();
      if (text.length < 2) return json(request, { error: "두 글자 이상 적어 주세요" }, 400);
      if (text.length > MAX_LEN) return json(request, { error: `${MAX_LEN}자까지만 쓸 수 있어요` }, 400);
      const why = reasonFor(text);
      if (why) return json(request, { error: why }, 400);
      const [perMin, perDay, perIp, lastText, voted] = await redis(cfg, [
        ["INCR", `say:rl:m:${me}`], ["INCR", `say:rl:d:${me}:${day}`], ["INCR", `say:rl:ip:${ipKey}`],
        ["GET", `say:last:${me}`], ["HGET", `say:voted:${day}`, me],
      ]);
      await redis(cfg, [["EXPIRE", `say:rl:m:${me}`, 60], ["EXPIRE", `say:rl:d:${me}:${day}`, DAY], ["EXPIRE", `say:rl:ip:${ipKey}`, DAY]]);
      if (Number(perMin) > PER_MIN) return json(request, { error: "1분에 한 개만 올릴 수 있어요" }, 429);
      if (Number(perDay) > PER_DAY || Number(perIp) > PER_DAY * 3) return json(request, { error: "오늘은 여기까지! 내일 다시 올려 주세요" }, 429);
      if (lastText === text) return json(request, { error: "같은 글을 연달아 올릴 수 없어요" }, 400);
      const post = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: now, text, v: me, vote: voted || null };
      await redis(cfg, [
        ["LPUSH", `say:posts:${day}`, JSON.stringify(post)], ["LTRIM", `say:posts:${day}`, 0, 499], ["EXPIRE", `say:posts:${day}`, POSTS_TTL],
        ["SET", `say:last:${me}`, text, "EX", 600],
      ]);
    } else if (b.action === "report" || b.action === "delete") {
      const id = /^[a-z0-9]{8,24}$/.test(b.id || "") ? b.id : null;
      const d = validDay(b.day) ? b.day : day;
      if (!id) return json(request, { error: "잘못된 글 번호" }, 400);
      const [raw] = await redis(cfg, [["LRANGE", `say:posts:${d}`, 0, 499]]);
      const entry = (raw || []).find((s) => s.includes(`"id":"${id}"`));
      if (!entry) return json(request, { error: "이미 지워진 글이에요" }, 404);
      if (b.action === "report") {
        const [n] = await redis(cfg, [["SADD", `say:rep:${id}`, me]]);
        const [cnt] = await redis(cfg, [["SCARD", `say:rep:${id}`], ["EXPIRE", `say:rep:${id}`, POSTS_TTL]]);
        if (Number(cnt) >= REPORT_HIDE) await redis(cfg, [["SADD", "say:hidden", id]]);
        return json(request, { ok: true, reported: Number(n) === 1, hidden: Number(cnt) >= REPORT_HIDE });
      }
      const post = JSON.parse(entry);
      const admin = process.env.ADMIN_KEY && b.key && b.key === process.env.ADMIN_KEY;
      if (post.v !== me && !admin) return json(request, { error: "내가 쓴 글만 지울 수 있어요" }, 403);
      await redis(cfg, [["LREM", `say:posts:${d}`, 1, entry]]);
    } else {
      return json(request, { error: "알 수 없는 요청" }, 400);
    }
    return json(request, { ok: true, ...(await readDay(cfg, day, vid, kstDate(now - DAY * 1000))) });
  } catch (e) {
    return json(request, { error: String(e.message || e) }, 502);
  }
}
