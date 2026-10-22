"""📸 시장 지표 수집기: 매시간 Vercel(api/snap.js)에서 펀딩·미결제약정·롱숏 비율·테이커 비율·코인베이스 프리미엄·김프·
공포탐욕·데리빗 변동성지수(DVOL)·옵션 풋/콜 비율을 받아 site/data/snapshots.csv 에 한 줄씩 쌓는다.
과거치가 짧은 지표들을 지금부터 모아 두었다가 몇 주 뒤 신호 실험실(lab.py)에서 검증하는 용도.

    python collector.py
"""
from __future__ import annotations

import csv
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

SOURCE = "https://driftbtc.vercel.app/api/snap"
PATH = Path(__file__).parent / "site" / "data" / "snapshots.csv"
COLS = ["time", "price", "mark", "funding", "oi_btc", "ls_all_long", "ls_top_long", "taker_ratio", "coinbase_premium_pct", "kimp_pct", "fng", "dvol", "opt_pcr", "opt_oi_btc"]


def main() -> int:
    try:
        r = requests.get(SOURCE, timeout=60)
        d = r.json()
        if r.status_code != 200 or "t" not in d:
            raise RuntimeError(d.get("error", r.status_code))
    except Exception as e:
        print(f"스냅샷을 받지 못했어요 (이번 시간은 건너뜀): {e}")
        return 0
    row = {"time": datetime.fromtimestamp(d["t"] / 1000, timezone.utc).isoformat(timespec="minutes")}
    for c in COLS[1:]:
        v = d.get(c)
        row[c] = "" if v is None else (round(v, 6) if isinstance(v, float) else v)
    new = not PATH.exists()
    PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PATH, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        if new:
            w.writeheader()
        w.writerow(row)
    filled = sum(1 for c in COLS[1:] if row[c] != "")
    print(f"스냅샷 저장: {row['time']} · 값 {filled}/{len(COLS) - 1}개" + (f" · 못 받은 것: {'; '.join(d['errors'])}" if d.get("errors") else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
