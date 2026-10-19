// 🔍 운영자 매매 분석: 90일 청산 기록(data/trades.json + 실시간 최근 기록)으로
// 누적 손익 곡선·최대 낙폭·손익비·요일/시간대·보유 시간·수수료 비중을 계산해 "어디서 돈이 새는지" 보여준다.
// app.js 뒤에 로드되며 그쪽의 $, money, signed, pct, css, mergedTrades 를 그대로 쓴다.

let anaChart = null;
const KST = 9 * 3600 * 1000;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const HOUR_BANDS = [
  { k: "00-04", name: "새벽 0~4시", from: 0, to: 4 },
  { k: "04-08", name: "새벽 4~8시", from: 4, to: 8 },
  { k: "08-12", name: "오전 8~12시", from: 8, to: 12 },
  { k: "12-16", name: "낮 12~16시", from: 12, to: 16 },
  { k: "16-20", name: "저녁 16~20시", from: 16, to: 20 },
  { k: "20-24", name: "밤 20~24시", from: 20, to: 24 },
];
const HOLD_BANDS = [
  { name: "1시간 안", max: 3600e3 },
  { name: "1~4시간", max: 4 * 3600e3 },
  { name: "4~24시간", max: 24 * 3600e3 },
  { name: "1~3일", max: 3 * 86400e3 },
  { name: "3일 넘게", max: Infinity },
];

