"""📄 정적 페이지 생성: 사이트 소개·개인정보처리방침·면책 조항 + 설명(가이드) 페이지 + sitemap.xml
머리글·꼬리글을 한 곳에서 관리하려고 파이썬으로 뽑는다. 내용을 고치려면 아래 PAGES 를 수정하고 다시 실행.

    python pages.py
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from email.utils import format_datetime
from html import escape, unescape
from pathlib import Path

ROOT = Path(__file__).parent
SITE = ROOT / "site"
BASE = "https://btc.rudals.app/"
UPDATED = "2026년 11월 18일"

FOOT = """<footer>
  <a href="{p}index.html">BTC Agent 홈</a><a href="https://rudals.app/">다른 앱 둘러보기</a><a href="{p}about.html">소개</a><a href="{p}disclaimer.html">면책 조항</a><a href="{p}privacy.html">개인정보처리방침</a>
  <a href="#" class="mail" data-u="rudalstb" data-d="gmail.com">✉️ 문의하기</a><a href="{p}faq.html">❓ 자주 묻는 질문</a><a href="{p}guide/">📚 매매 가이드</a><a href="{p}guide/glossary.html">📖 용어 사전</a><a href="{p}daily/">📅 시장 일지</a><a href="{p}weekly/">🗓️ 주간 일지</a><a href="{p}monthly/">📊 월간 성적표</a>
  <div style="margin-top:8px">BTC Agent 는 정보 제공 목적의 사이트이며 투자 권유가 아닙니다. 모든 투자 판단과 책임은 이용자 본인에게 있습니다.</div>
</footer>"""


# 카카오 애드핏 광고를 넣는 페이지 (site/ads.js). 개인정보처리방침·면책 조항에는 넣지 않는다
def has_ads(path: str) -> bool:
    return path.startswith("guide/") or path in ("about.html", "faq.html")


# 페이지별로 <head> 에 더 넣을 것 (구조화 데이터 등)
EXTRA_HEAD: dict[str, str] = {}

UPDATED_ISO = "2026-11-18"

# 🔎 검색 등록 소유 확인 코드 (구글 서치 콘솔 · 네이버 서치어드바이저의 'HTML 태그' 방식에서 content="..." 안의 값만)
# 넣고 python pages.py 를 실행하면 모든 글과 메인(index.html)에 들어간다
VERIFY = {"google": "", "naver": ""}

# 📚 가이드 끝 '다음에 읽을 글' (guide/ 뒤 이름)
RELATED = {
    "forecast-range": ["stop-loss", "sudden-moves", "leverage"],
    "kimchi-premium": ["upbit-profit", "funding-rate"],
    "funding-rate": ["liquidations", "trading-fees", "kimchi-premium"],
    "liquidation-price": ["leverage", "stop-loss", "liquidations"],
    "leverage": ["liquidation-price", "stop-loss", "win-rate-reward"],
    "stop-loss": ["forecast-range", "win-rate-reward", "leverage"],
    "win-rate-reward": ["stop-loss", "averaging-down", "trading-fees"],
    "averaging-down": ["liquidation-price", "win-rate-reward", "upbit-profit"],
    "trading-fees": ["funding-rate", "win-rate-reward", "leverage"],
    "upbit-profit": ["averaging-down", "kimchi-premium"],
    "liquidations": ["liquidation-price", "sudden-moves", "funding-rate"],
    "sudden-moves": ["liquidations", "forecast-range", "stop-loss"],
    "glossary": ["forecast-range", "leverage", "funding-rate"],
}

# 매주 숫자가 새로 들어가는 가이드 — '마지막 수정'·dateModified 를 다시 쓴 날로
DATA_GUIDES = {"guide/sudden-moves.html", "guide/fomc-cpi.html", "guide/fear-greed.html", "guide/volatile-hours.html"}

SECTION = {"daily": ("시장 일지", "daily/"), "weekly": ("주간 일지", "weekly/"), "monthly": ("월간 성적표", "monthly/"), "guide": ("매매 가이드", "guide/")}


def verify_meta() -> str:
    names = {"google": "google-site-verification", "naver": "naver-site-verification"}
    return "".join(f'\n  <meta name="{names[k]}" content="{v}">' for k, v in VERIFY.items() if v)


def _dates(path: str) -> tuple[str, str]:
    """(처음 쓴 날, 마지막 수정일) — 일지·성적표는 파일 이름의 날짜, 나머지는 UPDATED_ISO."""
    m = re.match(r"(daily|weekly|monthly)/(\d{4}-\d{2}(?:-\d{2})?)\.html$", path)
    if m:
        d = m.group(2) if len(m.group(2)) == 10 else m.group(2) + "-01"
        return d, d
    if path in DATA_GUIDES:
        return UPDATED_ISO, date.today().isoformat()
    return UPDATED_ISO, UPDATED_ISO


def structured(path: str, title: str, desc: str, image: str | None) -> str:
    """구글·네이버가 읽는 위치(홈 › 분류 › 글)와 글 정보(Article). 목록·안내 페이지는 위치만."""
    top = path.split("/")[0] if "/" in path else ""
    crumbs = [{"@type": "ListItem", "position": 1, "name": "BTC Agent", "item": BASE}]
    if top in SECTION:
        crumbs.append({"@type": "ListItem", "position": 2, "name": SECTION[top][0], "item": BASE + SECTION[top][1]})
    if not path.endswith("index.html"):
        crumbs.append({"@type": "ListItem", "position": len(crumbs) + 1, "name": title, "item": BASE + path})
    out = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": crumbs}]
    if top in SECTION and not path.endswith("index.html"):
        pub, mod = _dates(path)
        org = {"@type": "Organization", "name": "BTC Agent", "url": BASE, "logo": {"@type": "ImageObject", "url": BASE + "icons/icon-192.png"}}
        out.append({"@context": "https://schema.org", "@type": "Article", "headline": title[:110], "description": desc,
                    "datePublished": pub, "dateModified": mod, "inLanguage": "ko", "url": BASE + path,
                    "mainEntityOfPage": BASE + path, "image": image or BASE + "og.png", "author": org, "publisher": org})
    return "".join('\n  <script type="application/ld+json">' + json.dumps(o, ensure_ascii=False) + "</script>" for o in out)


def related(path: str, p: str) -> str:
    """가이드 끝 '📚 다음에 읽을 글' (일지·성적표는 site/page.js 가 이전·다음 글을 붙인다)."""
    name = path.removeprefix("guide/").removesuffix(".html")
    if not path.startswith("guide/") or name not in RELATED:
        return ""
    items = [(f"guide/{n}.html", PAGES[f"guide/{n}.html"][0]) for n in RELATED[name] if f"guide/{n}.html" in PAGES]
    if not items:
        return ""
    return ('\n<section class="read-next"><h2>📚 다음에 읽을 글</h2><ul>' + "".join(f'<li><a href="{p}{u}">{t}</a></li>' for u, t in items)
            + f'</ul><p class="muted"><a href="{p}guide/">가이드 전체 보기</a> · <a href="{p}daily/">시장 일지</a></p></section>')


def wrap(path: str, title: str, desc: str, body: str, updated: str | None = None, image: str | None = None) -> str:
    depth = path.count("/")
    p = "../" * depth
    ad_head = f'\n  <script src="{p}ads.js" defer></script>' if has_ads(path) else ""
    ad_end = '\n<div class="ad-slot" data-ad-slot="article-end" aria-label="광고"></div>' if has_ads(path) else ""
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
  <meta property="og:image" content="{image or BASE + "og.png"}">
  <meta name="twitter:card" content="summary_large_image">
  <meta property="og:locale" content="ko_KR">
  <link rel="icon" href="{p}favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="{p}style.css">
  <link rel="stylesheet" href="{p}page.css">
  <link rel="alternate" type="application/rss+xml" title="BTC Agent 새 글" href="{p}rss.xml">{verify_meta()}{structured(path, title, desc, image)}{ad_head}{EXTRA_HEAD.get(path, "")}
</head>
<body>
<main class="page">
  <header><a class="up" href="https://rudals.app/">다른 앱 둘러보기 ›</a><br><a class="home" href="{p}index.html">BTC Agent <span style="font-size:11px;background:var(--accent);color:#0d1117;border-radius:5px;padding:2px 5px;vertical-align:middle">AI</span></a><h1>{title}</h1><div class="updated">{updated or "마지막 수정 " + UPDATED}</div></header>
{body}{related(path, p)}{ad_end}
{FOOT.format(p=p)}
</main>
<script src="{p}page.js" defer></script>
<script>document.querySelectorAll("a.mail").forEach((a) => {{ const addr = a.dataset.u + "@" + a.dataset.d; a.href = "mailto:" + addr + "?subject=" + encodeURIComponent("[BTC Agent] 문의"); if (!a.textContent.trim()) a.textContent = addr; }});</script>
</body>
</html>
"""


PAGES: dict[str, tuple[str, str, str]] = {}

