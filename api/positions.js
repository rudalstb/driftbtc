// Vercel 서버리스 함수: worker/positions.js 의 같은 로직을 Vercel 에서 실행한다.
// 비트겟이 Cloudflare Worker 에서 오는 요청을 차단({"cloudflare":"block"})해서 Vercel(서울 리전)로 옮김.
// 키는 Vercel 프로젝트의 Environment Variables 에만 둔다:
//   BITGET_API_KEY, BITGET_API_SECRET, BITGET_PASSPHRASE
import worker from "../worker/positions.js";

export async function GET(request) {
  return worker.fetch(request, process.env);
}

export async function OPTIONS(request) {
  return worker.fetch(request, process.env);
}
