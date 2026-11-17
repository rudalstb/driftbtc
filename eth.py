"""Ξ 이더리움 예측 범위: 비트코인과 같은 방법(GARCH(1,1)-t σ + 68% 실제 분위수 보정, 95% 는 1.96)을 ETHUSDT 에 적용해
site/data/eth.json 에 쓴다. 매번 다음 캔들 예측을 site/data/eth_log.jsonl 에 남겨 실제 운영 적중률도 함께 공개한다.

- 1시간·하루·1주 (1주는 일봉에서 만든다)
- 최근 기록: 구간 시작 전 데이터로만 GARCH 를 맞춘 표본 외 1단계 95% 범위와 실제 가격
- 방향(오를지 내릴지)은 비트코인에서도 동전 던지기 수준이라 내지 않는다

    python eth.py            # 데이터 갱신 + 예측
    python eth.py --no-update
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

import data
import models
from forecast import HISTORY, HORIZON, SITE_DATA, STEP, Z68, Z95, _round, calib68, garch_path

SYMBOL = "ETHUSDT"
START = {"1h": "2022-01-01", "1d": "2017-08-17"}
OUT = SITE_DATA / "eth.json"
LOG = SITE_DATA / "eth_log.jsonl"
CHART_N = {"1h": 48, "1d": 60, "1w": 26}   # 화면 차트에 보여 줄 지난 캔들 수
# 68% 보정은 처음 보는 기간에서 나아진 주기에만 쓴다 (lab/calibrate.py 를 ETH 에 돌린 결과, reports/calibration_eth.json)
# 1h: 68% 포함률 83.2→74.5%, 1d: 84.0→64.7% (구간 점수도 개선) → 보정
# 1w: 지금 배수로도 55.8% 만 들어와 오히려 좁은 편이라, 범위를 좁히는 보정은 쓰지 않는다
USE_CALIB = {"1h": True, "1d": True, "1w": False}


def run(freq: str) -> dict:
    step = STEP[freq]
    df = data.load(freq, SYMBOL)
    ret = np.log(df["close"]).diff()
    now_time = df.index[-1] + step
    price = float(df["close"].iloc[-1])
    sd = garch_path(ret, HORIZON[freq])
    m68 = calib68(ret, freq) if USE_CALIB[freq] else Z68
    future = []
    for k, s in enumerate(sd, 1):
        z68 = Z68 + (m68 - Z68) / np.sqrt(k)   # 여러 캔들을 합치면 정규분포에 가까워지므로 보정 효과를 1/√k 로 줄인다
        future.append({"t": (now_time + k * step).isoformat(),
                       "lo95": price * np.exp(-Z95 * s), "lo68": price * np.exp(-z68 * s), "mid": price,
                       "hi68": price * np.exp(z68 * s), "hi95": price * np.exp(Z95 * s), "sigma": float(s)})

    # 표본 외 최근 기록 (1단계 95% 범위)
    n = HISTORY[freq]
    idx = df.index[-n - 1:-1]
    sig = models.garch_sigma(ret, idx[0], idx).to_numpy()
    base = df["close"].reindex(idx).to_numpy()
    actual = df["close"].shift(-1).reindex(idx).to_numpy()
    hits = [b * np.exp(-Z95 * s) <= a <= b * np.exp(Z95 * s) for b, s, a in zip(base, sig, actual)]
    closes = df["close"].iloc[-CHART_N[freq]:]
    return {
        "price": price, "as_of": now_time.isoformat(), "next": future[0], "future": future,
        "sigma_next": float(sd[0]), "mult68": round(m68, 4),
        "recent_cover95": float(np.mean(hits)), "recent_n": len(hits),
        # 차트용 지난 종가: 시각은 '그 가격이 된 시각'(캔들 시작 + step)
        "past": [[(t + step).isoformat(), float(c)] for t, c in closes.items()],
    }


def live_record() -> dict:
    """eth_log.jsonl 의 예측을 실제 가격과 비교 (같은 목표 시각은 처음 예측만)."""
    if not LOG.exists():
        return {}
    seen, logs = set(), []
    for line in LOG.read_text(encoding="utf-8").splitlines():
        if line.strip():
            e = json.loads(line)
            if (e["freq"], e["t"]) not in seen:
                seen.add((e["freq"], e["t"]))
                logs.append(e)
    out = {}
    for freq in ("1h", "1d", "1w"):
        c = data.load(freq, SYMBOL)["close"]
        c.index = c.index + STEP[freq]
        sc = [(e["lo68"] <= c[pd.Timestamp(e["t"])] <= e["hi68"], e["lo95"] <= c[pd.Timestamp(e["t"])] <= e["hi95"])
              for e in logs if e["freq"] == freq and pd.Timestamp(e["t"]) in c.index]
        out[freq] = {"n": len(sc), "hit68": int(sum(bool(a) for a, _ in sc)), "hit95": int(sum(bool(b) for _, b in sc)),
                     "since": next((e["made_at"] for e in logs if e["freq"] == freq), None)}
    return out


def main(update: bool = True) -> None:
    if update:
        for iv in ("1h", "1d"):
            data.update(iv, SYMBOL, START[iv])
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "symbol": SYMBOL, "forecasts": {}}
    for freq in ("1h", "1d", "1w"):
        f = out["forecasts"][freq] = run(freq)
        print(f"ETH {freq}: ${f['price']:,.2f}  다음 68% ±{(f['next']['hi68'] / f['price'] - 1) * 100:.2f}%  "
              f"95% ±{(f['next']['hi95'] / f['price'] - 1) * 100:.2f}%  최근 95% 적중 {f['recent_cover95'] * 100:.0f}%")
    out["live_record"] = live_record()
    out = _round(out)
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    # 같은 목표 시각 예측은 처음 것만 채점하므로, 이미 남긴 목표 시각이면 다시 쓰지 않는다
    done = set()
    if LOG.exists():
        done = {(e["freq"], e["t"]) for e in map(json.loads, filter(str.strip, LOG.read_text(encoding="utf-8").splitlines()))}
    with open(LOG, "a", encoding="utf-8", newline="\n") as log:
        for freq, f in out["forecasts"].items():
            if (freq, f["next"]["t"]) not in done:
                log.write(json.dumps({"made_at": out["generated_at"], "freq": freq, "price": f["price"],
                                      "as_of": f["as_of"], **{k: f["next"][k] for k in ("t", "lo95", "lo68", "hi68", "hi95")}}) + "\n")


if __name__ == "__main__":
    main(update="--no-update" not in sys.argv)