PAGES["about.html"] = ("BTC Agent 소개", "비트코인이 1시간·1일·1주 안에 어디까지 움직일 수 있는지 통계 모델로 예측하고, 예측이 맞았는지 매시간 공개 채점하는 사이트입니다.", """
<p><b>BTC Agent</b>는 "비트코인이 오를까 내릴까"보다 <b>"얼마나 움직일 수 있을까"</b>에 집중하는 사이트입니다. 가격은 아무도 못 맞히지만, 움직임의 크기(변동성)는 통계적으로 꽤 잘 잡힙니다. 그래서 1시간·1일·1주 뒤 가격이 들어올 가능성이 높은 <b>범위</b>를 보여 주고, 그 범위가 실제로 맞았는지 매시간 자동으로 채점해 그대로 공개합니다.</p>
<h2>무엇을 볼 수 있나</h2>
<ul>
  <li><b>예측 범위</b> — 68%·95% 확률로 가격이 머물 구간. 바이낸스 BTC/USDT 1시간 캔들이 마감될 때마다(매시간) 다시 계산합니다. 이더리움도 같은 방법으로 보여 줍니다.</li>
  <li><b>이 가격 될까?</b> — 목표 가격과 기간을 넣으면 그 안에 닿을 확률을 계산합니다.</li>
  <li><b>얼마나 들어갈까?</b> — 잃어도 되는 돈과 손절 거리로 들어갈 수량·증거금·청산가를 계산하는 리스크 계산기.</li>
  <li><b>지금 들어가도 될까?</b> — 변동성 극단, FOMC·CPI 발표 창, 펀딩비·쏠림을 점검해 🟢🟡🔴로 알려 주는 상황 신호등.</li>
  <li><b>내 매매 해부</b> — 거래소에서 내려받은 청산 내역 파일을 올리면 손익비·시간대·보유 시간별 약점을 짚어 줍니다. 파일은 브라우저 안에서만 처리됩니다.</li>
  <li><b>운영자 실전 공개</b> — 운영자의 실제 선물 계좌 포지션·청산 기록·매매 해부를 조회 전용 키로 그대로 보여 줍니다. 잘한 것도 못한 것도 숨기지 않습니다.</li>
  <li><b>강제 청산</b> — 바이낸스 실시간 청산 흐름과 OKX 시간별 청산 합계로, 지금 롱과 숏 중 어느 쪽이 털리고 있는지 보여 줍니다.</li>
  <li><b>범위 맞히기 게임</b> — 이번 주 비트코인 종가 범위를 골라 AI 예측 범위와 같은 잣대로 겨룹니다. 로그인 없이 익명으로 참가합니다.</li>
  <li><b>가격 알림</b> — 목표 가격을 저장해 두면 실시간 가격이 닿을 때 브라우저 알림으로 알려 줍니다.</li>
  <li><b>검증</b> — 모델별 과거 성적, 실제 운영 적중률, 신호를 따랐다면 어땠을지 보여 주는 가상 계좌.</li>
</ul>
<h2>어떻게 만들었나</h2>
<ul>
  <li><b>예측 범위</b>는 GARCH(1,1)-t 변동성 모델로 만듭니다. 중앙값은 현재 가격이에요.</li>
  <li><b>롱/숏 관점</b>은 릿지 회귀 예측의 부호로 내는 실험이며, 가상 계좌가 비용 포함 성적을 매시간 채점합니다. 1시간 관점은 비용 때문에 실제 매매에 쓸 수 없다는 것이 백테스트로 확인됐어요.</li>
  <li><b>상황 신호등</b>은 24시간 실현 변동성의 1년 백분위, FOMC·CPI 발표 창, 바이낸스 펀딩비·롱숏 비율·미결제약정으로 판정합니다.</li>
  <li><b>데이터</b>: 바이낸스 BTCUSDT 1시간·1일 캔들(마감된 캔들만), 업비트 원화 시세, 야후 파이낸스 환율·나스닥100 선물, 비트겟 조회 전용 API, OKX 공개 청산 기록. 새 1시간 캔들이 마감될 때마다 다시 계산합니다.</li>
  <li><b>기록</b>: 모든 예측·관점·채점은 자동으로 저장되고 운영자가 고칠 수 없습니다. 틀린 기록도 지우지 않아요.</li>
</ul>
<h2>어떻게 예측하나</h2>
<p>최근 가격의 흐름(수익률·변동성·거래량 특징)으로 다음 캔들의 움직임을 세 가지 모델(단순 기준, 릿지 회귀, 그래디언트 부스팅)로 예측하고, 변동성은 GARCH 모델로 추정합니다. 과거 3년 데이터로 '걷기식 검증'(미래 데이터를 전혀 보지 않고 한 칸씩 앞으로 나가며 채점)을 했고, 그 성적을 사이트 아래 "정확도는 얼마나 되나요?"에 공개합니다. 솔직히 말하면 방향 예측의 우위는 아주 얇고, 범위 예측이 이 사이트의 핵심입니다.</p>
<h2>운영 원칙</h2>
<ul>
  <li>예측이 틀린 기록도 지우지 않습니다. 채점은 자동이며 운영자가 손댈 수 없습니다.</li>
  <li>투자 권유를 하지 않습니다. 롱/숏 관점은 실험이며, 가상 계좌 성적이 그 한계를 보여 줍니다.</li>
  <li>이용자의 거래 내역·잔고 같은 개인 정보는 서버로 보내지도, 저장하지도 않습니다.</li>
</ul>
<h2>문의 · 광고 제휴</h2>
<p>오류 제보·제안·광고 문의는 이메일 <a class="mail" data-u="rudalstb" data-d="gmail.com"></a> 로 보내 주세요. 보통 하루 안에 답장합니다. 개발 관련 제안은 <a href="https://github.com/rudalstb/driftbtc/issues" target="_blank" rel="noopener">GitHub 이슈</a>도 좋습니다.</p>
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
  <li><b>익명 방문 집계</b> — 브라우저가 스스로 만든 임의의 번호(개인을 식별할 수 없음)로 순 방문자 수·조회수·접속 중 인원을 셉니다. 글 페이지는 글 주소별 조회 수와 들어온 경로의 종류(검색·사이트 안 링크·직접·다른 사이트 4가지)만 날짜별 합계로 셉니다. 이전 페이지 주소나 검색어는 저장하지 않습니다. IP 주소, 기기 정보, 위치는 저장하지 않습니다.</li>
  <li><b>화면 이용 집계</b> — 어떤 영역(예: 계산기, 신호등)이 얼마나 쓰이는지 영역 이름과 횟수만 셉니다. 입력한 값은 포함되지 않습니다.</li>
  <li><b>투표·한마디·주간 게임</b> — 롱/숏 투표, 직접 쓴 한마디, 주간 범위 맞히기에 고른 범위는 위의 익명 번호와 함께 서버(Vercel)에 저장되어 결과·순위 집계에 쓰입니다. 한마디에는 개인정보를 적지 말아 주세요. 한마디는 다른 방문자에게 공개됩니다.</li>
  <li><b>급변 푸시 알림</b> — 직접 켠 경우에만, 브라우저가 만든 푸시 주소와 암호화 키, 아침 요약·발표 알림을 받을지 여부를 서버(Vercel)에 저장해 알림을 보내는 데만 씁니다. 보낸 알림 수와 알림을 눌러 들어온 횟수는 개인을 구분하지 않는 날짜별 합계로만 셉니다. 이름·연락처는 받지 않으며, 끄면 바로 지워지고 브라우저가 구독을 해지해도 자동으로 지워집니다.</li>
</ul>
<h2>2. 수집하지 않는 정보</h2>
<ul>
  <li>"내 매매 해부"에 올리는 거래 내역 파일은 <b>이용자의 브라우저 안에서만</b> 읽고 분석하며, 서버로 전송하거나 저장하지 않습니다.</li>
  <li>리스크 계산기에 입력한 잔고 등은 이용자 브라우저의 저장소(localStorage)에만 남아 다음 방문 때 편의를 위해 쓰이며, 운영자는 볼 수 없습니다. 브라우저 데이터 삭제로 지울 수 있습니다.</li>
</ul>
<h2>3. 쿠키와 브라우저 저장소</h2>
<p>로그인 쿠키는 사용하지 않습니다. 통화 선택(원화/달러), 계산기 입력값, 접은 영역, 가격 알림 목록, 투표·게임 참여 표시 같은 화면 설정을 브라우저 저장소(localStorage)에 보관합니다.</p>
<p>홈 화면에 추가(앱 설치)와 끊긴 연결에서도 열리도록 <b>서비스 워커</b>가 페이지·스크립트·최근 예측 데이터를 브라우저 캐시에 저장합니다. 이 캐시는 기기 안에만 있고 운영자에게 전송되지 않으며, 브라우저의 사이트 데이터 삭제로 지울 수 있습니다.</p>
<h2>4. 광고</h2>
<p>사이트에는 주식회사 카카오의 광고 서비스인 <b>카카오 애드핏</b> 광고가 나옵니다. 매매 가이드 글의 중간과 끝, 가이드 목록과 소개 페이지 끝, 메인 화면 맨 아래에 한 칸씩이며, 차트·예측·신호등 사이에는 넣지 않습니다. 앞으로 Google AdSense 같은 다른 제3자 광고가 게재될 수도 있습니다.</p>
<ul>
  <li>광고 제공자는 광고를 보여 주고 횟수를 세고 관심사에 맞는 광고를 고르기 위해 자체 쿠키나 기기 정보를 사용할 수 있으며, 이는 각 제공자의 방침(<a href="https://www.kakao.com/policy/privacy" target="_blank" rel="noopener">카카오 개인정보 처리방침</a>, <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">Google 광고 정책</a>)을 따릅니다. 브라우저 설정에서 쿠키를 막거나 지울 수 있습니다.</li>
  <li>광고가 실제로 채워졌는지 알기 위해, 광고 칸을 만들 때와 광고가 채워졌을 때 '앱 이름·광고 자리·PC인지 휴대폰인지'만 rudals.app 익명 집계 서버에 날짜별 횟수로 셉니다. 계산기 입력값이나 거래 내역은 광고에 넘기지 않습니다.</li>
  <li>광고 내용은 운영자가 보증하지 않으며, 투자 상품 광고도 투자 권유가 아닙니다.</li>
</ul>
<h2>5. 외부 서비스</h2>
<p>시세·시장 데이터는 바이낸스·업비트·야후 파이낸스 등 공개 API 에서 받아옵니다. 실시간 시세·1분봉·차트·강제 청산 흐름은 이용자 브라우저가 바이낸스에 직접 요청하므로, 일반적인 웹 접속처럼 해당 서비스가 접속 IP 를 볼 수 있습니다. 이때 보내는 것은 공개 시세 요청뿐이며 이용자가 입력한 값은 포함되지 않습니다. 사이트는 GitHub Pages 와 Vercel 에서 호스팅됩니다.</p>
<h2>6. 보관과 파기</h2>
<p>익명 집계값은 통계 목적으로 보관하며, 날짜별 세부 집계는 40일 뒤 자동 삭제됩니다.</p>
<h2>7. 문의</h2>
<p>개인정보 관련 문의는 이메일 <a class="mail" data-u="rudalstb" data-d="gmail.com"></a> 로 보내 주세요. 이 방침은 변경될 수 있으며, 변경 시 이 페이지에 수정일을 표시합니다.</p>
""")

PAGES["guide/forecast-range.html"] = ("비트코인 예측 범위 읽는 법 (68%·95% 구간)", "BTC Agent 의 예측 범위가 무엇을 뜻하는지, 68%와 95% 구간의 차이, 범위를 매매에 어떻게 쓰는지 쉽게 설명합니다.", """
<p>BTC Agent 의 첫 화면에는 "±$318 (±0.39%) 안에서 움직여요" 같은 문장과 두 겹의 띠가 있습니다. 이 글은 그 숫자를 읽는 법입니다.</p>
<h2>범위는 "맞힌다"가 아니라 "가둔다"</h2>
<p>가격이 정확히 어디로 갈지는 아무도 모릅니다. 대신 <b>얼마나 멀리 갈 수 있는지</b>는 최근 변동성으로 꽤 잘 추정됩니다. 예측 범위는 "이 안에 들어올 가능성이 68%(또는 95%)인 구간"입니다.</p>
<table><tr><th>구간</th><th>뜻</th><th>쓰임</th></tr>
<tr><td>68% (진한 띠)</td><td>3번 중 2번은 이 안</td><td>평소 움직임의 크기 · 익절 목표의 현실성 점검</td></tr>
<tr><td>95% (연한 띠)</td><td>20번 중 19번은 이 안</td><td>손절·청산가를 이 밖에 둘지 판단</td></tr></table>
<h2>어떻게 계산하나</h2>
<p>최근 가격 흐름으로 다음 캔들의 변동성(σ)을 GARCH 모델로 추정해 구간을 만듭니다. 그래서 급등락이 잦은 시기에는 띠가 자동으로 넓어지고, 조용한 시기에는 좁아집니다.</p>
<p>비트코인은 평소엔 조금, 가끔은 아주 크게 움직이는(꼬리가 두꺼운) 자산이라 교과서식 "σ × 1" 범위에는 실제로 80% 넘게 들어와 68%라는 이름보다 넓었습니다. 그래서 <b>2026년 11월부터 68% 범위는 최근 1~3년의 실제 움직임으로 보정</b>합니다(σ의 약 0.7배). 처음 보는 기간 두 곳에서 검증했을 때 1시간·1일·1주 모두 68%에 더 가까워지고 범위도 좁아졌습니다. 95% 범위는 기간마다 결과가 엇갈려 그대로 σ × 1.96을 씁니다.</p>
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
<a class="cta" href="../index.html#market">지금 펀딩비 보기 →</a>
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
<a class="cta" href="../index.html#tools">리스크 계산기 열기 →</a>
""")


