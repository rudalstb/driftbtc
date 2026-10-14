"""운영자 청산 기록 보관: 비트겟은 최근 90일까지만 주므로 매시간 받아 저장소에 계속 쌓아 둔다.

Vercel 중계(api/positions.js)의 ?history=all 에서 최근 90일 기록을 받아
site/data/trades.json 에 거래 번호(id) 기준으로 합친다. 한 번 저장된 기록은 지우지 않는다.
비트겟 키는 Vercel 에만 있고 여기서는 쓰지 않는다.

사용법:
    python trades.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

SOURCE = "https://driftbtc.vercel.app/api/positions?history=all"
PATH = Path(__file__).parent / "site" / "data" / "trades.json"


def main() -> int:
    try:
        r = requests.get(SOURCE, timeout=30)
        d = r.json()
        if r.status_code != 200 or "history" not in d:
            raise RuntimeError(d.get("error", r.status_code))
    except Exception as e:  # 중계 서버 문제로 예측 갱신까지 멈추지 않도록 경고만 남긴다
        print(f"청산 기록을 받지 못했어요 (기존 기록 유지): {e}")
        return 0

    old = json.loads(PATH.read_text(encoding="utf-8")) if PATH.exists() else {"trades": []}
    merged = {t["id"]: t for t in old["trades"] if t.get("id")}
    added = 0
    for t in d["history"]:
        if not t.get("id"):
            continue
        if t["id"] not in merged:
            added += 1
        merged[t["id"]] = t  # 같은 거래는 최신 값으로 덮어씀
    trades = sorted(merged.values(), key=lambda t: t.get("closed") or 0, reverse=True)
    # 비트겟이 아직 90일을 다 주던 시점부터 기록이 시작되므로, 가장 처음 받은 시점을 남겨 둔다
    since = old.get("since") or (min(t["closed"] for t in trades if t.get("closed")) if trades else None)
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps({"since": since, "count": len(trades), "trades": trades}, ensure_ascii=False), encoding="utf-8")
    print(f"청산 기록: 받은 {len(d['history'])}건, 새로 추가 {added}건, 보관 총 {len(trades)}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
