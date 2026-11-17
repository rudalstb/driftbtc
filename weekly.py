"""🗓️ 비트코인 주간 일지: 매주 월요일 오전 9시(한국 시간) 주봉 마감 뒤, 지난 한 주를 한 편으로 정리해 site/weekly/YYYY-MM-DD.html 로 남긴다.
(파일 이름 = 그 주가 시작한 월요일, 한국 시간)

담는 것 — 한 주 시가·종가·고저와 1년 중 몇 번째로 큰 주였나, AI 1주 예측 채점, 그 주 1시간·1일 예측 적중률,
요일별 움직임(일지 링크), 5분 ±1% 급변·강제 청산 합계(있을 때), 범위 맞히기 게임 결과(있을 때), 다음 주 예측 범위와 발표 일정(가장 최근 주만).
숫자는 사이트가 이미 쌓아 둔 파일(forecast_log.jsonl, liq_hist.json, forecast.json)과 바이낸스 캔들에서 가져온다.
이미 만든 주는 다시 만들지 않는다(기록을 고치지 않음). 목록(weekly/index.html)과 sitemap 은 매번 갱신.

    python weekly.py              # 지난주 (없으면 생성)
    python weekly.py 2026-11-09   # 특정 주 (그 주 월요일, 한국 날짜)
    python weekly.py --all        # 예측 기록이 있는 모든 지난 주
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import requests

import data
import pages

ROOT = Path(__file__).parent
SITE = ROOT / "site"
OUT = SITE / "weekly"
WD = "월화수목금토일"
D = pd.Timedelta(days=1)
WEEK_API = "https://driftbtc.vercel.app/api/week"


def usd(v: float) -> str:
    return f"${v:,.0f}"


def sp(v: float, d: int = 2) -> str:
    return f"{'+' if v > 0 else ''}{v:.{d}f}%"


def kd(t: pd.Timestamp, wd: bool = False) -> str:
    k = t.tz_convert("Asia/Seoul")
    return f"{k.month}월 {k.day}일" + (f"({WD[k.dayofweek]})" if wd else "")


def first_log() -> pd.DataFrame:
    rows = []
    for line in (SITE / "data" / "forecast_log.jsonl").read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
    log = pd.DataFrame(rows)
    log["t"] = pd.to_datetime(log["t"], utc=True)
    # 같은 시각을 맞히는 예측은 처음 낸 것 하나만 채점 (사이트 전체와 같은 규칙)
    return log.sort_values("made_at").drop_duplicates(["freq", "t"], keep="first")


def hits(log: pd.DataFrame, freq: str, ws: pd.Timestamp) -> dict | None:
    c = data.load(freq)["close"]
    step = pd.Timedelta(hours=1) if freq == "1h" else D
    c.index = c.index + step                       # 캔들이 끝난 시각 = 예측의 목표 시각
    f = log[(log.freq == freq) & (log.t > ws) & (log.t <= ws + 7 * D)]
    f = f[f.t.isin(c.index)]
    if f.empty:
        return None
    a = c.loc[f.t].to_numpy()
    in68 = ((f.lo68.to_numpy() <= a) & (a <= f.hi68.to_numpy())).sum()
    in95 = ((f.lo95.to_numpy() <= a) & (a <= f.hi95.to_numpy())).sum()
    return {"n": len(f), "in68": int(in68), "in95": int(in95)}


def liq_week(ws: pd.Timestamp) -> dict | None:
    try:
        h = json.loads((SITE / "data" / "liq_hist.json").read_text(encoding="utf-8"))["hours"]
    except Exception:
        return None
    rows = [(pd.Timestamp(t), v) for t, v in h.items() if ws <= pd.Timestamp(t) < ws + 7 * D]
    if len(rows) < 6 * 24:                         # 한 주의 대부분이 기록돼 있을 때만
        return None
    big = max(rows, key=lambda r: r[1][0] + r[1][1])
    return {"long": sum(v[0] for _, v in rows), "short": sum(v[1] for _, v in rows), "hours": len(rows),
            "big_t": big[0], "big": big[1][0] + big[1][1], "big_long": big[1][0] >= big[1][1]}


def game_week(ws: pd.Timestamp) -> dict | None:
    try:
        last = requests.get(WEEK_API, timeout=15).json().get("last")
        if last and last.get("wk") == ws.strftime("%Y-%m-%d") and last.get("n"):
            return last
    except Exception:
        pass
    return None


def jumps(ws: pd.Timestamp) -> dict | None:
    """실시간 감시기와 같은 규칙으로 그 주 5분 ±1% 급변 횟수."""
    try:
        import alert_week as aw
        k = aw.klines_1m(int((ws - pd.Timedelta(hours=26)).timestamp() * 1000), int((ws + 7 * D).timestamp() * 1000))
        ev = aw.replay(k, {"1h": [], "1d": []}, int(ws.timestamp() * 1000))
        ups = sum(1 for e in ev if e["up"])
        return {"n": len(ev), "up": ups, "down": len(ev) - ups} if len(k) > 9000 else None
    except Exception as e:
        print(f"급변 집계 실패: {e}")
        return None


def build(ws: pd.Timestamp, latest: bool) -> tuple[str, str, str] | None:
    d1, w1 = data.load("1d"), data.load("1w")
    days = [ws + i * D for i in range(7)]
    if ws not in w1.index or any(d not in d1.index for d in days):
        print(f"{ws.date()} 주 캔들이 아직 다 없어요")
        return None
    w = w1.loc[ws]
    chg = (w.close / w.open - 1) * 100
    rng = (w.high - w.low) / w.open * 100
    past = ((w1.high - w1.low) / w1.open * 100).loc[:ws].iloc[-53:-1]
    rank = int((past > rng).sum()) + 1            # 최근 52주 가운데 몇 번째로 큰 주
    log = first_log()

    # AI 1주 예측 채점
    f1w = log[(log.freq == "1w") & (log.t == ws + 7 * D)]
    ai = ""
    if len(f1w):
        e = f1w.iloc[0]
        in68, in95 = e.lo68 <= w.close <= e.hi68, e.lo95 <= w.close <= e.hi95
        verdict = "68% 범위 안 (적중)" if in68 else "95% 범위 안 (68% 밖)" if in95 else "95% 범위 밖 (빗나감)"
        ai = (f"<p>한 주 전 BTC Agent 는 이번 주 종가가 <b>{usd(e.lo68)} ~ {usd(e.hi68)}</b>(68%), 넓게는 {usd(e.lo95)} ~ {usd(e.hi95)}(95%) 안에 "
              f"들어온다고 예측했어요. 실제 종가는 <b>{usd(w.close)}</b>로 <b>{verdict}</b>이었어요.</p>")
        short = "적중" if in68 else "95% 안" if in95 else "빗나감"
    else:
        short = None
    h1, h1d = hits(log, "1h", ws), hits(log, "1d", ws)
    rows = []
    for name, h in (("1시간", h1), ("1일", h1d)):
        if h:
            rows.append(f"<tr><td>{name} 예측 {h['n']}번</td><td>{h['in68']}번 ({h['in68'] / h['n'] * 100:.0f}%)</td><td>{h['in95']}번 ({h['in95'] / h['n'] * 100:.0f}%)</td></tr>")
    score_tbl = ("<table><tr><th>이번 주 결과가 나온 예측</th><th>68% 범위 안</th><th>95% 범위 안</th></tr>" + "".join(rows) + "</table>"
                 "<p class=\"muted\">잘 맞춰진 범위라면 길게 봐서 68%, 95% 근처가 나와야 해요. 한 주는 표본이 작아 출렁일 수 있어요.</p>") if rows else ""

    # 요일별
    day_rows, moves = [], []
    for d in days:
        c = d1.loc[d]
        m = (c.close / c.open - 1) * 100
        moves.append((m, (c.high - c.low) / c.open * 100, d))
        page = SITE / "daily" / f"{(d + D).tz_convert('Asia/Seoul').strftime('%Y-%m-%d')}.html"   # 다음 날 아침 일지가 이 날을 정리
        link = f' <a href="../daily/{page.name}">일지</a>' if page.exists() else ""
        day_rows.append(f"<tr><td>{kd(d + pd.Timedelta(hours=9), True)}{link}</td><td>{usd(c.close)}</td><td class=\"{'pos' if m >= 0 else 'neg'}\">{sp(m)}</td><td>{(c.high - c.low) / c.open * 100:.1f}%</td></tr>")
    big = max(moves, key=lambda x: abs(x[0]))
    calm = min(moves, key=lambda x: x[1])

    jp, lq, gm = jumps(ws), liq_week(ws), game_week(ws)
    extra = []
    if jp:
        extra.append(f"<li>5분 만에 ±1% 넘게 움직인 급변: <b>{jp['n']}번</b> (오름 {jp['up']} · 내림 {jp['down']}). "
                     "BTC Agent 실시간 감시기가 텔레그램으로 알리는 기준과 같아요.</li>")
    if lq:
        side = "롱" if lq["long"] >= lq["short"] else "숏"
        extra.append(f"<li>OKX 비트코인 선물 강제 청산 합계: 롱 <b>{usd(lq['long'])}</b> · 숏 <b>{usd(lq['short'])}</b> — {side} 쪽이 더 많이 털렸어요. "
                     f"가장 많았던 시간은 {kd(lq['big_t'], True)} {lq['big_t'].tz_convert('Asia/Seoul').hour}시대 {usd(lq['big'])}({'롱' if lq['big_long'] else '숏'} 위주). "
                     '<a href="../guide/liquidations.html">청산 데이터 읽는 법</a></li>')
    game = ""
    if gm:
        game = (f"<h2>🏆 범위 맞히기 결과</h2><p>이번 주 종가 범위를 맞히는 게임에 <b>{gm['n']}명</b>이 참가해 <b>{gm['hits']}명</b>이 맞혔어요. "
                f"AI 범위({usd(gm['ai']['lo'])}~{usd(gm['ai']['hi'])})는 {'적중해 100점' if gm.get('ai_hit') else '빗나가 0점'}이었고, "
                f"<b>AI보다 점수가 높은 사람은 {gm['beat_ai']}명</b>이었어요. 다음 주 게임은 월요일 오전 9시부터 수요일 오전 9시까지 참가할 수 있어요.</p>"
                '<a class="cta" href="../index.html#say">이번 주 게임 참가하기 →</a>')

    nxt = ""
    if latest:
        try:
            fc = json.loads((SITE / "data" / "forecast.json").read_text(encoding="utf-8"))
            f = fc["forecasts"]["1w"]
            if pd.Timestamp(f["as_of"]) == ws + 7 * D:
                n = f["next"]
                up = [u for u in (fc.get("regime") or {}).get("upcoming", []) if pd.Timestamp(u["t"]) < ws + 14 * D]
                nxt = (f"<h2>다음 주 예측</h2><p>다음 주 종가({kd(ws + 14 * D + pd.Timedelta(hours=9), True)} 오전 9시)는 "
                       f"<b>{usd(n['lo68'])} ~ {usd(n['hi68'])}</b>(68%), 넓게는 {usd(n['lo95'])} ~ {usd(n['hi95'])}(95%) 안으로 봐요.</p>"
                       + ("<ul>" + "".join(f"<li>📅 <b>{u['name']}</b> — {pd.Timestamp(u['t']).tz_convert('Asia/Seoul').strftime('%m월 %d일 %H:%M')} (한국 시간)</li>" for u in up) + "</ul>"
                          if up else "<p>다음 주에는 큰 발표 일정이 없어요.</p>"))
        except Exception as e:
            print(f"다음 주 예측 실패: {e}")

    start_k, end_k = ws + pd.Timedelta(hours=9), ws + 6 * D + pd.Timedelta(hours=9)
    title = f"비트코인 주간 일지 {start_k.year}년 {kd(start_k)} ~ {kd(end_k)}"
    desc = (f"이번 주 비트코인 {sp(chg)} ({usd(w.open)}→{usd(w.close)}), 고저 폭 {rng:.1f}%로 최근 1년 {rank}번째로 큰 주. "
            + (f"AI 1주 예측 {short}. " if short else "") + "요일별 움직임, 예측 적중률, 급변·청산까지 정리했어요.")
    body = f"""