PAGES["guide/leverage.html"] = ("선물 레버리지 몇 배가 적당할까? 변동성으로 정하는 법", "선물 레버리지를 감으로 정하지 않고 비트코인 변동성과 손절 거리로 계산하는 법, 레버리지별 위험, 흔한 착각을 설명합니다.", """
<p>"몇 배로 들어가야 하나요?"는 선물을 시작하면 가장 먼저 하는 질문입니다. 결론부터 말하면 <b>레버리지는 먼저 정하는 값이 아니라 마지막에 따라 나오는 값</b>입니다. 손절 거리와 잃어도 되는 금액을 정하면 필요한 수량이 나오고, 레버리지는 그 수량을 열 증거금을 줄이는 수단일 뿐입니다.</p>
<h2>레버리지가 바꾸는 것과 바꾸지 않는 것</h2>
<table><tr><th>레버리지를 올리면</th><th>그대로인 것</th></tr>
<tr><td>필요한 증거금이 줄어듦</td><td>같은 수량이면 1% 움직일 때 손익(달러)은 똑같음</td></tr>
<tr><td>청산가가 진입가에 가까워짐</td><td>손절에 걸리는 확률 (손절가가 같다면)</td></tr>
<tr><td>증거금 대비 수익률(ROE)이 크게 보임</td><td>계좌 전체 대비 손익</td></tr></table>
<p>즉 <b>위험을 키우는 건 레버리지가 아니라 수량</b>입니다. 다만 레버리지가 높으면 손절가보다 청산가가 먼저 오는 사고가 생기고, 같은 증거금으로 수량을 늘리고 싶은 유혹이 커집니다.</p>
<h2>손절 거리로 레버리지 상한 구하기</h2>
<div class="formula">레버리지 상한 ≈ 1 ÷ ( 손절 거리 + 유지증거금률 )<br>예: 손절 2%, 유지증거금률 0.5% → 1 ÷ 0.025 = 40배 미만</div>
<p>이보다 높으면 손절가에 닿기 전에 청산가에 먼저 닿습니다(격리 마진 기준). 실제로는 수수료·슬리피지·급변동을 생각해 이 값의 <b>절반 이하</b>로 쓰는 것이 안전합니다.</p>
<h2>변동성으로 보는 현실적인 범위</h2>
<p>비트코인은 평범한 날에도 하루 1.5~3% 정도 움직이고, 큰 뉴스가 있으면 5~10%도 움직입니다. 손절을 하루 변동성보다 좁게 잡으면 방향이 맞아도 털리기 쉽습니다.</p>
<table><tr><th>매매 기간</th><th>흔한 손절 거리</th><th>레버리지 상한(대략)</th></tr>
<tr><td>몇 시간 (단타)</td><td>0.5~1%</td><td>15~30배 미만</td></tr>
<tr><td>하루~며칠</td><td>2~4%</td><td>5~10배 미만</td></tr>
<tr><td>몇 주</td><td>8~15%</td><td>2~4배</td></tr></table>
<h2>흔한 착각 세 가지</h2>
<ul>
  <li><b>"낮은 레버리지면 안전하다"</b> — 3배라도 잔고 전부를 넣으면 10% 하락에 잔고의 30%를 잃습니다. 중요한 건 계좌 대비 손실액입니다.</li>
  <li><b>"높은 레버리지로 증거금만 조금 넣으면 안전하다"</b> — 교차 마진이면 계좌 잔고 전체가 증거금입니다. 청산되면 계좌가 통째로 위험합니다.</li>
  <li><b>"ROE 100%면 대박"</b> — 50배에서 ROE 100%는 가격 2% 움직임입니다. 반대로 2% 역행이면 증거금이 사라집니다.</li>
</ul>
<p>BTC Agent 의 리스크 계산기에 잔고·손절가·감수할 손실을 넣으면 수량과 함께 손절보다 청산이 먼저 오는지 바로 알려 줍니다.</p>
<a class="cta" href="../index.html#tools">계산기 열기 →</a>
""")

PAGES["guide/stop-loss.html"] = ("손절 거리 정하는 법: 털리지 않는 손절가 위치", "비트코인 선물에서 손절가를 어디에 둘지 변동성·예측 범위·차트 구조로 정하는 법과, 손절이 너무 좁거나 넓을 때의 문제를 설명합니다.", """
<p>손절은 "틀렸다고 인정하는 가격"입니다. 너무 좁으면 평소 출렁임에 털리고, 너무 넓으면 한 번에 크게 잃습니다. 손절가는 <b>"이 가격까지 오면 내 판단이 틀린 것"</b>이라고 말할 수 있는 곳에 둬야 합니다.</p>
<h2>1. 변동성보다 넓게</h2>
<p>가격은 방향과 상관없이 늘 흔들립니다. 손절 거리가 그 시간대의 평범한 흔들림보다 좁으면, 방향을 맞혀도 손절부터 맞습니다.</p>
<table><tr><th>손절 위치</th><th>결과</th></tr>
<tr><td>68% 예측 범위 안쪽</td><td>평범한 출렁임에도 걸릴 확률이 높음 (3번 중 1번 이상)</td></tr>
<tr><td>68%와 95% 범위 사이</td><td>보통의 선택. 평소 움직임은 견디고 큰 역행만 자름</td></tr>
<tr><td>95% 범위 밖</td><td>잘 안 걸리지만 걸리면 손실이 큼 → 수량을 줄여야 함</td></tr></table>
<p>BTC Agent 첫 화면의 예측 범위와 "이 가격까지 닿을 확률" 표가 바로 이 판단에 쓰입니다.</p>
<h2>2. 차트에서 "틀렸다"가 확인되는 곳에</h2>
<ul>
  <li>롱이면 최근 저점(지지)의 조금 아래, 숏이면 최근 고점(저항)의 조금 위.</li>
  <li>모두가 보는 딱 떨어지는 가격(예: 80,000달러)은 손절이 몰려 잠깐 뚫리기 쉽습니다. 약간 더 떨어뜨려 두세요.</li>
</ul>
<h2>3. 손절 거리를 정한 다음에 수량을 정한다</h2>
<div class="formula">수량 = 잃어도 되는 금액 ÷ ( 진입가 − 손절가 )<br>예: 잔고 2,000달러의 1% = 20달러, 진입 80,000 · 손절 78,400(2%) → 20 ÷ 1,600 = 0.0125 BTC</div>
<p>순서를 거꾸로 해서 "0.1 BTC 들어갈 건데 손절은 어디 두지?"라고 하면, 손실을 감당하려고 손절을 좁히게 되고 결국 털립니다.</p>
<h2>하지 말아야 할 것</h2>
<ul>
  <li><b>손절가를 뒤로 미루기</b> — 가장 흔하게 계좌를 망가뜨리는 습관입니다. 손절가는 진입 전에 정하고, 유리한 쪽으로만 옮기세요.</li>
  <li><b>손절 없이 물타기</b> — 평단은 낮아지지만 손실 한도가 사라집니다. 물타기 가이드를 참고하세요.</li>
  <li><b>청산가를 손절로 쓰기</b> — 청산은 수수료까지 더 떼이는 최악의 손절입니다.</li>
</ul>
<a class="cta" href="../index.html#tools">손절·수량 계산기 열기 →</a>
""")

PAGES["guide/win-rate-reward.html"] = ("승률과 손익비: 손익분기 승률과 기대값 계산", "매매 승률과 손익비(R)의 관계, 손익분기 승률 공식, 기대값 계산, 켈리 공식으로 적정 비중을 구하는 법을 예시와 함께 설명합니다.", """
<p>"승률 70%인데 왜 돈이 줄지?" — 승률만 보면 생기는 일입니다. 수익은 <b>승률 × 이길 때 크기</b>와 <b>패율 × 질 때 크기</b>의 싸움입니다.</p>
<h2>손익비(R)</h2>
<div class="formula">손익비 R = 평균 이익 ÷ 평균 손실<br>예: 이길 때 평균 +30달러, 질 때 평균 −20달러 → R = 1.5</div>
<h2>손익분기 승률</h2>
<div class="formula">손익분기 승률 = 1 ÷ ( 1 + R )</div>
<table><tr><th>손익비 R</th><th>본전이 되는 승률</th></tr>
<tr><td>0.5 (이익이 손실의 절반)</td><td>66.7%</td></tr>
<tr><td>1</td><td>50%</td></tr>
<tr><td>1.5</td><td>40%</td></tr>
<tr><td>2</td><td>33.3%</td></tr>
<tr><td>3</td><td>25%</td></tr></table>
<p>짧게 익절하고 손절은 버티는 습관이 있으면 승률은 높아도 R이 0.5 아래로 떨어져, 70% 승률로도 손해가 납니다.</p>
<h2>기대값: 한 번 매매할 때 평균적으로 버는 돈</h2>
<div class="formula">기대값 = 승률 × 평균 이익 − ( 1 − 승률 ) × 평균 손실<br>예: 45% × 30 − 55% × 20 = 13.5 − 11 = +2.5달러</div>
<p>여기서 <b>수수료와 펀딩비를 꼭 빼야 합니다.</b> 선물은 진입·청산 때마다 수수료가 나가서, 기대값이 작은 전략은 수수료만으로 마이너스가 되곤 합니다.</p>
<h2>켈리 공식: 한 번에 얼마나 걸까</h2>
<div class="formula">켈리 비중 = 승률 − ( 1 − 승률 ) ÷ R<br>예: 승률 45%, R 1.5 → 0.45 − 0.55 ÷ 1.5 ≈ 8.3%</div>
<p>켈리 값은 "잔고의 몇 %를 잃을 위험에 노출할지"의 이론상 최대치입니다. 승률과 R은 추정치라 틀릴 수 있으므로 실전에서는 <b>켈리의 1/4~1/2</b>만 쓰는 것이 일반적입니다. 켈리 값이 0 이하면 그 전략은 기대값이 마이너스라는 뜻입니다.</p>
<h2>내 숫자는 어떻게 구하나</h2>
<p>최소 30번 이상의 실제 매매 기록이 있어야 승률과 R이 어느 정도 믿을 만해집니다. BTC Agent 의 매매 진단에 거래소 기록을 올리면 승률·손익비·수수료 비중을 자동으로 계산해 주고, 계산기의 "내 기대값" 칸에 넣으면 켈리 비중까지 나옵니다.</p>
<a class="cta" href="../index.html#mine">내 매매 진단하기 →</a>
""")

PAGES["guide/averaging-down.html"] = ("물타기 평단 계산법과 위험: 언제 타고 언제 멈출까", "물타기 후 평균 단가 계산 공식, 평단을 원하는 가격까지 내리려면 얼마나 사야 하는지, 선물에서 물타기가 청산가에 미치는 영향을 설명합니다.", """
<p><b>물타기</b>는 가격이 내려갔을 때 더 사서 평균 단가(평단)를 낮추는 것입니다. 계산은 단순하지만, 잘못 쓰면 작은 손실을 큰 손실로 키우는 가장 빠른 방법이기도 합니다.</p>
<h2>평단 계산</h2>
<div class="formula">새 평단 = ( 기존 수량 × 기존 평단 + 추가 수량 × 추가 가격 ) ÷ ( 기존 수량 + 추가 수량 )<br>예: 0.1 BTC @ 80,000 + 0.1 BTC @ 76,000 → 평단 78,000</div>
<h2>평단을 목표가까지 내리려면 얼마나 사야 하나</h2>
<div class="formula">필요 수량 = 기존 수량 × ( 기존 평단 − 목표 평단 ) ÷ ( 목표 평단 − 지금 가격 )<br>예: 0.1 BTC @ 80,000, 지금 76,000, 목표 평단 77,000 → 0.1 × 3,000 ÷ 1,000 = 0.3 BTC</div>
<p>목표 평단이 지금 가격에 가까울수록 필요한 수량이 기하급수적으로 늘어납니다. 평단을 지금 가격까지 내리는 것은 수학적으로 불가능합니다.</p>
<h2>선물에서 물타기의 함정</h2>
<ul>
  <li><b>수량이 늘면 1% 움직임의 손익도 커집니다.</b> 0.1 BTC에서 0.4 BTC가 되면 같은 하락에 4배를 잃습니다.</li>
  <li><b>청산가가 지금 가격 쪽으로 다가옵니다.</b> 교차 마진에서 증거금(잔고)은 그대로인데 수량만 늘면, 평단이 내려가도 청산가는 오히려 가까워질 수 있습니다.</li>
  <li><b>"반등하면 본전"은 반등이 와야 성립</b>합니다. 추세가 꺾인 하락에서의 물타기는 손실을 키웁니다.</li>
</ul>
<h2>물타기를 쓴다면 지킬 규칙</h2>
<ol>
  <li><b>처음부터 계획된 분할 매수</b>여야 합니다. "떨어져서 급하게"는 물타기가 아니라 손절 회피입니다.</li>
  <li>전체 수량 기준의 <b>최종 손절가와 최대 손실액</b>을 진입 전에 정합니다.</li>
  <li>추가 매수는 2~3번까지만. 그 뒤에도 내려가면 계획대로 손절합니다.</li>
  <li>추가 매수 뒤 청산가와 손절가를 다시 확인합니다. 손절가보다 청산가가 가까우면 안 됩니다.</li>
</ol>
<p>BTC Agent 의 물타기 계산기는 추가 매수 후 평단·청산가·손익분기 가격을 보여 주고, "어디서 물탈까"에서 예측 범위를 기준으로 추가 매수 후보 가격을 제안합니다.</p>
<a class="cta" href="../index.html#tools">물타기 계산기 열기 →</a>
""")

