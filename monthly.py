"""📊 월간 성적표: 지난달 BTC Agent 가 낸 예측·관점·운영자 실전 매매를 한 편으로 채점해 site/monthly/YYYY-MM.html 로 남긴다.

- 예측 범위: 그달에 결과가 나온 1시간·1일 예측(같은 시각을 맞히는 예측은 처음 낸 것 하나만)이 68%·95% 범위 안에 들어온 비율
- 방향 관점: 1시간·1일 롱/숏 관점이 맞은 비율과, 늘 롱만 했을 때와의 비교
- 가장 크게 빗나간 날 (1일 예측, 범위 폭 대비 얼마나 벗어났나)
- 운영자 실전 계좌(비트겟) 그달 청산 거래 수·승률·순손익
- 그달 비트코인 시가·종가·고가·저가와 그달 시장 일지 목록
달(月)은 한국 시간 기준. 이미 있는 달은 다시 만들지 않는다(기록을 고치지 않음). 매일 실행해도 지난달 글이 없을 때만 만든다.

    python monthly.py            # 지난달 (없으면 생성)
    python monthly.py 2026-10    # 특정 달
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

import data
import pages

ROOT = Path(__file__).parent
SITE = ROOT / "site"
OUT = SITE / "monthly"
KST = "Asia/Seoul"


def usd(v: float) -> str:
    return f"${v:,.0f}"


def sp(v: float, d: int = 2) -> str:
    return f"{'+' if v > 0 else ''}{v:.{d}f}%"


def jsonl(p: Path) -> list[dict]:
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out


def in_month(ts: pd.Series, ym: str) -> pd.Series:
    return ts.dt.tz_convert(KST).dt.strftime("%Y-%m") == ym


def score_ranges(ym: str) -> tuple[dict, dict | None]:
    log = pd.DataFrame(jsonl(SITE / "data" / "forecast_log.jsonl"))
    log["t"] = pd.to_datetime(log["t"], utc=True)
    log = log.sort_values("made_at").drop_duplicates(["freq", "t"], keep="first")
    res, worst = {}, None
    for freq, step in (("1h", "h"), ("1d", "D")):
        c = data.load(freq)["close"]
        f = log[(log.freq == freq) & in_month(log.t, ym)].copy()
        f["actual"] = [c.get(t - pd.Timedelta(1, unit=step)) for t in f.t]
        f = f.dropna(subset=["actual"])
        if f.empty:
            continue
        in68 = (f.actual >= f.lo68) & (f.actual <= f.hi68)
        in95 = (f.actual >= f.lo95) & (f.actual <= f.hi95)
        res[freq] = {"n": int(len(f)), "in68": round(float(in68.mean()) * 100, 1), "in95": round(float(in95.mean()) * 100, 1),
                     "first": f.t.min(), "last": f.t.max()}
        if freq == "1d":
            sd = (f.hi95 - f.lo95) / 3.92
            z = ((f.actual - f.mid) / sd)
            i = z.abs().idxmax()
            r = f.loc[i]
            worst = {"t": r.t, "lo95": r.lo95, "hi95": r.hi95, "mid": r.mid, "actual": r.actual, "z": float(z[i])}
    return res, worst


def score_signals(ym: str) -> dict:
    log = pd.DataFrame(jsonl(SITE / "data" / "signal_log.jsonl"))
    log["target"] = pd.to_datetime(log["target"], utc=True)
    log = log.drop_duplicates(["freq", "target"], keep="first")
    out = {}
    for freq, step in (("1h", "h"), ("1d", "D")):
        c = data.load(freq)["close"]
        s = log[(log.freq == freq) & in_month(log.target, ym)].copy()
        s["actual"] = [c.get(t - pd.Timedelta(1, unit=step)) for t in s.target]
        s = s.dropna(subset=["actual"])
        if s.empty:
            continue
        up = s.actual > s.price
        hit = (up & (s.signal == "long")) | (~up & (s.signal == "short"))
        ret = (s.actual / s.price - 1) * 100
        strat = ret.where(s.signal == "long", -ret)
        out[freq] = {"n": int(len(s)), "hit": round(float(hit.mean()) * 100, 1), "up_share": round(float(up.mean()) * 100, 1),
                     "sum": round(float(strat.sum()), 2), "long_sum": round(float(ret.sum()), 2)}
    return out


def trades_month(ym: str) -> dict | None:
    try:
        t = pd.DataFrame(json.loads((SITE / "data" / "trades.json").read_text(encoding="utf-8"))["trades"])
    except Exception:
        return None
    if t.empty:
        return None
    t["closed"] = pd.to_datetime(t["closed"], unit="ms", utc=True)
    m = t[in_month(t.closed, ym)]
    if m.empty:
        return {"n": 0}
    return {"n": int(len(m)), "wins": int((m.net > 0).sum()), "net": round(float(m.net.sum()), 2),
            "fees": round(float(m.fees.sum()), 2), "best": round(float(m.net.max()), 2), "worst": round(float(m.net.min()), 2)}


def build(ym: str) -> tuple[str, str, str]:
    y, mo = map(int, ym.split("-"))
    d1 = data.load("1d")
    days = d1[(d1.index + pd.Timedelta(hours=9)).strftime("%Y-%m") == ym]   # 일봉은 한국 시간 오전 9시 시작
    mo_open, mo_close = float(days.open.iloc[0]), float(days.close.iloc[-1])
    mo_chg = (mo_close / mo_open - 1) * 100
    rng, worst = score_ranges(ym)
    sig = score_signals(ym)
    tr = trades_month(ym)
    journals = sorted((SITE / "daily").glob(f"{ym}-*.html")) if (SITE / "daily").exists() else []

    def rng_row(freq: str, name: str) -> str:
        r = rng.get(freq)
        if not r:
            return ""
        # 68%·95% 둘 다 본다: 목표보다 많이 들어오면 범위가 넓은 것(덜 날카로움), 적으면 좁은 것(급변동을 놓침)
        wide = r["in68"] > 76 or r["in95"] > 98
        narrow = r["in68"] < 60 or r["in95"] < 92
        ok95 = "범위가 넓은 편 (덜 날카로움)" if wide and not narrow else "범위가 좁았음 (급변동 놓침)" if narrow and not wide else "목표 근처 (정상)"
        return f"<tr><td>{name}</td><td>{r['n']:,}번</td><td><b>{r['in68']}%</b> <span class='muted'>(목표 68%)</span></td><td><b>{r['in95']}%</b> <span class='muted'>(목표 95%)</span></td><td>{ok95}</td></tr>"

    def sig_row(freq: str, name: str) -> str:
        s = sig.get(freq)
        if not s:
            return ""
        return (f"<tr><td>{name}</td><td>{s['n']:,}번</td><td><b>{s['hit']}%</b></td><td>{sp(s['sum'])}</td>"
                f"<td>{sp(s['long_sum'])}</td></tr>")

    first = min((r["first"] for r in rng.values()), default=None)
    partial = first is not None and (first + pd.Timedelta(hours=9)).day > 2
    title = f"BTC Agent {y}년 {mo}월 성적표"
    r1d = rng.get("1d", {})
    desc = (f"{y}년 {mo}월 비트코인 {sp(mo_chg, 1)}. 1일 예측 {r1d.get('n', 0)}번 중 95% 범위 안 {r1d.get('in95', 0)}%, "
            f"방향 관점 적중률, 가장 크게 빗나간 날, 운영자 실전 계좌 손익까지 공개 채점했어요.")
    worst_txt = ""
    if worst:
        wt = (worst["t"] - pd.Timedelta(days=1) + pd.Timedelta(hours=9))
        side = "위로" if worst["actual"] > worst["mid"] else "아래로"
        out95 = not (worst["lo95"] <= worst["actual"] <= worst["hi95"])
        worst_txt = (f"<h2>가장 크게 빗나간 날</h2><p>{wt.month}월 {wt.day}일 하루 예측은 95% 범위 {usd(worst['lo95'])} ~ {usd(worst['hi95'])}였는데, "
                     f"실제 종가는 <b>{usd(worst['actual'])}</b>로 예측 가운데값에서 {side} 표준편차의 {abs(worst['z']):.1f}배만큼 벗어났어요"
                     f"{' — 95% 범위 밖이었어요' if out95 else ', 그래도 95% 범위 안이었어요'}. 이런 날을 숨기지 않고 남기는 게 이 성적표의 목적이에요.</p>")
    tr_txt = ""
    if tr is not None:
        tr_txt = ("<h2>운영자 실전 계좌 (비트겟)</h2>" +
                  (f"<p>그달 청산한 거래 <b>{tr['n']}번</b>, 이긴 거래 {tr['wins']}번(승률 {tr['wins'] / tr['n'] * 100:.0f}%), "
                   f"수수료·펀딩을 뺀 순손익 <b class='{'pos' if tr['net'] >= 0 else 'neg'}'>{'+' if tr['net'] >= 0 else '−'}${abs(tr['net']):,.2f}</b> "
                   f"(낸 수수료·펀딩 ${tr['fees']:,.2f}). 가장 좋은 거래 {'+' if tr['best'] >= 0 else '−'}${abs(tr['best']):,.2f}, 가장 나쁜 거래 {'+' if tr['worst'] >= 0 else '−'}${abs(tr['worst']):,.2f}.</p>"
                   if tr["n"] else "<p>그달에 청산한 거래가 없어요.</p>") +
                  "<p class='muted'>사이트 예측과 별개로 운영자가 직접 한 매매예요. 조회 전용 키로 그대로 가져와요.</p>")
    jl = "".join(f'<li><a href="../daily/{f.name}">{int(f.stem[5:7])}월 {int(f.stem[8:10])}일 시장 일지</a></li>' for f in journals)

    body = f"""
