"""📄 정적 페이지 생성: 사이트 소개·개인정보처리방침·면책 조항 + 설명(가이드) 페이지 + sitemap.xml
머리글·꼬리글을 한 곳에서 관리하려고 파이썬으로 뽑는다. 내용을 고치려면 아래 PAGES 를 수정하고 다시 실행.

    python pages.py
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
SITE = ROOT / "site"
BASE = "https://rudalstb.github.io/driftbtc/"
UPDATED = "2026년 10월 19일"

FOOT = """<footer>
  <a href="{p}index.html">홈</a><a href="{p}about.html">소개</a><a href="{p}disclaimer.html">면책 조항</a><a href="{p}privacy.html">개인정보처리방침</a>
  <a href="{p}guide/forecast-range.html">예측 범위 읽는 법</a><a href="{p}guide/kimchi-premium.html">김치 프리미엄</a><a href="{p}guide/funding-rate.html">펀딩비</a><a href="{p}guide/liquidation-price.html">청산가</a>
  <div style="margin-top:8px">BTC Agent 는 정보 제공 목적의 사이트이며 투자 권유가 아닙니다. 모든 투자 판단과 책임은 이용자 본인에게 있습니다.</div>
</footer>"""


def wrap(path: str, title: str, desc: str, body: str) -> str:
    depth = path.count("/")
    p = "../" * depth
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} · BTC Agent</title>
  <meta name="description" content="{desc}">
  <link rel="canonical" href="{BASE}{path}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="BTC Agent">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:url" content="{BASE}{path}">
  <meta property="og:image" content="{BASE}og.png">
  <meta property="og:locale" content="ko_KR">
  <link rel="icon" href="{p}favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="{p}style.css">
  <link rel="stylesheet" href="{p}page.css">
</head>
<body>
<main class="page">
  <header><a class="home" href="{p}index.html">BTC Agent <span style="font-size:11px;background:var(--accent);color:#0d1117;border-radius:5px;padding:2px 5px;vertical-align:middle">AI</span></a><h1>{title}</h1><div class="updated">마지막 수정 {UPDATED}</div></header>
{body}
{FOOT.format(p=p)}
</main>
</body>
</html>
"""


PAGES: dict[str, tuple[str, str, str]] = {}