const kstHour = (ms) => new Date(ms + KST).getUTCHours();
const kstDow = (ms) => new Date(ms + KST).getUTCDay();
const kstDate = (ms) => { const d = new Date(ms + KST); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const sum = (xs, f = (x) => x) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const avg = (xs, f) => (xs.length ? sum(xs, f) / xs.length : 0);
const winRate = (xs) => {
  const w = xs.filter((t) => t.net > 0).length;
  const l = xs.filter((t) => t.net < 0).length;
  return w + l ? Math.round((w / (w + l)) * 100) : null;
};
const hours = (ms) => {
  if (ms < 3600e3) return `${Math.max(1, Math.round(ms / 60e3))}분`;
  if (ms < 86400e3) return `${(ms / 3600e3).toFixed(1)}시간`;
  return `${(ms / 86400e3).toFixed(1)}일`;
};

// 묶음별(요일·시간대·보유 시간·종목·방향) 합계 한 줄: 건수 · 승률 · 순손익 막대
function groupRows(groups, maxAbs) {
  return groups
    .map((g) => {
      if (!g.list.length) return "";
      const net = sum(g.list, (t) => t.net);
      const w = Math.round((Math.abs(net) / maxAbs) * 100);
      const rate = winRate(g.list);
      return `<div class="ana-row">
        <span class="ana-name">${g.name}</span>
        <span class="muted small">${g.list.length}건${rate != null ? ` · <span class="ana-w">승률 </span>${rate}%` : ""}</span>
        <span class="ana-bar"><i class="${net >= 0 ? "up" : "down"}" style="width:${w}%"></i></span>
        <span class="ana-net">${signed(net)}</span></div>`;
    })
    .join("");
}

function groupBy(list, keyOf, defs) {
  return defs.map((d) => ({ name: d.name, list: list.filter((t) => keyOf(t) === d.k) }));
}

function analyze(list) {
  const wins = list.filter((t) => t.net > 0);
  const losses = list.filter((t) => t.net < 0);
  const net = sum(list, (t) => t.net);
  const gross = sum(list, (t) => t.pnl);
  const fees = sum(list, (t) => t.fees);
  const avgWin = avg(wins, (t) => t.net);
  const avgLoss = Math.abs(avg(losses, (t) => t.net));
  const rr = avgLoss ? avgWin / avgLoss : null; // 손익비
  const rate = winRate(list);
  const expect = list.length ? net / list.length : 0; // 거래당 기대값

  // 누적 손익 곡선과 최대 낙폭 (청산 시각 순)
  const asc = [...list].sort((a, b) => a.closed - b.closed);
  let cum = 0, peak = 0, mdd = 0, mddFrom = null, mddTo = null, peakAt = null;
  const curve = asc.map((t) => {
    cum += t.net;
    if (cum > peak) { peak = cum; peakAt = t.closed; }
    const dd = peak - cum;
    if (dd > mdd) { mdd = dd; mddFrom = peakAt; mddTo = t.closed; }
    return { t: t.closed, v: cum };
  });

  // 최대 연속 손실
  let streak = 0, maxStreak = 0;
  for (const t of asc) {
    streak = t.net < 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }

  const worst = losses.length ? losses.reduce((a, t) => (t.net < a.net ? t : a)) : null;
  const best = wins.length ? wins.reduce((a, t) => (t.net > a.net ? t : a)) : null;
  const grossWin = sum(wins, (t) => t.net);
  const feeShare = grossWin ? (fees / grossWin) * 100 : null; // 번 돈 대비 수수료·펀딩 비중

  const holdOf = (t) => t.closed - t.opened;
  const avgHoldWin = avg(wins, holdOf);
  const avgHoldLoss = avg(losses, holdOf);

  const symbols = [...new Set(list.map((t) => t.symbol))].map((s) => ({ name: s.replace("USDT", ""), list: list.filter((t) => t.symbol === s) }))
    .sort((a, b) => sum(b.list, (t) => t.net) - sum(a.list, (t) => t.net));

  return {
    n: list.length, wins: wins.length, losses: losses.length, net, gross, fees, avgWin, avgLoss, rr, rate, expect,
    curve, mdd, mddFrom, mddTo, maxStreak, worst, best, grossWin, feeShare, avgHoldWin, avgHoldLoss,
    byDow: groupBy(list, (t) => kstDow(t.opened), DOW.map((d, i) => ({ k: i, name: d + "요일" }))),
    byHour: groupBy(list, (t) => HOUR_BANDS.find((b) => kstHour(t.opened) >= b.from && kstHour(t.opened) < b.to)?.k, HOUR_BANDS),
    byHold: HOLD_BANDS.map((b, i) => ({ name: b.name, list: list.filter((t) => holdOf(t) < b.max && holdOf(t) >= (HOLD_BANDS[i - 1]?.max ?? 0)) })),
    bySide: [{ name: "롱", list: list.filter((t) => t.side === "long") }, { name: "숏", list: list.filter((t) => t.side === "short") }],
    symbols,
  };
}

// 숫자만 보여주면 안 읽히니, 눈에 띄는 패턴을 한 줄 진단으로 뽑는다 (근거 수치를 같이 적는다)
function diagnose(a) {
  const out = [];
  const worstGroup = (groups, min = 3) => groups.filter((g) => g.list.length >= min).sort((x, y) => sum(x.list, (t) => t.net) - sum(y.list, (t) => t.net))[0];
  const bestGroup = (groups, min = 3) => groups.filter((g) => g.list.length >= min).sort((x, y) => sum(y.list, (t) => t.net) - sum(x.list, (t) => t.net))[0];

  if (a.worst && a.avgWin > 0) {
    const times = Math.abs(a.worst.net) / a.avgWin;
    if (times >= 3)
      out.push({ lv: "bad", text: `가장 큰 손실 1건(${a.worst.symbol.replace("USDT", "")} ${money(a.worst.net)})이 평균 이익의 <b>${times.toFixed(1)}배</b>예요. 이 한 건이 평균 이익 ${Math.round(times)}건치를 지웠어요.` });
  }
  if (a.rr != null) {
    if (a.rr < 1 && a.rate != null && a.rate >= 55)
      out.push({ lv: "warn", text: `승률 ${a.rate}%로 자주 이기지만 <b>평균 손실(${money(a.avgLoss)})이 평균 이익(${money(a.avgWin)})보다 커요</b>. 이익은 빨리 챙기고 손실은 버티는 패턴이에요.` });
    else if (a.rr >= 1.5)
      out.push({ lv: "good", text: `손익비 <b>${a.rr.toFixed(2)}</b>: 이길 때 평균 ${money(a.avgWin)}, 질 때 평균 ${money(a.avgLoss)}. 손실을 작게 끊는 습관이 잡혀 있어요.` });
  }
  if (a.avgHoldLoss > a.avgHoldWin * 2 && a.losses >= 3)
    out.push({ lv: "warn", text: `지는 거래는 평균 <b>${hours(a.avgHoldLoss)}</b>, 이기는 거래는 평균 ${hours(a.avgHoldWin)} 들고 있었어요. 손실 포지션을 ${Math.round(a.avgHoldLoss / a.avgHoldWin)}배 오래 버티고 있어요.` });
  if (a.feeShare != null && a.feeShare >= 15)
    out.push({ lv: "warn", text: `번 돈의 <b>${Math.round(a.feeShare)}%</b>가 수수료·펀딩으로 나갔어요(${money(a.fees)}). 잦은 진입·청산이 수익을 갉아먹고 있어요.` });
  const wh = worstGroup(a.byHour);
  if (wh && sum(wh.list, (t) => t.net) < 0 && a.net > 0 && Math.abs(sum(wh.list, (t) => t.net)) > a.net * 0.3)
    out.push({ lv: "warn", text: `<b>${wh.name}</b> 진입 거래가 ${money(sum(wh.list, (t) => t.net))}로 가장 안 좋아요. 이 시간대만 쉬었다면 순손익이 ${money(a.net - sum(wh.list, (t) => t.net))}였어요.` });
  const bh = bestGroup(a.byHour);
  if (bh && sum(bh.list, (t) => t.net) > 0) out.push({ lv: "good", text: `가장 잘 맞는 시간대는 <b>${bh.name}</b> 진입(${wh && bh.name === wh.name ? "" : money(sum(bh.list, (t) => t.net))}, ${bh.list.length}건, 승률 ${winRate(bh.list)}%)이에요.` });
  const ws = a.bySide.filter((g) => g.list.length >= 3).sort((x, y) => sum(x.list, (t) => t.net) - sum(y.list, (t) => t.net))[0];
  if (ws && sum(ws.list, (t) => t.net) < 0) out.push({ lv: "warn", text: `<b>${ws.name}</b> 거래 ${ws.list.length}건 합계가 ${money(sum(ws.list, (t) => t.net))}예요. 한쪽 방향에서 계속 잃고 있어요.` });
  if (a.maxStreak >= 4) out.push({ lv: "warn", text: `최대 <b>${a.maxStreak}연패</b>가 있었어요. 3연패 뒤에는 하루 쉬는 규칙을 생각해 볼 만해요.` });
  if (!out.length) out.push({ lv: "good", text: "눈에 띄는 나쁜 습관이 없어요. 기록이 더 쌓이면 다시 살펴볼게요." });
  return out;
}

function renderAnalysis() {
  const el = $("mp-analysis");
  if (!el) return;
  const list = mergedTrades().filter((t) => t.closed && t.opened && t.net != null);
  if (list.length < 5) {
    el.innerHTML = `<div class="mp-empty">청산 기록이 5건 넘게 쌓이면 분석을 보여드려요 (지금 ${list.length}건)</div>`;
    return;
  }
  const a = analyze(list);
  const since = new Date(Math.min(...list.map((t) => t.closed)) + KST);
  $("mp-analysis-since").textContent = `· ${since.getUTCMonth() + 1}/${since.getUTCDate()}부터 ${a.n}건`;

  const tile = (k, v, sub = "") => `<div class="ana-tile"><div class="label">${k}</div><div class="ana-val">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;
  const mddPct = window.OPERATOR?.seed ? `시드의 ${Math.round((a.mdd / window.OPERATOR.seed) * 100)}% · ` : "";
  const tiles =
    tile("순손익", signed(a.net), `수수료 전 ${money(a.gross)}`) +
    tile("승률", a.rate != null ? `${a.rate}%` : "—", `<span class="pos">${a.wins}승</span> <span class="neg">${a.losses}패</span>`) +
    tile("손익비", a.rr != null ? `<span class="${a.rr >= 1 ? "pos" : "neg"}">${a.rr.toFixed(2)}</span>` : "—", `이길 때 ${money(a.avgWin)} · 질 때 ${money(a.avgLoss)}`) +
    tile("거래당 기대값", signed(a.expect), "한 번 들어갈 때 평균") +
    tile("최대 낙폭", `<span class="neg">−${money(a.mdd)}</span>`, mddPct + (a.mddFrom ? (kstDate(a.mddFrom) === kstDate(a.mddTo) ? `${kstDate(a.mddTo)} 하루 만에` : `${kstDate(a.mddFrom)} → ${kstDate(a.mddTo)}`) : "")) +
    tile("수수료·펀딩", money(a.fees), a.feeShare != null ? `번 돈의 ${Math.round(a.feeShare)}%` : "") +
    tile("최대 연패", `${a.maxStreak}번`, `가장 큰 손실 ${a.worst ? money(a.worst.net) : "—"}`) +
    tile("보유 시간", `${hours(a.avgHoldWin)} <span class="muted">/</span> ${hours(a.avgHoldLoss)}`, "이길 때 / 질 때 평균");

  const diag = diagnose(a).map((d) => `<li class="ana-${d.lv}">${d.text}</li>`).join("");

  const maxAbs = Math.max(1, ...[...a.byDow, ...a.byHour, ...a.byHold, ...a.bySide, ...a.symbols].map((g) => Math.abs(sum(g.list, (t) => t.net))));
  const block = (title, rows) => `<div class="ana-block"><div class="label">${title}</div>${rows}</div>`;
  const top = a.symbols.slice(0, 3), bottom = a.symbols.slice(-3).reverse();
  const symRows = groupRows(top, maxAbs) + (a.symbols.length > 3 ? `<div class="muted small ana-sep">가장 잃은 종목</div>` + groupRows(bottom.filter((g) => !top.includes(g)), maxAbs) : "");

  el.innerHTML =
    `<ul class="ana-diag">${diag}</ul>` +
    `<div class="ana-tiles">${tiles}</div>` +
    `<div class="label" style="margin-top:14px">누적 순손익 곡선 <span class="muted">· 청산할 때마다 한 점, 빨간 구간이 최대 낙폭</span></div>` +
    `<div class="eq-wrap"><canvas id="ana-chart"></canvas></div>` +
    `<div class="ana-grid">` +
    block("진입 시간대 (한국 시간)", groupRows(a.byHour, maxAbs)) +
    block("진입 요일", groupRows(a.byDow, maxAbs)) +
    block("보유 시간", groupRows(a.byHold, maxAbs)) +
    block("방향 · 종목", groupRows(a.bySide, maxAbs) + `<div class="muted small ana-sep">가장 번 종목</div>` + symRows) +
    `</div>`;

  drawCurve(a);
}

function drawCurve(a) {
  const pts = [{ t: a.curve[0].t - 1, v: 0 }, ...a.curve];
  const inDd = (p) => a.mddFrom != null && p.t >= a.mddFrom && p.t <= a.mddTo;
  const data = {
    labels: pts.map((p) => kstDate(p.t)),
    datasets: [
      { label: "누적 순손익", data: pts.map((p) => p.v), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0, fill: { target: "origin", above: "rgba(63,185,80,0.08)", below: "rgba(248,81,73,0.10)" }, tension: 0.15 },
      { label: "최대 낙폭 구간", data: pts.map((p) => (inDd(p) ? p.v : null)), borderColor: css("--down"), borderWidth: 2.5, pointRadius: 0, spanGaps: false },
    ],
  };
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (i) => (i.raw == null ? null : `${i.dataset.label} ${money(i.raw)}`) } },
    },
    scales: {
      x: { ticks: { color: css("--muted"), maxTicksLimit: 5, maxRotation: 0 }, grid: { display: false } },
      y: { position: "right", ticks: { color: css("--muted"), callback: (v) => money(v) }, grid: { color: css("--border") } },
    },
  };
  if (anaChart) anaChart.destroy();
  anaChart = new Chart($("ana-chart"), { type: "line", data, options: opts });
}

window.renderAnalysis = renderAnalysis;