<p class="lead-sum">{kd(start_k, True)} 오전 9시부터 {kd(ws + 7 * D + pd.Timedelta(hours=9), True)} 오전 9시까지 비트코인은 <b>{usd(w.open)} → {usd(w.close)}</b>,
<b class="{'pos' if chg >= 0 else 'neg'}">{sp(chg)}</b> 움직였어요.</p>

<h2>한 주 요약</h2>
<table><tr><th>시가</th><th>고가</th><th>저가</th><th>종가</th><th>등락</th></tr>
<tr><td>{usd(w.open)}</td><td>{usd(w.high)}</td><td>{usd(w.low)}</td><td>{usd(w.close)}</td><td>{sp(chg)}</td></tr></table>
<p>고가와 저가 차이는 시가의 <b>{rng:.1f}%</b>로, 최근 52주 가운데 <b>{rank}번째</b>로 {'크게 움직인' if rank <= 13 else '평범한' if rank <= 39 else '조용한'} 주였어요.
가장 크게 움직인 날은 {kd(big[2] + pd.Timedelta(hours=9), True)}({sp(big[0])}), 가장 조용했던 날은 {kd(calm[2] + pd.Timedelta(hours=9), True)}(고저 폭 {calm[1]:.1f}%)이에요.</p>

<h2>AI 예측 채점</h2>
{ai or '<p>이번 주를 맞히는 1주 예측 기록이 없어 채점을 건너뛰어요.</p>'}
{score_tbl}

