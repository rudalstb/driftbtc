"""📅 비트코인 시장 일지: 하루 한 번(한국 시간 오전 9시 일봉 마감 뒤) 그날의 글 한 편을 site/daily/YYYY-MM-DD.html 로 만든다.

담는 것 — 어제 하루 정리(시가·종가·변동폭이 평소보다 컸나), 어제 예측 채점(범위 안이었나·누적 적중률),
오늘 1일·1주 예측 범위와 관점, 신호등 상황, 김프·고점 대비 낙폭·닮은꼴 과거, 다가오는 발표와 과거 반응.
숫자는 모두 사이트가 이미 계산해 둔 파일(forecast.json, forecast_log.jsonl, history.json)과 일봉에서 가져온다.
이미 만든 날짜는 다시 만들지 않는다(그날 기록을 고치지 않음). 목록(daily/index.html)과 sitemap 은 매번 갱신.

    python daily.py
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

import data
import pages

ROOT = Path(__file__).parent
SITE = ROOT / "site"
OUT = SITE / "daily"
WD = "월화수목금토일"


def usd(v: float) -> str:
    return f"${v:,.0f}"


def sp(v: float, d: int = 2) -> str:
    return f"{'+' if v > 0 else ''}{v:.{d}f}%"


def kdate(t: pd.Timestamp) -> str:
    return f"{t.year}년 {t.month}월 {t.day}일({WD[t.dayofweek]})"


def kd(t: pd.Timestamp) -> str:
    return f"{t.year}년 {t.month}월 {t.day}일"


def first_forecast(target: pd.Timestamp) -> dict | None:
    """그 시각을 맞히려고 처음 낸 1일 예측 (같은 예측이 매시간 다시 기록되므로 첫 번째)."""
    for line in (SITE / "data" / "forecast_log.jsonl").read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("freq") == "1d" and pd.Timestamp(r["t"]) == target:
            return r
    return None


def build(day: pd.Timestamp) -> tuple[str, str, str] | None:
    fc = json.loads((SITE / "data" / "forecast.json").read_text(encoding="utf-8"))
    f1d = fc["forecasts"]["1d"]
    if pd.Timestamp(f1d["as_of"]) != day:
        print(f"예측이 아직 {day.date()} 기준이 아니라 다음 실행 때 만들어요 ({f1d['as_of']})")
        return None
    hist = json.loads((SITE / "data" / "history.json").read_text(encoding="utf-8"))
    d1 = data.load("1d")
    yday = day - pd.Timedelta(days=1)                      # 어제 일봉(한국 시간 어제 9시 ~ 오늘 9시)
    if yday not in d1.index:
        return None
    c = d1.loc[yday]
    chg = (c.close / c.open - 1) * 100
    rng = (c.high - c.low) / c.open * 100
    past = ((d1.high - d1.low) / d1.open * 100).loc[:yday].iloc[-366:-1]
    rng_rank = round(float((past < rng).mean()) * 100)
    kst_y = yday + pd.Timedelta(hours=9)

    # 어제 예측 채점
    prev = first_forecast(day)
    score = ""
    if prev:
        a = c.close
        in68, in95 = prev["lo68"] <= a <= prev["hi68"], prev["lo95"] <= a <= prev["hi95"]
        verdict = "68% 범위 안 (적중)" if in68 else "95% 범위 안 (68% 밖)" if in95 else "95% 범위 밖 (빗나감)"
        pdir = prev.get("point_dir")
        dir_ok = None if not pdir else (pdir > 0) == (a > prev["price"])
        score = (f"<p>어제 아침 BTC Agent 는 오늘 9시 종가가 <b>{usd(prev['lo68'])} ~ {usd(prev['hi68'])}</b>(68%), "
                 f"넓게는 {usd(prev['lo95'])} ~ {usd(prev['hi95'])}(95%) 안에 들어온다고 예측했어요. 실제 종가는 <b>{usd(a)}</b>로 "
                 f"<b>{verdict}</b>이었어요."
                 + (f" 방향 관점({'오름' if pdir > 0 else '내림'})은 {'맞았어요' if dir_ok else '틀렸어요'}." if dir_ok is not None else "")
                 + "</p>")
    lr = fc.get("live_record", {}).get("1d", {})
    if lr.get("n"):
        score += (f"<p>{kd(pd.Timestamp(lr['since']))} 이후 실제로 채점한 1일 예측 {lr['n']}번 중 "
                  f"95% 범위 안 {lr['hit95']}번({lr['hit95'] / lr['n'] * 100:.0f}%), 68% 범위 안 {lr['hit68']}번({lr['hit68'] / lr['n'] * 100:.0f}%)이에요. "
                  f"잘 맞춰진 범위라면 장기적으로 각각 95%, 68% 근처가 나와야 해요.</p>")

    # 오늘 예측
    n0 = f1d["future"][0]
    w0 = fc["forecasts"]["1w"]["future"][0]
    sig = fc.get("signals", {}).get("1d", {}).get("current", {})
    side = {"long": "롱(오름)", "short": "숏(내림)"}.get(sig.get("signal"), "관망")
    p_up = sig.get("p_up")
    rg = fc.get("regime", {})

    # 과거 비교·김프·발표
    dd, an, kp, ev = hist.get("drawdown", {}), hist.get("analogs", {}), hist.get("kimp"), hist.get("events", {})
    cond = hist.get("conditions", [])
    odd = [x for x in cond if "자주" in x["verdict"]]
    cond_txt = ", ".join(f"{x['name']}" for x in cond)
    up = ev.get("upcoming", [])[:2]

    title = f"비트코인 시장 일지 {kdate(day + pd.Timedelta(hours=9))}"
    desc = (f"어제 비트코인 {sp(chg)} ({usd(c.open)}→{usd(c.close)}), 오늘 예측 범위 {usd(n0['lo68'])}~{usd(n0['hi68'])}. "
            f"어제 예측 채점, 김프, 고점 대비 낙폭, 다가오는 발표까지 정리했어요.")

    body = f"""