PAGES["guide/trading-fees.html"] = ("선물 수수료 계산: 메이커·테이커와 손익분기 가격", "코인 선물 거래 수수료(메이커·테이커)가 레버리지와 함께 얼마나 커지는지, 왕복 수수료와 펀딩비를 포함한 손익분기 가격 계산법을 설명합니다.", """
<p>선물 수수료는 0.0몇 %라 작아 보이지만, <b>증거금이 아니라 포지션 전체 금액(명목 금액)에 붙기 때문에</b> 레버리지를 쓰면 증거금 대비로는 꽤 큽니다.</p>
<h2>메이커와 테이커</h2>
<table><tr><th>구분</th><th>주문 방식</th><th>흔한 수수료율 (USDT 무기한 기본 등급)</th></tr>
<tr><td>메이커</td><td>지정가로 호가창에 걸어 두고 체결</td><td>약 0.02%</td></tr>
<tr><td>테이커</td><td>시장가, 또는 즉시 체결되는 지정가</td><td>약 0.05~0.06%</td></tr></table>
<p>정확한 값은 거래소·회원 등급·이벤트마다 다르니 각 거래소 수수료 안내를 확인하세요.</p>
<h2>왕복 수수료</h2>
<div class="formula">왕복 수수료 = 명목 금액 × ( 진입 수수료율 + 청산 수수료율 )<br>예: 0.1 BTC @ 80,000 = 8,000달러, 시장가 진입·청산(0.06% × 2) → 9.6달러</div>
<p>증거금이 400달러(20배)라면 이 9.6달러는 <b>증거금의 2.4%</b>입니다. 진입하자마자 ROE −2.4%에서 시작하는 셈입니다.</p>
<h2>손익분기 가격</h2>
<div class="formula">롱 손익분기 ≈ 진입가 × ( 1 + 진입 수수료율 + 청산 수수료율 )<br>숏 손익분기 ≈ 진입가 × ( 1 − 진입 수수료율 − 청산 수수료율 )<br>예: 80,000 롱, 왕복 0.12% → 80,096 이상에서 청산해야 이익</div>
<p>오래 들고 있으면 여기에 <b>펀딩비</b>가 더해집니다. 펀딩비 +0.01%가 하루 3번이면 하루 약 0.03%가 추가 비용입니다.</p>
<h2>수수료를 줄이는 방법</h2>
<ul>
  <li>급하지 않으면 지정가(메이커)로 진입·익절하기. 시장가 대비 절반 이하로 줄어듭니다.</li>
  <li>짧은 단타를 자주 하지 않기. 목표 수익이 0.2%인데 왕복 수수료가 0.12%면 이익의 절반 이상이 수수료입니다.</li>
  <li>매매 기록에서 "번 돈 대비 수수료 비중"을 확인하기. 30%를 넘으면 매매 횟수를 줄여야 한다는 신호입니다.</li>
</ul>
<p>BTC Agent 의 손익 계산기는 수수료·펀딩을 포함한 실수령 손익과 손익분기 가격을, 매매 진단은 실제 기록의 수수료 비중을 보여 줍니다.</p>
<a class="cta" href="../index.html#tools">손익 계산기 열기 →</a>
""")

PAGES["guide/upbit-profit.html"] = ("업비트 수익률 계산법: 평균 매수가와 실현 손익", "업비트 같은 원화 거래소에서 평균 매수가(이동평균법)가 어떻게 계산되는지, 실현 손익과 평가 손익의 차이, 거래내역으로 내 진짜 수익을 계산하는 법을 설명합니다.", """
<p>업비트 앱의 "평가손익"만 보면 <b>이미 팔아서 확정된 손익</b>은 알 수 없습니다. 지금까지 코인으로 실제로 얼마를 벌었는지 알려면 거래내역 전체를 다시 계산해야 합니다.</p>
<h2>평균 매수가는 이동평균법</h2>
<p>살 때마다 평균 매수가가 다시 계산되고, <b>팔 때는 평균 매수가가 바뀌지 않습니다.</b></p>
<div class="formula">살 때: 새 평단 = ( 보유 수량 × 평단 + 산 수량 × 산 가격 ) ÷ ( 보유 수량 + 산 수량 )<br>팔 때: 평단 그대로, 보유 수량만 줄어듦</div>
<h2>실현 손익과 평가 손익</h2>
<table><tr><th>구분</th><th>계산</th><th>뜻</th></tr>
<tr><td>실현 손익</td><td>( 판 가격 − 그때 평단 ) × 판 수량 − 수수료</td><td>팔아서 확정된 돈</td></tr>
<tr><td>평가 손익</td><td>( 지금 가격 − 평단 ) × 남은 수량</td><td>지금 팔면 생길 돈 (아직 확정 아님)</td></tr></table>
<p>예: 100만 원어치 사서 절반을 120만 원 가치일 때 팔면 실현 이익은 약 10만 원(수수료 제외)이고, 남은 절반은 평가 손익으로 따로 봅니다.</p>
<h2>수수료</h2>
<p>업비트 원화 마켓의 일반 주문 수수료는 0.05% 안팎입니다(정확한 값은 업비트 안내 확인). 매수·매도 모두 붙으므로 자주 사고팔면 왕복 0.1%씩 쌓입니다.</p>
<h2>계산이 틀어지는 흔한 이유</h2>
<ul>
  <li><b>다른 곳에서 입금받은 코인</b> — 산 기록이 없으니 원가를 알 수 없습니다. 판 금액 전체를 이익으로 계산하면 수익이 부풀려집니다.</li>
  <li><b>기록 시작 전에 산 코인</b> — 같은 이유로 원가를 모릅니다. 당시 평균 매수가를 직접 넣어야 정확해집니다.</li>
  <li><b>BTC·USDT 마켓 거래</b> — 원화로 사고판 게 아니라 원화 손익을 바로 계산할 수 없습니다.</li>
</ul>
<h2>거래내역 받는 법</h2>
<p>업비트 웹(PC) → 입출금·거래내역에서 기간을 정해 <b>거래내역서(PDF)</b>를 이메일로 받거나, 거래내역 화면을 복사해 붙여 넣을 수 있습니다. BTC Agent 의 매매 진단에 PDF·엑셀·복사한 글을 넣으면 코인별·월별 실현 손익과 평가 손익을 계산해 줍니다. 파일은 브라우저 안에서만 계산하고 서버로 보내지 않습니다.</p>
<a class="cta" href="../index.html#mine">업비트 수익 계산하기 →</a>
""")


PAGES["guide/liquidations.html"] = ("강제 청산 데이터 보는 법: 롱 청산·숏 청산과 연쇄 청산", "선물 강제 청산이 무엇인지, 롱 청산과 숏 청산이 가격에 주는 압력, 연쇄 청산이 생기는 원리, BTC Agent 청산 카드와 급증 알림을 읽는 법을 설명합니다.", """
<p>비트코인이 몇 분 만에 1~2%씩 튀는 날에는 거의 언제나 <b>강제 청산</b>이 함께 쏟아집니다. 이 글은 청산이 무엇인지, 그리고 BTC Agent 의 "💥 강제 청산" 카드를 어떻게 읽는지 설명합니다.</p>
<h2>강제 청산이란</h2>
<p>선물은 증거금보다 큰 포지션을 잡는 거래입니다. 가격이 반대로 움직여 손실이 증거금을 거의 다 먹으면, 거래소가 남은 증거금을 지키려고 포지션을 <b>시장가로 강제로 정리</b>합니다. 이것이 강제 청산입니다. 청산가가 어떻게 정해지는지는 <a href="liquidation-price.html">청산가 계산법</a>에서 자세히 다룹니다.</p>
<table><tr><th>종류</th><th>무슨 일이 일어나나</th><th>가격에 주는 압력</th></tr>
<tr><td>롱 청산</td><td>오를 거라 산 사람의 포지션이 강제로 <b>팔림</b></td><td>하락 쪽 (매도 물량이 더해짐)</td></tr>
<tr><td>숏 청산</td><td>내릴 거라 판 사람의 포지션이 강제로 <b>사들여짐</b></td><td>상승 쪽 (매수 물량이 더해짐)</td></tr></table>
<h2>연쇄 청산: 왜 한쪽으로 쏠려 튀나</h2>
<p>롱 청산이 시장가로 팔리면 가격이 더 내려가고, 그 아래 청산가를 둔 다른 롱이 또 청산됩니다. 이렇게 <b>청산이 청산을 부르는</b> 흐름이 연쇄 청산(캐스케이드)입니다. 숏 쪽에서 같은 일이 일어나 급등하는 것을 <b>숏 스퀴즈</b>라고 부릅니다. 레버리지가 높은 포지션이 한쪽에 몰려 있을수록 연쇄 청산이 커집니다.</p>
<h2>BTC Agent 청산 카드 읽는 법</h2>
<ul>
  <li><b>5분·15분·1시간 줄</b> — 바이낸스 비트코인 선물의 실시간 청산 흐름을 이 브라우저가 직접 받아 더한 값입니다. 바이낸스는 실시간 청산을 1초에 최대 1건만 보내므로 <b>전체가 아닌 표본</b>입니다. 방향과 분위기를 보는 용도예요.</li>
  <li><b>24시간 막대</b> — OKX 비트코인 무기한 선물의 공개 청산 기록을 서버가 매시간 빠짐없이 모아 시간별로 쌓은 것입니다. 빨강은 롱 청산, 초록은 숏 청산입니다.</li>
  <li><b>평소 대비 배수</b> — 지난 1시간 청산 합계를 그동안 쌓인 시간별 기록의 <b>중간값</b>과 비교합니다. 평균이 아니라 중간값을 쓰는 이유는 몇 번의 대형 청산이 "평소"를 부풀리지 않게 하려는 것입니다.</li>
  <li><b>급증</b> — 1시간 합계가 평소의 4배 이상이면서 300만 달러 이상일 때 급증으로 봅니다. 기록이 7일치 쌓이기 전에는 "평소"를 아직 모르므로 판정하지 않습니다.</li>
</ul>
<h2>매매에 쓰는 법과 함정</h2>
<ol>
  <li><b>추격하지 않기</b> — 대량 청산은 이미 가격이 크게 움직인 <b>결과</b>입니다. 청산 급증을 보고 같은 방향으로 따라 들어가면 꼭지나 바닥을 잡기 쉽습니다.</li>
  <li><b>쏠림이 풀린 신호로 보기</b> — 한쪽 청산이 크게 쏟아진 뒤에는 과도한 레버리지가 정리돼 움직임이 잦아들거나 되돌리기도 합니다. 다만 늘 그런 것은 아니어서, 되돌림을 노린다면 손절을 반드시 함께 정해야 합니다.</li>
  <li><b>내 청산가 다시 보기</b> — 청산이 몰리는 시기에는 변동성이 커집니다. 내 청산가가 <a href="forecast-range.html">95% 예측 범위</a> 안쪽에 있다면 레버리지를 낮출 때입니다.</li>
</ol>
<p class="muted">청산 금액은 거래소가 공개한 체결 수량 × 파산 가격으로 계산한 추정치이며, 거래소마다 공개 범위가 달라 시장 전체 청산과는 차이가 있습니다.</p>
<a class="cta" href="../index.html#market">지금 강제 청산 보기 →</a>
""")

