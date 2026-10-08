"""걷기식(walk-forward) 백테스트.

테스트 구간을 블록으로 나누고, 각 블록 시작 시점까지의 데이터로만 학습한 뒤
블록 안의 각 캔들에서 '다음 캔들'을 예측한다. 미래 정보는 학습에 쓰이지 않는다.

사용법:
    python backtest.py            # 1h, 1d, 1w 전부
    python backtest.py 1d         # 하나만
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import data
import features
import models

REPORT_DIR = Path(__file__).parent / "reports"

# 주기별 설정: 테스트 길이, 재학습 간격, 드리프트 창, LGBM 최소 리프 샘플
CONFIG = {
    "1h": dict(test=24 * 365, step=24 * 7, drift="mom_168", drift_w=168, min_child=200),
    "1d": dict(test=365 * 3, step=30, drift="mom_90", drift_w=90, min_child=40),
    "1w": dict(test=52 * 3, step=4, drift="mom_26", drift_w=26, min_child=15),
}


def walk_forward(freq: str) -> pd.DataFrame:
    cfg = CONFIG[freq]
    df = data.load(freq)
    X = features.build(df, freq)
    y = features.target(df)
    ok = X.notna().all(axis=1) & y.notna()
    X, y = X[ok], y[ok]

    test_idx = X.index[-cfg["test"]:]
    point_models = [
        models.Naive(),
        models.Drift(cfg["drift"], cfg["drift_w"]),
        models.Ridge(),
        models.LGBM(cfg["min_child"]),
    ]
    ret = np.log(df["close"]).diff()
    out = pd.DataFrame(index=test_idx)
    out["close"] = df["close"].reindex(test_idx)
    out["actual_ret"] = y.reindex(test_idx)
    out["ewma_sigma"] = models.ewma_sigma(ret).reindex(test_idx)

    blocks = [test_idx[i:i + cfg["step"]] for i in range(0, len(test_idx), cfg["step"])]
    for n, block in enumerate(blocks, 1):
        start = block[0]
        train = X.index < start
        for m in point_models:
            m.fit(X[train], y[train])
            out.loc[block, m.name] = m.predict(X.loc[block])
        out.loc[block, "garch_sigma"] = models.garch_sigma(ret, start, block).to_numpy()
        print(f"\r  {freq}: 블록 {n}/{len(blocks)}", end="", flush=True)
    print()
    return out


def _pvalue_two_sided(t: float) -> float:
    return math.erfc(abs(t) / math.sqrt(2))


def evaluate(out: pd.DataFrame) -> dict:
    a = out["actual_ret"].to_numpy()
    close = out["close"].to_numpy()
    actual_price = close * np.exp(a)
    nonzero = a != 0
    naive_sq = a ** 2
    res: dict = {"n": int(len(out)), "start": str(out.index[0]), "end": str(out.index[-1])}

    res["always_up_acc"] = float((a[nonzero] > 0).mean())
    for name in ["naive", "drift", "ridge", "lgbm"]:
        p = out[name].to_numpy()
        price = close * np.exp(p)
        err = p - a
        r = {
            "mape_pct": float(np.mean(np.abs(price - actual_price) / actual_price) * 100),
            "rmse_ret_pct": float(np.sqrt(np.mean(err ** 2)) * 100),
        }
        if name != "naive":
            # Diebold-Mariano: 제곱오차 차이가 0인지 검정 (음수 t = naive보다 우수)
            d = err ** 2 - naive_sq
            t = d.mean() / (d.std(ddof=1) / math.sqrt(len(d)))
            r["dm_t_vs_naive"] = float(t)
            r["dm_p"] = _pvalue_two_sided(t)
            hit = np.sign(p[nonzero]) == np.sign(a[nonzero])
            acc = float(hit.mean())
            r["dir_acc"] = acc
            r["dir_p_vs_50"] = _pvalue_two_sided((acc - 0.5) / math.sqrt(0.25 / nonzero.sum()))
            # 확신 상위 20%(예측 수익률 절댓값이 큰 경우)만 본 방향 적중률
            conf = np.abs(p[nonzero]) >= np.quantile(np.abs(p[nonzero]), 0.8)
            r["dir_acc_top20"] = float(hit[conf].mean())
        res[name] = r

    for vol in ["ewma_sigma", "garch_sigma"]:
        s = out[vol].to_numpy()
        z = np.abs(a / s)
        res[vol] = {
            "cover_1sigma": float((z <= 1).mean()),     # 목표 0.683
            "cover_2sigma": float((z <= 1.96).mean()),  # 목표 0.95
            "avg_width95_pct": float(np.mean(2 * 1.96 * s) * 100),
            # 정규분포 가정 음의 로그우도 (낮을수록 좋음)
            "nll": float(np.mean(0.5 * np.log(2 * np.pi * s ** 2) + a ** 2 / (2 * s ** 2))),
        }
    return res


def print_report(freq: str, r: dict) -> None:
    print(f"\n=== {freq}  ({r['start'][:16]} ~ {r['end'][:16]}, n={r['n']:,}) ===")
    print(f"{'모델':<8}{'MAPE%':>8}{'DM t':>8}{'DM p':>8}{'방향':>8}{'p(50%)':>8}{'상위20%':>9}")
    for name in ["naive", "drift", "ridge", "lgbm"]:
        m = r[name]
        if name == "naive":
            print(f"{name:<8}{m['mape_pct']:>8.3f}{'-':>8}{'-':>8}{'-':>8}{'-':>8}{'-':>9}")
        else:
            print(f"{name:<8}{m['mape_pct']:>8.3f}{m['dm_t_vs_naive']:>8.2f}{m['dm_p']:>8.3f}"
                  f"{m['dir_acc'] * 100:>7.1f}%{m['dir_p_vs_50']:>8.3f}{m['dir_acc_top20'] * 100:>8.1f}%")
    print(f"(참고: 항상 '상승' 예측 시 방향 적중률 {r['always_up_acc'] * 100:.1f}%)")
    print(f"{'변동성':<8}{'1σ 포함':>9}{'95% 포함':>10}{'95%폭%':>9}{'NLL':>9}")
    for vol in ["ewma_sigma", "garch_sigma"]:
        v = r[vol]
        print(f"{vol.split('_')[0]:<8}{v['cover_1sigma'] * 100:>8.1f}%{v['cover_2sigma'] * 100:>9.1f}%"
              f"{v['avg_width95_pct']:>9.2f}{v['nll']:>9.3f}")


def main(freqs: list[str]) -> None:
    REPORT_DIR.mkdir(exist_ok=True)
    summary = {}
    for freq in freqs:
        out = walk_forward(freq)
        out.to_csv(REPORT_DIR / f"predictions_{freq}.csv")
        summary[freq] = evaluate(out)
        print_report(freq, summary[freq])
    path = REPORT_DIR / "summary.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    old.update(summary)
    path.write_text(json.dumps(old, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:] or ["1w", "1d", "1h"])
