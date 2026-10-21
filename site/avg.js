// 🧮 물타기 계산기: 지금 평단·수량·레버리지에서 "여기서 이만큼 더 타면" 평단·청산가·증거금·본전 거리가 어떻게 되는지.
// 반대로 "평단을 X까지 내리려면 얼마나 더 타야 하나"도 계산한다. app.js 의 $, usd, money, krw, FX, live 와 risk.js 의 MMR, toUsd, fmtIn 을 쓴다.

let avgEntryUsd = null; // 추가 진입가 (비우면 실시간 BTC)
let avgTouched = { entry: false };
const avgNum = (id) => Number($(id).value) || 0;
const avgUsdIn = (id) => toUsd(avgNum(id));

function avgSide() { return document.querySelector("#av-side button[aria-pressed='true']")?.dataset.side || "long"; }

function syncAvgInputs() {
  if (!avgTouched.entry) $("av-entry").value = live != null ? fmtIn(live) : "";
  else if (avgEntryUsd != null) $("av-entry").value = fmtIn(avgEntryUsd);
  ["av-avg-unit", "av-entry-unit", "av-target-unit"].forEach((id) => { if ($(id)) $(id).textContent = krw() ? "(₩)" : "($)"; });
}

function renderAvg(sync = false) {
  const el = $("av-result");
  if (!el) return;
  if (sync) syncAvgInputs();
  const long = avgSide() === "long";
  const p1 = avgUsdIn("av-avg"), q1 = avgNum("av-qty"), lev = avgNum("av-lev") || 1;
  const p2 = avgTouched.entry ? avgEntryUsd : live;
  const q2 = avgNum("av-add");
  const tgt = avgUsdIn("av-target");
  if (!p1 || !q1 || !p2) {
    el.innerHTML = `<span class="muted">지금 평단과 보유 수량을 넣으면, 추가로 탔을 때 평단이 어디로 가는지 계산해요.</span>`;
    return;
  }
  const liqOf = (avg) => (long ? avg * (1 - 1 / lev + MMR) : avg * (1 + 1 / lev - MMR));
  const pnlAt = (avg, qty, px) => (long ? (px - avg) * qty : (avg - px) * qty);
  const mark = live ?? p2;
  const before = { avg: p1, qty: q1, notional: p1 * q1, margin: (p1 * q1) / lev, liq: liqOf(p1), pnl: pnlAt(p1, q1, mark) };
  const tile = (k, v, sub = "") => `<div class="rk-tile"><div class="label">${k}</div><div class="rk-val">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;
  const dist = (avg) => (long ? (avg / mark - 1) * 100 : (1 - avg / mark) * 100); // 본전까지 현재가에서 움직여야 하는 %
  const liqDist = (liq) => Math.abs(liq / mark - 1) * 100;
  let html = "";

  if (q2 > 0) {
    const qty = q1 + q2, avg = (p1 * q1 + p2 * q2) / qty;
    const after = { avg, qty, notional: avg * qty, margin: (avg * qty) / lev, liq: liqOf(avg), pnl: pnlAt(avg, qty, mark) };
    const addMargin = (p2 * q2) / lev;
    const avgChg = (avg / p1 - 1) * 100;
    html += `<div class="rk-tiles paper-tiles">` +
      tile("새 평단", `<b>${usd(avg)}</b>`, `${usd(p1)} → <span class="${(long ? avgChg < 0 : avgChg > 0) ? "pos" : "neg"}">${pct(avgChg, 2)}</span>`) +
      tile("총 수량 · 명목", `<b>${qty < 0.01 ? qty.toFixed(4) : qty.toFixed(3)}</b> <span class="muted">개</span>`, `명목 ${money(after.notional)}`) +
      tile("추가 증거금", `<b>${money(addMargin)}</b>`, `합계 ${money(after.margin)} · ${lev}배`) +
      tile("새 청산가 (대략)", `<b class="${liqDist(after.liq) < 5 ? "neg" : ""}">${usd(after.liq)}</b>`, `${usd(before.liq)} → 현재가에서 ${liqDist(after.liq).toFixed(1)}%`) +
      tile("본전까지", `<b class="${dist(avg) <= 0 ? "pos" : "warn"}">${dist(avg) <= 0 ? "이미 본전 위" : pct(dist(avg), 2)}</b>`, `지금 평단 기준 ${dist(p1) <= 0 ? "본전 위" : pct(dist(p1), 2)}`) +
      `</div>` +
      `<div class="rk-line">현재가 ${usd(mark)} 기준 미실현 손익: 지금 ${signed(before.pnl)} → 추가 후 ${signed(after.pnl)} <span class="muted">(평단만 내려갈 뿐 손실 금액은 그대로예요)</span></div>`;
    const warn = [];
    if (liqDist(after.liq) < 3) warn.push({ lv: "bad", text: `새 청산가가 현재가에서 <b>${liqDist(after.liq).toFixed(1)}%</b>밖에 안 떨어져 있어요. 평소 하루 변동폭 안이라 한 번 출렁이면 전부 잃어요.` });
    else if (liqDist(after.liq) < liqDist(before.liq)) warn.push({ lv: "warn", text: `물을 타면 청산가가 현재가 쪽으로 <b>${(liqDist(before.liq) - liqDist(after.liq)).toFixed(1)}%p</b> 가까워져요 (교차 마진이면 계좌 전체가 증거금이라 다름).` });
    if (after.margin > before.margin * 2) warn.push({ lv: "warn", text: `증거금이 ${money(before.margin)} → ${money(after.margin)}, <b>${(after.margin / before.margin).toFixed(1)}배</b>로 늘어요. 같은 % 움직임에 잃는 금액도 그만큼 커집니다.` });
    const fs = window.filterState;
    if (fs?.level === "red") warn.push({ lv: "bad", text: `지금은 🔴 쉬는 구간이에요. 물타기는 "방향이 맞다"는 확신이 있을 때만 — 쉬는 구간엔 확신 자체가 성립하지 않아요.` });
    warn.push({ lv: "info", text: `물타기는 평단을 내릴 뿐 손실을 줄이지 않아요. 본전 거리가 ${pct(Math.max(0, dist(avg)), 2)}로 줄어드는 대신, 틀렸을 때 잃는 돈은 ${(after.notional / before.notional).toFixed(1)}배가 됩니다.` });
    html += `<ul class="ana-diag rk-warn">${warn.map((w) => `<li class="ana-${w.lv}">${w.text}</li>`).join("")}</ul>`;
  } else {
    html += `<div class="rk-tiles paper-tiles">` +
      tile("지금 평단", `<b>${usd(p1)}</b>`, `${q1}개 · 명목 ${money(before.notional)}`) +
      tile("증거금", `<b>${money(before.margin)}</b>`, `${lev}배`) +
      tile("청산가 (대략)", `<b>${usd(before.liq)}</b>`, `현재가에서 ${liqDist(before.liq).toFixed(1)}%`) +
      tile("본전까지", `<b class="${dist(p1) <= 0 ? "pos" : "warn"}">${dist(p1) <= 0 ? "이미 본전 위" : pct(dist(p1), 2)}</b>`, `현재가 ${usd(mark)}`) +
      tile("미실현 손익", signed(before.pnl), "현재가 기준") +
      `</div><div class="muted small">추가 수량을 넣으면 새 평단·청산가를 계산해요.</div>`;
  }

  // 거꾸로: 목표 평단까지 내리려면
  if (tgt > 0) {
    const ok = long ? tgt < p1 && tgt > p2 : tgt > p1 && tgt < p2;
    if (!ok) html += `<div class="rk-line warn">목표 평단은 추가 진입가(${usd(p2)})와 지금 평단(${usd(p1)}) 사이여야 해요.</div>`;
    else {
      const need = (q1 * (p1 - tgt)) / (tgt - p2);
      const needMargin = (need * p2) / lev;
      html += `<div class="rk-line">평단을 <b>${usd(tgt)}</b>까지 ${long ? "내리려면" : "올리려면"} ${usd(p2)}에서 <b>${need < 0.01 ? need.toFixed(4) : need.toFixed(3)}개</b> 더 타야 해요 · 추가 증거금 ${money(needMargin)} · 그때 청산가 ${usd(liqOf(tgt))}</div>`;
    }
  }
  el.innerHTML = html;
}

// 입력 연결
["av-avg", "av-qty", "av-lev", "av-add", "av-target"].forEach((id) => $(id)?.addEventListener("input", () => renderAvg()));
$("av-entry")?.addEventListener("input", (e) => { avgTouched.entry = true; avgEntryUsd = toUsd(Number(e.target.value)) || null; renderAvg(); });
document.querySelectorAll("#av-side button").forEach((b) =>
  b.addEventListener("click", () => { document.querySelectorAll("#av-side button").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderAvg(); })
);
document.querySelectorAll(".av-quick button").forEach((b) =>
  b.addEventListener("click", () => { const q = avgNum("av-qty"); if (q) { $("av-add").value = +(q * Number(b.dataset.x)).toFixed(4); renderAvg(); } })
);
window.renderAvg = renderAvg;
setInterval(() => { if (!avgTouched.entry && $("av-result")) renderAvg(true); }, 10000);
setTimeout(() => renderAvg(true), 1600);