# ⚡ 급변 뒤 30분: jumps_stats.py 가 만든 1년 통계(site/data/jumps_stats.json)로 글을 채운다
def sudden_moves() -> str:
    import json as _j
    d = _j.loads((SITE / "data" / "jumps_stats.json").read_text(encoding="utf-8"))
    g = d["groups"]
    a = g["all"]["h30"]
    pc = lambda v: f"{v:+.2f}%"
    rows = "".join(
        f"<tr><td>{h}분 뒤</td><td>{g['all'][f'h{h}']['cont']}%</td><td>{g['all'][f'h{h}']['rev']}%</td><td>{g['all'][f'h{h}']['flat']}%</td><td>{pc(g['all'][f'h{h}']['avg'])}</td></tr>"
        for h in (5, 15, 30, 60))
    side = "".join(
        f"<tr><td>{name}</td><td>{g[k]['h30']['n']}번</td><td>{g[k]['h30']['cont']}%</td><td>{g[k]['h30']['rev']}%</td><td>{pc(g[k]['h30']['avg'])}</td></tr>"
        for k, name in (("up", "급등 (5분 +1% 이상)"), ("down", "급락 (5분 −1% 이상)"), ("small", "1~1.5% 급변"), ("big", "1.5% 넘는 급변")))
    hrs = d["by_hour_kst"]
    top = sorted(range(24), key=lambda h: -hrs[h])[:4]
    night = sum(hrs[h] for h in (21, 22, 23, 0, 1))
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    kst = lambda ms: _dt.fromtimestamp(ms / 1000 + 60, _tz(_td(hours=9))).strftime("%Y년 %m월 %d일 %H:%M")
    big = "".join(f"<li>{kst(b['t'])} — 5분 {pc(b['move'])} → 30분 뒤 급변 방향으로 {pc(b['r30']) if b['r30'] is not None else '—'}</li>" for b in d["biggest"])
    t = a["t"]
    r5, r60 = g["all"]["h5"].get("rev", 0), g["all"]["h60"].get("rev", 0)
    trend = "시간이 지날수록 되돌림 쪽이 조금씩 많아졌습니다" if r60 > r5 + 2 else "시간이 지나도 이어짐·되돌림 비율이 크게 달라지지 않았습니다"
    avg_max = max(abs(g["all"][f"h{h}"].get("avg", 0)) for h in (5, 15, 30, 60))
    chase = "추격 매수·매도는 불리했다" if a["cont"] < a["rev"] else "추격이 유리했다고 보기도 어렵다"
    sure = "통계적으로 확실하다고 하기엔 부족합니다(|t| 2 미만)" if t is not None and abs(t) < 2 else "우연으로 보기 어려운 크기입니다(|t| 2 이상)"
    return f"""
<p>비트코인이 5분 만에 1% 넘게 튀면 "지금 따라 들어가야 하나, 반대로 잡아야 하나" 고민이 됩니다. 감으로 답하지 않고, 지난 1년치 1분봉 <b>{d['minutes']:,}개</b>를 BTC Agent 가 쓰는 규칙 그대로 돌려 세어 봤습니다 ({d['from']} ~ {d['to']}, 바이낸스 BTC/USDT).</p>
<div class="box"><b>한 줄 요약:</b> 1년 동안 급변은 <b>{a['n']}번</b>(일주일에 약 {d['per_week']}번). 30분 뒤 급변 방향으로 <b>이어진 건 {a['cont']}%</b>, <b>되돌린 건 {a['rev']}%</b>였습니다. 평균으로는 급변 방향과 반대로 {abs(a['avg']):.2f}% 움직였지만, 30분 뒤 움직임의 흔들림(표준편차 {a['sd']:.2f}%)이 평균보다 훨씬 커서 {sure}.</div>
<h2>급변을 어떻게 셌나</h2>
<ul>
  <li><b>급변</b> — 5분 수익률(지금 1분봉 종가 ÷ 5분 전 종가)이 처음으로 ±1% 이상이 된 순간. 그 전 30분 안에 이미 급변이 있었으면 같은 움직임으로 보고 세지 않습니다.</li>
  <li><b>이어짐 / 되돌림</b> — 급변 순간 종가에서 정해진 시간 뒤 종가가 급변 방향으로 0.2% 이상 더 가면 이어짐, 반대로 0.2% 이상 가면 되돌림, 그 사이면 제자리.</li>
  <li>메인 화면의 "⚡ 최근 24시간 급변" 줄과 운영자의 실시간 텔레그램 알림이 이 규칙과 똑같습니다.</li>
</ul>
<h2>시간이 지나면서 어떻게 됐나</h2>
<table><tr><th>급변 뒤</th><th>이어짐</th><th>되돌림</th><th>제자리</th><th>평균 (급변 방향 +)</th></tr>
{rows}</table>
<p>{trend}. 다만 평균은 가장 커도 {avg_max:.2f}% 수준이라, 왕복 수수료와 슬리피지(<a href="trading-fees.html">수수료 글</a>)를 빼면 남는 게 거의 없습니다.</p>
<h2>급등과 급락, 크기별로는</h2>
<table><tr><th>구분 (30분 뒤)</th><th>횟수</th><th>이어짐</th><th>되돌림</th><th>평균</th></tr>
{side}</table>
<p>1.5% 넘는 큰 급변은 1년에 {g['big']['h30']['n']}번뿐이라 비율을 믿기 어렵습니다. 표본이 작은 칸은 참고만 하세요.</p>
<h2>언제 몰리나 (한국 시간)</h2>
<p>급변이 가장 많았던 시간은 {', '.join(f'{h}시' for h in top)}입니다. 밤 9시~새벽 1시 다섯 시간에 전체의 <b>{round(night / max(1, sum(hrs)) * 100)}%</b>가 몰렸습니다. 미국 주식 시장이 열리고 경제 지표가 발표되는 시간대입니다(<a href="../index.html">메인 화면</a>의 발표 일정 참고).</p>
<h2>가장 컸던 급변 5번</h2>
<ul>{big}</ul>
<h2>그래서 어떻게 쓰나</h2>
<ol>
  <li><b>{chase}</b> — 1년 동안 30분 뒤 이어진 경우는 {round(a['cont'])}%, 되돌린 경우는 {round(a['rev'])}%였습니다. 급변을 보고 같은 방향으로 시장가 진입하면, 수수료까지 내고 되돌림을 맞기 쉽습니다.</li>
  <li><b>그렇다고 반대 매매가 정답도 아니다</b> — 되돌림 쪽이 조금 많았을 뿐, 평균 크기가 작고 흔들림이 커서 "무조건 반대"로 이길 만한 차이는 아닙니다. 지난 1년이 다음 1년에도 그대로라는 보장도 없습니다.</li>
  <li><b>급변은 손절·청산가 점검 신호</b> — 급변 직후에는 변동성이 커집니다. 내 손절이 너무 가깝지 않은지(<a href="stop-loss.html">손절 거리</a>), 청산가가 <a href="forecast-range.html">95% 예측 범위</a> 안에 있지 않은지 먼저 보세요.</li>
</ol>
<p class="muted">이 통계는 매주 새 1분봉으로 다시 계산해 메인 화면 줄에 반영되며, 이 글의 숫자는 글을 만든 시점 기준입니다. 과거 통계이며 투자 권유가 아닙니다.</p>
<a class="cta" href="../index.html#home">지금 최근 24시간 급변 보기 →</a>
"""


if (SITE / "data" / "jumps_stats.json").exists():   # daily.py 등이 이 모듈을 불러도 통계 파일이 없으면 넘어감
    PAGES["guide/sudden-moves.html"] = ("비트코인 5분 1% 급변, 따라가야 할까? 1년치 통계", "비트코인이 5분 만에 1% 넘게 움직인 뒤 30분 동안 이어졌는지 되돌렸는지, 지난 1년 1분봉으로 센 통계와 급등·급락·시간대별 차이, 매매에 쓰는 법을 정리했습니다.", sudden_moves())


# ─── 📊 데이터로 쓰는 가이드 (history.json 은 매시간 history.py 가 갱신, 글은 주 1회 pages.py 로 다시 씀) ───
WD = "월화수목금토일"


def _hist() -> dict:
    return json.loads((SITE / "data" / "history.json").read_text(encoding="utf-8"))


def _pc(v: float) -> str:
    return f"{v:+.2f}%"


def event_guide() -> str:
    h = _hist()
    ev = h["events"]
    c, f = ev["cpi"], ev["fomc"]
    hrs = ev.get("hours", 4)

    def row(e: dict) -> str:
        return (f"<tr><td>{e['name']}</td><td>{e['n']}번</td><td>±{e['abs_median']}%</td><td>±{e['base_abs_median']}%</td>"
                f"<td><b>{e['ratio']}배</b></td><td>{e['big_share']}% <span class='muted'>(평소 {e['base_big_share']}%)</span></td><td>{e['up']}%</td></tr>")

    def recent(e: dict) -> str:
        return " · ".join(f"{r['date'][2:].replace('-', '/')} {_pc(r['move'])}" for r in e["recent"][:8])

    def biggest(e: dict) -> str:
        return ", ".join(f"{b['date']} {_pc(b['move'])}" for b in e["biggest"])

    up = ev.get("upcoming") or []
    def kst(t: str) -> str:
        k = datetime.fromisoformat(t.replace("Z", "+00:00")) + timedelta(hours=9)
        return f"{k.month}월 {k.day}일 {k:%H:%M}"
    nxt = "".join(f"<li><b>{u['name']}</b> — {kst(u['t'])} (한국 시간)</li>" for u in up) or "<li>가까운 발표 일정이 없어요.</li>"
    return f"""
<p>미국 소비자물가(CPI)와 연준 금리 결정(FOMC) 날에는 "발표 전에 정리해야 하나" 고민이 됩니다. 2020년 이후 실제 발표 <b>{c['n'] + f['n']}번</b>을 모아, 발표 시각부터 <b>{hrs}시간 동안</b> 비트코인이 얼마나 움직였는지 같은 요일·같은 시각의 평소와 비교했습니다 (바이낸스 BTC/USDT 1시간봉).</p>
<div class="box"><b>한 줄 요약:</b> 발표 뒤 {hrs}시간 움직임(크기 중간값)은 CPI 날 평소의 <b>{c['ratio']}배</b>, FOMC 날 평소의 <b>{f['ratio']}배</b>였습니다. 방향은 오른 날이 CPI {c['up']}%, FOMC {f['up']}%로 반반에 가깝습니다. 즉 <b>"얼마나 크게"는 예상할 수 있어도 "어느 쪽으로"는 예상하기 어렵습니다.</b></div>
<h2>발표 뒤 {hrs}시간, 평소와 비교</h2>
<table><tr><th>발표</th><th>횟수</th><th>보통 움직임</th><th>평소</th><th>배수</th><th>2% 넘게 움직인 비율</th><th>오른 비율</th></tr>
{row(c)}{row(f)}</table>
<p class="muted">보통 움직임 = 발표 시각 1시간봉 시가 → {hrs}시간 뒤 종가 변화의 크기(절댓값) 중간값. 평소 = 발표가 없던 날 같은 요일·같은 시각. CPI 는 한국 시간 밤 10시 반(미국 서머타임 기간엔 9시 반), FOMC 는 새벽 4시(서머타임 기간엔 3시)에 나옵니다.</p>
<h2>최근 발표 때는</h2>
<ul>
  <li><b>CPI</b> — {recent(c)}</li>
  <li><b>FOMC</b> — {recent(f)}</li>
</ul>
<h2>가장 크게 움직인 날</h2>
<ul>
  <li><b>CPI</b> — {biggest(c)}</li>
  <li><b>FOMC</b> — {biggest(f)}</li>
</ul>
<p>같은 발표라도 그 시기 시장이 물가·금리에 얼마나 민감했는지에 따라 반응 크기가 크게 달라졌습니다. 평균보다 '가끔 크게 터지는 날'이 있다는 점을 기억하세요.</p>
<h2>다가오는 발표</h2>
<ul>{nxt}</ul>
<h2>그래서 어떻게 쓰나</h2>
<ol>
  <li><b>방향에 걸지 말고 크기에 대비</b> — 오른 비율이 반반이라 발표 직전 방향 베팅은 동전 던지기에 가깝습니다. 대신 평소보다 {min(c['ratio'], f['ratio'])}~{max(c['ratio'], f['ratio'])}배 크게 움직인다고 보고 손절 거리(<a href="stop-loss.html">손절 거리 정하는 법</a>)와 레버리지(<a href="leverage.html">레버리지 정하는 법</a>)를 먼저 조정하세요.</li>
  <li><b>청산가 점검</b> — 2% 넘게 움직인 날이 CPI 는 평소의 {c['big_share'] / max(0.1, c['base_big_share']):.1f}배, FOMC 는 {f['big_share'] / max(0.1, f['base_big_share']):.1f}배였습니다. 20배 이상이면 2~3% 움직임에도 청산가가 가까워집니다(<a href="liquidation-price.html">청산가 계산법</a>).</li>
  <li><b>발표 30분 전 알림</b> — 메인 화면에서 급변 푸시를 켠 뒤 "📅 큰 발표 30분 전 알림"을 켜 두면, 발표 30분 전에 이 통계와 함께 알려 드립니다.</li>
</ol>
<p class="muted">숫자는 매주 다시 계산해 이 글에 반영됩니다. 과거 통계이며 투자 권유가 아닙니다.</p>
<a class="cta" href="../index.html#home">지금 예측 범위와 발표 일정 보기 →</a>
"""