PAGES["about.html"] = ("BTC Agent 소개", "비트코인이 1시간·1일·1주 안에 어디까지 움직일 수 있는지 통계 모델로 예측하고, 예측이 맞았는지 매시간 공개 채점하는 사이트입니다.", """
<p><b>BTC Agent</b>는 "비트코인이 오를까 내릴까"보다 <b>"얼마나 움직일 수 있을까"</b>에 집중하는 사이트입니다. 가격은 아무도 못 맞히지만, 움직임의 크기(변동성)는 통계적으로 꽤 잘 잡힙니다. 그래서 1시간·1일·1주 뒤 가격이 들어올 가능성이 높은 <b>범위</b>를 보여 주고, 그 범위가 실제로 맞았는지 매시간 자동으로 채점해 그대로 공개합니다.</p>
<h2>무엇을 볼 수 있나</h2>
<ul>
  <li><b>예측 범위</b> — 68%·95% 확률로 가격이 머물 구간. 바이낸스 BTC/USDT 1시간 캔들로 15분마다 다시 계산합니다.</li>
  <li><b>이 가격 될까?</b> — 목표 가격과 기간을 넣으면 그 안에 닿을 확률을 계산합니다.</li>
  <li><b>얼마나 들어갈까?</b> — 잃어도 되는 돈과 손절 거리로 들어갈 수량·증거금·청산가를 계산하는 리스크 계산기.</li>
  <li><b>지금 들어가도 될까?</b> — 변동성 극단, FOMC·CPI 발표 창, 펀딩비·쏠림을 점검해 🟢🟡🔴로 알려 주는 상황 신호등.</li>
  <li><b>내 매매 해부</b> — 거래소에서 내려받은 청산 내역 파일을 올리면 손익비·시간대·보유 시간별 약점을 짚어 줍니다. 파일은 브라우저 안에서만 처리됩니다.</li>
  <li><b>운영자 실전 공개</b> — 운영자의 실제 선물 계좌 포지션·청산 기록·매매 해부를 조회 전용 키로 그대로 보여 줍니다. 잘한 것도 못한 것도 숨기지 않습니다.</li>
  <li><b>검증</b> — 모델별 과거 성적, 실제 운영 적중률, 신호를 따랐다면 어땠을지 보여 주는 가상 계좌.</li>
</ul>
<h2>어떻게 예측하나</h2>
<p>최근 가격의 흐름(수익률·변동성·거래량 특징)으로 다음 캔들의 움직임을 세 가지 모델(단순 기준, 릿지 회귀, 그래디언트 부스팅)로 예측하고, 변동성은 GARCH 모델로 추정합니다. 과거 3년 데이터로 '걷기식 검증'(미래 데이터를 전혀 보지 않고 한 칸씩 앞으로 나가며 채점)을 했고, 그 성적을 사이트 아래 "정확도는 얼마나 되나요?"에 공개합니다. 솔직히 말하면 방향 예측의 우위는 아주 얇고, 범위 예측이 이 사이트의 핵심입니다.</p>
<h2>운영 원칙</h2>
<ul>
  <li>예측이 틀린 기록도 지우지 않습니다. 채점은 자동이며 운영자가 손댈 수 없습니다.</li>
  <li>투자 권유를 하지 않습니다. 롱/숏 관점은 실험이며, 가상 계좌 성적이 그 한계를 보여 줍니다.</li>
  <li>이용자의 거래 내역·잔고 같은 개인 정보는 서버로 보내지도, 저장하지도 않습니다.</li>
</ul>
<h2>문의</h2>
<p>오류 제보나 제안은 <a href="https://github.com/rudalstb/driftbtc/issues" target="_blank" rel="noopener">GitHub 이슈</a>로 남겨 주세요.</p>
<a class="cta" href="index.html">사이트로 돌아가기 →</a>
""")

PAGES["disclaimer.html"] = ("면책 조항", "BTC Agent 의 모든 정보는 참고용이며 투자 권유·자문이 아닙니다. 암호화폐 선물 거래의 위험과 이용 시 유의사항을 안내합니다.", """
<div class="box"><b>요약:</b> 이 사이트의 어떤 내용도 특정 자산을 사거나 팔라는 권유가 아닙니다. 모든 투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다.</div>
<h2>1. 정보 제공 목적</h2>
<p>BTC Agent 가 제공하는 예측 범위, 상승·하락 확률, 롱/숏 관점, 상황 신호등, 계산기 결과, 운영자 포지션 공개 등 모든 콘텐츠는 통계 모델과 공개 시장 데이터를 바탕으로 한 <b>정보 제공·교육 목적</b>의 자료입니다. 금융투자업자의 투자 자문, 일임, 권유에 해당하지 않으며 운영자는 금융 관련 자격을 보유하고 있지 않습니다.</p>
<h2>2. 정확성과 미래 성과</h2>
<p>예측은 과거 데이터에 기반한 확률적 추정이며 실제 가격은 범위를 벗어날 수 있습니다. 사이트에 공개된 과거 적중률·백테스트·가상 계좌 성적은 미래 성과를 보장하지 않습니다. 데이터 제공처(거래소 API 등)의 장애, 지연, 오류로 정보가 부정확하거나 늦게 반영될 수 있습니다.</p>
<h2>3. 암호화폐 선물 거래의 위험</h2>
<p>암호화폐 선물은 레버리지로 인해 <b>투자 원금 전부를 잃을 수 있는</b> 고위험 상품입니다. 청산가·증거금 등 계산기 결과는 단순화한 근사치이며 실제 거래소 규칙(유지증거금률, 수수료, 펀딩비, 호가 단위 등)과 다를 수 있습니다. 주문 전 반드시 거래소에서 직접 확인하세요.</p>
<h2>4. 운영자 포지션 공개</h2>
<p>운영자의 실제 포지션과 거래 기록은 투명성을 위해 공개하는 것이며, 따라 하라는 뜻이 아닙니다. 운영자는 공개한 포지션으로 손실을 볼 수 있고, 실제로 손실 기록도 그대로 공개되어 있습니다.</p>
<h2>5. 책임의 제한</h2>
<p>운영자는 이 사이트의 정보를 이용하여 발생한 직접·간접 손실에 대해 어떠한 법적 책임도 지지 않습니다. 사이트는 예고 없이 변경·중단될 수 있습니다.</p>
<h2>6. 외부 링크와 광고</h2>
<p>사이트에는 제3자 광고나 외부 사이트 링크가 포함될 수 있습니다. 해당 콘텐츠는 운영자가 보증하지 않으며, 외부 사이트 이용은 각 사이트의 약관을 따릅니다.</p>
""")

