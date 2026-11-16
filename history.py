"""📜 과거와 비교: 비트코인 일봉(2017-08~)으로 "예전에 이랬을 때 그 뒤엔 어땠나"를 정리해 site/data/history.json 에 쓴다.

1) 닮은꼴 과거: 최근 30일 가격 흐름(누적 수익률 경로)과 가장 닮은 과거 30일 10개를 찾아 그 뒤 7일·30일 결과를 본다.
2) 이런 날 다음엔: 지금 해당하는 조건(연속 하락, 7일 급락, 고점 대비 낙폭, 변동성, 200일선 등)이 있었던 날들의
   다음 날·7일 뒤 결과를 '평소(모든 날)'와 나란히 비교한다. 표본 수와 평소와의 차이가 우연인지(z)도 함께.
3) 고점 대비 낙폭: 지금보다 깊게 빠진 적이 몇 번이고, 이 깊이에서 전고점 회복까지 며칠 걸렸나.

마감된 일봉만 쓴다(어제 마감 기준). 예측 모델에는 넣지 않는다 — 효과가 있는지는 신호 실험실과 같은 잣대로 따로 채점한 뒤에만.

    python history.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

import data

OUT = Path(__file__).parent / "site" / "data" / "history.json"
WIN = 30          # 닮은꼴 비교 길이(일)
FWD = 30          # 닮은꼴 뒤로 보여 줄 길이(일)
TOP = 10          # 닮은꼴 개수
GAP = 20          # 닮은꼴끼리 최소 간격(일) — 거의 같은 구간이 여러 번 뽑히지 않게
MIN_N = 30        # 이보다 적으면 "표본 적음"


def pct(x: float) -> float:
    return round(float(x) * 100, 2)


def outcome_stats(fwd: pd.Series) -> dict:
    fwd = fwd.dropna()
    if fwd.empty:
        return {"n": 0}
    return {"n": int(len(fwd)), "up": round(float((fwd > 0).mean()) * 100, 1), "median": pct(fwd.median()),
            "worst": pct(fwd.min()), "best": pct(fwd.max())}


def verdict(p: float, p0: float, n: int) -> tuple[str, float]:
    """평소 상승 비율 p0 대비 p 가 우연 범위인지: 이항 근사 z. 표본 적으면 판정하지 않는다."""
    if n < MIN_N:
        return "표본 적음", 0.0
    se = np.sqrt(p0 * (1 - p0) / n)
    z = (p - p0) / se if se else 0.0
    if z >= 2:
        return "평소보다 자주 오름", round(float(z), 1)
    if z <= -2:
        return "평소보다 자주 내림", round(float(z), 1)
    return "평소와 비슷", round(float(z), 1)


def analogs(close: pd.Series) -> dict:
    lc = np.log(close.to_numpy())
    n = len(lc)
    cur = lc[n - WIN - 1:] - lc[n - WIN - 1]          # 지금: 31개 점, 시작 0
    cands = []
    for t in range(WIN, n - 1 - FWD):                  # t = 비교 구간 끝(그 뒤 FWD 일이 있어야 함)
        path = lc[t - WIN:t + 1] - lc[t - WIN]
        d = float(np.sqrt(np.mean((path - cur) ** 2)))
        cands.append((d, t))
    cands.sort()
    picked: list[int] = []
    for d, t in cands:
        if all(abs(t - u) >= GAP for u in picked):
            picked.append(t)
        if len(picked) == TOP:
            break
    idx = close.index
    items, f7, f30, paths = [], [], [], []
    for t in picked:
        base = lc[t]
        p = np.round((np.exp(lc[t - WIN:t + FWD + 1] - base) - 1) * 100, 2).tolist()   # 끝점=0% 기준, -30..+30
        r7, r30 = np.exp(lc[t + 7] - base) - 1, np.exp(lc[t + 30] - base) - 1
        corr = float(np.corrcoef(lc[t - WIN:t + 1] - lc[t - WIN], cur)[0, 1])
        items.append({"date": idx[t].strftime("%Y-%m-%d"), "price": round(float(close.iloc[t]), 0),
                      "fwd7": pct(r7), "fwd30": pct(r30), "corr": round(corr, 2)})
        f7.append(r7); f30.append(r30); paths.append(p)
    fwd_paths = np.array([p[WIN:] for p in paths])
    median_path = np.round(np.median(fwd_paths, axis=0), 2).tolist()
    now_path = np.round((np.exp(cur - cur[-1]) - 1) * 100, 2).tolist()
    # 평소: 모든 날의 7일·30일 뒤 결과
    s = close
    base7, base30 = s.shift(-7) / s - 1, s.shift(-30) / s - 1
    return {
        "window": WIN, "now_path": now_path, "paths": paths, "median_path": median_path, "items": items,
        "fwd7": outcome_stats(pd.Series(f7)), "fwd30": outcome_stats(pd.Series(f30)),
        "base7": outcome_stats(base7), "base30": outcome_stats(base30),
    }


def conditions(close: pd.Series) -> list[dict]:
    s = close
    r1 = s.pct_change()
    lr = np.log(s).diff()
    nxt1, nxt7 = s.shift(-1) / s - 1, s.shift(-7) / s - 1
    # 연속 상승/하락 일수 (오늘 포함)
    sign = np.sign(r1).fillna(0)
    streak = sign.groupby((sign != sign.shift()).cumsum()).cumcount() + 1
    streak = streak * sign
    r7 = s / s.shift(7) - 1
    dd = s / s.cummax() - 1
    vol20 = lr.rolling(20).std() * np.sqrt(365)
    vol_rank = vol20.rank(pct=True)
    ma200 = s.rolling(200).mean()

    def bucket(x: float) -> tuple[float, float]:
        lo = np.floor(x * 10) / 10                     # 예: -0.27 → -0.3
        return lo, lo + 0.1

    last = s.index[-1]
    st, d_now = int(streak.iloc[-1]), float(dd.iloc[-1])
    rules: list[tuple[str, pd.Series]] = []
    if st <= -3:
        rules.append((f"{-st}일 연속 하락", streak <= st))
    elif st >= 3:
        rules.append((f"{st}일 연속 상승", streak >= st))
    if r7.iloc[-1] <= -0.10:
        rules.append(("7일 동안 10% 넘게 하락", r7 <= -0.10))
    elif r7.iloc[-1] >= 0.10:
        rules.append(("7일 동안 10% 넘게 상승", r7 >= 0.10))
    if abs(r1.iloc[-1]) >= 0.05:
        rules.append(("하루에 5% 넘게 하락" if r1.iloc[-1] < 0 else "하루에 5% 넘게 상승", (r1 <= -0.05) if r1.iloc[-1] < 0 else (r1 >= 0.05)))
    if d_now <= -0.05:
        lo, hi = bucket(d_now)
        rules.append((f"최고점 대비 −{round(-hi * 100)}~−{round(-lo * 100)}% 구간", (dd > lo) & (dd <= hi)))
    if vol_rank.iloc[-1] >= 0.8:
        rules.append(("변동성 높음 (20일 기준 상위 20%)", vol_rank >= 0.8))
    elif vol_rank.iloc[-1] <= 0.2:
        rules.append(("변동성 낮음 (20일 기준 하위 20%)", vol_rank <= 0.2))
    if pd.notna(ma200.iloc[-1]):
        below = s.iloc[-1] < ma200.iloc[-1]
        rules.append(("200일 이동평균선 아래" if below else "200일 이동평균선 위", (s < ma200) if below else (s >= ma200)))

    base1, base7 = (nxt1.dropna() > 0).mean(), (nxt7.dropna() > 0).mean()
    out = []
    for name, mask in rules:
        mask = mask.fillna(False) & (s.index < last)    # 오늘 자신은 결과가 없으니 제외
        o1, o7 = outcome_stats(nxt1[mask]), outcome_stats(nxt7[mask])
        v, z = verdict(o7.get("up", 0) / 100, base7, o7["n"]) if o7["n"] else ("표본 없음", 0.0)
        out.append({"name": name, "next1": o1, "next7": o7, "verdict": v, "z": z,
                    "last_seen": s.index[mask][-1].strftime("%Y-%m-%d") if mask.any() else None})
    return out, {"next1_up": round(float(base1) * 100, 1), "next7_up": round(float(base7) * 100, 1),
                 "next7_median": pct(nxt7.median()), "n": int(nxt7.notna().sum())}


def drawdown(close: pd.Series) -> dict:
    s = close
    peak = s.cummax()
    dd = s / peak - 1
    d_now = float(dd.iloc[-1])
    ath_date = s.idxmax()
    # 고점 갱신 사이 구간(에피소드)마다 최대 낙폭과 회복 기간
    new_high = s >= peak
    ep_id = new_high.cumsum()
    episodes = []
    for _, g in s.groupby(ep_id):
        if len(g) < 2:
            continue
        gd = g / g.iloc[0] - 1
        start, trough = g.index[0], gd.idxmin()
        recovered = g.index[-1] != s.index[-1]          # 마지막(진행 중) 구간이 아니면 다음 날 신고가로 회복
        reach = gd[gd <= d_now].index                   # 지금 깊이에 처음 닿은 날
        episodes.append({"start": start, "depth": float(gd.min()), "trough": trough, "recovered": recovered,
                         "end": g.index[-1] + pd.Timedelta(days=1) if recovered else None,
                         "reach": reach[0] if len(reach) else None})
    past = [e for e in episodes if e["recovered"]]
    deeper = [e for e in past if e["depth"] <= d_now]
    rec_days = [(e["end"] - e["reach"]).days for e in deeper if e["reach"] is not None]
    top = sorted(past, key=lambda e: e["depth"])[:8]
    return {
        "now": pct(d_now), "ath": round(float(s.max()), 0), "ath_date": ath_date.strftime("%Y-%m-%d"),
        "days_since_ath": int((s.index[-1] - ath_date).days),
        "deeper_count": len(deeper),
        "recover_median_days": int(np.median(rec_days)) if rec_days else None,
        "recover_min_days": int(min(rec_days)) if rec_days else None,
        "recover_max_days": int(max(rec_days)) if rec_days else None,
        "biggest": [{"start": e["start"].strftime("%Y-%m-%d"), "depth": pct(e["depth"]),
                     "days": (e["end"] - e["start"]).days} for e in top],
    }


def main() -> None:
    close = data.load("1d")["close"]
    cond, base = conditions(close)
    out = {
        "as_of": close.index[-1].strftime("%Y-%m-%d"), "price": round(float(close.iloc[-1]), 2),
        "since": close.index[0].strftime("%Y-%m-%d"), "days": int(len(close)),
        "analogs": analogs(close), "conditions": cond, "baseline": base, "drawdown": drawdown(close),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    a = out["analogs"]
    print(f"과거와 비교 {out['as_of']}: 닮은꼴 7일 뒤 {a['fwd7']['up']}% 상승(평소 {a['base7']['up']}%), "
          f"조건 {len(cond)}개, 고점 대비 {out['drawdown']['now']}%")


if __name__ == "__main__":
    main()
