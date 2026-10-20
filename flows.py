"""운영자 입금·출금 기록 보관: Vercel 중계(api/flows.js)에서 비트겟 지갑 기록(금액·코인·시각)을 받아
site/data/flows.json 에 저장한다. 화면(renderSeed)은 이 파일을 읽어 설정한 시작일 이후만 합산한다.
받지 못하면 기존 파일을 그대로 둔다.

사용법:
    python flows.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

SOURCE = "https://driftbtc.vercel.app/api/flows"
PATH = Path(__file__).parent / "site" / "data" / "flows.json"


def main() -> int:
    try:
        r = requests.get(SOURCE, timeout=90)
        d = r.json()
        if r.status_code != 200 or "records" not in d:
            raise RuntimeError(d.get("error", r.status_code))
        if d.get("errors"):
            raise RuntimeError(" / ".join(d["errors"]))
    except Exception as e:  # 중계 서버 문제로 예측 갱신까지 멈추지 않도록 경고만 남긴다
        print(f"입출금 기록을 받지 못했어요 (기존 기록 유지): {e}")
        return 0
    out = {"updated": d.get("updated"), "records": d["records"]}
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    dep = sum(x["size"] for x in d["records"] if x["kind"] == "deposit" and x["coin"] in ("USDT", "USDC", "USD"))
    wd = sum(x["size"] for x in d["records"] if x["kind"] == "withdraw" and x["coin"] in ("USDT", "USDC", "USD"))
    print(f"입출금 기록 {len(d['records'])}건 저장 (입금 ${dep:,.0f} · 출금 ${wd:,.0f}, 전체 기간)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