<h2>요일별 움직임</h2>
<p class="muted">하루 = 그날 오전 9시 ~ 다음 날 오전 9시 (한국 시간). '일지'는 그 하루를 정리한 시장 일지예요.</p>
<table><tr><th>날짜</th><th>종가</th><th>등락</th><th>고저 폭</th></tr>{"".join(day_rows)}</table>
{('<h2>급변과 강제 청산</h2><ul>' + ''.join(extra) + '</ul>') if extra else ''}
{game}
{nxt}
<p class="note">이 글은 BTC Agent 가 매주 월요일 아침 자동으로 정리한 기록이에요. 예측 범위와 통계는 참고용이며 투자 권유가 아니에요. 지난 일지는 고치지 않고 그대로 남겨 둬요.</p>
<a class="cta" href="../index.html">실시간 예측 보기 →</a> <a class="cta" href="index.html">지난 주간 일지 →</a>
"""
    return title, desc, body


def write_index() -> None:
    files = sorted(OUT.glob("20*.html"), reverse=True)
    items = []
    for f in files:
        h = f.read_text(encoding="utf-8")
        t = h.split("<title>")[1].split(" · BTC Agent")[0] if "<title>" in h else f.stem
        d = h.split('name="description" content="')[1].split('"')[0] if 'name="description"' in h else ""
        items.append(f'<li><a href="{f.name}"><b>{t}</b></a><br><span class="muted">{d}</span></li>')
    body = ("<p>BTC Agent 가 매주 월요일 아침 9시(한국 시간) 주봉 마감 뒤 자동으로 쓰는 비트코인 한 주 정리예요. "
            "한 주 움직임, AI 1주 예측이 맞았는지, 요일별 흐름과 급변·청산을 남겨요. 하루 단위 기록은 <a href=\"../daily/\">시장 일지</a>에 있어요.</p>"
            f'<ul class="guide-list">{"".join(items)}</ul><a class="cta" href="../index.html">BTC Agent 홈으로 →</a>')
    (OUT / "index.html").write_text(pages.wrap("weekly/index.html", "비트코인 주간 일지", "매주 월요일 자동으로 쓰는 비트코인 한 주 정리 — 주간 등락, AI 1주 예측 채점, 요일별 흐름, 급변·청산.", body, f"주간 일지 {len(files)}편"),
                                    encoding="utf-8", newline="\n")


def make(ws: pd.Timestamp, latest: bool) -> None:
    path = OUT / f"{(ws + pd.Timedelta(hours=9)).strftime('%Y-%m-%d')}.html"
    if path.exists():
        print(f"주간 일지 {path.name} 이미 있음")
        return
    built = build(ws, latest)
    if built:
        title, desc, body = built
        made = pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y년 %m월 %d일 %H:%M 자동 작성 (한국 시간)")
        path.write_text(pages.wrap(f"weekly/{path.name}", title, desc, body, made), encoding="utf-8", newline="\n")
        print(f"주간 일지 {path.name} 생성")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    last = data.load("1w").index[-1]              # 마지막으로 마감된 주봉의 시작
    args = [a for a in sys.argv[1:]]
    if "--all" in args:
        log = first_log()
        weeks = sorted({t - 7 * D for t in log[log.freq == "1w"].t if t - 7 * D <= last})
        for ws in weeks:
            make(ws, ws == last)
    elif args:
        make(pd.Timestamp(args[0], tz="UTC"), False)   # 한국 월요일 오전 9시 = UTC 월요일 0시 → 날짜가 같다
    else:
        make(last, True)
    write_index()
    pages.write_sitemap()


if __name__ == "__main__":
    main()
