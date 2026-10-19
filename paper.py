"""💵 가상 계좌: 사이트가 실제로 낸 롱/숏 관점(site/data/signal_log.jsonl)을 그대로 따랐다면
가상의 $1,000 이 어떻게 됐을지 매시간 1시간 종가로 평가한다. 실제 돈이 아니며 투자 권유가 아니다.

규칙 (단순하고 검증 가능하게):
- 주기(1h/1d/1w)마다 계좌 하나, 레버리지 1배, 자산 전부를 관점 방향으로 (롱 +1 / 숏 −1)
- 관점이 바뀔 때만 매매 → 수수료 0.05% + 슬리피지 0.02% (편도, 전환은 왕복)
- 펀딩비 8시간마다 0.01% 가정 (롱이 내고 숏이 받음)
- 비교 기준: 같은 돈으로 그냥 들고만 있었다면 (항상 롱)
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

import signals

ROOT = Path(__file__).parent
START = 1000.0
HOUR = pd.Timedelta(hours=1)


def _series_points(points: list[dict], limit: int = 200) -> list[dict]:
    if len(points) <= limit:
        return points
    step = (len(points) - 1) / (limit - 1)
    return [points[round(i * step)] for i in range(limit)]


def run(frame_1h: pd.DataFrame) -> dict:
    log = signals._read_log()
    # 시각 T 의 가격 = T−1h 에 시작한 1시간 캔들의 종가
    px = frame_1h["close"].copy()
    px.index = pd.DatetimeIndex(px.index)
    if px.index.tz is None:
        px.index = px.index.tz_localize("UTC")
    px.index = px.index + HOUR
    out = {"start": START, "rules": {"fee_pct": signals.FEE * 100, "slip_pct": signals.SLIP * 100,
                                     "funding_8h_pct": signals.FUNDING_8H * 100, "leverage": 1}}
    for freq in signals.SIGNAL_FREQS:
        entries = sorted((e for e in log if e["freq"] == freq), key=lambda e: e["as_of"])
        if not entries:
            out[freq] = None
            continue
        sig_at = {pd.Timestamp(e["as_of"]): (1 if e["signal"] == "long" else -1) for e in entries}
        t0 = min(sig_at)
        times = px.index[(px.index >= t0)]
        if len(times) < 2:
            out[freq] = None
            continue

        eq, hold = START, START
        pos, prev_t = 0, None
        cost = {"fee": 0.0, "slip": 0.0, "funding": 0.0}
        peak, mdd = START, 0.0
        trades, open_trade = [], None
        series = []
        for t in times:
            p = float(px[t])
            if prev_t is not None:
                r = p / float(px[prev_t]) - 1
                eq *= 1 + pos * r
                hold *= 1 + r
                # 펀딩: 매시간 8시간치의 1/8 (롱 −, 숏 +)
                f = pos * eq * signals.FUNDING_8H / 8
                eq -= f
                cost["funding"] += f
            new = sig_at.get(t, pos)
            if new != pos:
                sides = 2 if pos != 0 else 1
                fee, slip = eq * signals.FEE * sides, eq * signals.SLIP * sides
                eq -= fee + slip
                cost["fee"] += fee
                cost["slip"] += slip
                if open_trade:
                    open_trade.update(close_t=t.isoformat(), exit=p, pnl_pct=(eq / open_trade["eq0"] - 1) * 100)
                    trades.append(open_trade)
                open_trade = {"side": "long" if new > 0 else "short", "open_t": t.isoformat(), "entry": p, "eq0": eq}
                pos = new
            peak = max(peak, eq)
            mdd = max(mdd, 1 - eq / peak)
            series.append({"t": t.isoformat(), "v": round(eq, 2), "hold": round(hold, 2)})
            prev_t = t

        done = [{k: v for k, v in tr.items() if k != "eq0"} for tr in trades]
        wins = sum(1 for tr in done if tr["pnl_pct"] > 0)
        cur_px = float(px[times[-1]])
        out[freq] = {
            "since": t0.isoformat(), "as_of": times[-1].isoformat(),
            "equity": eq, "return_pct": (eq / START - 1) * 100,
            "hold_equity": hold, "hold_return_pct": (hold / START - 1) * 100,
            "max_drawdown_pct": -mdd * 100,
            "trades": len(done), "wins": wins, "win_rate": (wins / len(done)) if done else None,
            "costs": cost, "cost_total": sum(cost.values()),
            "open": ({"side": open_trade["side"], "since": open_trade["open_t"], "entry": open_trade["entry"],
                      "pnl_pct": (eq / open_trade["eq0"] - 1) * 100,
                      "hours": int((times[-1] - pd.Timestamp(open_trade["open_t"])) / HOUR)}
                     if open_trade else None),
            "recent": done[-8:],
            "series": _series_points(series),
            "price_now": cur_px,
        }
    return out


if __name__ == "__main__":
    import data

    res = run(data.load("1h"))
    for freq in signals.SIGNAL_FREQS:
        r = res[freq]
        if r:
            print(f"{freq}: ${r['equity']:,.2f} ({r['return_pct']:+.2f}%)  거래 {r['trades']}번  비용 ${r['cost_total']:,.2f}"
                  f"  낙폭 {r['max_drawdown_pct']:.1f}%  vs 들고만 있기 {r['hold_return_pct']:+.2f}%")
