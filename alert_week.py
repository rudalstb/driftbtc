"""📡 실시간 알림 주간 성적: Cloudflare 감시기(worker/watch.js)와 같은 규칙으로 지난 7일 1분봉을 다시 돌려
알림이 몇 번 갔을지, 30분 뒤 움직임이 이어졌는지·되돌렸는지 센다. 감시기는 기록을 남기지 않으므로 여기서 다시 계산한다.
notify.py 가 월요일 아침 브리핑에 한 줄로 붙인다.

규칙 (watch.js 와 같아야 함)
- ⚡ 급변: 5분 수익률이 ±1% 이상이 된 첫 1분봉, 그 전 30분 안에 이미 넘은 적 없음
- 🚨 범위 이탈: 그 시각에 사이트가 보여 주던 1시간·1일 예측 95% 범위를 그 창에서 처음 벗어난 1분봉 (고가·저가 기준)
- ↪️ 30분 뒤: 알림 캔들 종가 → 30분 뒤 종가가 알림 방향으로 0.2% 이상이면 '이어짐', 반대로 0.2% 이상이면 '되돌림', 아니면 '제자리'

    python alert_week.py     # 지난 7일 결과 출력
"""
from __future__ import annotations

import json
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

DATA = Path(__file__).parent / "site" / "data"
M = 60_000
MOVE_PCT, MOVE_MIN, COOLDOWN, FOLLOW, FLAT = 0.01, 5, 30, 30, 0.002
HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"]


def klines_1m(start_ms: int, end_ms: int) -> list[tuple[int, float, float, float]]:
    """[(t, high, low, close)] 마감된 1분봉, 오래된 순."""
    out: list = []
    t = start_ms
    while t < end_ms:
        rows = None
        for h in HOSTS:
            try:
                r = requests.get(f"{h}/api/v3/klines", params={"symbol": "BTCUSDT", "interval": "1m", "startTime": t, "limit": 1000}, timeout=20)
                if r.ok:
                    rows = r.json()
                    break
            except Exception:
                pass
        if not rows:
            break
        out += [(int(x[0]), float(x[2]), float(x[3]), float(x[4])) for x in rows if int(x[0]) + M <= end_ms]
        t = int(rows[-1][0]) + M
        if len(rows) < 1000:
            break
    return out


def forecasts() -> dict[str, list[dict]]:
    """freq → [{made, as_of, t, lo95, hi95}] 만든 시각 순 (그 시각에 사이트에 떠 있던 예측을 찾으려고)."""
    out: dict[str, list[dict]] = {"1h": [], "1d": []}
    for line in (DATA / "forecast_log.jsonl").read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("freq") in out and "lo95" in e:
            ms = lambda s: int(datetime.fromisoformat(s).timestamp() * 1000)
            out[e["freq"]].append({"made": ms(e["made_at"]), "as_of": ms(e["as_of"]), "t": ms(e["t"]), "lo": e["lo95"], "hi": e["hi95"]})
    for v in out.values():
        v.sort(key=lambda x: x["made"])
    return out


def replay(k: list, fc: dict[str, list[dict]], since_ms: int) -> list[dict]:
    """since_ms 이후 각 1분봉 시점에 감시기가 보냈을 알림 (같은 분의 여러 알림은 한 묶음)."""
    t = [x[0] for x in k]
    c = [x[3] for x in k]
    made = {f: [e["made"] for e in v] for f, v in fc.items()}
    move = lambda i: c[i] / c[i - MOVE_MIN] - 1 if i >= MOVE_MIN else 0.0
    # 창마다 이미 벗어났는지 기억 (창 = (freq, as_of, 방향))
    broke: set = set()
    events = []
    for i in range(MOVE_MIN + COOLDOWN, len(k)):
        now = t[i] + M
        kinds = []
        mv = move(i)
        if abs(mv) >= MOVE_PCT and all(abs(move(j)) < MOVE_PCT for j in range(i - COOLDOWN, i)):
            kinds.append(("move", mv > 0))
        for f in ("1h", "1d"):
            j = bisect_right(made[f], now) - 1          # 그 시각 사이트에 떠 있던 최신 예측
            if j < 0:
                continue
            e = fc[f][j]
            if not (e["as_of"] <= t[i] and now <= e["t"]):
                continue
            for up in (True, False):
                key = (f, e["as_of"], e["lo"], e["hi"], up)
                hit = k[i][1] >= e["hi"] if up else k[i][2] <= e["lo"]
                if hit and key not in broke:
                    # 창 시작부터 이 캔들 전까지 한 번도 안 닿았는지 (감시기와 같은 판정)
                    a = bisect_right(t, e["as_of"] - 1)
                    before = any((k[x][1] >= e["hi"]) if up else (k[x][2] <= e["lo"]) for x in range(a, i))
                    broke.add(key)
                    if not before:
                        kinds.append((f, up))
                elif hit:
                    broke.add(key)
        if kinds and t[i] >= since_ms:
            ev = {"t": t[i], "kinds": kinds, "up": kinds[0][1]}
            if i + FOLLOW < len(k):
                chg = c[i + FOLLOW] / c[i] - 1
                same = chg if ev["up"] else -chg
                ev["after"] = "cont" if same >= FLAT else "rev" if same <= -FLAT else "flat"
                ev["same"] = same
            events.append(ev)
    return events


def summary(now: datetime | None = None) -> dict | None:
    now = now or datetime.now(timezone.utc)
    end = int(now.replace(second=0, microsecond=0).timestamp() * 1000)
    since = end - 7 * 86_400_000
    k = klines_1m(since - 26 * 3_600_000, end)   # 1일 창 판정용으로 하루 넘게 앞에서부터
    if len(k) < 5000:
        return None
    ev = replay(k, forecasts(), since)
    cnt = lambda kind: sum(any(x[0] == kind for x in e["kinds"]) for e in ev)
    done = [e for e in ev if "after" in e]
    return {
        "n": len(ev), "move": cnt("move"), "r1h": cnt("1h"), "r1d": cnt("1d"),
        "cont": sum(e["after"] == "cont" for e in done), "rev": sum(e["after"] == "rev" for e in done),
        "flat": sum(e["after"] == "flat" for e in done),
        "avg_same": round(sum(e["same"] for e in done) / len(done) * 100, 2) if done else None,
        "events": ev,
    }


def line(s: dict | None) -> str:
    if not s:
        return ""
    if not s["n"]:
        return "📡 지난주 실시간 알림 0번 — 5분 ±1% 급변도, 예측 범위 이탈도 없던 조용한 한 주"
    tail = (f" · 30분 뒤 이어짐 {s['cont']} · 되돌림 {s['rev']} · 제자리 {s['flat']} (알림 방향 평균 {s['avg_same']:+.2f}%)"
            if s["avg_same"] is not None else "")
    return f"📡 지난주 실시간 알림 {s['n']}번 (⚡ 급변 {s['move']} · 🚨 1시간 범위 {s['r1h']} · 1일 범위 {s['r1d']}){tail}"


if __name__ == "__main__":
    s = summary()
    print(line(s))
    KST = timezone(timedelta(hours=9))
    for e in (s or {}).get("events", []):
        when = datetime.fromtimestamp(e["t"] / 1000 + 60, KST).strftime("%m/%d %H:%M")
        print(" ", when, ", ".join(f"{k}{'↑' if u else '↓'}" for k, u in e["kinds"]), e.get("after", "-"), f"{e.get('same', 0) * 100:+.2f}%")
