"""모델 입력 피처. 모든 피처는 t 시점 캔들 마감까지의 정보만 사용한다.

타깃은 다음 캔들의 로그수익률: log(close[t+1] / close[t]).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# 주기별 룩백 창 (캔들 개수)
WINDOWS = {"1h": [6, 24, 72, 168], "1d": [3, 7, 30, 90], "1w": [2, 4, 12, 26]}


def build(df: pd.DataFrame, freq: str) -> pd.DataFrame:
    X = pd.DataFrame(index=df.index)
    ret = np.log(df["close"]).diff()
    X["ret"] = ret
    for lag in range(1, 6):
        X[f"ret_lag{lag}"] = ret.shift(lag)
    for w in WINDOWS[freq]:
        X[f"mom_{w}"] = ret.rolling(w).sum()
        X[f"vol_{w}"] = ret.rolling(w).std()
        X[f"zclose_{w}"] = (df["close"] - df["close"].rolling(w).mean()) / df["close"].rolling(w).std()
    logv = np.log1p(df["quote_volume"])
    X["volume_z"] = (logv - logv.rolling(WINDOWS[freq][2]).mean()) / logv.rolling(WINDOWS[freq][2]).std()
    X["taker_ratio"] = df["taker_base"] / df["volume"].replace(0, np.nan)
    X["range"] = np.log(df["high"] / df["low"])
    X["body"] = np.log(df["close"] / df["open"])
    X["upper_wick"] = np.log(df["high"] / df[["open", "close"]].max(axis=1))
    X["lower_wick"] = np.log(df[["open", "close"]].min(axis=1) / df["low"])
    if freq == "1h":
        X["hour"] = df.index.hour
        X["dow"] = df.index.dayofweek
    elif freq == "1d":
        X["dow"] = df.index.dayofweek
    return X


def target(df: pd.DataFrame) -> pd.Series:
    return np.log(df["close"]).diff().shift(-1).rename("target")