<p class="lead-sum">어제({kdate(kst_y)} 오전 9시 ~ 오늘 오전 9시) 비트코인은 <b>{usd(c.open)} → {usd(c.close)}</b>, <b class="{'pos' if chg >= 0 else 'neg'}">{sp(chg)}</b> 움직였어요.
오늘 BTC Agent 가 보는 하루 범위는 <b>{usd(n0['lo68'])} ~ {usd(n0['hi68'])}</b>(68%)예요.</p>

<h2>어제 하루</h2>
<table><tr><th>시가</th><th>고가</th><th>저가</th><th>종가</th><th>등락</th></tr>
<tr><td>{usd(c.open)}</td><td>{usd(c.high)}</td><td>{usd(c.low)}</td><td>{usd(c.close)}</td><td>{sp(chg)}</td></tr></table>
<p>고가와 저가 차이는 시가의 <b>{rng:.1f}%</b>로, 최근 1년 365일 가운데 <b>{'상위 ' + str(100 - rng_rank) + '%' if rng_rank >= 50 else '하위 ' + str(rng_rank) + '%'}</b> 수준의 {'큰' if rng_rank >= 70 else '평범한' if rng_rank >= 30 else '작은'} 움직임이었어요.</p>

<h2>어제 예측 채점</h2>
{score or '<p>어제 기록된 1일 예측이 없어 채점을 건너뛰어요.</p>'}

<h2>오늘 예측</h2>
<table><tr><th>기간</th><th>68% 범위</th><th>95% 범위</th></tr>
<tr><td>하루 (내일 오전 9시)</td><td>{usd(n0['lo68'])} ~ {usd(n0['hi68'])}</td><td>{usd(n0['lo95'])} ~ {usd(n0['hi95'])}</td></tr>
<tr><td>1주 ({pd.Timestamp(w0['t']).month}월 {pd.Timestamp(w0['t']).day}일 오전 9시)</td><td>{usd(w0['lo68'])} ~ {usd(w0['hi68'])}</td><td>{usd(w0['lo95'])} ~ {usd(w0['hi95'])}</td></tr></table>
<p>하루 관점은 <b>{side}</b>{f' (오를 확률 {p_up * 100:.0f}%)' if p_up is not None else ''}이에요. 방향 관점은 동전 던지기보다 조금 나은 정도라 범위를 먼저 보는 게 좋아요.
최근 24시간 변동성은 {rg.get('vol_24h_pct', 0):.2f}%로, 지난 1년 가운데 {rg.get('vol_rank', 0):.0f}%의 시간보다 컸어요{' — 신호등의 쉬는 구간 기준(상위 10%)을 넘었어요' if rg.get('vol_off') else ''}.</p>

