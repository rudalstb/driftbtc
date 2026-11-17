"""📣 텔레그램 채널 알림: forecast.py 가 만든 site/data/forecast.json 을 읽어 공개 채널에 올린다.

보내는 것 (중복 방지 상태는 site/data/notify_state.json):
- 아침 브리핑 (한국 시간 9시대 첫 실행): 어제 예측 채점 · 가격 · 1일 예측 범위 · 1일 관점 · 상황 신호등 · 다음 발표 · 오늘 시장 일지 링크
- 1일 관점이 롱↔숏으로 바뀔 때
- 쉬는 구간(변동성 극단·발표 창) 시작/끝
- 발표 약 1시간 전 (20~90분 전 창, 1번)
- 가상 계좌 주간 성적 · 실시간 알림 주간 성적(alert_week.py) (월요일 아침 브리핑에 덧붙임)
- 💥 강제 청산 급증 (liq.py 가 판정, 같은 시간은 1번만)

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
SITE = "https://btc.rudals.app/"
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


# 🩺 점검 대상: (이름, 단계 id, 갱신 시각을 꺼내는 함수, 몇 시간 넘게 그대로면 멈춘 걸로 볼지)
HEALTH = [
    ("이더리움 예측", "eth", lambda: _load(DATA / "eth.json", {}).get("generated_at"), 3),
    ("강제 청산 집계", "liq", lambda: _load(DATA / "liq.json", {}).get("updated"), 3),
    ("발표 일정 갱신", "events", lambda: None, None),
    ("시장 일지", "daily", lambda: (_load(DATA / "daily_latest.json", {}).get("date") or "") + "T00:00:00+09:00", 50),
    ("월간 성적표", "monthly", lambda: None, None),
    # 주간 일지: 가장 최근 글이 다룬 주가 끝난 월요일 9시에서 30시간 넘게 새 글이 없으면
    ("주간 일지", "weekly", lambda: (max((p.stem for p in (DATA.parent / "weekly").glob("20*.html")), default="2000-01-01")) + "T09:00:00+09:00", 7 * 24 + 7 * 24 + 30),
]


def health(state: dict, new_state: dict, now: datetime) -> list[str]:
    failed = set(os.environ.get("STEP_FAIL", "").split())
    out = []
    for name, sid, updated, max_h in HEALTH:
        why = None
        if sid in failed:
            why = "이번 실행에서 실패"
        elif max_h:
            try:
                age = (now - datetime.fromisoformat(updated().replace("Z", "+00:00"))).total_seconds() / 3600
                if age > max_h:
                    why = f"{age:.0f}시간째 갱신 안 됨"
            except Exception:
                why = "갱신 시각을 읽지 못함"
        key = f"down_{sid}"
        if why and not state.get(key):
            out.append(f"🩺 <b>{name} 멈춤</b> — {why}\n사이트의 다른 부분은 계속 돌아가요. GitHub Actions 기록에서 '{name}' 단계를 확인하세요.")
            new_state[key] = now.isoformat(timespec="minutes")
        elif not why and state.get(key):
            out.append(f"✅ <b>{name} 다시 정상</b> (멈춘 시각 {state[key][5:16].replace('-', '/').replace('T', ' ')} KST)")
            new_state.pop(key, None)
    return out


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
    daily = _load(DATA / "daily_latest.json", {})
    has_daily = daily.get("date") == today
    if now.hour == 9 and state.get("brief_date") != today:
        lines = [
            f"☀️ <b>BTC Agent 아침 브리핑</b> {now:%m/%d %H:%M} KST",
            (f"✅ 어제 예측 <b>{daily['scored']}</b> · 어제 {pct(daily['chg'], 2)}" if has_daily and daily.get("scored") else ""),
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
        if now.weekday() == 0:
            try:  # 실시간 감시기 알림을 같은 규칙으로 다시 돌린 지난주 성적 (실패해도 브리핑은 나간다)
                import alert_week
                lines.append(alert_week.line(alert_week.summary(now)))
            except Exception as e:
                print(f"실시간 알림 주간 성적 실패: {e}")
        lines.append(f"📅 오늘 시장 일지: {SITE}{daily['file']}" if has_daily else f"🔗 {SITE}")
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

    # 4) 발표 약 1시간 전 (알림 단계는 새 1시간 캔들마다 = 1시간에 1번 돌므로, 폭 70분 창(20~90분 전)이면 어느 발표든 한 번은 걸린다)
    for e in upcoming:
        mins = (kst(e["t"]) - now).total_seconds() / 60
        key = f"pre_{e['t']}"
        if 20 <= mins <= 90 and not state.get(key):
            left = f"{round(mins / 5) * 5}분" if mins < 55 else ("약 1시간" if mins < 70 else f"1시간 {round((mins - 60) / 5) * 5}분")
            msgs.append(f"⏰ <b>{e['name']}</b> {left} 뒤 ({kst(e['t']):%H:%M} KST)\n발표 전후는 방향이 뉴스 한 줄로 뒤집혀요. 발표 2시간 뒤까지 쉬는 구간입니다.")
            new_state[key] = True
    # 5) 💥 강제 청산 급증 (liq.py: 지난 1시간 합계가 평소의 4배 이상 · $3M 이상)
    lq = _load(DATA / "liq.json", {})
    if lq.get("spike") and state.get("liq_spike") != lq["hour"]["t"]:
        h = lq["hour"]
        big_long = h["long"] >= h["short"]
        msgs.append(f"💥 <b>{'롱' if big_long else '숏'} 강제 청산 급증</b> ({kst(h['t']):%H}시대 KST)\n"
                    f"1시간 롱 청산 {fmt_usd(h['long'])} · 숏 청산 {fmt_usd(h['short'])} — 평소의 {lq['ratio']:.0f}배 ({lq['source']})\n"
                    + ("롱이 대량으로 털렸어요. 하락이 연쇄 청산을 부르는 구간이라 바닥 잡기는 조심하세요." if big_long
                       else "숏이 대량으로 털렸어요. 숏 스퀴즈로 급등이 이어질 수 있어 추격 매수는 조심하세요.")
                    + f"\n🔗 {SITE}#market")
        new_state["liq_spike"] = h["t"]
    # 6) 🩺 조용한 고장: 실패해도 넘어가는 단계가 멈추면 처음 한 번, 다시 살아나면 한 번 알린다
    msgs += health(state, new_state, now)
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
