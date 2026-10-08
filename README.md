# driftbtc

BTCUSDT 1시간 / 1일 / 1주 예측 실험. 목표는 "그럴듯한 숫자"가 아니라
**기준선(현재 가격 그대로)과 정직하게 비교된 예측**과 **신뢰할 수 있는 예측 구간**이다.

> 예측 실험용 프로젝트이며 투자 권유가 아니다.

## 실행

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python data.py            # Binance 캔들 수집/갱신 → data/
.venv/Scripts/python backtest.py        # 걷기식 백테스트 → reports/
.venv/Scripts/python compare_btcgpt.py  # btcgpt.info 공개 예측과 같은 시점 비교
```

(Windows 콘솔에서 한글이 깨지면 `PYTHONIOENCODING=utf-8` 설정)

### 사이트

```bash
.venv/Scripts/python forecast.py                                   # 데이터 갱신 + site/data/forecast.json 생성
.venv/Scripts/python -m http.server 8765 --directory site          # http://localhost:8765
```

`site/` 는 정적 파일만으로 동작한다 (GitHub Pages 등에 그대로 올릴 수 있음).
`forecast.py` 를 주기적으로 (예: 매시 5분) 실행하면 예측이 갱신되고,
`site/data/forecast_log.jsonl` 에 실제 운영 예측 기록이 쌓인다.
백테스트 지표를 갱신하려면 `backtest.py` → `compare_btcgpt.py` → `forecast.py` 순서로 실행.

## 구성

| 파일 | 역할 |
|---|---|
| `data.py` | Binance klines 수집, 미마감 캔들 제외, 1d → 1w(월요일 시작) 변환 |
| `features.py` | 수익률 래그, 모멘텀, 변동성, 거래량 z, 테이커 비율, 캔들 모양, 시간 피처 |
| `models.py` | 점 예측: naive / drift / ridge / LightGBM, 변동성: EWMA / GARCH(1,1)-t |
| `backtest.py` | 블록 단위 재학습 걷기식 백테스트, MAPE·Diebold-Mariano·방향 적중률·구간 포함률 |
| `compare_btcgpt.py` | btcgpt.info 공개 예측과 같은 목표 시점 MAPE 비교 |
| `forecast.py` | 실시간 예측: 현재가 중앙값 + GARCH 68/95% 부채꼴, 최근 표본 외 구간 기록 |
| `site/` | 정적 사이트 (Chart.js, Binance 실시간 가격) |

## 첫 결과 (2026-10-08 기준)

테스트 구간: 1h 최근 1년, 1d 최근 3년, 1w 최근 3년.

| 주기 | naive MAPE | ridge | lgbm | lgbm 방향 적중 | GARCH 95% 구간 포함률 |
|---|---|---|---|---|---|
| 1h | 0.306% | 0.306% | 0.306% | 51.3% | 94.8% |
| 1d | 1.727% | 1.728% | 1.758% | 49.5% | 94.9% |
| 1w | 4.630% | 4.672% | 5.029% | 50.0% | 94.2% |

- 어떤 점 예측 모델도 naive 를 통계적으로 유의하게 이기지 못했다 (DM 검정 p > 0.05).
- GARCH 예측 구간은 목표(95%)에 거의 정확히 맞는다. 신뢰할 수 있는 결과물은 이쪽이다.

btcgpt.info 공개 예측과 같은 목표 시점 100개 비교 (MAPE %):

| 구간 | BTCGPT | naive | ridge | lgbm |
|---|---|---|---|---|
| hour | 0.292 | 0.209 | 0.206 | 0.209 |
| day | 1.892 | 1.322 | 1.339 | 1.362 |
| week | 6.696 | 4.443 | 4.496 | 5.086 |