<h2>지금 상황을 과거와 비교하면</h2>
<ul>
  <li>최고점 {usd(dd.get('ath', 0))}({kd(pd.Timestamp(dd['ath_date'])) if dd.get('ath_date') else ''}) 대비 <b>{sp(dd.get('now', 0), 1)}</b>. {f"2017년 이후 이보다 깊게 빠진 적은 {dd['deeper_count']}번이고, 이 깊이에서 전고점 회복까지 중간값 {dd['recover_median_days']}일 걸렸어요." if dd.get('deeper_count') else ''}</li>
  <li>최근 30일 흐름과 닮은 과거 {an.get('fwd7', {}).get('n', 0)}번 가운데 7일 뒤 오른 비율은 {an.get('fwd7', {}).get('up', 0)}% (평소 {an.get('base7', {}).get('up', 0)}%), 중간값 {sp(an.get('fwd7', {}).get('median', 0), 1)}.</li>
  {f"<li>지금 해당하는 조건: {cond_txt}. " + ('과거에 평소와 뚜렷하게 달랐던 조건: ' + ', '.join(f"{x['name']}({x['verdict']})" for x in odd) if odd else '모두 7일 뒤 결과가 평소와 비슷했어요.') + "</li>" if cond else ''}
  {f"<li>김프(어제 마감) <b>{sp(kp['now'])}</b> — 2017년 이후 상위 {max(1, 100 - kp['now_rank'])}% 수준." + (" 김프가 5%를 넘었던 때는 30일 뒤 성적이 평소보다 나빴어요." if kp['now'] >= 5 else "") + "</li>" if kp else ''}
</ul>

<h2>다가오는 발표</h2>
{('<ul>' + ''.join(f"<li><b>{u['name']}</b> — {pd.Timestamp(u['t']).tz_convert('Asia/Seoul').strftime('%m월 %d일 %H:%M')} (한국 시간)" + (f" · 지난 {ev[u['kind']]['n']}번 발표 뒤 4시간 동안 평소의 {ev[u['kind']]['ratio']}배 움직였어요" if u.get('kind') in ev else '') + "</li>" for u in up) + '</ul>') if up else '<p>가까운 발표 일정이 없어요.</p>'}

<p class="note">이 글은 BTC Agent 가 매일 아침 자동으로 정리한 기록이에요. 과거 통계와 예측 범위는 참고용이며 투자 권유가 아니에요. 지난 일지는 고치지 않고 그대로 남겨 둬요.</p>
<a class="cta" href="../index.html#home">실시간 예측 보기 →</a> <a class="cta" href="index.html">지난 일지 →</a>
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
    body = ("<p>BTC Agent 가 매일 아침 9시(한국 시간) 일봉 마감 뒤 자동으로 쓰는 비트코인 시장 기록이에요. "
            "어제 예측이 맞았는지, 오늘 범위와 지금 상황을 과거와 비교한 내용을 날마다 남겨요.</p>"
            f'<ul class="guide-list">{"".join(items)}</ul><a class="cta" href="../index.html">BTC Agent 홈으로 →</a>')
    (OUT / "index.html").write_text(pages.wrap("daily/index.html", "비트코인 시장 일지", "매일 아침 자동으로 쓰는 비트코인 시장 기록 — 어제 예측 채점, 오늘 예측 범위, 과거 비교.", body, f"일지 {len(files)}편"), encoding="utf-8", newline="\n")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    day = data.load("1d").index[-1] + pd.Timedelta(days=1)   # 마지막으로 마감된 일봉이 끝난 시각 = 오늘 한국 9시
    path = OUT / f"{(day + pd.Timedelta(hours=9)).strftime('%Y-%m-%d')}.html"
    if path.exists():
        print(f"시장 일지 {path.name} 이미 있음")
    else:
        built = build(day)
        if built:
            title, desc, body = built
            made = pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y년 %m월 %d일 %H:%M 자동 작성 (한국 시간)")
            path.write_text(pages.wrap(f"daily/{path.name}", title, desc, body, made), encoding="utf-8", newline="\n")
            print(f"시장 일지 {path.name} 생성")
    write_index()
    pages.write_sitemap()


if __name__ == "__main__":
    main()
