"""🗓 발표 일정 자동 갱신: site/data/event_dates.json(CPI·FOMC 날짜 원장) → site/data/events.json(신호등·발표 카드가 쓰는 목록).

- FOMC: 연준 공식 일정 페이지를 읽어 새 회의 날짜가 있으면 원장에 더한다(실패하면 원장 그대로).
- CPI: 노동통계국은 자동 접속을 막아서, 1년치 공식 발표 일정을 원장에 적어 둔다(매년 12월쯤 다음 해 일정 공개).
  남은 CPI 일정이 60일 안쪽이면 실행 기록에 경고를 남기고, events.json 에도 그 사실을 적는다.
- events.json 에는 최근 60일 ~ 앞으로의 일정만, 한국어 이름과 함께 넣는다. CPI·FOMC 가 아닌 항목은 그대로 둔다.

    python events_update.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

ROOT = Path(__file__).parent
LEDGER = ROOT / "site" / "data" / "event_dates.json"
EVENTS = ROOT / "site" / "data" / "events.json"
NY = ZoneInfo("America/New_York")
FED = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                       "September", "October", "November", "December"], 1)}


def fetch_fomc() -> tuple[list[str], set[str]]:
    """연준 일정 페이지 → (결정일 목록, 경제 전망(SEP)이 나오는 회의 결정일). 긴급·서면 결의는 뺀다."""
    h = requests.get(FED, headers={"User-Agent": "Mozilla/5.0"}, timeout=20).text
    years = [(m.start(), m.group(1)) for m in re.finditer(r">(\d{4}) FOMC Meetings<", h)]
    days, sep = [], set()
    for i, (pos, y) in enumerate(years):
        seg = h[pos: years[i + 1][0] if i + 1 < len(years) else len(h)]
        for mm in re.finditer(r"fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<", seg, re.S):
            month, date = mm.group(1).strip(), mm.group(2).strip()
            if "notation" in date or "unscheduled" in date or "cancel" in date:
                continue
            last_month = month.split("/")[-1]
            last_month = next((v for k, v in MONTHS.items() if k.startswith(last_month[:3])), None)
            nums = re.findall(r"\d+", date)
            if not last_month or not nums:
                continue
            d = f"{y}-{last_month:02d}-{int(nums[-1]):02d}"
            days.append(d)
            if "*" in date:
                sep.add(d)
    if len(days) < 20:
        raise RuntimeError(f"연준 일정을 제대로 못 읽었어요 ({len(days)}개)")
    return sorted(set(days)), sep


def main() -> None:
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    sep = set(ledger.get("fomc_sep", []))
    try:
        fomc, fsep = fetch_fomc()
        new = sorted(set(fomc) - set(ledger["fomc"]))
        ledger["fomc"] = sorted(set(ledger["fomc"]) | set(fomc))
        sep |= fsep
        ledger["fomc_sep"] = sorted(sep)
        ledger["_source"]["fomc_checked"] = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d")
        LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"FOMC 일정 확인: {len(fomc)}개" + (f", 새 날짜 {new}" if new else ""))
    except Exception as e:
        print(f"⚠ FOMC 일정 페이지를 못 읽어 원장 그대로 씀: {e}")

    now = pd.Timestamp.now(tz="UTC")
    lo = now - pd.Timedelta(days=60)
    items = []
    for d in ledger["cpi"]:
        t = pd.Timestamp(f"{d} 08:30", tz=NY).tz_convert("UTC")
        ref = (t - pd.DateOffset(months=1)).month
        items.append({"t": t, "name": f"미국 CPI ({ref}월분)"})
    for d in ledger["fomc"]:
        t = pd.Timestamp(f"{d} 14:00", tz=NY).tz_convert("UTC")
        items.append({"t": t, "name": "FOMC 금리 결정", **({"note": "경제 전망(SEP) 포함"} if d in sep else {})})
    # CPI·FOMC 가 아닌 항목(직접 넣은 다른 발표)은 그대로 둔다
    try:
        for e in json.loads(EVENTS.read_text(encoding="utf-8")):
            if "CPI" not in e["name"] and "FOMC" not in e["name"]:
                items.append({**e, "t": pd.Timestamp(e["t"])})
    except Exception:
        pass
    items = sorted((e for e in items if e["t"] >= lo), key=lambda e: e["t"])
    out = [{**e, "t": e["t"].strftime("%Y-%m-%dT%H:%M:%SZ")} for e in items]
    EVENTS.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    future_cpi = [d for d in ledger["cpi"] if pd.Timestamp(d, tz="UTC") > now]
    last = max(future_cpi) if future_cpi else None
    print(f"events.json: {len(out)}개 (다음: {out[0]['name'] if out else '-'}), CPI 일정은 {last}까지")
    if not last or pd.Timestamp(last, tz="UTC") < now + pd.Timedelta(days=60):
        print("⚠ CPI 일정이 60일 안에 끝나요. https://www.bls.gov/schedule/news_release/cpi.htm 에서 다음 해 일정을 event_dates.json 에 더해 주세요.")


if __name__ == "__main__":
    main()
