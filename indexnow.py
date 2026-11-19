"""🔔 새 글·바뀐 글을 검색엔진에 바로 알린다 (IndexNow: 빙·네이버 등. 구글은 IndexNow 를 받지 않아 sitemap 으로만 안다).

배포 전후로 두 번 부른다 (.github/workflows/forecast.yml):

    python indexnow.py plan    # 배포 전: 지금 떠 있는 sitemap 과 새 sitemap 을 비교해 새로 생겼거나 lastmod 가 바뀐 주소를 적어 둔다
    python indexnow.py send    # 배포 뒤: 적어 둔 주소를 알린다

상태 파일을 저장소에 두지 않으려고 '지금 떠 있는 sitemap'을 기준으로 삼는다. 떠 있는 sitemap 을 못 읽으면 아무것도 보내지 않는다.
KEY 는 비밀이 아니다. site/<KEY>.txt 로 공개해 두어 이 사이트 주인이 보낸 알림임을 검색엔진이 확인하는 용도다.
"""
from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

import requests

ROOT = Path(__file__).parent
HOST = "btc.rudals.app"
BASE = f"https://{HOST}/"
KEY = "a5c37f57ba4c6c44ebca79eb26faa1f0"
ENDPOINTS = ["https://api.indexnow.org/indexnow", "https://searchadvisor.naver.com/indexnow"]
PENDING = Path(tempfile.gettempdir()) / "indexnow_urls.txt"
ITEM = re.compile(r"<loc>([^<]+)</loc><lastmod>([^<]+)</lastmod>")


def parse(xml: str) -> dict[str, str]:
    return dict(ITEM.findall(xml))


def changed(live: dict[str, str], new: dict[str, str]) -> list[str]:
    """새로 생겼거나 lastmod 가 바뀐 주소 (새 sitemap 순서 그대로)."""
    return [u for u, m in new.items() if live.get(u) != m]


def plan() -> None:
    PENDING.unlink(missing_ok=True)
    r = requests.get(BASE + "sitemap.xml", timeout=20, headers={"Cache-Control": "no-cache"})
    r.raise_for_status()
    live = parse(r.text)
    if not live:
        raise SystemExit("떠 있는 sitemap 에서 주소를 읽지 못함 — 보내지 않음")
    urls = changed(live, parse((ROOT / "site" / "sitemap.xml").read_text(encoding="utf-8")))
    PENDING.write_text("\n".join(urls), encoding="utf-8")
    print(f"알릴 주소 {len(urls)}개" + "".join(f"\n  {u}" for u in urls))


def send() -> None:
    urls = [u for u in PENDING.read_text(encoding="utf-8").splitlines() if u.startswith(BASE)] if PENDING.exists() else []
    if not urls:
        print("알릴 주소 없음")
        return
    body = {"host": HOST, "key": KEY, "keyLocation": f"{BASE}{KEY}.txt", "urlList": urls}
    failed = 0
    for ep in ENDPOINTS:
        try:
            r = requests.post(ep, json=body, timeout=20, headers={"Content-Type": "application/json; charset=utf-8"})
            ok = r.status_code in (200, 202)
            print(f"{ep} → {r.status_code}{'' if ok else ' ' + r.text[:200]}")
        except requests.RequestException as e:
            ok = False
            print(f"{ep} → 실패 {e}")
        failed += not ok
    if failed == len(ENDPOINTS):
        raise SystemExit("모든 검색엔진 알림 실패")


if __name__ == "__main__":
    {"plan": plan, "send": send}[sys.argv[1] if len(sys.argv) > 1 else ""]()
