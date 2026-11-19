# BTC Agent (저장소 이름: driftbtc)

비트코인 예측 범위·시장 일지·매매 가이드를 공개하는 사이트. https://btc.rudals.app
예측 실험용이며 투자 권유가 아니다. 사이트 문구도 이 선을 넘지 않는다.

## 답변·글쓰기

- 사용자에게 하는 모든 답변은 100% 한국어 (코드·URL·버튼 이름만 예외). 중간 진행 안내도 한국어.
- 경로는 항상 전체 경로로 적는다 (`C:\Users\DG-2507-PC-011\driftbtc\...`).
- 코드 주석·커밋 메시지·사이트 문구는 한국어. 사이트 문구는 쉬운 말, 해요체.
- 커밋 메시지: 이모지 하나 + 무엇을 왜 바꿨는지 한 줄 (예: `🛡️ 푸시 감시는 앞단 저장본을 피해 최신 값으로`).

## 어디서 무엇이 도는가

| 곳 | 무엇 | 올리는 법 |
|---|---|---|
| GitHub Actions `.github/workflows/forecast.yml` | 데이터 수집 → 예측 → 일지·가이드 → 텔레그램 알림 → 커밋 → GitHub Pages 배포 → 검색엔진 알림 | main 에 푸시하면 실행. 매시간 Cloudflare 가 깨움 |
| GitHub Pages | `site/` (정적 사이트) | 위 워크플로가 배포 |
| Vercel (서울) | `api/*.js` (포지션·푸시·방문 집계 등), `lib/` | main 푸시 때 Vercel 이 자동 배포. 주소 https://driftbtc.vercel.app |
| Cloudflare Worker | `worker/cron.js`(매시간 워크플로 실행), `worker/watch.js`(1분마다 급변 감시) | 저장소와 자동 연결 안 됨. 고치면 사용자가 Cloudflare 화면에 붙여 넣어야 한다 |

비밀 값(거래소 키·텔레그램 토큰·푸시 키·Redis)은 GitHub·Vercel·Cloudflare 의 Secret 에만 있다. 찾지도, 출력하지도, 코드에 넣지도 않는다.

## 실행

```bash
cd /c/Users/DG-2507-PC-011/driftbtc
export PYTHONIOENCODING=utf-8
.venv/Scripts/python data.py                 # 캔들 수집 → data/ (저장소에 안 올라감)
.venv/Scripts/python forecast.py             # 예측 → site/data/forecast.json
.venv/Scripts/python -m http.server 8767 --directory site   # 미리보기 (.claude/launch.json 의 "site")
```

- 백테스트 지표를 다시 내려면 `backtest.py` → `signals.py` → `forecast.py` 순서.
- 테스트 모음은 없다. 고친 스크립트를 직접 돌리거나 `python -c "import 모듈"` 로 확인하고, 화면은 미리보기로 본다.
- `bundle.py` · `og.py` 는 배포본에서만 쓴다. 로컬에서 돌리면 `site/index.html` 이 바뀌니 돌리지 않는다.

## 꼭 지킬 것

- **작업 전 `git pull --rebase`, 푸시 직전에도 다시.** 워크플로가 매시간 `forecast YYYY-MM-DD HH:MM UTC` 커밋을 main 에 올려 로컬은 늘 뒤처져 있다.
- **main 푸시 = 바로 배포.** 워크플로가 돌고 사이트·Vercel 에 반영된다. 커밋·푸시는 사용자가 하라고 할 때만.
- **자동으로 만드는 파일은 손으로 고치지 않는다.** 만드는 스크립트를 고친다.
  - `site/data/*`, `site/sitemap.xml`, `site/rss.xml`, `site/robots.txt`, `reports/*`
  - `site/about.html` · `faq.html` · `privacy.html` · `disclaimer.html` · `site/guide/*.html` → `pages.py` 의 `PAGES`
  - `site/daily/` · `site/weekly/` · `site/monthly/` → `daily.py` · `weekly.py` · `monthly.py`
- **이미 쓴 일지·성적표·예측 기록은 고치지 않는다** (`site/daily/날짜.html`, `forecast_log.jsonl` 등). 그날 기록 그대로 두는 것이 이 사이트의 신뢰 근거다.
- **`pages.py` 를 통째로 돌리면 데이터 가이드 4편의 '숫자 갱신' 날짜가 오늘로 바뀐다.** 가이드 내용을 고칠 때만 돌린다. sitemap·RSS 만 다시 만들 때는 `python -c "import pages; pages.write_sitemap()"`.
- **`private/` 는 개인 파일(거래내역서 등).** 열지 않고, 저장소에 올리지 않는다.
- 워크플로에 단계를 더할 때: 예측·배포와 무관한 부가 단계는 `continue-on-error: true`. 새로 만든 파일을 저장소에 남기려면 '예측 기록 커밋' 단계의 `git add` 목록에 넣는다.
- `site/index.html` 의 스크립트 태그 묶음은 연속으로 둔다 (`bundle.py` 가 한 덩어리로 찾는다).

## 파일 안내

- 예측: `data.py`(수집) · `features.py` · `models.py` · `backtest.py` · `signals.py` · `forecast.py` · `eth.py`
- 글: `pages.py`(고정 페이지·가이드·sitemap·RSS) · `daily.py` · `weekly.py` · `monthly.py` · `guide_og.py` · `daily_og.py`
- 통계·기록: `history.py` · `jumps_stats.py` · `liq.py` · `kimp_hist.py` · `lab.py` · `collector.py` · `trades.py` · `flows.py` · `visits.py`
- 알림: `notify.py`(텔레그램, 상태는 `site/data/notify_state.json`) · `alert_week.py` · `api/push.js`(웹 푸시) · `indexnow.py`(빙·네이버에 새 글 알림)
- 사이트: `site/index.html` + `site/*.js` (빌드 없음), 글 페이지 공통 `site/page.js` · `site/page.css`, 설정 `site/config.js`
- 검색: 구글은 `rudals.app` DNS 로 인증, 네이버는 `site/index.html` 메타 태그. `site/a5c37f57ba4c6c44ebca79eb26faa1f0.txt` 는 IndexNow 공개 키라 지우지 않는다.

각 파일 맨 위 설명글에 하는 일과 실행법이 적혀 있다. 고치기 전에 먼저 읽는다.
