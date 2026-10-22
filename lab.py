"""🔬 신호 실험실: 가격 말고 다른 정보원으로 만든 '다음 날 롱/숏' 신호들을 전부 같은 잣대로 채점한다.

같은 잣대 = 미래를 보지 않는 걷기식 + 수수료·슬리피지·펀딩비(signals.py 와 동일) + 레버리지 1배.
결과는 site/data/signal_lab.json 에 저장되고 '적중률' 탭의 신호 리그 표에 그대로 공개된다 (못 맞힌 신호도).

신호 목록
- 공포·탐욕 지수 극단 (≤25 롱 / ≥75 숏), 강한 극단 (≤20 / ≥80)
- 펀딩비 극단 (하루 평균 > 0.05% 숏 / < −0.01% 롱) — 역추세
- 나스닥 선물 전날 방향 따라가기, 달러지수 전날 반대
- 이동평균 추세 (종가 > 50일 / 200일 평균이면 롱, 아니면 숏), 돈치안 20일 돌파
- RSI 14 (< 30 롱 / > 70 숏), 7일 모멘텀 방향
- 요일 효과 (지난 1년 요일별 평균 수익률 부호 — 걷기식)
- 현재 AI 관점 (릿지, reports/predictions_1d.csv 의 걷기식 예측)
- 기준선: 항상 롱

외부 데이터는 lab/data/ 에 캐시한다 (받지 못하면 캐시 사용).
    python lab.py
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

import signals

ROOT = Path(__file__).parent
CACHE = ROOT / "lab" / "data"
OUT = ROOT / "site" / "data" / "signal_lab.json"
UA = {"User-Agent": "Mozilla/5.0"}
H = 24  # 하루 보유


# ───────── 데이터 ─────────
def _cache(name: str, fetch) -> pd.DataFrame:
    p = CACHE / name
    CACHE.mkdir(parents=True, exist_ok=True)
    try:
        df = fetch()
        if df is not None and len(df):
            df.to_csv(p)
            return df
    except Exception as e:  # 막힌 지역(GitHub 미국 서버 등)에서는 캐시로
        print(f"{name}: 새로 받지 못해 캐시 사용 ({e})")
    if p.exists():
        return pd.read_csv(p, index_col=0, parse_dates=[0])
    raise RuntimeError(f"{name}: 데이터 없음")


def fetch_fng() -> pd.DataFrame:
    r = requests.get("https://api.alternative.me/fng/?limit=0&format=json", timeout=30).json()["data"]
    df = pd.DataFrame({"fng": [int(x["value"]) for x in r]}, index=pd.to_datetime([int(x["timestamp"]) for x in r], unit="s", utc=True))
    return df.sort_index()


def fetch_funding() -> pd.DataFrame:
    rows, end = [], None
    for _ in range(14):  # 500개(8시간 × 500 ≈ 166일)씩 뒤로 — 약 6년
        params = {"symbol": "BTCUSDT", "limit": 1000}
        if end:
            params["endTime"] = end
        r = requests.get("https://fapi.binance.com/fapi/v1/fundingRate", params=params, timeout=30).json()
        if not r:
            break
        rows = r + rows
        end = r[0]["fundingTime"] - 1
        time.sleep(0.2)
    df = pd.DataFrame({"funding": [float(x["fundingRate"]) for x in rows]}, index=pd.to_datetime([x["fundingTime"] for x in rows], unit="ms", utc=True))
    return df[~df.index.duplicated()].sort_index()


def fetch_yahoo(sym: str, col: str) -> pd.DataFrame:
    y = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=6y", headers=UA, timeout=30).json()["chart"]["result"][0]
    close = y["indicators"]["quote"][0]["close"]
    df = pd.DataFrame({col: close}, index=pd.to_datetime(y["timestamp"], unit="s", utc=True).normalize())
    return df[~df.index.duplicated()].dropna().sort_index()


def load_all() -> dict:
    btc = pd.read_csv(ROOT / "data" / "BTCUSDT_1d.csv", index_col="time", parse_dates=["time"])
    btc.index = pd.DatetimeIndex(btc.index)
    if btc.index.tz is None:
        btc.index = btc.index.tz_localize("UTC")
    fng = _cache("fng.csv", fetch_fng)
    fund = _cache("funding.csv", fetch_funding)
    nq = _cache("nq.csv", lambda: fetch_yahoo("NQ%3DF", "nq"))
    dxy = _cache("dxy.csv", lambda: fetch_yahoo("DX-Y.NYB", "dxy"))
    for df in (fng, fund, nq, dxy):
        if df.index.tz is None:
            df.index = df.index.tz_localize("UTC")
    pred = pd.read_csv(ROOT / "reports" / "predictions_1d.csv", index_col=0, parse_dates=[0])
    pred.index = pd.DatetimeIndex(pred.index)
    if pred.index.tz is None:
        pred.index = pred.index.tz_localize("UTC")
    return {"btc": btc, "fng": fng, "fund": fund, "nq": nq, "dxy": dxy, "pred": pred}


# ───────── 신호 ─────────
def build_signals(d: dict) -> tuple[pd.DataFrame, pd.Series, dict]:
    btc = d["btc"]
    close = btc["close"]
    idx = close.index
    # 다음 날 수익률 (오늘 종가 → 내일 종가): 오늘 종가에 포지션을 잡고 내일 종가에 평가
    ret_next = np.log(close.shift(-1) / close)
    S = pd.DataFrame(index=idx)
    meta = {}

    fng = d["fng"]["fng"].reindex(idx, method="ffill")
    S["fng_25_75"] = np.where(fng <= 25, 1, np.where(fng >= 75, -1, 0)); meta["fng_25_75"] = ("공포·탐욕 극단", "지수 25 이하면 롱, 75 이상이면 숏 (역추세)")
    S["fng_20_80"] = np.where(fng <= 20, 1, np.where(fng >= 80, -1, 0)); meta["fng_20_80"] = ("공포·탐욕 강한 극단", "지수 20 이하면 롱, 80 이상이면 숏")

    fd = d["fund"]["funding"].resample("1D").mean().reindex(idx)
    S["funding_ext"] = np.where(fd > 0.0005, -1, np.where(fd < -0.0001, 1, 0)); meta["funding_ext"] = ("펀딩비 극단", "하루 평균 펀딩 > 0.05%면 숏, < −0.01%면 롱 (쏠린 쪽 반대)")
    S["funding_sign"] = np.where(fd > 0, -1, np.where(fd < 0, 1, 0)); meta["funding_sign"] = ("펀딩비 부호 반대", "펀딩이 양수면 숏, 음수면 롱 — 매일")

    nq = d["nq"]["nq"].reindex(idx, method="ffill")
    nq_ret = np.log(nq / nq.shift(1))
    S["nq_follow"] = np.sign(nq_ret).fillna(0); meta["nq_follow"] = ("나스닥 전날 따라가기", "나스닥 선물이 오른 날 다음 날 롱, 내린 날 숏")
    dxy = d["dxy"]["dxy"].reindex(idx, method="ffill")
    S["dxy_inverse"] = -np.sign(np.log(dxy / dxy.shift(1))).fillna(0); meta["dxy_inverse"] = ("달러지수 반대", "달러가 오른 날 다음 날 숏, 내린 날 롱")

    for n in (50, 200):
        S[f"ma{n}"] = np.where(close > close.rolling(n).mean(), 1, -1); meta[f"ma{n}"] = (f"{n}일 이동평균 추세", f"종가가 {n}일 평균 위면 롱, 아래면 숏")
    hi20, lo20 = close.rolling(20).max(), close.rolling(20).min()
    don = pd.Series(np.where(close >= hi20, 1, np.where(close <= lo20, -1, np.nan)), index=idx).ffill().fillna(0)
    S["donchian20"] = don; meta["donchian20"] = ("돈치안 20일 돌파", "20일 최고가 돌파하면 롱 유지, 최저가 이탈하면 숏 유지")

    delta = close.diff()
    up = delta.clip(lower=0).rolling(14).mean(); dn = (-delta.clip(upper=0)).rolling(14).mean()
    rsi = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    S["rsi14"] = np.where(rsi < 30, 1, np.where(rsi > 70, -1, 0)); meta["rsi14"] = ("RSI 14 극단", "RSI 30 아래면 롱, 70 위면 숏 (역추세)")
    S["mom7"] = np.sign(np.log(close / close.shift(7))).fillna(0); meta["mom7"] = ("7일 모멘텀", "지난 7일 올랐으면 롱, 내렸으면 숏")

    # 요일 효과: 지난 365일 같은 요일 평균 수익률 부호 (걷기식 — 오늘까지의 과거만 사용)
    past = np.log(close / close.shift(1))
    dow = pd.Series(idx.dayofweek, index=idx)
    wd = pd.Series(0.0, index=idx)
    past_v, dow_v = past.to_numpy(), dow.to_numpy()
    for i in range(400, len(idx) - 1):
        target = dow_v[i + 1]  # 내일의 요일
        win_r, win_d = past_v[i - 365:i + 1], dow_v[i - 365:i + 1]  # 오늘까지의 과거 1년
        same = win_r[win_d == target]
        same = same[~np.isnan(same)]
        wd.iloc[i] = np.sign(same.mean()) if len(same) else 0
    S["weekday"] = wd; meta["weekday"] = ("요일 효과", "지난 1년 같은 요일 평균이 양수면 롱, 음수면 숏")

    pr = d["pred"]["ridge"].reindex(idx)
    S["ridge_ai"] = np.where(pr.isna(), 0, np.where(pr >= 0, 1, -1)); meta["ridge_ai"] = ("현재 AI 관점 (릿지)", "가격 특징으로 만든 지금 사이트의 1일 관점")

    S["always_long"] = 1; meta["always_long"] = ("항상 롱 (기준선)", "그냥 들고만 있기")
    return S, ret_next, meta


def score(sig: np.ndarray, ret: np.ndarray) -> dict:
    s = signals._stats(sig, ret, H)
    nz = sig != 0
    eq, net = signals._equity(sig, ret, H)
    trades = int((np.diff(np.r_[0, sig]) != 0).sum())  # 포지션이 바뀐 횟수 (진입·청산·전환 모두)
    return {
        "n": int(len(ret)), "exposure": float(nz.mean()), "flips": s["flips"], "trades": trades,
        "hit_rate": float((np.sign(sig[nz]) == np.sign(ret[nz])).mean()) if nz.any() else None,
        "gross_pct": s["gross_return_pct"], "net_pct": s["return_pct"], "mdd_pct": s["max_drawdown_pct"],
        "profit_factor": s["profit_factor"],
        "annual_pct": float((np.exp(np.sum(net) * 365 / len(ret)) - 1) * 100),
    }


def main() -> None:
    d = load_all()
    S, ret, meta = build_signals(d)
    # 공통 구간: 모든 데이터가 있는 기간 (펀딩은 자체 시작일부터)
    start = max(d["nq"].index[0], d["fng"].index[0], S.index[0] + pd.Timedelta(days=400))
    end = ret.dropna().index[-1]
    rows = []
    for col in S.columns:
        s0 = start if col not in ("funding_ext", "funding_sign") else max(start, d["fund"].index[0].normalize())
        if col == "ridge_ai":
            s0 = max(start, d["pred"].index[0])
        m = (S.index >= s0) & (S.index <= end)
        sig = S[col].to_numpy()[m].astype(float)
        r = ret.to_numpy()[m]
        ok = ~np.isnan(r)
        sig, r = sig[ok], r[ok]
        sc = score(sig, r)
        base = score(np.ones(len(r)), r)
        # 최근 2년만 따로 (강세장 초입에서 시작한 결과인지 가려 보기 위해)
        m2 = S.index[m][ok] >= end - pd.Timedelta(days=730)
        rec = score(sig[m2], r[m2]) if m2.sum() > 100 else None
        rec_base = score(np.ones(int(m2.sum())), r[m2]) if rec else None
        rows.append({"id": col, "name": meta[col][0], "desc": meta[col][1], "since": str(S.index[m][0].date()), "until": str(end.date()),
                     **sc, "long_net_pct": base["net_pct"], "long_hit": base["hit_rate"],
                     "recent": rec and {"net_pct": rec["net_pct"], "hit_rate": rec["hit_rate"], "mdd_pct": rec["mdd_pct"], "trades": rec["trades"], "long_net_pct": rec_base["net_pct"]}})
    rows.sort(key=lambda x: -x["net_pct"])
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "horizon": "1d", "leverage": 1,
           "costs": {"fee_pct": signals.FEE * 100, "slip_pct": signals.SLIP * 100, "funding_8h_pct": signals.FUNDING_8H * 100},
           "signals": rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{'신호':22s} {'기간':10s} {'노출':>5s} {'적중':>6s} {'비용후':>8s} {'항상롱':>8s} {'낙폭':>7s} {'거래':>5s} | {'최근2년':>8s} {'항상롱':>8s}")
    for r in rows:
        rc = r["recent"] or {}
        print(f"{r['name']:22s} {r['since']:10s} {r['exposure']*100:4.0f}% {(r['hit_rate'] or 0)*100:5.1f}% {r['net_pct']:+7.0f}% {r['long_net_pct']:+7.0f}% {r['mdd_pct']:6.0f}% {r['trades']:5d} | {rc.get('net_pct', 0):+7.0f}% {rc.get('long_net_pct', 0):+7.0f}%")


if __name__ == "__main__":
    main()