PAGES["privacy.html"] = ("개인정보처리방침", "BTC Agent 가 수집하는 정보와 수집하지 않는 정보, 쿠키·광고·브라우저 저장소 이용에 대한 안내입니다.", """
<div class="box"><b>요약:</b> 회원 가입이 없고, 이름·이메일·IP 같은 개인정보를 저장하지 않습니다. 방문자 수는 익명 번호로만 셉니다. 거래 내역 파일은 브라우저 안에서만 처리되고 서버로 전송되지 않습니다.</div>
<h2>1. 수집하는 정보</h2>
<ul>
  <li><b>익명 방문 집계</b> — 브라우저가 스스로 만든 임의의 번호(개인을 식별할 수 없음)로 순 방문자 수·조회수·접속 중 인원을 셉니다. IP 주소, 기기 정보, 위치는 저장하지 않습니다.</li>
  <li><b>화면 이용 집계</b> — 어떤 영역(예: 계산기, 신호등)이 얼마나 쓰이는지 영역 이름과 횟수만 셉니다. 입력한 값은 포함되지 않습니다.</li>
</ul>
<h2>2. 수집하지 않는 정보</h2>
<ul>
  <li>"내 매매 해부"에 올리는 거래 내역 파일은 <b>이용자의 브라우저 안에서만</b> 읽고 분석하며, 서버로 전송하거나 저장하지 않습니다.</li>
  <li>리스크 계산기에 입력한 잔고 등은 이용자 브라우저의 저장소(localStorage)에만 남아 다음 방문 때 편의를 위해 쓰이며, 운영자는 볼 수 없습니다. 브라우저 데이터 삭제로 지울 수 있습니다.</li>
</ul>
<h2>3. 쿠키와 브라우저 저장소</h2>
<p>로그인 쿠키는 사용하지 않습니다. 통화 선택(원화/달러), 계산기 입력값, 접은 영역 같은 화면 설정을 브라우저 저장소에 보관합니다.</p>
<h2>4. 광고</h2>
<p>사이트에 제3자 광고(예: Google AdSense)가 게재될 수 있습니다. 광고 제공자는 이용자의 관심사에 맞는 광고를 보여 주기 위해 자체 쿠키를 사용할 수 있으며, 이는 해당 제공자의 개인정보처리방침을 따릅니다. 맞춤 광고는 <a href="https://adssettings.google.com" target="_blank" rel="noopener">Google 광고 설정</a>에서 해제할 수 있습니다.</p>
<h2>5. 외부 서비스</h2>
<p>시세·시장 데이터는 바이낸스·업비트·야후 파이낸스 등 공개 API 에서 받아오며, 이 과정에서 이용자의 정보가 해당 서비스로 전달되지는 않습니다(서버가 대신 요청하거나 공개 데이터만 요청). 사이트는 GitHub Pages 와 Vercel 에서 호스팅됩니다.</p>
<h2>6. 보관과 파기</h2>
<p>익명 집계값은 통계 목적으로 보관하며, 날짜별 세부 집계는 40일 뒤 자동 삭제됩니다.</p>
<h2>7. 문의</h2>
<p>개인정보 관련 문의는 <a href="https://github.com/rudalstb/driftbtc/issues" target="_blank" rel="noopener">GitHub 이슈</a>로 남겨 주세요. 이 방침은 변경될 수 있으며, 변경 시 이 페이지에 수정일을 표시합니다.</p>
""")

