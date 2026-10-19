"""🎲 롱/숏 게임 (실험): Ridge 예측 수익률의 부호로 다음 캔들의 롱/숏 신호를 낸다.

- backtest(): 걷기식 백테스트 예측(reports/predictions_*.csv)으로 신호 매매 성과를 계산해
  reports/signal_backtest.json 에 저장 (수수료·슬리피지·펀딩비 포함, 레버리지 1배)
- record_and_score(): 실시간 신호를 site/data/signal_log.jsonl 에 캔들당 1번 기록하고,
  결과가 확정된 신호를 채점해 실제 운영 성적을 돌려준다

재미로 보는 실험이며 투자 권유가 아니다.

사용법:
    python signals.py     # 백테스트 성과 계산 (backtest.py 이후)
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
FEE = 0.0005           # 바이낸스 선물 테이커 수수료 (편도)
SLIP = 0.0002          # 슬리피지 가정 (편도): 시장가 체결 때 호가 밀림
FUNDING_8H = 0.0001    # 펀딩비 가정: 8시간마다 0.01% (롱이 내고 숏이 받음, 장기 평균 수준)
BAR_HOURS = {"1h": 1, "1d": 24, "1w": 168}
MODEL = "ridge"        # 백테스트에서 확률이 가장 과신하지 않았던 모델
SIGNAL_FREQS = ["1h", "1d", "1w"]  # 1시간은 매번 바꾸면 수수료가 크므로 화면에서 '관점'으로만 안내
STEP = {"1h": pd.Timedelta(hours=1), "1d": pd.Timedelta(days=1), "1w": pd.Timedelta(weeks=1)}
LOG = ROOT / "site" / "data" / "signal_log.jsonl"


def _equity(sig: np.ndarray, ret: np.ndarray, hours: float = 1) -> tuple[np.ndarray, np.ndarray]:
    """누적 자산(1에서 시작)과 각 캔들의 비용 차감 로그수익률.
    비용 = 수수료 + 슬리피지 (방향이 바뀔 때만) + 펀딩비 (들고 있는 동안 매 8시간)."""
    turns = np.abs(np.diff(np.r_[0, sig]))  # 진입 1회, 롱↔숏 전환 2회
    net = sig * ret - turns * (FEE + SLIP) - sig * FUNDING_8H * (hours / 8)
    return np.exp(np.cumsum(net)), net


def _stats(sig: np.ndarray, ret: np.ndarray, hours: float = 1) -> dict:
    eq, net = _equity(sig, ret, hours)
    nz = ret != 0
    turns = np.abs(np.diff(np.r_[0, sig]))
    gains = net[net > 0].sum()
    losses = -net[net < 0].sum()
    return {
        "return_pct": float((eq[-1] - 1) * 100),
        "gross_return_pct": float((np.exp(np.sum(sig * ret)) - 1) * 100),
        "max_drawdown_pct": float((eq / np.maximum.accumulate(eq) - 1).min() * 100),
        "hit_rate": float((np.sign(sig[nz]) == np.sign(ret[nz])).mean()),
        "flips": int((np.abs(np.diff(sig)) == 2).sum()),
        # 비용 내역 (시작 자산 대비 %, 로그 근사)
        "cost_fee_pct": float(turns.sum() * FEE * 100),
        "cost_slip_pct": float(turns.sum() * SLIP * 100),
        "cost_funding_pct": float((sig * FUNDING_8H * (hours / 8)).sum() * 100),
        "profit_factor": float(gains / losses) if losses > 0 else None,
    }


def backtest() -> dict:
    out = {}
    for freq in ["1h", "1d", "1w"]:
        p = ROOT / "reports" / f"predictions_{freq}.csv"
        d = pd.read_csv(p, index_col=0, parse_dates=[0])
        ret = d["actual_ret"].to_numpy()
        sig = np.where(d[MODEL].to_numpy() >= 0, 1, -1)
        hold = np.ones(len(d))
        h = BAR_HOURS[freq]
        eq_sig, _ = _equity(sig, ret, h)
        eq_hold, _ = _equity(hold, ret, h)
        eq_short, _ = _equity(-hold, ret, h)
        # 그래프용으로 최대 200개 지점만 (결과 확정 시각 기준)
        t = d.index + 2 * STEP[freq]
        idx = np.unique(np.linspace(0, len(d) - 1, min(200, len(d))).astype(int))
        out[freq] = {
            "start": str(t[0]), "end": str(t[-1]), "n": len(d),
            "signal": _stats(sig, ret, h),
            "always_long": _stats(hold, ret, h),
            "always_short": _stats(-hold, ret, h),
            "costs": {"fee_pct": FEE * 100, "slip_pct": SLIP * 100, "funding_8h_pct": FUNDING_8H * 100},
            "series": [{"t": t[i].isoformat(), "signal": round(float(eq_sig[i]), 4),
                        "long": round(float(eq_hold[i]), 4),
                        "short": round(float(eq_short[i]), 4)} for i in idx],
        }
    (ROOT / "reports" / "signal_backtest.json").write_text(json.dumps(out), encoding="utf-8")
    return out


def p_up(lean: float, sigma: float) -> float:
    """예측 수익률과 표준편차로 계산한 상승 확률 (정규분포 가정)."""
    return 0.5 * (1 + math.erf(lean / sigma / math.sqrt(2)))


def _read_log() -> list[dict]:
    if not LOG.exists():
        return []
    return [json.loads(line) for line in LOG.read_text(encoding="utf-8").splitlines() if line.strip()]


def record_and_score(forecasts: dict, frames: dict[str, pd.DataFrame]) -> dict:
    """forecasts: forecast.run() 결과, frames: 주기별 캔들 DataFrame."""
    log = _read_log()
    seen = {(e["freq"], e["as_of"]) for e in log}
    new = []
    for freq in SIGNAL_FREQS:
        f = forecasts[freq]
        if (freq, f["as_of"]) in seen:
            continue
        new.append({
            "freq": freq, "as_of": f["as_of"], "target": f["next"]["t"], "price": f["price"],
            "signal": "long" if f["lean_pct"][MODEL] >= 0 else "short",
            "p_up": round(p_up(f["lean_pct"][MODEL] / 100, f["sigma_next"]), 4),
        })
    if new:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG, "a", encoding="utf-8", newline="\n") as fp:
            for e in new:
                fp.write(json.dumps(e) + "\n")
        log += new

    result = {}
    for freq in SIGNAL_FREQS:
        df = frames[freq]
        # 목표 시각 T 의 가격 = T - step 에 시작한 캔들의 종가
        close_at = df["close"].copy()
        close_at.index = close_at.index + STEP[freq]
        entries = [e for e in log if e["freq"] == freq]
        scored = []
        for e in entries:
            t = pd.Timestamp(e["target"])
            if t in close_at.index:
                actual = float(close_at[t])
                ret = math.log(actual / e["price"])
                scored.append({**e, "actual": actual, "ret": ret})
        current = entries[-1] if entries else None
        r = {"current": current, "n": len(scored)}
        if scored:
            sig = np.array([1 if s["signal"] == "long" else -1 for s in scored])
            ret = np.array([s["ret"] for s in scored])
            h = BAR_HOURS[freq]
            eq, net = _equity(sig, ret, h)
            hold, _ = _equity(np.ones(len(ret)), ret, h)
            short, _ = _equity(-np.ones(len(ret)), ret, h)
            hits = [bool(np.sign(s) == np.sign(x)) for s, x in zip(sig, ret)]
            streak = 0
            for h in reversed(hits):
                if h != hits[-1]:
                    break
                streak += 1
            r.update({
                "since": scored[0]["as_of"],
                "hits": int(sum(hits)),
                "hit_rate": float(np.mean(hits)),
                "return_pct": float((eq[-1] - 1) * 100),
                "gross_pct": float((np.exp(np.sum(sig * ret)) - 1) * 100),
                "always_long_pct": float((hold[-1] - 1) * 100),
                "always_short_pct": float((short[-1] - 1) * 100),
                "streak": streak, "streak_hit": hits[-1],
                "recent": [{"t": s["target"], "signal": s["signal"], "hit": h,
                            "ret_pct": round(float(sg * s["ret"] * 100), 3)}
                           for s, h, sg in list(zip(scored, hits, sig))[-20:]],
            })
        result[freq] = r
    return result


if __name__ == "__main__":
    bt = backtest()
    for freq, r in bt.items():
        s, h = r["signal"], r["always_long"]
        print(f"{freq}: 신호 {s['return_pct']:+.1f}% (적중 {s['hit_rate'] * 100:.1f}%, 낙폭 {s['max_drawdown_pct']:.1f}%)"
              f"  vs 항상 롱 {h['return_pct']:+.1f}%")