def fear_greed_guide() -> str:
    g = _hist()["fng"]
    b, base = g["buckets"], g["base"]
    now = next((x for x in b if x["now"]), None)
    rows = "".join(
        f"<tr{' style=\"font-weight:700\"' if x['now'] else ''}><td>{x['name']} ({x['lo']}~{x['hi']})</td><td>{x['days']:,}일</td>"
        f"<td>{x['up7']}%</td><td>{_pc(x['med7'])}</td><td>{x['up30']}%</td><td>{_pc(x['med30'])}</td></tr>" for x in b)
    diff = [x["name"] for x in b if x.get("verdict") and x["verdict"] != "평소와 비슷"]
    gap = (f"{', '.join(diff)} 구간은 평소와 다르게 나타났지만 표본이 겹쳐 있어 참고만 하세요" if diff
           else "통계적으로 뚜렷한 차이라고 하기는 어려웠습니다")
    best = max(b, key=lambda x: x["med30"])
    worst = min(b, key=lambda x: x["med30"])
    return f"""
<p>공포·탐욕 지수는 비트코인 시장 분위기를 0(극단적 공포)~100(극단적 탐욕) 숫자 하나로 보여 줍니다. "남들이 공포에 질렸을 때 사라"는 말이 정말 맞았는지, {g['since'][:4]}년 이후 <b>{g['days']:,}일</b>의 지수와 그 뒤 비트코인 가격을 맞대어 셌습니다 (지수 출처: alternative.me).</p>
<div class="box"><b>지금:</b> {g['date']} 기준 <b>{g['now']}</b>{f" — {now['name']}" if now else ""}. 최근 1년 평균은 {g['avg_1y']}이었습니다. <b>한 줄 요약:</b> 구간별로 그 뒤 30일 수익률 중간값은 {worst['name']} {_pc(worst['med30'])} ~ {best['name']} {_pc(best['med30'])}로 차이가 있었지만, 모든 날의 평소(30일 뒤 오른 비율 {base['up30']}%, 중간값 {_pc(base['med30'])})와 견줘 {gap}.</div>
<h2>구간별로 그 뒤 비트코인은</h2>
<table><tr><th>지수 구간</th><th>날 수</th><th>7일 뒤 오른 비율</th><th>7일 중간값</th><th>30일 뒤 오른 비율</th><th>30일 중간값</th></tr>
{rows}
<tr class="muted"><td>평소 (모든 날)</td><td></td><td>{base['up7']}%</td><td>{_pc(base['med7'])}</td><td>{base['up30']}%</td><td>{_pc(base['med30'])}</td></tr></table>
<p class="muted">굵은 줄이 지금 구간입니다. 같은 구간이 며칠씩 이어지므로(예: 극단적 공포 {b[0]['days']}일은 {b[0]['episodes']}번의 시기) 날 수만큼 독립적인 표본은 아닙니다.</p>
<h2>읽는 법</h2>
<ul>
  <li><b>극단적 공포 = 바닥은 아니다</b> — 공포가 길게 이어지며 더 내린 시기도 있었습니다. "극단적 공포니까 바로 산다"보다는 분할로 나눠 들어가는 근거 정도로 쓰는 게 안전합니다(<a href="averaging-down.html">물타기 평단 계산</a>).</li>
  <li><b>극단적 탐욕 = 바로 꼭지도 아니다</b> — 강세장에서는 탐욕이 몇 주씩 이어지며 더 오르기도 했습니다. 다만 이때는 펀딩비가 높아지는 경우가 많아 롱을 오래 들고 있으면 비용이 큽니다(<a href="funding-rate.html">펀딩비</a>).</li>
  <li><b>지수는 결과를 요약한 숫자</b> — 지수는 최근 가격 변동성·거래량·검색량 등을 섞어 만든 것이라, 이미 일어난 움직임을 늦게 반영합니다. 예측 신호보다는 "지금 시장 분위기" 확인용입니다.</li>
</ul>
<h2>최근 10일 흐름</h2>
<p>{" → ".join(str(v) for v in g['last30'][-10:])} (최근 10일)</p>
<p class="muted">숫자는 매주 다시 계산해 이 글에 반영됩니다. 과거 통계이며 투자 권유가 아닙니다.</p>
<a class="cta" href="../index.html#home">지금 공포·탐욕 지수와 예측 범위 보기 →</a>
"""


def hours_guide() -> str:
    hm = _hist()["heatmap"]
    y = hm["year"]
    hour_avg = [sum(y[w][h] for w in range(7)) / 7 for h in range(24)]
    day_avg = [sum(y[w]) / 24 for w in range(7)]
    top_h = sorted(range(24), key=lambda h: -hour_avg[h])[:4]
    calm_h = sorted(range(24), key=lambda h: hour_avg[h])[:4]
    spot = lambda x: f"{WD[x['wd']]}요일 {x['h']}시 (±{x['v']:.2f}%)"  # noqa: E731
    js = None
    if (SITE / "data" / "jumps_stats.json").exists():
        js = json.loads((SITE / "data" / "jumps_stats.json").read_text(encoding="utf-8"))
    jumps = ""
    if js:
        bh = js["by_hour_kst"]
        tot = max(1, sum(bh))
        jt = sorted(range(24), key=lambda h: -bh[h])[:4]
        jumps = (f"<h2>5분 1% 급변은 언제 몰리나</h2><p>지난 1년 급변 {tot}번 가운데 가장 많았던 시간은 "
                 f"{', '.join(f'{h}시({bh[h]}번)' for h in jt)}입니다. 자세한 통계는 <a href='sudden-moves.html'>급변 글</a>에 있습니다.</p>")
    cells = "".join(
        f"<tr><td>{WD[w]}</td>" + "".join(
            f"<td style='background:rgba(247,147,26,{min(0.9, y[w][h] / max(map(max, y)) * 0.9):.2f})'>{y[w][h]:.2f}</td>" for h in range(0, 24, 3))
        + "</tr>" for w in range(7))
    return f"""
<p>비트코인은 24시간 거래되지만 하루 내내 똑같이 움직이지 않습니다. 최근 1년 1시간봉으로 <b>한국 시간 요일·시간대별 "1시간 동안 보통 얼마나 움직이나"</b>(시가→종가 변화 크기의 중간값)를 셌습니다.</p>
<div class="box"><b>한 줄 요약:</b> 1시간 움직임 중간값은 전체 ±{hm['median']:.2f}%. 평일 ±{hm['weekday']:.2f}%, 주말 ±{hm['weekend']:.2f}%로 <b>주말이 평일의 약 {hm['weekend'] / hm['weekday'] * 100:.0f}%</b> 수준입니다. 가장 크게 움직인 시간대는 {', '.join(f'{h}시' for h in top_h)}, 가장 조용한 시간대는 {', '.join(f'{h}시' for h in calm_h)}였습니다.</div>
<h2>가장 크게 / 조용하게 움직인 칸</h2>
<ul>
  <li><b>가장 큰 칸</b> — {', '.join(spot(x) for x in hm['top'])}</li>
  <li><b>가장 조용한 칸</b> — {', '.join(spot(x) for x in hm['calm'])}</li>
</ul>
<h2>요일 × 시간 (3시간 간격, 1시간 움직임 중간값 %)</h2>
<table><tr><th></th>{''.join(f'<th>{h}시</th>' for h in range(0, 24, 3))}</tr>{cells}</table>
<p class="muted">색이 진할수록 많이 움직인 칸입니다. 요일별 평균: {' · '.join(f'{WD[w]} ±{day_avg[w]:.2f}%' for w in range(7))}.</p>
<h2>왜 이 시간대인가</h2>
<ul>
  <li><b>밤 9시~새벽 1시</b> — 미국 주식 시장이 열리고(한국 시간 밤 11시 반, 미국 서머타임 기간엔 10시 반) 미국 경제 지표가 나오는 시간입니다(<a href="fomc-cpi.html">FOMC·CPI 발표 통계</a>).</li>
  <li><b>오전 9시 전후</b> — 일봉이 바뀌는 시각(UTC 0시)이라, 평일에는 바로 앞 새벽 시간보다 조금 커지는 편입니다.</li>
  <li><b>주말 낮</b> — 기관·주식 시장이 쉬어 거래량이 줄고 조용한 편입니다. 다만 거래량이 적을 때 큰 주문 하나에 급변이 나기도 합니다.</li>
</ul>
{jumps}
<h2>그래서 어떻게 쓰나</h2>
<ol>
  <li><b>같은 손절이라도 시간대에 따라 다르게</b> — 많이 움직이는 시간대에 진입하면 평소 출렁임만으로 손절이 맞기 쉽습니다(<a href="stop-loss.html">손절 거리</a>).</li>
  <li><b>자기 전에 포지션 점검</b> — 한국 시간 밤~새벽이 가장 크게 움직이는 시간대라, 잠들기 전 레버리지·청산가를 한 번 더 보세요(<a href="liquidation-price.html">청산가 계산법</a>).</li>
  <li><b>시간대는 방향을 알려 주지 않는다</b> — 이 통계는 움직임의 크기만 셉니다. 오를지 내릴지는 별개입니다.</li>
</ol>
<p class="muted">숫자는 매주 다시 계산해 이 글에 반영됩니다. 메인 화면 "과거와 비교" 영역에서 24시간 전체 표를 볼 수 있습니다. 과거 통계이며 투자 권유가 아닙니다.</p>
<a class="cta" href="../index.html#home">지금 예측 범위 보기 →</a>
"""