PAGES["guide/forecast-range.html"] = ("비트코인 예측 범위 읽는 법 (68%·95% 구간)", "BTC Agent 의 예측 범위가 무엇을 뜻하는지, 68%와 95% 구간의 차이, 범위를 매매에 어떻게 쓰는지 쉽게 설명합니다.", """
<p>BTC Agent 의 첫 화면에는 "±$318 (±0.39%) 안에서 움직여요" 같은 문장과 두 겹의 띠가 있습니다. 이 글은 그 숫자를 읽는 법입니다.</p>
<h2>범위는 "맞힌다"가 아니라 "가둔다"</h2>
<p>가격이 정확히 어디로 갈지는 아무도 모릅니다. 대신 <b>얼마나 멀리 갈 수 있는지</b>는 최근 변동성으로 꽤 잘 추정됩니다. 예측 범위는 "이 안에 들어올 가능성이 68%(또는 95%)인 구간"입니다.</p>
<table><tr><th>구간</th><th>뜻</th><th>쓰임</th></tr>
<tr><td>68% (진한 띠)</td><td>3번 중 2번은 이 안</td><td>평소 움직임의 크기 · 익절 목표의 현실성 점검</td></tr>
<tr><td>95% (연한 띠)</td><td>20번 중 19번은 이 안</td><td>손절·청산가를 이 밖에 둘지 판단</td></tr></table>
<h2>어떻게 계산하나</h2>
<p>최근 가격 흐름으로 다음 캔들의 변동성을 GARCH 모델로 추정하고, 정규분포보다 꼬리가 두꺼운 분포(t 분포)로 구간을 만듭니다. 그래서 급등락이 잦은 시기에는 띠가 자동으로 넓어지고, 조용한 시기에는 좁아집니다.</p>
<h2>매매에 쓰는 세 가지 방법</h2>
<ol>
  <li><b>손절 거리 정하기</b> — 손절을 68% 구간 안쪽에 두면 방향이 맞아도 평소 출렁임에 털릴 확률이 높습니다. 사이트의 리스크 계산기는 "24시간 안에 손절가에 닿을 확률"을 바로 보여 줍니다.</li>
  <li><b>익절 목표 점검</b> — 목표가가 95% 구간 밖이면 그 기간 안에 도달할 가능성이 낮습니다. "이 가격 될까?" 계산기로 확률을 확인하세요.</li>
  <li><b>레버리지 상한</b> — 청산가가 95% 구간 안에 있으면 하루 안에 청산될 위험이 현실적입니다. 레버리지를 낮추는 신호입니다.</li>
</ol>
<h2>얼마나 믿을 수 있나</h2>
<p>사이트는 매시간 실제 가격이 범위 안에 들어왔는지 자동 채점하고, "실제 운영 기록" 카드에 비율을 공개합니다. 95% 구간이 장기적으로 93~96% 정도 맞으면 정상입니다. 100%에 가까우면 띠가 쓸데없이 넓은 것이고, 85% 아래면 변동성 급변기라 주의가 필요합니다.</p>
<a class="cta" href="../index.html">지금 예측 범위 보기 →</a>
""")

