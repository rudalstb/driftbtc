// 비트겟 포지션 중계 주소 (Vercel 서버리스 함수, api/positions.js)
// 비워 두면 '운영자 실전 포지션' 카드가 숨겨진다
window.POSITIONS_URL = "https://driftbtc.vercel.app/api/positions";

// 운영자 시드·출금 기록 (달러). 출금이 늘면 withdrawn 숫자만 바꾸면 된다
// 총 수익 = 누적 출금 + 현재 자산 − 시드
// autoFlows: true 로 켜면 비트겟 입출금 기록으로 누적 입금·출금을 자동 집계하고, since(날짜) 이후 기록만 센다
window.OPERATOR = { seed: 1700, withdrawn: 3888, autoFlows: true, since: "2026-06-03" }; // 2026-06-03 $1,725.85 입금부터 비트겟 기록으로 자동 집계 (seed·withdrawn 은 기록을 못 받을 때만 씀)

// 카피트레이딩 원금 직접 지정 (프로젝트 번호: 달러). 비트겟이 원금을 0 으로 주는 경우(원금 출금 등)에만 쓴다
// 비워 두면 비트겟이 주는 누적 투자 금액을 그대로 쓴다
window.COPY_PRINCIPAL = {
  "1477845695045435392": 100, // trader丶🥇 (비트겟이 원금을 0으로 줌)
};

// 방문자 수 집계 주소 (Vercel 서버리스 함수, api/visit.js). 저장소(Upstash Redis)를 연결하기 전에는 표시되지 않는다
window.VISIT_URL = "https://driftbtc.vercel.app/api/visit";

// 달러→원화 환율 중계 주소 (Vercel 서버리스 함수, api/fx.js). 원화 표시·김치 프리미엄 계산에 쓴다
window.FX_URL = "https://driftbtc.vercel.app/api/fx";

// 오늘 한마디·롱/숏 투표 (Vercel 서버리스 함수, api/say.js). 비워 두면 카드가 "불러올 수 없어요"로 남는다
window.SAY_URL = "https://driftbtc.vercel.app/api/say";

// 텔레그램 공개 채널 주소 (예: "https://t.me/driftbtc"). 비워 두면 버튼이 숨겨진다
window.TELEGRAM_URL = "";

// 나스닥100 선물 캔들 중계 (Vercel 서버리스 함수, api/nq.js). 야후 파이낸스라 약 10~15분 지연
window.NQ_URL = "https://driftbtc.vercel.app/api/nq";

// 한국어 코인 뉴스 중계 (Vercel 서버리스 함수, api/news.js) — 제목·링크·시각만
window.NEWS_URL = "https://driftbtc.vercel.app/api/news";
