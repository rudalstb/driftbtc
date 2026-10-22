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
  ["av-avg-unit", "av-entry-unit", "av-target-unit", "av-loss-unit", "av-cand-unit"].forEach((id) => { if ($(id)) $(id).textContent = krw() ? "(₩)" : "($)"; });
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
  if (!p2) { el.innerHTML = `<span class="muted">가격을 불러오는 중…</span>`; return; }
  if (!p1 || !q1) {
    const liqOf0 = (avg) => (long ? avg * (1 - 1 / lev + MMR) : avg * (1 + 1 / lev - MMR));
    el.innerHTML = `<div class="muted small">① <b>지금 평단</b>과 <b>보유 수량</b>을 넣으면 물탄 뒤 평단·청산가·추천이 채워져요. 지금은 후보 가격과 닿을 확률만 보여드려요.</div>` +
      renderWhereToAdd({ long, p1: 0, q1: 0, q2: 0, lev, mark: p2, liqOf: liqOf0, dist: () => 0 });
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

  // 허용 손실이 있으면: 물 탄 뒤 손절가를 어디 둬야 그 안인가
  const loss = avgUsdIn("av-loss");
  if (loss > 0) {
    const qtyNow = q2 > 0 ? q1 + q2 : q1;
    const avgNow = q2 > 0 ? (p1 * q1 + p2 * q2) / qtyNow : p1;
    const stop = long ? avgNow - loss / qtyNow : avgNow + loss / qtyNow;
    const liqNow = liqOf(avgNow);
    const beyond = long ? stop <= liqNow : stop >= liqNow;
    const fromMark = (stop / mark - 1) * 100;
    html += `<div class="rk-line">허용 손실 ${money(loss)} 안에 있으려면 ${q2 > 0 ? "물 탄 뒤" : "지금"} 손절가는 <b class="${beyond ? "neg" : ""}">${usd(stop)}</b> <span class="muted">(현재가에서 ${pct(fromMark, 2)})</span>` +
      (beyond ? ` <span class="neg">— 청산가(${usd(liqNow)}) 너머라 손절 전에 청산돼요. 레버리지를 낮추거나 허용 손실을 키워야 해요.</span>` : "") + `</div>`;
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
  // ───── 어디서 물탈까? 후보 가격 × 닿을 확률 × 물탄 뒤 상태 → 규칙으로 추천
  html += renderWhereToAdd({ long, p1, q1, q2: q2 > 0 ? q2 : q1, lev, mark, liqOf, dist });
  el.innerHTML = html;
}

function renderWhereToAdd(o) {
  const sel = $("av-period");
  const key = sel?.value || "1h:24";
  const [fq, k] = key.split(":");
  const f = typeof report !== "undefined" ? report?.forecasts?.[fq] : null;
  const fut = f?.future?.[Number(k) - 1];
  if (!f || !fut || typeof calcSigma !== "function") return "";
  const label = sel.options[sel.selectedIndex].text;
  const sigma = calcSigma(key);
  const { long, p1, q1, q2, lev, mark, liqOf, dist } = o;
  const scale = (v) => mark * (v / f.price); // 예측은 생성 시점 가격 기준이라 현재가에 맞춰 비율로 옮긴다
  // 20일 최저/최고: 1일 예측의 최근 기록(실제 종가)에서
  const hist = (typeof report !== "undefined" ? report?.forecasts?.["1d"]?.history : null) || [];
  const last20 = hist.slice(-20).map((x) => x.actual);
  const cands = long
    ? [["얕게 · 68% 하단", scale(fut.lo68)], ["중간 · 95% 하단", scale(fut.lo95)], last20.length >= 10 ? ["깊게 · 20일 최저", Math.min(...last20)] : null]
    : [["얕게 · 68% 상단", scale(fut.hi68)], ["중간 · 95% 상단", scale(fut.hi95)], last20.length >= 10 ? ["깊게 · 20일 최고", Math.max(...last20)] : null];
  const custom = avgUsdIn("av-cand");
  if (custom > 0) cands.push(["직접 입력", custom]);
  const rows = cands.filter(Boolean).map(([name, px]) => {
    const okDir = long ? px < mark : px > mark;
    const z = Math.abs(Math.log(px / mark)) / sigma;
    const touch = okDir ? Math.min(1, 2 * (1 - normCdf(z))) : 1;
    const qty = q1 + q2, avg = qty ? (p1 * q1 + px * q2) / qty : px;
    const liq = liqOf(avg);
    const liqDist = Math.abs(liq / px - 1) * 100; // 물탄 가격에서 청산가까지
    const band95 = Math.abs(Math.log((long ? fut.lo95 : fut.hi95) / f.price)) * 100; // 95% 범위 폭(%)
    const safe = liqDist >= band95; // 물탄 가격에서 청산가까지가 그 기간 95% 범위 폭보다 멀어야 안전
    const be = long ? (avg / px - 1) * 100 : (1 - avg / px) * 100; // 물탄 가격에서 본전까지
    return { name, px, okDir, touch, avg, liq, liqDist, safe, be, margin: (avg * (qty || 1)) / lev };
  });
  const noPos = !q1;
  const fs = window.filterState;
  const eligible = noPos ? [] : rows.filter((r) => r.okDir && r.touch >= 0.3 && r.safe);
  // 조건을 만족하는 것 중 가장 깊은(현재가에서 먼) 가격
  const pick = eligible.sort((a, b) => Math.abs(b.px - mark) - Math.abs(a.px - mark))[0];
  const tr = (r) => `<tr class="${pick && r === pick ? "pick" : ""}"><td>${r.name}${pick && r === pick ? " ⭐" : ""}</td><td><b>${usd(r.px)}</b><div class="muted small">${pct((r.px / mark - 1) * 100, 2)}</div></td><td>${r.okDir ? `<b class="${r.touch >= 0.5 ? "pos" : r.touch >= 0.3 ? "warn" : "neg"}">${Math.round(r.touch * 100)}%</b>` : `<span class="muted">이미 지남</span>`}</td>` +
    (noPos ? `<td class="muted small" colspan="2">평단·수량을 넣으면 계산돼요</td>` : `<td>${usd(r.avg)}<div class="muted small">본전 ${pct(r.be, 2)}</div></td><td class="${r.safe ? "" : "neg"}">${usd(r.liq)}<div class="muted small">${r.liqDist.toFixed(1)}% 아래${r.safe ? "" : " · 위험"}</div></td>`) + `</tr>`;
  let verdict;
  if (noPos) verdict = `<li class="ana-info">위 입력칸에 <b>지금 평단</b>과 <b>보유 수량</b>을 넣으면 "어디서 타는 게 가장 나은지" ⭐로 골라드려요.</li>`;
  else if (fs?.level === "red") verdict = `<li class="ana-bad">🔴 지금은 쉬는 구간이라 <b>물타기 자체를 권하지 않아요.</b> 범위가 넓어지는 구간엔 어디서 타도 다시 밀릴 수 있어요.</li>`;
  else if (pick) verdict = `<li class="ana-good"><b>${label} 안이라면 ${usd(pick.px)}(${pick.name}) 근처가 가장 나아요.</b> 닿을 확률 ${Math.round(pick.touch * 100)}%, 물탄 뒤 평단 ${usd(pick.avg)}, 청산가 ${usd(pick.liq)}는 ${label} 95% 범위 밖이라 평소 출렁임엔 버텨요. 그 전에 손절가(허용 손실)부터 정해 두세요.</li>`;
  else verdict = `<li class="ana-bad"><b>조건을 만족하는 물타기 가격이 없어요.</b> 닿을 확률 30% 이상이면서 청산가가 안전한 후보가 없다는 뜻이에요 — 지금은 물타기보다 <b>손절이 싸요</b>. 레버리지를 낮추면 후보가 생길 수 있어요.</li>`;
  // 분할: 추천 가격까지 3번 나눠 타면
  let split = "";
  if (pick) {
    const steps = [1 / 3, 2 / 3, 1].map((w) => mark + (pick.px - mark) * w);
    const each = q2 / 3;
    const qty = q1 + q2, avg3 = (p1 * q1 + steps.reduce((s, px) => s + px * each, 0)) / qty;
    split = `<div class="rk-line">3번에 나눠 타면 (${steps.map((px) => usd(px)).join(" → ")}, 각 ${each.toFixed(4)}개) 평단 <b>${usd(avg3)}</b> · 한 번에 ${usd(pick.px)}에서 타면 ${usd(pick.avg)}. 나눠 타면 평단은 조금 높지만 <b>다 안 내려와도 일부는 탈 수 있어요.</b></div>`;
  }
  return `<div class="label game-sub">🪣 어디서 물탈까? <span class="muted">· ${label} 기준 · 추가 ${q2.toFixed(4)}개 · 현재가 ${usd(mark)}</span></div>
    <div class="table-wrap"><table class="compact where"><thead><tr><th>후보</th><th>가격</th><th>${label} 안에 닿을 확률</th><th>물탄 뒤 평단</th><th>물탄 뒤 청산가</th></tr></thead><tbody>${rows.map(tr).join("")}</tbody></table></div>
    <ul class="ana-diag rk-warn">${verdict}</ul>${split}
    <div class="muted small">추천 규칙: 닿을 확률 30% 이상 + 물탄 뒤 청산가가 그 기간 95% 범위 밖인 후보 중 가장 깊은 가격. 확률은 변동성 기준 근사치이고, 큰 뉴스가 있으면 더 크게 움직여요.</div>`;
}

// 입력 연결
["av-avg", "av-qty", "av-lev", "av-add", "av-target", "av-loss", "av-cand"].forEach((id) => $(id)?.addEventListener("input", () => renderAvg()));
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
$("av-period")?.addEventListener("change", () => renderAvg());
