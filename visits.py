"""방문자 수 백업: 무료 Upstash 는 디스크 저장이 없어 초기화될 수 있으므로 매시간 저장소에 백업한다.

api/visit.js 에서 현재 방문자 수를 읽어 site/data/visits.json 에 저장한다.
Redis 가 초기화되면 api/visit.js 가 이 파일을 읽어 기본값으로 깔고 이어서 센다.
초기화돼서 값이 줄어든 경우에는 백업을 덮어쓰지 않는다.

사용법:
    python visits.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

SOURCE = "https://driftbtc.vercel.app/api/visit"
PATH = Path(__file__).parent / "site" / "data" / "visits.json"
KEYS = ["total", "total_views", "today", "today_views", "yesterday"]


def main() -> int:
    try:
        r = requests.get(SOURCE, timeout=20)
        v = r.json()
        if not v.get("enabled") or v.get("error"):
            print(f"방문자 수를 받지 못했어요 (백업 유지): {v}")
            return 0
    except Exception as e:  # 방문자 수 문제로 예측 갱신이 멈추지 않도록 경고만 남긴다
        print(f"방문자 수를 받지 못했어요 (백업 유지): {e}")
        return 0

    old = json.loads(PATH.read_text(encoding="utf-8")) if PATH.exists() else {}
    if old.get("total", 0) > v.get("total", 0) or old.get("total_views", 0) > v.get("total_views", 0):
        print(f"현재 값이 백업보다 작아요 (초기화된 듯): 백업을 덮어쓰지 않음 {old} vs {v}")
        return 0

    data = {"date": v["date"], **{k: int(v.get(k, 0)) for k in KEYS},
            "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    PATH.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"방문자 수 백업: {data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
