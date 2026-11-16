"""🎯 예측 범위 보정 실험: 지금 범위(GARCH σ × 정규분포 배수 0.9945·1.96)와
'과거 표준화 잔차의 실제 분위수' 배수 중 어느 쪽이 처음 보는 기간에서 68%·95%에 더 정확히 맞나.

방법(시간 순서 유지, 미래 정보 없음):
- 기간을 셋으로: [GARCH 적합] → [보정 구간: 배수 학습] → [평가 구간: 채점]
- 보정 구간에서 z = 다음 캔들 로그수익률 / σ 의 |z| 분위수(68%·95%)를 배수로 쓴다.
- 평가 구간에서 두 방식의 포함률, 평균 폭, 구간 점수(Winkler, 낮을수록 좋음)를 비교한다.
채택 기준: 평가 구간에서 68%·95% 포함률 오차가 둘 다 줄고, 구간 점수도 나빠지지 않을 것.

    python lab/calibrate.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import data      # noqa: E402
import models    # noqa: E402

Z68, Z95 = 0.9945, 1.96
OUT = Path(__file__).resolve().parent.parent / "reports" / "calibration.json"
# 보정·평가 길이 (캔들 수)
SPAN = {"1h": (8760, 8760), "1d": (730, 730), "1w": (156, 156)}


def winkler(lo, hi, y, alpha):
    w = hi - lo
    return np.mean(w + (2 / alpha) * (lo - y) * (y < lo) + (2 / alpha) * (y - hi) * (y > hi))


def run(freq: str) -> dict:
    df = data.load(freq)
    ret = np.log(df["close"]).diff()
    ncal, nev = SPAN[freq]
    idx = df.index[-(ncal + nev) - 1:-1]
    sig = models.garch_sigma(ret, idx[0], idx).to_numpy()
    nxt = ret.shift(-1).reindex(idx).to_numpy()
    z = nxt / sig
    cal, ev = slice(0, ncal), slice(ncal, ncal + nev)
    q68, q95 = np.nanquantile(np.abs(z[cal]), 0.68), np.nanquantile(np.abs(z[cal]), 0.95)
    out = {"freq": freq, "cal": [str(idx[0].date()), str(idx[ncal - 1].date())], "eval": [str(idx[ncal].date()), str(idx[-1].date())],
           "mult_now": {"68": Z68, "95": Z95}, "mult_emp": {"68": round(float(q68), 4), "95": round(float(q95), 4)}}
    y, s = nxt[ev], sig[ev]
    for name, m68, m95 in (("now", Z68, Z95), ("emp", q68, q95)):
        r = {}
        for lvl, m, a in (("68", m68, 0.32), ("95", m95, 0.05)):
            lo, hi = -m * s, m * s
            cover = float(np.nanmean((y >= lo) & (y <= hi)))
            r[lvl] = {"cover": round(cover * 100, 2), "width_pct": round(float(np.nanmean(hi - lo)) * 100, 3),
                      "winkler": round(float(winkler(lo, hi, y, a)) * 100, 4)}
        out[name] = r
    good = all(abs(out["emp"][l]["cover"] - float(l)) <= abs(out["now"][l]["cover"] - float(l)) for l in ("68", "95")) and \
        all(out["emp"][l]["winkler"] <= out["now"][l]["winkler"] * 1.001 for l in ("68", "95"))
    out["adopt"] = bool(good)
    return out


def main() -> None:
    res = {f: run(f) for f in ("1h", "1d", "1w")}
    for f, r in res.items():
        print(f"[{f}] 평가 {r['eval'][0]}~{r['eval'][1]}  배수 지금 {Z68}/{Z95} → 실제 분위수 {r['mult_emp']['68']}/{r['mult_emp']['95']}")
        for lvl in ("68", "95"):
            a, b = r["now"][lvl], r["emp"][lvl]
            print(f"   {lvl}%: 포함률 {a['cover']}% → {b['cover']}%, 평균 폭 {a['width_pct']}% → {b['width_pct']}%, 구간 점수 {a['winkler']} → {b['winkler']}")
        print(f"   채택: {'예' if r['adopt'] else '아니오'}")
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
