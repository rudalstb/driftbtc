// Vercel 서버리스 함수: worker/positions.js 의 같은 로직을 Vercel 에서 실행한다.
// 비트겟이 Cloudflare Worker 에서 오는 요청을 차단({"cloudflare":"block"})해서 Vercel(서울 리전)로 옮김.
// 키는 Vercel 프로젝트의 Environment Variables 에만 둔다:
//   BITGET_API_KEY, BITGET_API_SECRET, BITGET_PASSPHRASE
import worker from "../worker/positions.js";

// 대시보드에 붙여 넣을 때 섞인 앞뒤 공백·줄바꿈·따옴표를 제거한다
const clean = (v) => v?.trim().replace(/^["']|["']$/g, "").trim();
// 복사할 때 앞의 "bg_" 가 빠져 32자리만 들어간 경우 보정한다
const apiKey = (v) => (/^[0-9a-f]{32}$/i.test(v || "") ? "bg_" + v : v);
const env = () => ({
  BITGET_API_KEY: apiKey(clean(process.env.BITGET_API_KEY)),
  BITGET_API_SECRET: clean(process.env.BITGET_API_SECRET),
  BITGET_PASSPHRASE: clean(process.env.BITGET_PASSPHRASE),
  ALLOW_ORIGIN: clean(process.env.ALLOW_ORIGIN),
  // 카피트레이딩(엘리트 트레이더) 계좌 전용 키 (없으면 카피 계좌는 건너뜀)
  BITGET_COPY_API_KEY: apiKey(clean(process.env.BITGET_COPY_API_KEY)),
  BITGET_COPY_API_SECRET: clean(process.env.BITGET_COPY_API_SECRET),
  BITGET_COPY_PASSPHRASE: clean(process.env.BITGET_COPY_PASSPHRASE),
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

export async function GET(request) {
  const e = env();
  const res = await worker.fetch(request, e);
  if (res.status === 200) return res;
  const body = await res.json();
  return new Response(JSON.stringify({ ...body, check: keyShape(e) }), { status: res.status, headers: res.headers });
}

export async function OPTIONS(request) {
  return worker.fetch(request, env());
}
