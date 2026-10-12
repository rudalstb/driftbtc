// Vercel 서버리스 함수: worker/positions.js 의 같은 로직을 Vercel 에서 실행한다.
// 비트겟이 Cloudflare Worker 에서 오는 요청을 차단({"cloudflare":"block"})해서 Vercel(서울 리전)로 옮김.
// 키는 Vercel 프로젝트의 Environment Variables 에만 둔다:
//   BITGET_API_KEY, BITGET_API_SECRET, BITGET_PASSPHRASE
import worker from "../worker/positions.js";

// 대시보드에 붙여 넣을 때 섞인 앞뒤 공백·줄바꿈·따옴표를 제거한다
const clean = (v) => v?.trim().replace(/^["']|["']$/g, "").trim();
const env = () => ({
  BITGET_API_KEY: clean(process.env.BITGET_API_KEY),
  BITGET_API_SECRET: clean(process.env.BITGET_API_SECRET),
  BITGET_PASSPHRASE: clean(process.env.BITGET_PASSPHRASE),
  ALLOW_ORIGIN: clean(process.env.ALLOW_ORIGIN),
});

export async function GET(request) {
  return worker.fetch(request, env());
}

export async function OPTIONS(request) {
  return worker.fetch(request, env());
}
