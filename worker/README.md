# 비트겟 포지션 중계 (Cloudflare Worker)

사이트의 "📊 운영자 실전 포지션" 카드에 비트겟 USDT-M 선물 포지션을 실시간으로 보여준다.
API 키는 Cloudflare Worker 의 Secret 에만 저장하고, 저장소와 사이트에는 절대 넣지 않는다.

## 1. 비트겟 API 키 만들기 (조회 전용)

1. 비트겟 → 프로필 → **API 관리** → **API 키 생성** → 시스템 생성(HMAC)
2. 이름: `driftbtc`, 패스프레이즈는 직접 정해서 따로 적어 둔다
3. 권한: **읽기(Read-only)만** 켠다. 거래·이체·출금은 모두 끈다
4. 발급된 **API Key / Secret Key / Passphrase** 를 안전한 곳에 적어 둔다 (채팅·코드에 붙여 넣지 않기)

## 2. Cloudflare Worker 만들기

1. https://dash.cloudflare.com 가입 (무료)
2. **Workers & Pages** → **Create** → **Create Worker** → 이름 `driftbtc-positions` → **Deploy**
3. **Edit code** → 기존 코드를 모두 지우고 `worker/positions.js` 내용을 붙여 넣기 → **Deploy**
4. Worker → **Settings** → **Variables and Secrets** → **Add** (Type: **Secret**) 로 3개 추가
   - `BITGET_API_KEY`
   - `BITGET_API_SECRET`
   - `BITGET_PASSPHRASE`
5. Worker 주소(`https://driftbtc-positions.<아이디>.workers.dev`)를 브라우저로 열어
   `{"updated":..., "mode":"uta" 또는 "classic", ...}` 가 나오면 성공

## 3. 사이트에 연결

`site/config.js` 의 `window.POSITIONS_URL` 에 Worker 주소를 넣고 커밋하면 카드가 나타난다.

## 동작

- 통합 계정(UTA, v3)과 기존 계정(Classic, v2)을 자동 구분
- 비트겟 호출은 3초에 한 번으로 제한 (방문자가 많아도 동일), 사이트는 5초마다 조회
- 다른 사이트에서 호출하지 못하도록 `https://rudalstb.github.io` 만 허용 (변수 `ALLOW_ORIGIN` 으로 변경 가능)
