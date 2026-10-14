// 비트겟 포지션 중계 주소 (Vercel 서버리스 함수, api/positions.js)
// 비워 두면 '운영자 실전 포지션' 카드가 숨겨진다
window.POSITIONS_URL = "https://driftbtc.vercel.app/api/positions";

// 운영자 시드·출금 기록 (달러). 출금이 늘면 withdrawn 숫자만 바꾸면 된다
// 총 수익 = 누적 출금 + 현재 자산 − 시드
window.OPERATOR = { seed: 1700, withdrawn: 3588 };

// 카피트레이딩 원금 직접 지정 (프로젝트 번호: 달러). 비트겟이 원금을 0 으로 주는 경우(원금 출금 등)에만 쓴다
// 비워 두면 비트겟이 주는 누적 투자 금액을 그대로 쓴다
window.COPY_PRINCIPAL = {
  "1477845695045435392": 100, // trader丶🥇 (비트겟이 원금을 0으로 줌)
};

// 방문자 수 집계 주소 (Vercel 서버리스 함수, api/visit.js). 저장소(Upstash Redis)를 연결하기 전에는 표시되지 않는다
window.VISIT_URL = "https://driftbtc.vercel.app/api/visit";