<p class="lead-sum">{y}년 {mo}월 비트코인은 <b>{usd(mo_open)} → {usd(mo_close)}</b>, <b class="{'pos' if mo_chg >= 0 else 'neg'}">{sp(mo_chg, 1)}</b> 움직였어요 (고가 {usd(days.high.max())}, 저가 {usd(days.low.min())}).
BTC Agent 가 이 달에 낸 예측을 실제 가격과 하나하나 맞춰 본 결과예요.{' 사이트 기록은 ' + str((first + pd.Timedelta(hours=9)).month) + '월 ' + str((first + pd.Timedelta(hours=9)).day) + '일부터라 그 이후만 채점했어요.' if partial else ''}</p>

<h2>예측 범위는 잘 맞았나</h2>
<table><tr><th>예측</th><th>채점 수</th><th>68% 범위 안</th><th>95% 범위 안</th><th>판정</th></tr>
{rng_row('1h', '1시간 뒤')}{rng_row('1d', '하루 뒤')}</table>
<p>잘 맞춰진 범위라면 오래 보면 68% 범위에는 약 68%, 95% 범위에는 약 95%가 들어와야 해요. 이보다 훨씬 높으면 범위가 쓸데없이 넓은 것이고, 낮으면 급변동을 놓친 거예요. 한 달은 짧아서 몇 %p 정도 오르내리는 건 자연스러워요.</p>