if (SITE / "data" / "history.json").exists():
    _h = _hist()
    if _h.get("events", {}).get("cpi"):
        PAGES["guide/fomc-cpi.html"] = ("FOMC·CPI 발표 날 비트코인은 얼마나 움직일까? 2020년 이후 통계", "미국 CPI·FOMC 발표 뒤 4시간 동안 비트코인이 평소보다 몇 배 움직였는지, 오른 비율, 가장 크게 움직인 날, 최근 발표 반응과 다가오는 일정을 실제 데이터로 정리했습니다.", event_guide())
    if _h.get("fng", {}).get("buckets"):
        PAGES["guide/fear-greed.html"] = ("공포탐욕지수 보는 법: 극단적 공포일 때 사도 될까?", "비트코인 공포·탐욕 지수 구간별로 그 뒤 7일·30일 비트코인 수익률이 어땠는지 2018년 이후 데이터로 비교하고, 지수를 매매에 쓰는 법과 한계를 설명합니다.", fear_greed_guide())
    if _h.get("heatmap", {}).get("year"):
        PAGES["guide/volatile-hours.html"] = ("비트코인이 가장 크게 움직이는 시간대·요일 (한국 시간)", "최근 1년 1시간봉으로 한국 시간 요일·시간대별 비트코인 변동폭을 세고, 평일과 주말 차이, 급변이 몰리는 시간, 손절·포지션 관리에 쓰는 법을 정리했습니다.", hours_guide())
    RELATED.update({
        "fomc-cpi": ["volatile-hours", "sudden-moves", "stop-loss"],
        "fear-greed": ["averaging-down", "funding-rate", "forecast-range"],
        "volatile-hours": ["fomc-cpi", "sudden-moves", "stop-loss"],
    })


# 📖 용어 사전: (용어, 설명, 관련 글) — 가나다 순이 아니라 처음 보는 사람이 읽기 좋은 순서
GLOSSARY = [
    ("변동성 (σ, 시그마)", "가격이 평소 얼마나 크게 출렁이는지를 나타내는 숫자. 수익률의 표준편차로 잽니다. BTC Agent 의 예측 범위 폭은 이 값으로 정해집니다.", "forecast-range.html"),
    ("GARCH 모델", "최근에 크게 움직였으면 당분간 크게 움직이고, 조용했으면 조용한 경향(변동성 군집)을 이용해 다음 변동성을 추정하는 통계 모델. BTC Agent 는 꼬리가 두꺼운 t 분포를 쓰는 GARCH(1,1)-t 를 씁니다.", ""),
    ("예측 범위 (68%·95%)", "다음 캔들의 종가가 그 확률로 들어올 것으로 보는 가격 구간. 68%는 3번 중 2번, 95%는 20번 중 19번 들어와야 정상입니다.", "forecast-range.html"),
    ("적중률 (커버리지)", "실제 가격이 예측 범위 안에 들어온 비율. 95% 범위의 적중률이 95% 근처면 범위가 정직하게 만들어진 것입니다.", "forecast-range.html"),
    ("보정 (캘리브레이션)", "이름은 68%인데 실제로는 80%가 들어오는 식으로 어긋난 범위를, 과거 실제 움직임에 맞게 넓히거나 좁히는 것.", "forecast-range.html"),
    ("캔들 (봉)", "정해진 시간(1시간·1일·1주) 동안의 시가·고가·저가·종가를 묶은 단위. BTC Agent 는 마감된 캔들만 씁니다.", ""),
    ("롱 / 숏", "롱은 오르면 버는 포지션(매수), 숏은 내리면 버는 포지션(매도). 선물에서는 둘 다 자유롭게 잡을 수 있습니다.", ""),
    ("무기한 선물", "만기가 없는 선물. 현물 가격과 벌어지지 않도록 펀딩비를 주고받습니다.", "funding-rate.html"),
    ("펀딩비 (펀딩 레이트)", "무기한 선물에서 롱과 숏이 8시간마다 서로 주고받는 비용. 양수면 롱이 숏에게 내고, 롱이 과열됐다는 뜻으로 읽힙니다.", "funding-rate.html"),
    ("미결제약정 (OI)", "아직 정리되지 않고 열려 있는 선물 계약의 총량. 가격과 함께 늘면 새 돈이 들어오는 것, 급감하면 청산·정리가 일어난 것입니다.", ""),
    ("롱숏 비율", "롱 포지션을 가진 계정 수와 숏 계정 수의 비율. 한쪽이 지나치게 많으면 반대 방향으로 털리는 일이 잦습니다.", ""),
    ("레버리지", "증거금의 몇 배 크기로 포지션을 잡는지. 10배면 가격이 10% 반대로 가면 증거금이 거의 사라집니다.", "leverage.html"),
    ("증거금 (격리·교차)", "포지션을 유지하려고 맡겨 둔 돈. 격리는 그 포지션에 넣은 돈만, 교차는 계좌 전체를 담보로 씁니다.", "liquidation-price.html"),
    ("청산가", "손실이 커져 거래소가 포지션을 강제로 정리하는 가격.", "liquidation-price.html"),
    ("강제 청산", "청산가에 닿아 포지션이 시장가로 강제 정리되는 것. 롱 청산은 매도, 숏 청산은 매수 물량이 됩니다.", "liquidations.html"),
    ("연쇄 청산 / 숏 스퀴즈", "청산 물량이 가격을 더 밀어 다른 청산을 부르는 연쇄 반응. 숏 쪽에서 일어나 급등하면 숏 스퀴즈라고 합니다.", "liquidations.html"),
    ("손절 (스톱로스)", "손실이 정해 둔 크기를 넘기 전에 포지션을 닫는 가격. 변동성보다 너무 가까우면 평소 출렁임에 털립니다.", "stop-loss.html"),
    ("손익비 (R)", "한 번 이길 때 버는 크기 ÷ 한 번 질 때 잃는 크기. 손익비가 2면 승률 34%만 넘어도 기대값이 플러스입니다(수수료 제외).", "win-rate-reward.html"),
    ("기대값", "같은 매매를 아주 많이 반복했을 때 1번당 평균으로 남는 손익. 승률 × 평균 이익 − 패율 × 평균 손실.", "win-rate-reward.html"),
    ("물타기 (평단 낮추기)", "가격이 내려갈 때 더 사서 평균 매수가를 낮추는 것. 선물에서는 청산가도 함께 움직여 위험이 커집니다.", "averaging-down.html"),
    ("메이커 / 테이커", "호가창에 주문을 걸어 두면 메이커(수수료 낮음), 이미 걸린 주문을 바로 체결시키면 테이커(수수료 높음).", "trading-fees.html"),
    ("슬리피지", "시장가 주문이 생각한 가격보다 불리하게 체결되는 차이. 급변 구간과 강제 청산 때 커집니다.", "trading-fees.html"),
    ("김치 프리미엄", "국내 원화 거래소 비트코인 가격이 해외 가격(환율 적용)보다 비싼 정도. 마이너스면 역프리미엄이라고 합니다.", "kimchi-premium.html"),
    ("USDT (테더)", "1달러에 맞춰 발행되는 스테이블코인. BTC Agent 의 가격과 예측 범위는 바이낸스 BTC/USDT 기준입니다.", ""),
    ("백테스트", "과거 데이터로 전략이나 모델을 돌려 성적을 재는 것. 미래 정보를 실수로 쓰면 성적이 부풀려집니다.", ""),
    ("걷기식 검증 (워크포워드)", "과거의 한 시점까지만 보고 예측한 뒤 한 칸씩 앞으로 나가며 채점하는 방식. 미래를 보지 않으므로 실제 운영과 가장 비슷합니다.", ""),
    ("과적합", "과거 데이터의 우연한 패턴까지 외워서 과거 성적만 좋고 앞으로는 통하지 않는 상태.", ""),
    ("FOMC · CPI", "FOMC 는 미국 기준금리를 정하는 회의, CPI 는 미국 소비자물가지수 발표. 발표 직후 비트코인이 크게 출렁여 BTC Agent 는 앞뒤를 '쉬는 구간'으로 표시합니다.", ""),
]


def glossary() -> str:
    more = lambda g: ' <a href="' + g + '">자세히 →</a>' if g else ""
    rows = "".join(f'<h3 id="t{i}">{t}</h3><p>{d}{more(g)}</p>\n' for i, (t, d, g) in enumerate(GLOSSARY))
    return f"""
<p>BTC Agent 와 코인 선물 매매에서 자주 나오는 용어 {len(GLOSSARY)}개를 한 줄씩 풀었습니다. 더 긴 설명이 있는 용어는 "자세히"로 이어집니다.</p>
{rows}<a class="cta" href="index.html">매매 가이드 모음 →</a>
"""


PAGES["guide/glossary.html"] = ("코인 선물·예측 용어 사전", "변동성, GARCH, 예측 범위, 펀딩비, 미결제약정, 청산가, 강제 청산, 손익비, 김치 프리미엄 등 비트코인 매매와 BTC Agent 에서 쓰는 용어를 쉽게 풀어 쓴 사전입니다.", glossary())

# ❓ 자주 묻는 질문: 화면 글과 검색엔진용 구조화 데이터(FAQPage)를 같은 목록에서 만든다
FAQ = [
    ("BTC Agent 는 무엇을 하는 사이트인가요?",
     "비트코인이 1시간·1일·1주 뒤에 <b>어느 범위 안에 있을지</b>를 통계 모델로 예측하고, 그 예측이 맞았는지 매시간 자동으로 채점해 공개하는 사이트입니다. 오를지 내릴지 맞히기보다 얼마나 움직일 수 있는지를 알려 주는 데 집중합니다."),
    ("예측은 얼마나 자주 바뀌나요?",
     "1시간 예측은 바이낸스 1시간 캔들이 마감될 때마다(매시간 몇 분 안에) 새로 만듭니다. 1일 예측은 하루에 한 번(한국 시간 오전 9시), 1주 예측은 일주일에 한 번(월요일 오전 9시) 바뀝니다. 화면의 실시간 가격은 계속 움직입니다."),
    ("어느 거래소 가격 기준인가요? 원화인가요?",
     "바이낸스 BTC/USDT 가격 기준이라 달러(테더) 단위입니다. 업비트 원화 가격과 환율로 계산한 김치 프리미엄은 따로 보여 줍니다."),
    ("68%와 95% 범위는 무슨 뜻인가요?",
     "68% 범위는 3번 중 2번, 95% 범위는 20번 중 19번은 실제 가격이 그 안에 들어와야 하는 구간입니다. 손절을 어디에 둘지, 목표가가 현실적인지 판단할 때 씁니다. <a href=\"guide/forecast-range.html\">예측 범위 읽는 법</a>에 자세히 있습니다."),
    ("롱/숏 관점을 따라 하면 돈을 벌 수 있나요?",
     "보장할 수 없습니다. 롱/숏 관점은 실험이며, 따랐다면 어땠을지를 수수료까지 넣은 '가상 계좌'로 매시간 채점해 그대로 보여 줍니다. 방향 예측의 우위는 아주 얇고, 이 사이트의 핵심은 범위 예측입니다. 투자 판단과 책임은 이용자 본인에게 있습니다."),
    ("예측이 틀리면 어떻게 되나요?",
     "틀린 예측도 지우지 않습니다. 모든 예측과 채점은 자동으로 저장되고 운영자가 고칠 수 없으며, '실제 운영 기록' 카드와 <a href=\"monthly/\">월간 성적표</a>에 적중률이 그대로 나옵니다."),
    ("이더리움도 예측하나요?",
     "네. 이더리움(ETH/USDT)도 비트코인과 같은 방법으로 1시간·1일·1주 범위를 만들고, 차트에서 예측 범위를 겹쳐 볼 수 있습니다."),
    ("'이번 주 범위 맞히기'는 어떻게 하나요?",
     "월요일 오전 9시부터 수요일 오전 9시까지, 다음 월요일 오전 9시의 비트코인 가격이 들어올 범위를 골라 참가합니다. 정답이 범위 안이면 100 × (AI 범위 폭 ÷ 내 범위 폭)점(최대 300점), 밖이면 0점입니다. 좁게 맞힐수록 점수가 높고, AI 는 맞히면 100점입니다. 로그인 없이 익명으로 참가합니다."),
    ("가격 알림은 휴대폰이 꺼져 있어도 오나요?",
     "아니요. 가격 알림은 이 사이트가 브라우저 탭에 열려 있는 동안만 확인합니다(다른 탭을 보고 있어도 됩니다). 알림 목록은 내 브라우저에만 저장되고 서버로 보내지 않습니다."),
    ("상황 신호등이 빨간불이면 무슨 뜻인가요?",
     "변동성이 1년 중 상위 10% 수준으로 극단적이거나, FOMC·CPI 같은 큰 발표 앞뒤라 움직임이 뉴스 한 줄로 뒤집힐 수 있는 구간이라는 뜻입니다. 새 포지션은 쉬고, 들고 있는 포지션의 손절가를 다시 확인하라는 신호입니다."),
    ("내 거래 내역 파일을 올려도 안전한가요?",
     "'내 매매 해부'에 올린 파일은 브라우저 안에서만 계산되고 서버로 전송되지 않습니다. 회원 가입도 없습니다. 자세한 내용은 <a href=\"privacy.html\">개인정보처리방침</a>에 있습니다."),
    ("왜 무료인가요?",
     "광고 수익으로 운영합니다. 광고는 내용을 가리지 않는 자리에만 넣고, 예측이나 채점 결과에는 영향을 주지 않습니다."),
    ("오류를 발견했거나 제안하고 싶어요.",
     "페이지 아래 '문의하기'의 이메일이나 <a href=\"https://github.com/rudalstb/driftbtc/issues\" target=\"_blank\" rel=\"noopener\">GitHub 이슈</a>로 알려 주세요. 보통 하루 안에 답장합니다."),
]


