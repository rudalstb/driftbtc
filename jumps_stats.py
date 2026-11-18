"""📊 급변 뒤 30분 통계: 지난 1년 1분봉에 감시기(worker/watch.js)·site/jumps.js 와 같은 급변 규칙을 돌려
"5분에 ±1% 움직인 뒤 30분 동안 그 방향으로 이어졌나, 되돌렸나"를 센다. → site/data/jumps_stats.json
사이트의 '⚡ 최근 24시간 급변' 줄과 가이드 글(guide/sudden-moves.html)이 이 숫자를 쓴다.

규칙 (alert_week.py 와 같음)
- 급변: 5분 수익률이 ±1% 이상이 된 첫 1분봉, 그 전 30분 안에 이미 넘은 적 없음
- 30분 뒤: 급변 캔들 종가 → 30분 뒤 종가가 급변 방향으로 0.2% 이상이면 이어짐, 반대로 0.2% 이상이면 되돌림, 아니면 제자리

1분봉은 data/BTCUSDT_1m.csv 에 쌓아 두고 새 부분만 받는다 (GitHub Actions 캐시와 같은 data/ 폴더).
    python jumps_stats.py
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import alert_week

ROOT = Path(__file__).parent
CACHE = ROOT / "data" / "BTCUSDT_1m.csv"
OUT = ROOT / "site" / "data" / "jumps_stats.json"
DAYS = 365
M = 60_000
PCT, WIN, COOL, FLAT = alert_week.MOVE_PCT, alert_week.MOVE_MIN, alert_week.COOLDOWN, alert_week.FLAT
HORIZONS = (5, 15, 30, 60)


def load() -> pd.Series:
    """지난 DAYS+1 일의 마감된 1분봉 종가 (index = 시작 시각 ms)."""
    end = int(time.time() // 60 * M)
    start = end - (DAYS + 1) * 86_400_000
    old = pd.Series(dtype=float)
    if CACHE.exists():
        old = pd.read_csv(CACHE, index_col=0)["close"]
        old = old[old.index >= start]
    frm = int(old.index[-1]) + M if len(old) else start
    rows = alert_week.klines_1m(frm, end) if frm < end else []
    new = pd.Series({t: c for t, _, _, c in rows}, dtype=float)
    s = pd.concat([old, new])
    s = s[~s.index.duplicated(keep="last")].sort_index()
    CACHE.parent.mkdir(exist_ok=True)
    s.rename("close").to_csv(CACHE)
    return s


def events(s: pd.Series) -> pd.DataFrame:
    t = s.index.to_numpy()
    c = s.to_numpy()
    mv = np.zeros_like(c)
    mv[WIN:] = c[WIN:] / c[:-WIN] - 1
    # 1분봉이 비어 있는 곳(거래소 점검)은 5분 수익률을 쓰지 않는다
    ok = np.zeros(len(c), bool)
    ok[WIN:] = (t[WIN:] - t[:-WIN]) == WIN * M
    big = (np.abs(mv) >= PCT) & ok
    out = []
    for i in np.flatnonzero(big):
        if i < WIN + COOL or big[i - COOL:i].any():
            continue
        up = mv[i] > 0
        row = {"t": int(t[i]), "move": float(mv[i]), "up": bool(up)}
        for h in HORIZONS:
            j = i + h
            if j < len(c) and t[j] - t[i] == h * M:
                row[f"r{h}"] = float((c[j] / c[i] - 1) * (1 if up else -1))
        out.append(row)
    return pd.DataFrame(out)


def verdict(x: pd.Series) -> dict:
    x = x.dropna()
    n = len(x)
    if not n:
        return {"n": 0}
    return {
        "n": n,
        "cont": round(float((x >= FLAT).mean()) * 100, 1),
        "rev": round(float((x <= -FLAT).mean()) * 100, 1),
        "flat": round(float(((x > -FLAT) & (x < FLAT)).mean()) * 100, 1),
        "avg": round(float(x.mean()) * 100, 3),
        "med": round(float(x.median()) * 100, 3),
        "sd": round(float(x.std()) * 100, 3) if n > 1 else None,
        # 평균이 0과 다른지 (|t| 2 넘어야 우연이 아니라고 볼 만함)
        "t": round(float(x.mean() / x.std() * np.sqrt(n)), 2) if n > 1 and x.std() > 0 else None,
    }


def main() -> None:
    s = load()
    since = s.index[-1] - DAYS * 86_400_000
    ev = events(s)
    ev = ev[ev["t"] >= since].reset_index(drop=True)
    size = ev["move"].abs()
    groups = {
        "all": ev,
        "up": ev[ev["up"]],
        "down": ev[~ev["up"]],
        "small": ev[size < 0.015],
        "big": ev[size >= 0.015],
    }
    res = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "from": datetime.fromtimestamp(since / 1000, timezone.utc).date().isoformat(),
        "to": datetime.fromtimestamp(int(s.index[-1]) / 1000, timezone.utc).date().isoformat(),
        "minutes": int(len(s)),
        "rule": {"pct": PCT, "win": WIN, "cool": COOL, "flat": FLAT},
        "per_week": round(len(ev) / (DAYS / 7), 1),
        "groups": {k: {f"h{h}": verdict(g.get(f"r{h}", pd.Series(dtype=float))) for h in HORIZONS} for k, g in groups.items()},
        # 한국 시간 기준 시간대별 횟수 (어느 시간대에 몰리나)
        "by_hour_kst": [int(x) for x in np.bincount(((ev["t"] // 3_600_000 + 9) % 24).astype(int), minlength=24)],
        "biggest": [
            {"t": int(r.t), "move": round(r.move * 100, 2), "r30": None if pd.isna(getattr(r, "r30", np.nan)) else round(r.r30 * 100, 2)}
            for r in ev.reindex(size.sort_values(ascending=False).index[:5]).itertuples()
        ],
    }
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    a = res["groups"]["all"]["h30"]
    print(f"{res['from']}~{res['to']} 1분봉 {len(s):,}개 · 급변 {a['n']}번(주 {res['per_week']}번) · 30분 뒤 이어짐 {a['cont']}% 되돌림 {a['rev']}% 제자리 {a['flat']}% 평균 {a['avg']:+.3f}%")
    for k in ("up", "down", "small", "big"):
        g = res["groups"][k]["h30"]
        print(f"  {k:5s} n={g['n']:4d} 이어짐 {g.get('cont')}% 되돌림 {g.get('rev')}% 평균 {g.get('avg')}%  | 5분 {res['groups'][k]['h5'].get('avg')} 60분 {res['groups'][k]['h60'].get('avg')}")


if __name__ == "__main__":
    main()