<h2>방향 관점(롱·숏)은 맞았나</h2>
<table><tr><th>관점</th><th>횟수</th><th>맞은 비율</th><th>관점대로 했다면 (합산)</th><th>늘 롱만 했다면</th></tr>
{sig_row('1h', '1시간')}{sig_row('1d', '하루')}</table>
<p>합산 수익률은 수수료를 빼지 않은 단순 합이에요. 방향은 원래 맞히기 어려워서 50%를 꾸준히 넘기기만 해도 의미가 있지만, 한 달 결과는 운의 영향이 커요.</p>

{worst_txt}
{tr_txt}
{('<h2>이 달의 시장 일지</h2><ul>' + jl + '</ul>') if jl else ''}

<p class="note">매달 1일 아침에 자동으로 정리해 남기고, 지난 성적표는 고치지 않아요. 투자 권유가 아니에요.</p>
<a class="cta" href="../index.html#verify">실시간 적중률 보기 →</a> <a class="cta" href="index.html">지난 성적표 →</a>
"""
    return title, desc, body


def write_index() -> None:
    files = sorted(OUT.glob("20*.html"), reverse=True)
    rows, items = [], []
    for f in files:
        h = f.read_text(encoding="utf-8")
        t = h.split("<title>")[1].split(" · BTC Agent")[0]
        d = h.split('name="description" content="')[1].split('"')[0]
        items.append(f'<li><a href="{f.name}"><b>{t}</b></a><br><span class="muted">{d}</span></li>')
        rows.append({"ym": f.stem, "file": f"monthly/{f.name}", "title": t, "desc": d})
    (SITE / "data" / "monthly_list.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    body = ("<p>BTC Agent 가 매달 1일에 지난달 예측·관점·운영자 실전 매매를 채점해 남기는 성적표예요. 잘 맞은 달도, 빗나간 달도 그대로 남겨요.</p>"
            f'<ul class="guide-list">{"".join(items)}</ul><a class="cta" href="../index.html">BTC Agent 홈으로 →</a>')
    (OUT / "index.html").write_text(pages.wrap("monthly/index.html", "BTC Agent 월간 성적표", "매달 자동으로 채점해 공개하는 BTC Agent 예측·관점·실전 매매 성적표.", body, f"성적표 {len(files)}편"), encoding="utf-8", newline="\n")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    if len(sys.argv) > 1:
        ym = sys.argv[1]
    else:
        ym = (pd.Timestamp.now(tz=KST).replace(day=1) - pd.Timedelta(days=1)).strftime("%Y-%m")
    path = OUT / f"{ym}.html"
    if path.exists():
        print(f"월간 성적표 {ym} 이미 있음")
    else:
        title, desc, body = build(ym)
        made = pd.Timestamp.now(tz=KST).strftime("%Y년 %m월 %d일 자동 작성 (한국 시간)")
        path.write_text(pages.wrap(f"monthly/{path.name}", title, desc, body, made), encoding="utf-8", newline="\n")
        print(f"월간 성적표 {ym} 생성")
    write_index()
    pages.write_sitemap()


if __name__ == "__main__":
    main()
