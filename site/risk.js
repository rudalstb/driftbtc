// 🛡️ 리스크 계산기: 들어가기 전에 "얼마나 들어갈지"를 정해 준다.
// 계좌 잔고 × 허용 손실 ÷ 손절 거리 = 포지션 크기. 여기에 증거금·청산가 거리·손절에 닿을 확률·
// 매매 분석(analysis.js)에서 나온 나쁜 습관 경고를 붙인다. app.js 뒤에 로드되며 $, usd, money, krw, FX, live, calcSigma, normCdf 를 쓴다.

const MMR = 0.005; // 유지증거금률 근사(비트코인 소액 구간 0.4~0.5%) — 청산가는 거래소마다 조금 다르니 "대략"으로만
let riskBalUsd = null; // 사용자가 직접 넣기 전에는 운영자 총 자산을 기본값으로
let riskEntryUsd = null; // 비워 두면 실시간 BTC 가격
let riskTouched = { bal: false, entry: false };

const rv = (id) => Number($(id).value);
const toUsd = (v) => (krw() ? v / FX : v);
const fmtIn = (v) => (krw() ? Math.round(v * FX) : Math.round(v * 100) / 100);

function riskInputs() {
  return {
    bal: riskBalUsd,
    riskPct: rv("rk-risk"),
    side: document.querySelector("#rk-side button[aria-pressed='true']")?.dataset.side || "long",
    entry: riskEntryUsd ?? live,
    stopPct: rv("rk-stop"),
    lev: rv("rk-lev"),
  };
}

// 통화를 바꾸거나 자산이 들어오면 입력칸 숫자를 다시 쓴다
function syncRiskInputs() {
  if (!riskTouched.bal && typeof lastPosData !== "undefined" && lastPosData?.account?.equity != null) riskBalUsd = lastPosData.account.equity;
  if (riskBalUsd != null) $("rk-bal").value = fmtIn(riskBalUsd);
  if (!riskTouched.entry) $("rk-entry").value = live != null ? fmtIn(live) : "";
  else if (riskEntryUsd != null) $("rk-entry").value = fmtIn(riskEntryUsd);
  $("rk-bal-unit").textContent = $("rk-entry-unit").textContent = krw() ? "(₩)" : "($)";
}

