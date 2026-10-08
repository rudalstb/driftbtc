"""Binance BTCUSDT 캔들 수집 및 로컬 캐시.

사용법:
    python data.py            # 1h, 1d 캔들을 갱신하고 1w는 1d에서 만든다
"""
from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
import requests

DATA_DIR = Path(__file__).parent / "data"
SYMBOL = "BTCUSDT"
START = {"1h": "2020-01-01", "1d": "2017-08-17"}
HOSTS = ["https://api.binance.com", "https://data-api.binance.vision"]
COLUMNS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_base", "taker_quote", "ignore",
]
NUMERIC = ["open", "high", "low", "close", "volume", "quote_volume", "trades", "taker_base", "taker_quote"]


def _get(path: str, params: dict) -> list:
    last_err = None
    for host in HOSTS:
        try:
            r = requests.get(host + path, params=params, timeout=20)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            last_err = e
    raise RuntimeError(f"Binance 요청 실패: {last_err}")


def fetch_klines(interval: str, start_ms: int) -> pd.DataFrame:
    rows: list = []
    while True:
        batch = _get("/api/v3/klines", {
            "symbol": SYMBOL, "interval": interval, "startTime": start_ms, "limit": 1000,
        })
        if not batch:
            break
        rows.extend(batch)
        start_ms = batch[-1][0] + 1
        if len(batch) < 1000:
            break
        time.sleep(0.2)
    df = pd.DataFrame(rows, columns=COLUMNS)
    if df.empty:
        return df
    df[NUMERIC] = df[NUMERIC].astype(float)
    df["time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    # 아직 마감되지 않은 캔들은 제외 (미래 정보 누출 방지)
    now_ms = int(time.time() * 1000)
    df = df[df["close_time"] < now_ms]
    return df.set_index("time")[NUMERIC]


def update(interval: str) -> pd.DataFrame:
    DATA_DIR.mkdir(exist_ok=True)
    path = DATA_DIR / f"{SYMBOL}_{interval}.csv"
    if path.exists():
        old = load_csv(path)
        start_ms = int(old.index[-1].timestamp() * 1000) + 1
    else:
        old = None
        start_ms = int(pd.Timestamp(START[interval], tz="UTC").timestamp() * 1000)
    new = fetch_klines(interval, start_ms)
    df = new if old is None else pd.concat([old, new])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.to_csv(path)
    print(f"{interval}: {len(df):,}개 캔들 ({df.index[0]} ~ {df.index[-1]}), 신규 {len(new):,}개")
    return df


def to_weekly(daily: pd.DataFrame) -> pd.DataFrame:
    """월요일 00:00 UTC 시작 주봉. 마지막 미완성 주는 제외."""
    agg = {"open": "first", "high": "max", "low": "min", "close": "last"}
    agg.update({c: "sum" for c in NUMERIC if c not in agg})
    weekly = daily.resample("W-MON", label="left", closed="left").agg(agg)
    counts = daily["close"].resample("W-MON", label="left", closed="left").count()
    return weekly[counts == 7]


def load_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, index_col="time", parse_dates=["time"])


def load(freq: str) -> pd.DataFrame:
    """freq: '1h' | '1d' | '1w'"""
    if freq == "1w":
        return to_weekly(load("1d"))
    return load_csv(DATA_DIR / f"{SYMBOL}_{freq}.csv")


if __name__ == "__main__":
    update("1h")
    daily = update("1d")
    print(f"1w: {len(to_weekly(daily)):,}개 캔들 (1d에서 생성)")
