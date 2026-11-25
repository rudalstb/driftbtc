// Vercel 서버리스 함수: worker/positions.js 의 같은 로직을 Vercel 에서 실행한다.
// 비트겟이 Cloudflare Worker 에서 오는 요청을 차단({"cloudflare":"block"})해서 Vercel(서울 리전)로 옮김.
// 키는 Vercel 프로젝트의 Environment Variables 에만 둔다:
//   BITGET_API_KEY, BITGET_API_SECRET, BITGET_PASSPHRASE
import worker from "../worker/positions.js";
import copyProjects from "../copy-projects.js";

// 대시보드에 붙여 넣을 때 섞인 앞뒤 공백·줄바꿈·따옴표를 제거한다
const clean = (v) => v?.trim().replace(/^["']|["']$/g, "").trim();
// 복사할 때 앞의 "bg_" 가 빠져 32자리만 들어간 경우 보정한다
const apiKey = (v) => (/^[0-9a-f]{32}$/i.test(v || "") ? "bg_" + v : v);
export const env = () => ({
  BITGET_API_KEY: apiKey(clean(process.env.BITGET_API_KEY)),
  BITGET_API_SECRET: clean(process.env.BITGET_API_SECRET),
  BITGET_PASSPHRASE: clean(process.env.BITGET_PASSPHRASE),
  ALLOW_ORIGIN: clean(process.env.ALLOW_ORIGIN),
  // 카피트레이딩 팔로워 프로젝트 번호 목록 (copy-projects.js)
  COPY_PROJECTS: copyProjects,
});

// 키 값 자체는 내보내지 않고 '모양'만 점검한다 (오류일 때만 응답에 붙음)
function keyShape(e) {
  const k = e.BITGET_API_KEY || "";
  return {
    api_key_starts_bg: k.startsWith("bg_"),
    api_key_length: k.length,
    api_key_format_ok: /^bg_[0-9a-f]{32}$/.test(k),
    secret_length: (e.BITGET_API_SECRET || "").length,
    passphrase_length: (e.BITGET_PASSPHRASE || "").length,
  };
}

// 성공 응답은 Vercel CDN 에 5초 담아 방문자끼리 나눠 쓴다(탭마다 5초에 한 번 부르므로, 안 담으면 방문자 수만큼 함수가 돈다).
// 브라우저 쪽 Cache-Control: no-store 는 그대로. 허용 주소(Access-Control-Allow-Origin)가 요청한 곳마다 달라서 Vary: Origin
const CDN = { "Vercel-CDN-Cache-Control": "max-age=5", Vary: "Origin" };

export async function GET(request) {
  const e = env();
  const res = await worker.fetch(request, e);
  if (res.status === 200) {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CDN)) headers.set(k, v);
    return new Response(res.body, { status: 200, headers });
  }
  const body = await res.json();
  return new Response(JSON.stringify({ ...body, check: keyShape(e) }), { status: res.status, headers: res.headers });
}

export async function OPTIONS(request) {
  return worker.fetch(request, env());
}