PAGES["guide/kimchi-premium.html"] = ("김치 프리미엄이란? 계산법과 보는 법", "김치 프리미엄의 뜻, 계산 공식, 높을 때와 마이너스일 때의 의미, 환율이 미치는 영향을 설명합니다.", """
<p><b>김치 프리미엄(김프)</b>은 한국 거래소(업비트 등)의 비트코인 원화 가격이 해외 거래소 달러 가격보다 얼마나 비싼지를 퍼센트로 나타낸 값입니다.</p>
<div class="formula">김프(%) = ( 업비트 원화 가격 ÷ ( 바이낸스 달러 가격 × 원·달러 환율 ) − 1 ) × 100</div>
<p>예: 업비트 1억 1,100만 원, 바이낸스 82,000달러, 환율 1,340원이면 82,000 × 1,340 = 1억 988만 원이므로 김프는 약 +1.0%입니다. BTC Agent 첫 화면의 BTC·ETH 카드에 실시간으로 표시됩니다.</p>
<h2>왜 생기나</h2>
<ul>
  <li>한국은 외환 규제로 달러를 해외 거래소로 쉽게 보내기 어려워 차익 거래가 제한됩니다.</li>
  <li>국내 수요가 몰리면(상승장 후반) 프리미엄이 커지고, 공포 국면에서는 마이너스(역프)가 되기도 합니다.</li>
</ul>
<h2>보는 법</h2>
<table><tr><th>김프</th><th>흔한 해석</th></tr>
<tr><td>0 ~ +2%</td><td>평상시 범위</td></tr>
<tr><td>+3% 이상</td><td>국내 과열 신호로 자주 언급됨. 2021년 초에는 +20%까지 간 적 있음</td></tr>
<tr><td>마이너스</td><td>국내 투자 심리 위축. 바닥 근처에서 자주 관찰되지만 확정 신호는 아님</td></tr></table>
<h2>주의할 점</h2>
<ul>
  <li><b>환율이 핵심 변수</b>입니다. 환율이 10원 오르면 같은 가격이라도 김프는 약 0.75%p 내려갑니다. BTC Agent 는 1분 단위 환율을 씁니다.</li>
  <li>거래소마다 가격이 조금씩 달라 어느 거래소를 기준으로 하느냐에 따라 0.1~0.3%p 차이가 납니다.</li>
  <li>김프 자체로 방향을 맞히려 하기보다 시장 심리를 읽는 보조 지표로 쓰는 것이 안전합니다.</li>
</ul>
<a class="cta" href="../index.html">실시간 김프 보기 →</a>
""")

PAGES["guide/funding-rate.html"] = ("펀딩비(펀딩 레이트)란? 롱·숏 중 누가 내는지", "무기한 선물의 펀딩비 개념, 8시간마다 정산되는 구조, 양수·음수의 의미, 과열 판단 기준과 비용 계산법을 설명합니다.", """
<p><b>펀딩비</b>는 무기한 선물 가격이 현물 가격에서 너무 멀어지지 않게 하려고, 롱과 숏 포지션 보유자끼리 8시간마다 주고받는 돈입니다. 거래소가 가져가는 수수료가 아닙니다.</p>
<h2>누가 누구에게 내나</h2>
<table><tr><th>펀딩비</th><th>뜻</th><th>돈의 흐름</th></tr>
<tr><td>양수 (+)</td><td>선물이 현물보다 비쌈 = 롱이 많음</td><td>롱 보유자 → 숏 보유자</td></tr>
<tr><td>음수 (−)</td><td>선물이 현물보다 쌈 = 숏이 많음</td><td>숏 보유자 → 롱 보유자</td></tr></table>
<p>바이낸스 기준 보통 +0.01%(8시간)가 "중립"입니다. 하루 3번이니 연 환산으로 약 11%에 해당합니다.</p>
<h2>비용 계산</h2>
<div class="formula">펀딩 비용 = 포지션 명목 금액 × 펀딩비<br>예: 10,000달러 롱, 펀딩 +0.03% → 8시간마다 3달러, 하루 9달러</div>
<p>레버리지를 높여도 명목 금액 기준으로 내기 때문에, 증거금 1,000달러로 10배 롱을 들고 있으면 증거금 대비 하루 0.9%가 빠져나갑니다. 오래 들고 있을수록 무시 못 할 비용입니다.</p>
<h2>과열 판단에 쓰기</h2>
<ul>
  <li><b>+0.05% 이상</b>이 이어지면 롱이 비싸게 버티는 중입니다. 작은 하락에도 롱 청산이 연쇄로 터지기 쉬워 BTC Agent 의 상황 신호등은 이때 "롱 신호 끔"으로 바꿉니다.</li>
  <li><b>−0.02% 이하</b>면 숏 과밀입니다. 급등 시 숏 스퀴즈가 나기 쉽습니다.</li>
  <li>펀딩비는 군중이 어디에 몰렸는지 보여 주는 지표이지, 방향을 알려 주는 지표가 아닙니다. 극단일수록 "군중 반대편"을 경계하는 용도로 쓰세요.</li>
</ul>
<a class="cta" href="../index.html#futures">지금 펀딩비 보기 →</a>
""")

