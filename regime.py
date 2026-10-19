"""🚦 상황 필터(서버 쪽): 매시간 "지금 들어가도 되는 구간인지"를 판정하는 재료 중
과거까지 되짚어 계산할 수 있는 두 가지를 맡는다.

- 변동성 극단: 최근 24시간 실현 변동성이 지난 1년 중 상위 10% 안이면 쉬는 구간
  (손절이 꼬리에 털리고 청산 확률이 치솟는 구간)
- 이벤트: site/data/events.json 의 발표(FOMC·CPI 등) 12시간 전 ~ 2시간 후는 쉬는 구간

펀딩비·롱숏 비율·미결제약정은 바이낸스 선물 API 가 미국 서버에서 막혀 브라우저(site/filter.js)에서 본다.
여기서 만든 '쉬는 시간' 표는 paper.py 의 필터 적용 가상 계좌 검증에도 쓴다.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
EVENTS = ROOT / "site" / "data" / "events.json"
VOL_WINDOW = 24          # 실현 변동성 계산 구간 (시간)
VOL_LOOKBACK = 24 * 365  # 백분위 기준 기간 (1년)
VOL_HI = 0.90            # 이 백분위 위면 '변동성 극단'
BEFORE = pd.Timedelta(hours=12)
AFTER = pd.Timedelta(hours=2)


def load_events() -> list[dict]:
    if not EVENTS.exists():
        return []
    ev = json.loads(EVENTS.read_text(encoding="utf-8"))
    return sorted(({**e, "ts": pd.Timestamp(e["t"])} for e in ev), key=lambda e: e["ts"])


def realized_vol(frame_1h: pd.DataFrame) -> pd.Series:
    """시각 T(=캔들 종가 시각) 기준 최근 24시간 실현 변동성(%, 24시간 환산)."""
    close = frame_1h["close"].copy()
    idx = pd.DatetimeIndex(close.index)
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    close.index = idx + pd.Timedelta(hours=1)
    r = np.log(close).diff()
    return r.rolling(VOL_WINDOW).std() * np.sqrt(VOL_WINDOW) * 100


def off_hours(frame_1h: pd.DataFrame, events: list[dict] | None = None) -> pd.DataFrame:
    """시각별 쉬는 구간 표: vol_off(변동성 극단), event_off(이벤트 창), off(둘 중 하나)."""
    vol = realized_vol(frame_1h)
    thr = vol.rolling(VOL_LOOKBACK, min_periods=24 * 90).quantile(VOL_HI)
    vol_off = (vol > thr).fillna(False)
    event_off = pd.Series(False, index=vol.index)
    for e in events if events is not None else load_events():
        event_off |= (vol.index >= e["ts"] - BEFORE) & (vol.index <= e["ts"] + AFTER)
    return pd.DataFrame({"vol": vol, "thr": thr, "vol_off": vol_off, "event_off": event_off,
                         "off": vol_off | event_off})


def current(frame_1h: pd.DataFrame) -> dict:
    """화면용 요약: 지금 변동성과 백분위, 진행 중/다가오는 이벤트, 최근 30일 중 쉬는 시간 비율."""
    events = load_events()
    tbl = off_hours(frame_1h, events)
    last = tbl.iloc[-1]
    now = tbl.index[-1]
    year = tbl["vol"].iloc[-VOL_LOOKBACK:].dropna()
    rank = float((year < last["vol"]).mean() * 100) if len(year) else None
    active = next((e for e in events if e["ts"] - BEFORE <= now <= e["ts"] + AFTER), None)
    upcoming = [e for e in events if e["ts"] > now][:3]
    month = tbl.iloc[-24 * 30:]
    fmt = lambda e: {"name": e["name"], "t": e["ts"].isoformat(), **({"note": e["note"]} if e.get("note") else {})}
    return {
        "as_of": now.isoformat(),
        "vol_24h_pct": float(last["vol"]) if pd.notna(last["vol"]) else None,
        "vol_rank": rank,
        "vol_hi_pct": float(last["thr"]) if pd.notna(last["thr"]) else None,
        "vol_off": bool(last["vol_off"]),
        "event": fmt(active) if active else None,
        "upcoming": [fmt(e) for e in upcoming],
        "off_share_30d": float(month["off"].mean() * 100) if len(month) else None,
        "rules": {"vol_window_h": VOL_WINDOW, "vol_hi_pctile": VOL_HI * 100, "event_before_h": 12, "event_after_h": 2},
    }


if __name__ == "__main__":
    import data

    c = current(data.load("1h"))
    print(f"24시간 변동성 {c['vol_24h_pct']:.2f}% (1년 백분위 {c['vol_rank']:.0f}, 상위10% 기준 {c['vol_hi_pct']:.2f}%)"
          f" → {'🔴 변동성 극단' if c['vol_off'] else '🟢 보통'}")
    print("이벤트:", c["event"] or "없음", "| 다음:", [(e["name"], e["t"]) for e in c["upcoming"]])
    print(f"최근 30일 중 쉬는 시간 {c['off_share_30d']:.0f}%")
