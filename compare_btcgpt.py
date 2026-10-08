"""BTCGPT 공개 예측(pred_past)과 우리 백테스트 예측을 같은 목표 시점끼리 비교한다.

사용법:
    python compare_btcgpt.py          # btcgpt 데이터를 새로 받아 비교 → reports/btcgpt_compare.json
    python compare_btcgpt.py --cached # data/btcgpt_output.json 사용
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).parent
SOURCE = "https://raw.githubusercontent.com/btcgpt/data/main/output.json"
CACHE = ROOT / "data" / "btcgpt_output.json"
STEP = {"hour": ("1h", pd.Timedelta(hours=1)), "day": ("1d", pd.Timedelta(days=1)), "week": ("1w", pd.Timedelta(weeks=1))}

if "--cached" not in sys.argv:
    CACHE.write_bytes(requests.get(SOURCE, timeout=20).content)
g = json.loads(CACHE.read_text())

result = {}
print(f"{'구간':<6}{'n':>5}{'BTCGPT':>9}{'naive':>9}{'ridge':>9}{'lgbm':>9}   (MAPE %, 같은 목표 시점)")
for key, (freq, step) in STEP.items():
    pred = pd.read_csv(ROOT / "reports" / f"predictions_{freq}.csv", index_col=0, parse_dates=[0])
    # 우리 인덱스 t = 캔들 시작. close[t+1] 은 t+2 시점 가격이며, BTCGPT 의 x 는 "x 시점 가격"(= x 캔들 시가)
    pred.index = pred.index + 2 * step
    actual = pred["close"] * np.exp(pred["actual_ret"])
    gp = pd.Series({pd.Timestamp(p["x"], tz="UTC"): p["y"] for p in g[key]["pred_past"]})
    common = gp.index.intersection(pred.index)
    a = actual[common]
    row = {"n": len(common), "btcgpt": float(np.mean(np.abs(gp[common] - a) / a) * 100)}
    for m in ["naive", "ridge", "lgbm"]:
        p = pred.loc[common, "close"] * np.exp(pred.loc[common, m])
        row[m] = float(np.mean(np.abs(p - a) / a) * 100)
    result[freq] = row
    print(f"{key:<6}{row['n']:>5}" + "".join(f"{row[k]:>9.3f}" for k in ["btcgpt", "naive", "ridge", "lgbm"]))

(ROOT / "reports" / "btcgpt_compare.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