function renderRisk(sync = false) {
  const el = $("rk-result");
  if (!el) return;
  if (sync) syncRiskInputs();
  const i = riskInputs();
  if (!i.bal || !i.entry || !i.stopPct || !i.lev) {
    el.innerHTML = `<span class="muted">계좌 잔고와 손절 거리를 넣으면 들어갈 수량을 계산해요.</span>`;
    return;
  }
  const long = i.side === "long";
  const maxLoss = i.bal * (i.riskPct / 100); // 이번 거래에서 잃어도 되는 돈
  const notional = maxLoss / (i.stopPct / 100); // 포지션 명목 금액
  const qty = notional / i.entry;
  const margin = notional / i.lev;
  const stop = i.entry * (long ? 1 - i.stopPct / 100 : 1 + i.stopPct / 100);
  // 격리 마진 청산가 근사: 증거금을 다 잃는 지점에서 유지증거금만큼 앞
  const liq = long ? i.entry * (1 - 1 / i.lev + MMR) : i.entry * (1 + 1 / i.lev - MMR);
  const liqPct = Math.abs(liq / i.entry - 1) * 100;
  const stopBeyondLiq = long ? stop <= liq : stop >= liq;
  const minLev = Math.ceil(notional / i.bal); // 잔고로 이 포지션을 열려면 필요한 최소 레버리지

  // 24시간 안에 손절가·청산가에 한 번이라도 닿을 확률 (무작위 행보 근사, 반사 원리) — BTC 변동성 기준
  const sigma = typeof calcSigma === "function" ? calcSigma("1h:24") : null;
  const touch = (p) => (sigma ? Math.min(100, 200 * (1 - normCdf(Math.abs(Math.log(p / i.entry)) / sigma))) : null);
  const tStop = touch(stop), tLiq = touch(liq);
  const isBtc = !riskTouched.entry || Math.abs(i.entry / live - 1) < 0.2;

  const tp = (r) => i.entry * (long ? 1 + (i.stopPct * r) / 100 : 1 - (i.stopPct * r) / 100);
  const kv = (k, v, sub = "") => `<div class="rk-tile"><div class="label">${k}</div><div class="rk-val">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;

  let html = `<div class="rk-tiles">` +
    kv("들어갈 수량", `<b>${qty < 0.01 ? qty.toFixed(4) : qty.toFixed(3)}</b> <span class="muted">개</span>`, `명목 ${money(notional)}`) +
    kv("필요 증거금", `<b class="${margin > i.bal ? "neg" : ""}">${money(margin)}</b>`, margin > i.bal ? `잔고 부족 · 최소 ${minLev}배 필요` : `잔고의 ${Math.round((margin / i.bal) * 100)}%`) +
    kv("손절가", `<b class="neg">${usd(stop)}</b>`, `여기서 끊으면 ${money(-maxLoss).replace("-", "−")} (잔고의 ${i.riskPct}%)`) +
    kv("청산가 (대략)", `<b class="${stopBeyondLiq ? "neg" : ""}">${usd(liq)}</b>`, `진입가에서 ${liqPct.toFixed(1)}% · ${i.lev}배 격리 기준`) +
    `</div>`;

  html += `<div class="rk-line"><span class="muted">손익비 1.5 익절</span> <b>${usd(tp(1.5))}</b> <span class="muted">· 손익비 2 익절</span> <b>${usd(tp(2))}</b>` +
    (isBtc && tStop != null ? ` <span class="muted">· 24시간 안에 손절가에 닿을 확률</span> <b class="${tStop >= 60 ? "neg" : tStop >= 35 ? "warn" : "pos"}">${Math.round(tStop)}%</b>` : "") +
    `</div>`;

  // 경고: 손절·청산·확률·매매 분석에서 나온 습관
  const warn = [];
  if (stopBeyondLiq) warn.push({ lv: "bad", text: `손절가(${usd(stop)})가 청산가(${usd(liq)}) 너머에 있어요. <b>손절 전에 강제 청산</b>돼서 증거금 ${money(margin)} 전부를 잃어요. 레버리지를 ${Math.max(1, Math.floor(1 / (i.stopPct / 100 + MMR)))}배 아래로 낮추세요.` });
  else if (liqPct < i.stopPct * 1.5) warn.push({ lv: "warn", text: `청산가가 손절가와 너무 가까워요(${liqPct.toFixed(1)}% 대 ${i.stopPct}%). 급등락 꼬리에 손절이 안 걸리고 청산될 수 있어요.` });
  if (margin > i.bal) warn.push({ lv: "bad", text: `이 수량은 잔고 ${money(i.bal)}로 ${i.lev}배에서 열 수 없어요. 레버리지를 ${minLev}배로 올리거나 손절 거리를 ${(i.stopPct * (margin / i.bal)).toFixed(1)}%로 넓히세요.` });
  if (isBtc && tStop != null && tStop >= 60) warn.push({ lv: "warn", text: `지금 변동성이면 하루 안에 손절가에 닿을 확률이 <b>${Math.round(tStop)}%</b>예요. 손절이 너무 가까워서 방향이 맞아도 털릴 수 있어요.` });
  if (isBtc && tLiq != null && tLiq >= 10) warn.push({ lv: "bad", text: `하루 안에 <b>청산</b>될 확률이 ${Math.round(tLiq)}%예요. 레버리지를 낮추세요.` });
  if (i.riskPct > 2) warn.push({ lv: "warn", text: `한 번에 잔고의 ${i.riskPct}%를 거는 건 커요. ${Math.ceil(50 / i.riskPct)}연패면 잔고 절반이 사라져요. 보통 1~2%를 권해요.` });

  const a = window.lastAnalysis;
  if (a) {
    if (a.avgWin > 0 && maxLoss > a.avgWin * 1.2)
      warn.push({ lv: "warn", text: `이번 손절 금액(${money(maxLoss)})이 지난 90일 평균 이익(${money(a.avgWin)})보다 커요. 지금 손익비 ${a.rr?.toFixed(2)}가 더 나빠져요. 허용 손실을 ${Math.max(0.25, Math.floor(((a.avgWin / i.bal) * 100) * 4) / 4)}% 아래로.` });
    const sideG = a.bySide.find((g) => g.name === (long ? "롱" : "숏"));
    const sideNet = sideG ? sideG.list.reduce((s, t) => s + t.net, 0) : 0;
    if (sideG && sideG.list.length >= 5 && sideNet < 0)
      warn.push({ lv: "warn", text: `지난 90일 <b>${sideG.name}</b> ${sideG.list.length}건 합계가 ${money(sideNet)}예요. 이 방향은 수량을 절반(${(qty / 2).toFixed(3)}개)으로 줄여 보세요.` });
    const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
    const band = a.byHour.find((g) => { const m = g.name.match(/(\d+)~(\d+)시/); return m && h >= Number(m[1]) && h < Number(m[2]); });
    const bandNet = band ? band.list.reduce((s, t) => s + t.net, 0) : 0;
    if (band && band.list.length >= 5 && bandNet < 0)
      warn.push({ lv: "warn", text: `지금은 <b>${band.name}</b>, 지난 90일 이 시간대 진입이 ${money(bandNet)}였어요. 꼭 들어가야 하면 수량을 절반으로.` });
    if (a.maxStreak >= 3) warn.push({ lv: "info", text: `지난 90일 최대 ${a.maxStreak}연패. 오늘 2번 연속 손절했다면 여기서 멈추는 걸 권해요.` });
  }
  if (!warn.length) warn.push({ lv: "good", text: "손절·청산·수량 모두 무리 없는 범위예요. 손절가를 주문에 같이 넣고 들어가세요." });
  html += `<ul class="ana-diag rk-warn">${warn.map((w) => `<li class="ana-${w.lv}">${w.text}</li>`).join("")}</ul>`;
  el.innerHTML = html;
}

// 입력 연결
$("rk-bal").addEventListener("input", (e) => { riskTouched.bal = true; riskBalUsd = toUsd(Number(e.target.value)) || null; renderRisk(); });
$("rk-entry").addEventListener("input", (e) => { riskTouched.entry = true; riskEntryUsd = toUsd(Number(e.target.value)) || null; renderRisk(); });
["rk-risk", "rk-stop", "rk-lev"].forEach((id) => $(id).addEventListener("input", () => renderRisk()));
document.querySelectorAll("#rk-side button").forEach((b) =>
  b.addEventListener("click", () => { document.querySelectorAll("#rk-side button").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderRisk(); })
);
document.querySelectorAll(".rk-quick button").forEach((b) =>
  b.addEventListener("click", () => { $(b.dataset.for).value = b.dataset.v; renderRisk(); })
);

window.renderRisk = renderRisk;
setInterval(() => { if (!riskTouched.entry) renderRisk(true); }, 10000); // 진입가를 비워 뒀으면 실시간 가격 따라감
setTimeout(() => renderRisk(true), 1500);
