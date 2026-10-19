"""📣 텔레그램 채널 알림: forecast.py 가 만든 site/data/forecast.json 을 읽어 공개 채널에 올린다.

보내는 것 (중복 방지 상태는 site/data/notify_state.json):
- 아침 브리핑 (한국 시간 9시대 첫 실행): 가격 · 1일 예측 범위 · 1일 관점 · 상황 신호등 · 다음 발표
- 1일 관점이 롱↔숏으로 바뀔 때
- 쉬는 구간(변동성 극단·발표 창) 시작/끝
- 발표 1시간 전
- 가상 계좌 주간 성적 (월요일 아침 브리핑에 덧붙임)

환경 변수 TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID 가 없으면 아무것도 보내지 않고 조용히 끝난다.
    python notify.py            # 보내기
    python notify.py --dry-run  # 보낼 내용만 출력
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "site" / "data"
STATE = DATA / "notify_state.json"
SITE = "https://rudalstb.github.io/driftbtc/"
KST = timezone(timedelta(hours=9))


def _load(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def kst(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(KST)


def fmt_usd(v: float) -> str:
    return f"${v:,.0f}"


def pct(v: float, d: int = 1) -> str:
    return f"{v:+.{d}f}%"


def light(rg: dict) -> tuple[str, str]:
    """서버가 아는 재료(변동성·이벤트)만으로 신호등. 펀딩·쏠림은 사이트에서 확인."""
    vol = rg.get("vol_24h_pct")
    if rg.get("event"):
        return "🔴", f"쉬는 구간 — {rg['event']['name']} 발표 창"
    if rg.get("vol_off") and vol is not None:
        return "🔴", f"쉬는 구간 — 24시간 변동성 {vol:.2f}% (1년 상위 10%)"
    if (rg.get("vol_rank") or 0) >= 75:
        return "🟡", f"주의 — 변동성 높은 편 (1년 백분위 {rg['vol_rank']:.0f})"
    if vol is None:
        return "⚪", "변동성 정보 없음"
    return "🟢", f"변동성 보통 (24시간 {vol:.2f}%)"


def build(report: dict, state: dict, now: datetime) -> tuple[list[str], dict]:
    msgs: list[str] = []
    new_state = dict(state)
    f1d = report["forecasts"]["1d"]
    price = f1d["price"]
    rg = report.get("regime") or {}
    sig1d = report["signals"]["1d"]["current"]
    sig_side = "롱 🟢" if sig1d and sig1d["signal"] == "long" else "숏 🔴"
    lt, why = light(rg)
    nxt = f1d["next"]
    upcoming = rg.get("upcoming") or []

    # 1) 아침 브리핑: 한국 시간 9시대, 하루 1번
    today = now.strftime("%Y-%m-%d")
    if now.hour == 9 and state.get("brief_date") != today:
        lines = [
            f"☀️ <b>DriftBTC 아침 브리핑</b> {now:%m/%d %H:%M} KST",
            f"BTC {fmt_usd(price)}",
            f"오늘(1일) 95% 범위: {fmt_usd(nxt['lo95'])} ~ {fmt_usd(nxt['hi95'])}",
            f"1일 관점: {sig_side} (상승 확률 {sig1d['p_up'] * 100:.0f}%)" if sig1d else "",
            f"{lt} {why}",
        ]
        if upcoming:
            e = upcoming[0]
            lines.append(f"📅 다음 발표: {e['name']} {kst(e['t']):%m/%d %H:%M} KST")
        paper = (report.get("paper") or {}).get("1d")
        if now.weekday() == 0 and paper:
            lines.append(f"💵 가상 계좌(1일 관점) {fmt_usd(paper['equity'])} ({pct(paper['return_pct'], 2)}) · 들고만 있기 {pct(paper['hold_return_pct'], 2)}")
        lines.append(f"🔗 {SITE}")
        lines.append("재미로 보는 실험 · 투자 권유 아님")
        msgs.append("\n".join(x for x in lines if x))
        new_state["brief_date"] = today

    # 2) 1일 관점 전환
    if sig1d and state.get("sig_1d") and state["sig_1d"] != sig1d["signal"]:
        msgs.append(f"🔁 <b>1일 관점 전환</b>: {'롱' if state['sig_1d'] == 'long' else '숏'} → <b>{sig_side}</b>\n"
                    f"기준가 {fmt_usd(sig1d['price'])} · 결과 확인 {kst(sig1d['target']):%m/%d %H:%M} KST\n{lt} {why}\n🔗 {SITE}")
    if sig1d:
        new_state["sig_1d"] = sig1d["signal"]

    # 3) 쉬는 구간 시작/끝 (서버가 아는 재료 기준)
    red = lt == "🔴"
    if state.get("red") is not None and state["red"] != red:
        msgs.append((f"🔴 <b>쉬는 구간 시작</b>\n{why}\n새 포지션은 쉬고, 들고 있는 포지션은 손절가를 다시 확인하세요."
                     if red else f"🟢 <b>쉬는 구간 끝</b>\n{why}\n🔗 {SITE}"))
    new_state["red"] = red

    # 4) 발표 1시간 전 (실행 주기가 15분이라 45~75분 전 창에서 1번)
    for e in upcoming:
        mins = (kst(e["t"]) - now).total_seconds() / 60
        key = f"pre_{e['t']}"
        if 45 <= mins <= 75 and not state.get(key):
            msgs.append(f"⏰ <b>{e['name']}</b> 약 1시간 뒤 ({kst(e['t']):%H:%M} KST)\n발표 전후는 방향이 뉴스 한 줄로 뒤집혀요. 발표 2시간 뒤까지 쉬는 구간입니다.")
            new_state[key] = True
    # 오래된 pre_ 키 정리
    for k in list(new_state):
        if k.startswith("pre_") and kst(k[4:]) < now - timedelta(days=2):
            del new_state[k]
    return msgs, new_state


def send(token: str, chat: str, text: str) -> None:
    data = urllib.parse.urlencode({"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status != 200:
            raise RuntimeError(f"텔레그램 응답 {r.status}")


def main() -> None:
    dry = "--dry-run" in sys.argv
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(), os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    report = _load(DATA / "forecast.json", None)
    if not report:
        print("forecast.json 없음 — 건너뜀")
        return
    state = _load(STATE, {})
    msgs, new_state = build(report, state, datetime.now(KST))
    if dry:
        print("\n\n".join(msgs) if msgs else "(보낼 알림 없음)")
        return
    if not token or not chat:
        print("텔레그램 설정 없음 — 알림 건너뜀 (TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID)")
        return
    for m in msgs:
        send(token, chat, m)
    STATE.write_text(json.dumps(new_state, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(f"텔레그램 알림 {len(msgs)}건 보냄")


if __name__ == "__main__":
    main()