PAGES["guide/liquidation-price.html"] = ("청산가 계산법: 레버리지별 청산 거리와 피하는 법", "선물 청산가가 어떻게 정해지는지, 레버리지별 청산까지 거리, 격리·교차 차이, 청산을 피하는 포지션 크기 정하는 법을 설명합니다.", """
<p><b>청산가</b>는 손실이 증거금을 거의 다 잠식해서 거래소가 강제로 포지션을 닫는 가격입니다. 손절 주문과 달리 내가 고르는 값이 아니라 레버리지와 증거금으로 자동 결정됩니다.</p>
<h2>간단 공식 (격리 마진)</h2>
<div class="formula">롱 청산가 ≈ 진입가 × ( 1 − 1 ÷ 레버리지 + 유지증거금률 )<br>숏 청산가 ≈ 진입가 × ( 1 + 1 ÷ 레버리지 − 유지증거금률 )</div>
<p>유지증거금률은 포지션 크기에 따라 0.4~0.5%(소액)에서 커집니다. 실제 값은 거래소 주문창이 가장 정확합니다.</p>
<h2>레버리지별 청산까지 거리</h2>
<table><tr><th>레버리지</th><th>청산까지 거리 (대략)</th><th>비트코인 하루 변동성 1.5% 기준</th></tr>
<tr><td>3배</td><td>약 33%</td><td>사실상 하루 안에 청산 불가</td></tr>
<tr><td>5배</td><td>약 19.5%</td><td>매우 드묾</td></tr>
<tr><td>10배</td><td>약 9.5%</td><td>급락장에서 가능</td></tr>
<tr><td>20배</td><td>약 4.5%</td><td>하루 안에 닿을 확률 수 %</td></tr>
<tr><td>50배</td><td>약 1.5%</td><td>평범한 하루 출렁임에도 청산</td></tr>
<tr><td>100배</td><td>약 0.5%</td><td>몇 분 안에도 청산</td></tr></table>
<h2>격리와 교차</h2>
<ul>
  <li><b>격리(Isolated)</b> — 이 포지션에 넣은 증거금만 잃습니다. 청산가가 가깝지만 손실이 한정됩니다.</li>
  <li><b>교차(Cross)</b> — 계좌 잔고 전체가 증거금 역할을 해서 청산가가 멀어지지만, 청산되면 계좌 전체를 잃을 수 있습니다.</li>
</ul>
<h2>청산을 피하는 순서</h2>
<ol>
  <li>잃어도 되는 돈(잔고의 1~2%)을 먼저 정한다.</li>
  <li>손절 거리를 정한다(최근 변동성보다 넓게).</li>
  <li>수량 = 잃어도 되는 돈 ÷ 손절 거리. 레버리지는 그 수량을 열기 위한 수단일 뿐이다.</li>
  <li>손절가가 청산가보다 <b>항상 진입가에 가까워야</b> 한다. 반대면 손절 전에 청산된다.</li>
</ol>
<p>BTC Agent 의 "얼마나 들어갈까?" 계산기는 이 순서대로 수량·증거금·청산가와 하루 안에 청산될 확률을 계산해 줍니다.</p>
<a class="cta" href="../index.html#risk">리스크 계산기 열기 →</a>
""")


def main() -> None:
    urls = [BASE]
    for path, (title, desc, body) in PAGES.items():
        out = SITE / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(wrap(path, title, desc, body), encoding="utf-8", newline="\n")
        urls.append(BASE + path)
    today = date.today().isoformat()
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls) + "</urlset>\n"
    (SITE / "sitemap.xml").write_text(sitemap, encoding="utf-8", newline="\n")
    (SITE / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {BASE}sitemap.xml\n", encoding="utf-8", newline="\n")
    print(f"{len(PAGES)}개 페이지 + sitemap.xml + robots.txt 생성")


if __name__ == "__main__":
    main()