def faq_page() -> str:
    import json
    import re
    items = "".join(f'<h2 id="q{i}">{q}</h2>\n<p>{a}</p>\n' for i, (q, a) in enumerate(FAQ))
    ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", a)}} for q, a in FAQ]}
    EXTRA_HEAD["faq.html"] = '\n  <script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + "</script>"
    return f"""
<p>BTC Agent 를 쓰면서 자주 받는 질문을 모았습니다. 용어가 낯설면 <a href="guide/glossary.html">용어 사전</a>을 함께 보세요.</p>
{items}<a class="cta" href="index.html">BTC Agent 홈으로 →</a>
"""


PAGES["faq.html"] = ("자주 묻는 질문", "BTC Agent 예측이 얼마나 자주 바뀌는지, 어느 가격 기준인지, 68%·95% 범위의 뜻, 롱/숏 관점의 한계, 범위 맞히기 게임 규칙, 가격 알림과 개인정보까지 자주 묻는 질문을 정리했습니다.", faq_page())


# 📚 가이드 모음: 위에 있는 guide/ 페이지를 자동으로 모아 목록을 만든다
def guide_index() -> str:
    items = "".join(f'<li><a href="{path.split("/", 1)[1]}"><b>{title}</b></a><br><span class="muted">{desc}</span></li>\n'
                    for path, (title, desc, _) in PAGES.items() if path.startswith("guide/") and path != "guide/index.html")
    return f"""
<p>비트코인 선물·현물 매매에서 자주 묻는 것들을 계산 공식과 예시로 정리했습니다. 글마다 바로 써 볼 수 있는 BTC Agent 계산기로 이어집니다.</p>
<ul class="guide-list">
{items}</ul>
<a class="cta" href="../index.html">BTC Agent 홈으로 →</a>
"""



def _hour(h: int) -> str:
    return "자정" if h == 0 else f"새벽 {h}시" if h < 6 else f"오전 {h}시" if h < 12 else "낮 12시" if h == 12 else f"오후 {h - 12}시" if h < 18 else f"밤 {h - 12}시"


def og_spec(path: str) -> tuple[str | None, str]:
    """가이드 공유 그림에 크게 박을 숫자와 설명. 데이터 가이드는 지금 숫자, 나머지는 (None, 설명)."""
    try:
        if path == "guide/sudden-moves.html":
            d = json.loads((SITE / "data" / "jumps_stats.json").read_text(encoding="utf-8"))
            a = d["groups"]["all"]["h30"]
            return f"되돌림 {round(a['rev'])}%", f"5분 1% 급변 {a['n']}번, 30분 뒤 이어짐은 {round(a['cont'])}% · 최근 1년 1분봉"
        if path == "guide/fomc-cpi.html":
            e = _hist()["events"]
            return f"평소의 {e['fomc']['ratio']}배", f"FOMC 발표 뒤 4시간 비트코인 움직임 (CPI 는 {e['cpi']['ratio']}배) · 2020년 이후 {e['fomc']['n'] + e['cpi']['n']}번"
        if path == "guide/fear-greed.html":
            g = _hist()["fng"]
            now = next((x for x in g["buckets"] if x["now"]), None)
            ex = g["buckets"][0]
            return f"지금 {g['now']}" + (f" · {now['name']}" if now else ""), f"극단적 공포 뒤 30일 오른 비율 {ex['up30']}% (평소 {g['base']['up30']}%) · {g['since'][:4]}년 이후"
        if path == "guide/volatile-hours.html":
            hm = _hist()["heatmap"]
            y = hm["year"]
            top = max(range(24), key=lambda h: sum(y[w][h] for w in range(7)))
            return _hour(top), f"비트코인이 가장 크게 움직이는 시간 (한국 시간) · 주말은 평일의 {hm['weekend'] / hm['weekday'] * 100:.0f}%"
    except Exception as e:  # 그림 숫자 실패해도 글은 쓴다
        print(f"공유 그림 숫자 실패 {path}: {e}")
    return None, PAGES[path][1]


def guide_image(path: str, title: str) -> str | None:
    """guide/og/<이름>.png 를 그리고 주소를 돌려준다 (실패하면 사이트 공통 그림)."""
    if not path.startswith("guide/") or path.endswith("index.html"):
        return None
    try:
        import guide_og
        name = path.removeprefix("guide/").removesuffix(".html")
        big, label = og_spec(path)
        guide_og.draw(SITE / "guide" / "og" / f"{name}.png", title, big, label)
        return f"{BASE}guide/og/{name}.png"
    except Exception as e:
        print(f"가이드 공유 그림 실패 {path}: {e}")
        return None


def main() -> None:
    PAGES["guide/index.html"] = ("비트코인 매매 가이드 모음", "레버리지, 손절, 청산가, 물타기, 수수료, 펀딩비, 김치 프리미엄, 업비트 수익 계산까지 코인 매매 기본을 공식과 예시로 정리한 가이드 모음입니다.", guide_index())
    for path, (title, desc, body) in PAGES.items():
        out = SITE / path
        out.parent.mkdir(parents=True, exist_ok=True)
        upd = f"숫자 갱신 {date.today():%Y년 %m월 %d일}" if path in DATA_GUIDES else None
        out.write_text(wrap(path, title, desc, body, upd, guide_image(path, title)), encoding="utf-8", newline="\n")
    write_sitemap()
    print(f"{len(PAGES)}개 페이지 + sitemap.xml + robots.txt 생성")


def _lastmod(path: str) -> str:
    """고정 페이지·가이드가 실제로 바뀐 날: 만들어 둔 html 의 dateModified(매주 숫자를 새로 넣는 가이드는 그날), 없으면 UPDATED_ISO."""
    try:
        m = re.search(r'"dateModified": ?"(\d{4}-\d{2}-\d{2})"', (SITE / path).read_text(encoding="utf-8"))
    except OSError:
        m = None
    return m.group(1) if m else UPDATED_ISO


def write_sitemap() -> None:
    """고정 페이지 + 일지·성적표. daily.py · weekly.py · monthly.py 도 부른다.
    lastmod 는 실제로 바뀐 날만 적는다 (바뀌지 않은 글까지 매일 오늘 날짜면 검색엔진이 lastmod 를 믿지 않는다).
    메인만 오늘 날짜(예측이 매시간 바뀜), 목록은 가장 새 글의 날짜."""
    today = date.today().isoformat()
    items = [(BASE, today)] + [(BASE + p, _lastmod(p)) for p in {**PAGES, "guide/index.html": None}]
    daily = sorted((SITE / "daily").glob("20*.html"), reverse=True) if (SITE / "daily").exists() else []
    if daily:
        items.append((BASE + "daily/index.html", daily[0].stem))
        items += [(f"{BASE}daily/{f.name}", f.stem) for f in daily]
    weekly = sorted((SITE / "weekly").glob("20*.html"), reverse=True) if (SITE / "weekly").exists() else []
    if weekly:
        week_end = lambda f: (date.fromisoformat(f.stem) + timedelta(days=7)).isoformat()  # noqa: E731
        items.append((BASE + "weekly/index.html", week_end(weekly[0])))
        items += [(f"{BASE}weekly/{f.name}", week_end(f)) for f in weekly]
    monthly = sorted((SITE / "monthly").glob("20*.html"), reverse=True) if (SITE / "monthly").exists() else []
    if monthly:
        # 성적표는 다음 달 1일에 한 번 쓰고 고치지 않는다
        month_end = lambda f: (date.fromisoformat(f.stem + "-01") + timedelta(days=32)).replace(day=1).isoformat()  # noqa: E731
        items.append((BASE + "monthly/index.html", month_end(monthly[0])))
        items += [(f"{BASE}monthly/{f.name}", month_end(f)) for f in monthly]
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{u}</loc><lastmod>{m}</lastmod></url>\n" for u, m in items) + "</urlset>\n"
    (SITE / "sitemap.xml").write_text(sitemap, encoding="utf-8", newline="\n")
    (SITE / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {BASE}sitemap.xml\n", encoding="utf-8", newline="\n")
    write_rss()
    sync_index_verify()


def write_rss() -> None:
    """📰 새 글 RSS (네이버 서치어드바이저에 제출): 일지·주간·월간·가이드 최근 40편. 제목·설명은 각 html 에서 읽는다."""
    items = []
    for f in [*(SITE / "daily").glob("20*.html"), *(SITE / "weekly").glob("20*.html"), *(SITE / "monthly").glob("20*.html"), *(SITE / "guide").glob("*.html")]:
        rel = f.relative_to(SITE).as_posix()
        if rel.endswith("index.html"):
            continue
        t = f.read_text(encoding="utf-8")
        title = re.search(r"<title>(.*?) · BTC Agent</title>", t)
        desc = re.search(r'<meta name="description" content="(.*?)">', t)
        items.append((_dates(rel)[0], rel, unescape(title.group(1)) if title else rel, unescape(desc.group(1)) if desc else ""))
    items.sort(key=lambda x: (x[0], x[1]), reverse=True)
    when = lambda d: format_datetime(datetime.fromisoformat(d).replace(tzinfo=timezone.utc))  # noqa: E731
    body = "".join(f"<item><title>{escape(t)}</title><link>{BASE}{r}</link><guid>{BASE}{r}</guid><pubDate>{when(d)}</pubDate><description>{escape(ds)}</description></item>\n"
                   for d, r, t, ds in items[:40])
    rss = ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n'
           f"<title>BTC Agent 새 글</title><link>{BASE}</link><description>비트코인 AI 예측 범위 · 시장 일지 · 매매 가이드</description><language>ko</language>\n"
           + body + "</channel></rss>\n")
    (SITE / "rss.xml").write_text(rss, encoding="utf-8", newline="\n")


def sync_index_verify() -> None:
    """메인(index.html)의 <!-- verify --> … <!-- /verify --> 사이를 VERIFY 값으로 맞춘다."""
    f = SITE / "index.html"
    t = f.read_text(encoding="utf-8")
    new = re.sub(r"<!-- verify -->.*?<!-- /verify -->", lambda m: "<!-- verify -->" + verify_meta().replace("\n  ", "") + "<!-- /verify -->", t, flags=re.S)
    if new != t:
        f.write_text(new, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
