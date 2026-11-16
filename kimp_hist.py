"""🇰🇷 김치 프리미엄 역사: 업비트 KRW-BTC 일봉 ÷ (바이낸스 BTCUSDT 일봉 × 원·달러 환율) − 1.

- 업비트 일봉(한국 시간 오전 9시 = UTC 0시 기준, 바이낸스 일봉과 같은 경계)은 data/upbit_KRW-BTC_1d.csv 에 쌓아 두고 새 날만 받는다.
- 환율은 야후 파이낸스 KRW=X 일봉(종가). 주말·휴일은 직전 값으로 채운다. USDT 를 1달러로 본다.
- 김프 구간별로 그 뒤 30일 비트코인(바이낸스 달러 가격) 결과를 '평소(같은 기간 모든 날)'와 비교한다.

history.py 가 불러 쓴다. 단독 실행: python kimp_hist.py
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import data

CSV = data.DATA_DIR / "upbit_KRW-BTC_1d.csv"
UA = {"User-Agent": "Mozilla/5.0"}
BUCKETS = [  # (이름, 하한, 상한) — 김프 % 기준
    ("역프 (0% 미만)", -99, 0), ("0~2%", 0, 2), ("2~5%", 2, 5), ("5% 이상", 5, 999),
]
FWD = 30


def update_upbit() -> pd.Series:
    old = pd.read_csv(CSV, index_col="time", parse_dates=["time"])["close"] if CSV.exists() else pd.Series(dtype=float)
    rows, to = [], None
    stop = old.index[-1] if len(old) else None
    for _ in range(40):                                   # 200일 × 40 = 약 22년
        params = {"market": "KRW-BTC", "count": 200}
        if to:
            params["to"] = to
        r = requests.get("https://api.upbit.com/v1/candles/days", params=params, headers=UA, timeout=15)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        rows += batch
        oldest = pd.Timestamp(batch[-1]["candle_date_time_utc"], tz="UTC")
        if stop is not None and oldest <= stop or len(batch) < 200:
            break
        to = batch[-1]["candle_date_time_utc"].replace("T", " ")
        time.sleep(0.15)
    new = pd.Series({pd.Timestamp(x["candle_date_time_utc"], tz="UTC"): float(x["trade_price"]) for x in rows}, dtype=float)
    s = pd.concat([old, new]).sort_index()
    s = s[~s.index.duplicated(keep="last")]
    today = pd.Timestamp.now(tz="UTC").normalize()
    s = s[s.index < today]                                # 마감된 일봉만
    s.rename("close").rename_axis("time").to_csv(CSV)
    return s


def fx_daily() -> pd.Series:
    # range=max 로 부르면 조용히 '월봉'이 와서 날짜를 정해 일봉으로 받는다
    p1 = int(pd.Timestamp("2017-09-01", tz="UTC").timestamp())
    p2 = int(time.time()) + 86400
    r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?period1={p1}&period2={p2}&interval=1d", headers=UA, timeout=20)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    ts = pd.to_datetime(res["timestamp"], unit="s", utc=True).normalize()
    s = pd.Series(res["indicators"]["quote"][0]["close"], index=ts, dtype=float).dropna()
    if len(s) < 1500 or s.index.to_series().diff().dt.days.median() > 2:
        raise RuntimeError(f"환율이 일봉이 아니에요 ({len(s)}개)")
    s = s[(s > 800) & (s < 2500)]                         # 가끔 섞이는 엉뚱한 값 제거
    return s[~s.index.duplicated(keep="last")]


def analyze(btc_close: pd.Series) -> dict:
    upbit = update_upbit()
    fx = fx_daily()
    idx = upbit.index.intersection(btc_close.index)
    fx_a = fx.reindex(fx.index.union(idx)).sort_index().ffill().reindex(idx)
    k = (upbit.reindex(idx) / (btc_close.reindex(idx) * fx_a) - 1).dropna() * 100
    k = k[(k > -30) & (k < 80)]
    s = btc_close.reindex(k.index)
    fwd = btc_close.shift(-FWD).reindex(k.index) / s - 1      # 그 뒤 30일 (바이낸스 달러 가격)
    base = fwd.dropna()
    now = float(k.iloc[-1])
    rows = []
    for name, lo, hi in BUCKETS:
        m = (k >= lo) & (k < hi)
        f = fwd[m].dropna()
        # 붙어 있는 날은 한 번으로: 7일 넘게 끊겼다 다시 들어오면 새 구간
        on = k.index[m]
        episodes = int((on.to_series().diff().dt.days.fillna(999) > 7).sum()) if len(on) else 0
        rows.append({"name": name, "days": int(m.sum()), "n": int(len(f)), "episodes": episodes,
                     "up": round(float((f > 0).mean()) * 100, 1) if len(f) else None,
                     "median": round(float(f.median()) * 100, 2) if len(f) else None,
                     "now": bool(lo <= now < hi)})
    weekly = k.resample("W-MON").last().dropna()
    top = k.sort_values(ascending=False)
    peaks = []
    for t, v in top.items():                              # 서로 60일 이상 떨어진 최고점 3개
        if all(abs((t - p[0]).days) >= 60 for p in peaks):
            peaks.append((t, v))
        if len(peaks) == 3:
            break
    return {
        "now": round(now, 2), "as_of": k.index[-1].strftime("%Y-%m-%d"),
        "since": k.index[0].strftime("%Y-%m-%d"), "days": int(len(k)),
        "now_rank": round(float((k < now).mean()) * 100), "median": round(float(k.median()), 2),
        "avg_1y": round(float(k[k.index >= k.index[-1] - pd.Timedelta(days=365)].mean()), 2),
        "min": {"date": k.idxmin().strftime("%Y-%m-%d"), "v": round(float(k.min()), 2)},
        "peaks": [{"date": t.strftime("%Y-%m-%d"), "v": round(float(v), 2)} for t, v in peaks],
        "buckets": rows, "base": {"n": int(len(base)), "up": round(float((base > 0).mean()) * 100, 1),
                                  "median": round(float(base.median()) * 100, 2)},
        "fwd": FWD,
        "weekly": {"t": [t.strftime("%Y-%m-%d") for t in weekly.index], "v": [round(float(v), 2) for v in weekly.values]},
    }


if __name__ == "__main__":
    out = analyze(data.load("1d")["close"])
    print({k: v for k, v in out.items() if k != "weekly"})
