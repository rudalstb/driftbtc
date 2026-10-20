// Vercel 서버리스 함수: 운영자 입금·출금 기록 (비트겟 지갑 기록, 금액·코인·시각만).
// 비트겟 호출이 30번 넘게 필요해 포지션 함수(10초 제한)와 분리했다 (vercel.json 에서 60초).
// 매시간 GitHub Actions(flows.py)가 받아 site/data/flows.json 에 저장하고, 화면은 그 파일을 읽는다.
import { readFlows, summarizeFlows, corsHeaders } from "../worker/positions.js";
import { env } from "./positions.js";

export async function GET(request) {
  const headers = corsHeaders(request, env());
  try {
    const q = new URL(request.url).searchParams;
    const since = Date.parse(q.get("since") || "") || 0;
    const windows = Math.min(40, Math.max(1, Number(q.get("windows")) || 16)); // ?windows=40 → 약 3년치
    const f = summarizeFlows(await readFlows(env(), windows), since);
    return new Response(JSON.stringify(f), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers });
  }
}
