"""최신 데이터로 실시간 예측을 만들어 site/data/forecast.json 에 쓴다.

- 중앙값: 현재 가격 (백테스트에서 어떤 모델도 naive 를 유의하게 이기지 못했음)
- 예측 구간: GARCH(1,1)-t 다단계 분산으로 만든 68% / 95% 부채꼴
- 모델 기울기: LightGBM / Ridge 의 다음 캔들 수익률 예측 (참고용)
- 최근 기록: 최근 N개 캔들에 대한 표본 외 1단계 95% 구간과 실제 가격
- 실행할 때마다 site/data/forecast_log.jsonl 에 예측을 남겨 실제 운영 기록을 쌓는다

사용법:
    python forecast.py            # 데이터 갱신 + 예측
    python forecast.py --no-update
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from arch import arch_model

import backtest
import data
import features
import models

ROOT = Path(__file__).parent
SITE_DATA = ROOT / "site" / "data"
STEP = {"1h": pd.Timedelta(hours=1), "1d": pd.Timedelta(days=1), "1w": pd.Timedelta(weeks=1)}
HORIZON = {"1h": 24, "1d": 30, "1w": 12}
HISTORY = {"1h": 72, "1d": 90, "1w": 52}
Z68, Z95 = 0.9945, 1.96


def garch_path(ret: pd.Series, horizon: int, max_obs: int = 10000) -> np.ndarray:
    """마지막 시점에서 1..horizon 캔들 후 누적 로그수익률의 표준편차."""
    r = ret.dropna().iloc[-max_obs:] * 100
    am = arch_model(r, mean="Zero", vol="GARCH", p=1, q=1, dist="t", rescale=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = am.fit(disp="off")
        var = res.forecast(horizon=horizon, reindex=False).variance.iloc[-1].to_numpy()
    return np.sqrt(np.cumsum(var)) / 100


def run(freq: str) -> dict:
    cfg = backtest.CONFIG[freq]
    step = STEP[freq]
    df = data.load(freq)
    ret = np.log(df["close"]).diff()
    X = features.build(df, freq)
    y = features.target(df)
    ok = X.notna().all(axis=1)
    train = ok & y.notna()

    # 시점 규칙: 인덱스 t 캔들의 종가 = (t + step) 시각의 가격
    last_t = df.index[-1]
    now_time = last_t + step
    price = float(df["close"].iloc[-1])

    lean = {}
    for m in [models.Ridge(), models.LGBM(cfg["min_child"])]:
        m.fit(X[train], y[train])
        lean[m.name] = float(m.predict(X[ok].iloc[[-1]])[0])

    sd = garch_path(ret, HORIZON[freq])
    future = []
    for k, s in enumerate(sd, 1):
        future.append({
            "t": (now_time + k * step).isoformat(),
            "lo95": price * np.exp(-Z95 * s), "lo68": price * np.exp(-Z68 * s),
            "mid": price,
            "hi68": price * np.exp(Z68 * s), "hi95": price * np.exp(Z95 * s),
        })

    # 최근 기록: 구간 시작 전까지만으로 GARCH 를 적합하고 파라미터 고정 후 1단계 예측 (표본 외)
    n = HISTORY[freq]
    idx = df.index[-n - 1:-1]  # 이 시점들에서 다음 캔들을 예측
    sig = models.garch_sigma(ret, idx[0], idx).to_numpy()
    base = df["close"].reindex(idx).to_numpy()
    actual = df["close"].shift(-1).reindex(idx).to_numpy()
    history = []
    for t, b, s, a in zip(idx, base, sig, actual):
        history.append({
            "t": (t + 2 * step).isoformat(), "actual": float(a),
            "lo95": float(b * np.exp(-Z95 * s)), "hi95": float(b * np.exp(Z95 * s)),
        })
    hits = [h["lo95"] <= h["actual"] <= h["hi95"] for h in history]

    return {
        "price": price,
        "as_of": now_time.isoformat(),
        "next": future[0],
        "future": future,
        "lean_pct": {k: v * 100 for k, v in lean.items()},
        "history": history,
        "recent_cover95": float(np.mean(hits)),
    }


def _round(o, nd: int = 4):
    if isinstance(o, float):
        return round(o, 2) if abs(o) >= 100 else round(o, nd)
    if isinstance(o, dict):
        return {k: _round(v, nd) for k, v in o.items()}
    if isinstance(o, list):
        return [_round(v, nd) for v in o]
    return o


def main(update: bool = True) -> None:
    if update:
        data.update("1h")
        data.update("1d")
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "forecasts": {}}
    for freq in ["1h", "1d", "1w"]:
        out["forecasts"][freq] = run(freq)
        f = out["forecasts"][freq]
        print(f"{freq}: 현재 ${f['price']:,.0f}  다음 95% [{f['next']['lo95']:,.0f} ~ {f['next']['hi95']:,.0f}]"
              f"  최근 적중 {f['recent_cover95'] * 100:.0f}%")

    for name in ["summary.json", "btcgpt_compare.json"]:
        p = ROOT / "reports" / name
        if p.exists():
            out[name.removesuffix(".json")] = json.loads(p.read_text(encoding="utf-8"))

    out = _round(out)
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    (SITE_DATA / "forecast.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    with open(SITE_DATA / "forecast_log.jsonl", "a", encoding="utf-8") as log:
        for freq, f in out["forecasts"].items():
            log.write(json.dumps({"made_at": out["generated_at"], "freq": freq, "price": f["price"],
                                  "as_of": f["as_of"], **f["next"]}) + "\n")


if __name__ == "__main__":
    main(update="--no-update" not in sys.argv)
