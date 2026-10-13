// DriftBTC 예측 실행 알람 (Cloudflare Worker Cron Trigger)
//
// GitHub Actions 의 예약 실행(schedule)이 몇 시간씩 누락돼서, Cloudflare 의 정시 실행 기능으로
// 매시간 GitHub 워크플로(forecast.yml)를 직접 실행시킨다. 새 캔들이 없으면 워크플로가 알아서 바로 끝난다.
//
// 필요한 Secret: GITHUB_TOKEN  (fine-grained 토큰, driftbtc 저장소의 Actions: Read and write 권한만)
// 필요한 Cron Trigger 예: "2 * * * *", "20 * * * *"

const REPO = "rudalstb/driftbtc";
const WORKFLOW = "forecast.yml";
let last = null; // 마지막 실행 결과 (상태 확인용)

async function dispatch(env) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "driftbtc-cron",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  // 성공하면 204 (본문 없음). 실패하면 GitHub 의 오류 메시지만 남긴다 (토큰 값은 포함되지 않음)
  last = { at: new Date().toISOString(), status: res.status, ok: res.status === 204, message: res.status === 204 ? "" : (await res.text()).slice(0, 200) };
  return last;
}

export default {
  // Cloudflare 가 정해진 시각에 호출
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
  // 브라우저로 열면 상태만 보여준다 (아무나 실행시키지 못하도록 여기서는 실행하지 않음)
  async fetch(request, env) {
    const body = { token_set: Boolean(env.GITHUB_TOKEN), last_run_in_this_instance: last };
    return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  },
};
