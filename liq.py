"""💥 강제 청산 시간별 집계: OKX 비트코인 무기한 선물(BTC-USDT-SWAP)의 공개 청산 기록을 매시간 받아
site/data/liq.json(지난 24시간·급증 판정)과 site/data/liq_hist.json(시간별 기록, 90일 보관)에 쓴다.

- OKX 공개 API 는 최근 약 24시간치 청산을 빠짐없이 준다 (바이낸스 실시간 스트림은 1초에 1건만 보내 표본이라, 서버 집계는 OKX 를 쓴다)
- 롱 청산 = 롱 포지션이 강제로 팔림(하락 압력), 숏 청산 = 숏이 강제로 사들여짐(상승 압력)
- 급증: 지난 1시간(마감된 시간) 청산 합계가 지금까지 쌓인 시간별 기록 중간값의 4배 이상이고 $3M 이상
  (기록이 7일치 미만이면 '평소'를 아직 잘 모르므로 급증 판정을 하지 않는다)
실패하면 기존 파일을 그대로 둔다.

    python liq.py
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests

DATA = Path(__file__).parent / "site" / "data"
OUT, HIST = DATA / "liq.json", DATA / "liq_hist.json"
OKX = "https://www.okx.com/api/v5"
INST = "BTC-USDT-SWAP"
KEEP_DAYS = 90
SPIKE_X, SPIKE_MIN, MIN_HIST_H = 4.0, 3_000_000, 7 * 24


def ct_val() -> float:
    """계약 1개가 몇 BTC 인지 (BTC-USDT-SWAP 은 0.01)."""
    try:
        d = requests.get(f"{OKX}/public/instruments", params={"instType": "SWAP", "instId": INST}, timeout=15).json()
        return float(d["data"][0]["ctVal"])
    except Exception:
        return 0.01


def fetch(since_ms: int) -> list[dict]:
    out, after = [], None
    for _ in range(60):
        p = {"instType": "SWAP", "instFamily": "BTC-USDT", "state": "filled", "limit": 100}
        if after:
            p["after"] = after
        d = requests.get(f"{OKX}/public/liquidation-orders", params=p, timeout=15).json()
        if d.get("code") not in ("0", 0):
            raise RuntimeError(f"OKX 응답 {d.get('code')} {d.get('msg')}")
        det = [x for blk in d.get("data") or [] if blk.get("instId", INST) == INST for x in blk.get("details") or []]
        if not det:
            break
        out += det
        after = min(int(x["ts"]) for x in det)
        if after < since_ms:
            break
        time.sleep(0.12)
    return out


def main() -> None:
    now = datetime.now(timezone.utc)
    cur_h = now.replace(minute=0, second=0, microsecond=0)
    since = cur_h - timedelta(hours=25)
    cv = ct_val()
    rows = fetch(int(since.timestamp() * 1000))
    seen, hours = set(), {}
    for x in rows:
        key = (x["ts"], x["sz"], x["bkPx"], x.get("side"), x.get("posSide"))
        if key in seen:
            continue
        seen.add(key)
        t = datetime.fromtimestamp(int(x["ts"]) / 1000, timezone.utc)
        if t < since:
            continue
        usd = float(x["sz"]) * cv * float(x["bkPx"])
        # posSide 가 long/short 이면 그대로, net(단방향 모드)이면 강제 매도 = 롱 청산
        long_liq = x.get("posSide") == "long" or (x.get("posSide") not in ("long", "short") and x.get("side") == "sell")
        h = t.replace(minute=0, second=0, microsecond=0).isoformat()
        hours.setdefault(h, [0.0, 0.0, 0])
        hours[h][0 if long_liq else 1] += usd
        hours[h][2] += 1

    # 시간별 기록에 합치기 (마감된 시간만; 같은 시간은 새 값으로 덮어씀 — 24시간 안 데이터는 매번 다시 받으므로 더 완전함)
    hist = {}
    try:
        hist = json.loads(HIST.read_text(encoding="utf-8")).get("hours", {})
    except Exception:
        pass
    oldest_seen = min((datetime.fromisoformat(h) for h in hours), default=cur_h)
    for h, v in hours.items():
        if datetime.fromisoformat(h) < cur_h and datetime.fromisoformat(h) > oldest_seen:   # 받은 범위의 첫 시간은 잘렸을 수 있어 뺀다
            hist[h] = [round(v[0]), round(v[1]), v[2]]
    # 받은 범위 안인데 청산이 0건이던 시간도 0 으로 남긴다
    t = oldest_seen.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    while t < cur_h:
        hist.setdefault(t.isoformat(), [0, 0, 0])
        t += timedelta(hours=1)
    cut = (cur_h - timedelta(days=KEEP_DAYS)).isoformat()
    hist = {h: v for h, v in sorted(hist.items()) if h >= cut}
    HIST.write_text(json.dumps({"inst": INST, "hours": hist}, separators=(",", ":")), encoding="utf-8", newline="\n")

    last_h = (cur_h - timedelta(hours=1)).isoformat()
    last = hist.get(last_h, [0, 0, 0])
    day = [hist.get((cur_h - timedelta(hours=k)).isoformat(), [0, 0, 0]) for k in range(24, 0, -1)]
    totals = np.array([v[0] + v[1] for h, v in hist.items() if h < last_h])
    med = float(np.median(totals)) if len(totals) else None
    tot = last[0] + last[1]
    enough = len(totals) >= MIN_HIST_H
    ratio = tot / med if med else None
    spike = bool(enough and ratio and ratio >= SPIKE_X and tot >= SPIKE_MIN)
    out = {
        "updated": now.isoformat(timespec="seconds"), "source": "OKX BTC-USDT 무기한 선물",
        "hour": {"t": last_h, "long": round(last[0]), "short": round(last[1]), "n": last[2]},
        "day": {"long": round(sum(v[0] for v in day)), "short": round(sum(v[1] for v in day)), "n": sum(v[2] for v in day)},
        "hours24": [[(cur_h - timedelta(hours=k)).isoformat(), round(v[0]), round(v[1])] for k, v in zip(range(24, 0, -1), day)],
        "median_hour": round(med) if med is not None else None, "hist_hours": len(totals), "ratio": round(ratio, 2) if ratio else None,
        "spike": spike, "side": ("long" if last[0] >= last[1] else "short") if tot else None,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8", newline="\n")
    print(f"청산(OKX BTC) 지난 1시간 롱 ${last[0]:,.0f} 숏 ${last[1]:,.0f} · 24시간 롱 ${out['day']['long']:,} 숏 ${out['day']['short']:,} · "
          f"기록 {len(totals)}시간, 평소 대비 {ratio and round(ratio, 1)}배, 급증 {spike}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"청산 집계 실패 — 기존 파일 유지: {e}")
