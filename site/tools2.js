// 🧮 계산기 3종: 손익 계산기 · 승률/손익비 → 기대값·켈리 · 김프 차익.
// app.js 의 $, usd, money, krw, FX, live, upbit, pct, signed, lastFutures 와 risk.js 의 MMR, toUsd, fmtIn 을 쓴다.

const num0 = (id) => Number($(id)?.value) || 0;
const side0 = (grp) => document.querySelector(`#${grp} button[aria-pressed='true']`)?.dataset.side || "long";
const bindSide = (grp, fn) => document.querySelectorAll(`#${grp} button`).forEach((b) => b.addEventListener("click", () => { document.querySelectorAll(`#${grp} button`).forEach((x) => x.setAttribute("aria-pressed", x === b)); fn(); }));
const tile2 = (k, v, sub = "") => `<div class="rk-tile"><div class="label">${k}</div><div class="rk-val">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;
const fundingNow = () => (typeof lastFutures !== "undefined" && lastFutures?.prem?.lastFundingRate != null ? Number(lastFutures.prem.lastFundingRate) * 100 : 0.01); // 8시간 % (없으면 0.01%)

/* ───────── 1) 손익 계산기 ───────── */
let plEntryUsd = null, plExitUsd = null, plTouched = { entry: false, exit: false }, plLast = "exit"; // 마지막에 고친 쪽: exit | roe

function plSync() {
  if (!plTouched.entry) $("pl-entry").value = live != null ? fmtIn(live) : "";
  else if (plEntryUsd != null) $("pl-entry").value = fmtIn(plEntryUsd);
  if (plTouched.exit && plExitUsd != null) $("pl-exit").value = fmtIn(plExitUsd);
  ["pl-entry-unit", "pl-exit-unit", "pl-wallet-unit"].forEach((id) => { if ($(id)) $(id).textContent = krw() ? "(₩)" : "($)"; });
}

function renderPnl(sync = false) {
  const el = $("pl-result");
  if (!el) return;
  if (sync) plSync();
  const long = side0("pl-side") === "long";
  const entry = plTouched.entry ? plEntryUsd : live;
  const qty = num0("pl-qty"), lev = num0("pl-lev") || 1, hours = num0("pl-hours"), feePct = num0("pl-fee");
  if (!entry || !qty) { el.innerHTML = `<span class="muted">진입가·수량을 넣고, 청산가 또는 목표 수익률(ROE) 중 하나를 넣어 보세요.</span>`; return; }
  const notional = entry * qty, margin = notional / lev;
  const fundRate = fundingNow() / 100;
  const fundPeriods = Math.floor(hours / 8);
  // 목표 ROE 를 넣었으면 그에 맞는 청산가를 거꾸로 계산 (수수료·펀딩 포함해 실수령 기준)
  let exit = plTouched.exit ? plExitUsd : null;
  const roeIn = num0("pl-roe");
  const fees2 = (ex) => (notional + ex * qty) * (feePct / 100); // 진입+청산 수수료
  const funding = (long ? 1 : -1) * notional * fundRate * fundPeriods; // 롱이 내고(양수 비용) 숏이 받음
  if (plLast === "roe" && roeIn) {
    // 실수령 = 가격손익 − 수수료 − 펀딩 = ROE × 증거금 → 가격에 대해 풀기
    const target = (roeIn / 100) * margin + funding;
    const k = feePct / 100;
    exit = long ? (target + notional * (1 + k)) / (qty * (1 - k)) : (notional * (1 - k) - target) / (qty * (1 + k));
    plExitUsd = exit; $("pl-exit").value = fmtIn(exit);
  }
  if (!exit) { el.innerHTML = `<span class="muted">청산가 또는 목표 수익률(ROE)을 넣어 보세요.</span>`; return; }
  const gross = long ? (exit - entry) * qty : (entry - exit) * qty;
  const fee = fees2(exit);
  const net = gross - fee - funding;
  const roe = (net / margin) * 100;
  const move = (exit / entry - 1) * 100;
  const mode = marginMode("pl-mode");
  const liq = liqPrice({ long, entry, qty, lev, mode, wallet: toUsd(num0("pl-wallet")) });
  if (plLast !== "roe") $("pl-roe").value = Math.round(roe * 10) / 10;
  const hidden = gross ? ((fee + funding) / Math.abs(gross)) * 100 : 0;
  el.innerHTML =
    `<div class="rk-tiles paper-tiles">` +
    tile2("실수령 손익", `<b>${signed(net)}</b>`, `수수료·펀딩 뺀 뒤 · <span class="${roe >= 0 ? "pos" : "neg"}">ROE ${pct(roe, 1)}</span>`) +
    tile2("가격 손익", signed(gross), `가격 ${pct(move, 2)} × ${lev}배`) +
    tile2("수수료 (왕복)", money(fee), `편도 ${feePct}% · 명목 ${money(notional)}`) +
    tile2("펀딩비", funding >= 0 ? money(funding) : `<span class="pos">${money(-funding)} 받음</span>`, `${fundPeriods}회 × ${fundingNow().toFixed(4)}% (지금 비율)`) +
    tile2("증거금 · 청산가", `<b>${money(margin)}</b>`, liq == null ? "교차: 지갑 잔고를 넣으면 청산가 계산" : `청산가 ${usd(liq)} (${mode === "cross" ? "교차" : "격리"}, 대략)`) +
    `</div>` +
    `<div class="rk-line">${gross > 0 && hidden >= 10 ? `<span class="warn">가격으로는 ${money(gross)} 벌었지만 수수료·펀딩이 <b>${Math.round(hidden)}%</b>를 가져가요.</span>` : gross > 0 ? `수수료·펀딩이 이익의 ${hidden.toFixed(1)}%예요.` : ""}` +
    (liq != null && long && liq >= Math.min(entry, exit) ? ` <span class="neg">목표 청산가에 닿기 전에 청산가(${usd(liq)})를 먼저 지날 수 있어요.</span>` : "") + `</div>`;
}

/* ───────── 2) 승률·손익비 → 기대값·켈리 ───────── */
function renderEdge() {
  const el = $("ed-result");
  if (!el) return;
  const p = num0("ed-win") / 100, b = num0("ed-rr"), risk = toUsd(num0("ed-risk"));
  if (!p || !b) { el.innerHTML = `<span class="muted">승률과 손익비를 넣으면 "이 습관으로 계속하면 장기적으로 버는지"를 계산해요. 매매 진단 탭에 파일을 올렸다면 버튼으로 불러올 수 있어요.</span>`; return; }
  const E = p * b - (1 - p); // 1R 걸 때 기대값 (R)
  const be = 1 / (1 + b); // 손익분기 승률
  const kelly = p - (1 - p) / b;
  const half = Math.max(0, kelly / 2);
  const lose10 = Math.pow(1 - p, 10);
  const over100 = E * 100;
  const verdict = E > 0.15 ? ["pos", "장기적으로 버는 구조예요"] : E > 0 ? ["warn", "겨우 플러스 — 수수료·슬리피지가 조금만 커져도 마이너스"] : ["neg", "이대로 계속하면 잃는 구조예요"];
  el.innerHTML =
    `<div class="rk-tiles paper-tiles">` +
    tile2("거래당 기대값", `<b class="${verdict[0]}">${E >= 0 ? "+" : ""}${E.toFixed(2)}R</b>`, risk ? `1회 ${money(risk)} 걸면 평균 ${signed(E * risk)}` : "R = 1회 손절 금액") +
    tile2("손익분기 승률", `<b>${(be * 100).toFixed(0)}%</b>`, `지금 승률 ${(p * 100).toFixed(0)}% → <span class="${p > be ? "pos" : "neg"}">${p > be ? "여유 " : "부족 "}${Math.abs((p - be) * 100).toFixed(0)}%p</span>`) +
    tile2("적정 베팅 (½켈리)", `<b>${(half * 100).toFixed(1)}%</b>`, kelly > 0 ? `켈리 ${(kelly * 100).toFixed(1)}% · 절반만 쓰는 게 안전` : "기대값이 음수면 베팅 0%") +
    tile2("10연패 확률", `<b>${(lose10 * 100).toFixed(lose10 < 0.01 ? 2 : 1)}%</b>`, `승률 ${(p * 100).toFixed(0)}%면 ${Math.round(1 / Math.max(lose10, 1e-9)).toLocaleString()}번 중 1번`) +
    tile2("100번 거래하면", `<b class="${over100 >= 0 ? "pos" : "neg"}">${over100 >= 0 ? "+" : ""}${over100.toFixed(0)}R</b>`, risk ? signed(over100 * risk) : "수수료 빼기 전") +
    `</div>` +
    `<ul class="ana-diag rk-warn"><li class="ana-${verdict[0] === "pos" ? "good" : verdict[0] === "warn" ? "warn" : "bad"}"><b>${verdict[1]}.</b> 승률 ${(p * 100).toFixed(0)}% × 손익비 ${b.toFixed(2)} → 1R 걸 때 평균 ${E >= 0 ? "+" : ""}${E.toFixed(2)}R. ` +
    (E <= 0 ? `손익비를 <b>${((1 - p) / p).toFixed(2)}</b> 이상으로 올리거나 승률을 <b>${(be * 100).toFixed(0)}%</b> 넘게 올려야 본전이에요.` : `잔고의 ${(half * 100).toFixed(1)}%보다 많이 걸면 기대값이 플러스여도 연패 때 회복이 어려워요.`) + `</li></ul>`;
}

function loadEdgeFromMine() {
  const a = window.myAnalysis;
  if (!a || a.rate == null || a.rr == null) { $("ed-note").textContent = "먼저 '매매 진단' 탭에 거래 내역 파일을 올려 주세요."; return; }
  $("ed-win").value = a.rate; $("ed-rr").value = Math.round(a.rr * 100) / 100;
  if (a.avgLoss) $("ed-risk").value = fmtIn(a.avgLoss);
  $("ed-note").textContent = `매매 진단 결과를 불러왔어요 (${a.n}건 · 승률 ${a.rate}% · 손익비 ${a.rr.toFixed(2)})`;
  renderEdge();
}

/* ───────── 3) 김프 차익 계산기 ───────── */
let kpTouched = false;
function kimpNow() { return upbit && live && FX ? (upbit / (live * FX) - 1) * 100 : null; }

function renderKimp2(sync = false) {
  const el = $("kp-result");
  if (!el) return;
  const now = kimpNow();
  if (sync && !kpTouched && now != null) $("kp-kimp").value = Math.round(now * 100) / 100;
  if ($("kp-now")) $("kp-now").textContent = now != null ? `지금 김프 ${pct(now, 2)} (업비트 ₩${Math.round(upbit).toLocaleString("ko-KR")} · 환율 ₩${FX.toLocaleString("ko-KR", { maximumFractionDigits: 1 })})` : "";
  const amt = num0("kp-amt"), kimp = num0("kp-kimp"), fxCost = num0("kp-fx"), buyFee = num0("kp-buy"), sendFee = num0("kp-send"), sellFee = num0("kp-sell");
  if (!amt) { el.innerHTML = `<span class="muted">투입 원화를 넣으면 환전·수수료·송금비를 뺀 실제 차익을 계산해요.</span>`; return; }
  // 원화 → (환전 비용) → 해외에서 코인 매수(수수료) → 송금(수수료) → 업비트 매도(김프만큼 비싸게, 수수료)
  const afterFx = amt * (1 - fxCost / 100);
  const bought = afterFx * (1 - buyFee / 100);
  const landed = Math.max(0, bought - sendFee);
  const soldKrw = landed * (1 + kimp / 100) * (1 - sellFee / 100);
  const profit = soldKrw - amt;
  const costPct = 100 - ((1 - fxCost / 100) * (1 - buyFee / 100) * (1 - sellFee / 100)) * 100 + (sendFee / amt) * 100;
  const breakEven = costPct / (1 - costPct / 100); // 이 김프 아래면 손해
  el.innerHTML =
    `<div class="rk-tiles paper-tiles">` +
    tile2("실제 차익", `<b class="${profit >= 0 ? "pos" : "neg"}">${profit >= 0 ? "+" : "−"}₩${Math.abs(Math.round(profit)).toLocaleString("ko-KR")}</b>`, `투입 대비 <span class="${profit >= 0 ? "pos" : "neg"}">${pct((profit / amt) * 100, 2)}</span>`) +
    tile2("손익분기 김프", `<b>${breakEven.toFixed(2)}%</b>`, `비용 합계 약 ${costPct.toFixed(2)}%`) +
    tile2("업비트에서 받는 돈", `₩${Math.round(soldKrw).toLocaleString("ko-KR")}`, `김프 ${kimp}% 기준`) +
    tile2("비용 내역", `₩${Math.round(amt * (1 + kimp / 100) - soldKrw).toLocaleString("ko-KR")}`, `환전 ${fxCost}% · 매수 ${buyFee}% · 송금 ₩${sendFee.toLocaleString("ko-KR")} · 매도 ${sellFee}%`) +
    `</div>` +
    `<ul class="ana-diag rk-warn">` +
    `<li class="ana-${profit > 0 ? "warn" : "bad"}">${profit > 0 ? `김프가 송금 도중 <b>${breakEven.toFixed(2)}%</b> 아래로 내려가면 손해로 바뀌어요. 송금·입금 확인에 보통 10분~1시간, 혼잡하면 더 걸립니다.` : `지금 조건으로는 <b>손해</b>예요. 김프가 ${breakEven.toFixed(2)}%를 넘어야 남습니다.`}</li>` +
    `<li class="ana-info">해외 송금은 외국환거래 규정과 은행·거래소 한도(연간 5만 달러 등)의 적용을 받아요. 가상자산 거래소 간 이동은 트래블룰로 100만 원 이상이면 신원 확인이 필요합니다. 계산은 참고용이며 세금·규제는 각자 확인하세요.</li></ul>`;
}

/* ───────── 연결 ───────── */
if ($("pl-result")) {
  bindSide("pl-side", () => renderPnl());
  $("pl-entry").addEventListener("input", (e) => { plTouched.entry = true; plEntryUsd = toUsd(Number(e.target.value)) || null; renderPnl(); });
  $("pl-exit").addEventListener("input", (e) => { plTouched.exit = true; plLast = "exit"; plExitUsd = toUsd(Number(e.target.value)) || null; renderPnl(); });
  $("pl-roe").addEventListener("input", () => { plLast = "roe"; plTouched.exit = true; renderPnl(); });
  ["pl-qty", "pl-lev", "pl-hours", "pl-fee", "pl-wallet"].forEach((id) => $(id).addEventListener("input", () => renderPnl()));
  bindMode("pl-mode", () => renderPnl(), "pl-wallet");
  document.querySelectorAll(".pl-quick button").forEach((b) => b.addEventListener("click", () => { $("pl-roe").value = b.dataset.roe; plLast = "roe"; plTouched.exit = true; renderPnl(); }));
  setInterval(() => { if (!plTouched.entry) renderPnl(true); }, 10000);
  setTimeout(() => renderPnl(true), 1700);
}
if ($("ed-result")) {
  ["ed-win", "ed-rr", "ed-risk"].forEach((id) => $(id).addEventListener("input", renderEdge));
  $("ed-load")?.addEventListener("click", loadEdgeFromMine);
  renderEdge();
}
if ($("kp-result")) {
  ["kp-amt", "kp-fx", "kp-buy", "kp-send", "kp-sell"].forEach((id) => $(id).addEventListener("input", () => renderKimp2()));
  $("kp-kimp").addEventListener("input", () => { kpTouched = true; renderKimp2(); });
  $("kp-reset")?.addEventListener("click", () => { kpTouched = false; renderKimp2(true); });
  setInterval(() => renderKimp2(true), 10000);
  setTimeout(() => renderKimp2(true), 1800);
}
window.renderPnl = renderPnl; window.renderEdge = renderEdge; window.renderKimp2 = renderKimp2;
