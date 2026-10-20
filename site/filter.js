// 🚦 상황 필터: "지금 들어가도 될까?" 신호등.
// 서버(regime.py)가 준 변동성 백분위·이벤트 창 + 브라우저가 받은 바이낸스 선물 지표(펀딩·롱숏 비율·미결제약정)
// 를 합쳐 🟢 들어가도 됨 / 🟡 수량 절반 / 🔴 쉬는 구간 으로 판정한다.
// 판정 결과는 window.filterState 에 두고, 롱/숏 게임·리스크 계산기·가상 계좌가 함께 쓴다.

const FUNDING_HI = 0.05;  // 8시간 펀딩 % — 이 위면 롱 과밀
const FUNDING_LO = -0.02; // 이 아래면 숏 과밀
const LS_HI = 65, LS_LO = 35; // 전체 계정 롱 비율 %
const OI_JUMP = 10;       // 미결제약정 24시간 변화 %

window.filterState = null;

const hoursUntil = (t) => (new Date(t).getTime() - Date.now()) / 3600e3;
const kstClock = (t) => {
  const d = new Date(new Date(t).getTime() + 9 * 3600e3);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

function judge() {
  const rg = report?.regime;
  const reasons = []; // { lv: "bad"|"warn"|"info"|"good", text }
  let blockLong = false, blockShort = false, halve = false, red = false;

  // 1) 변동성 극단
  if (rg?.vol_24h_pct != null) {
    if (rg.vol_off) {
      red = true;
      reasons.push({ lv: "bad", text: `24시간 변동성 <b>${rg.vol_24h_pct.toFixed(2)}%</b> — 지난 1년 중 상위 10% (기준 ${rg.vol_hi_pct.toFixed(2)}%). 손절이 꼬리에 털리고 청산 확률이 치솟는 구간이에요.` });
    } else if (rg.vol_rank >= 75) {
      halve = true;
      reasons.push({ lv: "warn", text: `24시간 변동성 ${rg.vol_24h_pct.toFixed(2)}%, 1년 백분위 ${Math.round(rg.vol_rank)} — 높은 편이에요. 손절 거리를 평소보다 넓히고 수량은 줄이세요.` });
    } else {
      reasons.push({ lv: "good", text: `24시간 변동성 ${rg.vol_24h_pct.toFixed(2)}% (1년 백분위 ${Math.round(rg.vol_rank)}) — 보통 수준이에요.` });
    }
  }

  // 2) 이벤트 창 (12시간 전 ~ 2시간 후)
  const ev = rg?.event;
  const next = rg?.upcoming?.[0];
  if (ev) {
    red = true;
    const h = hoursUntil(ev.t);
    reasons.push({ lv: "bad", text: `<b>${ev.name}</b> ${h > 0 ? `${Math.ceil(h)}시간 뒤 발표` : "방금 발표"} (${kstClock(ev.t)} KST). 발표 12시간 전부터 2시간 후까지는 방향이 뉴스 한 줄로 뒤집혀요.` });
  } else if (next && hoursUntil(next.t) <= 36) {
    reasons.push({ lv: "info", text: `${Math.ceil(hoursUntil(next.t))}시간 뒤 <b>${next.name}</b> (${kstClock(next.t)} KST). 12시간 전부터 쉬는 구간으로 바뀌어요.` });
  }

  // 3) 펀딩·롱숏 비율·미결제약정 (브라우저가 바이낸스에서 직접 받음)
  const f = typeof lastFutures !== "undefined" ? lastFutures : null;
  if (f) {
    const fr = Number(f.prem.lastFundingRate) * 100;
    const longP = Number(f.lsr.longAccount) * 100;
    const first = f.oiHist[0], last = f.oiHist[f.oiHist.length - 1];
    const oiChg = (Number(last.sumOpenInterest) / Number(first.sumOpenInterest) - 1) * 100;
    if (fr > FUNDING_HI) { blockLong = true; reasons.push({ lv: "warn", text: `펀딩비 <b>+${fr.toFixed(3)}%</b> — 롱이 숏에게 비싸게 내는 중. 군중이 롱에 몰렸어요 → <b>롱 신호 끔</b> (군중 반대편 경고).` }); }
    else if (fr < FUNDING_LO) { blockShort = true; reasons.push({ lv: "warn", text: `펀딩비 <b>${fr.toFixed(3)}%</b> — 숏이 롱에게 내는 중. 군중이 숏에 몰렸어요 → <b>숏 신호 끔</b> (숏 스퀴즈 주의).` }); }
    if (longP > LS_HI) { blockLong = true; reasons.push({ lv: "warn", text: `전체 계정 롱 비율 <b>${longP.toFixed(0)}%</b> — 롱 쏠림. 하락 시 연쇄 청산이 나오기 쉬워요 → <b>롱 신호 끔</b>.` }); }
    else if (longP < LS_LO) { blockShort = true; reasons.push({ lv: "warn", text: `전체 계정 롱 비율 <b>${longP.toFixed(0)}%</b> — 숏 쏠림. 상승 시 숏 스퀴즈가 나오기 쉬워요 → <b>숏 신호 끔</b>.` }); }
    if (Math.abs(oiChg) >= OI_JUMP) { halve = true; reasons.push({ lv: "warn", text: `미결제약정이 24시간에 <b>${pct(oiChg, 1)}</b> — 큰 돈이 움직이는 중이에요. 급변 주의, 수량 절반.` }); }
    if (!blockLong && !blockShort && Math.abs(oiChg) < OI_JUMP) reasons.push({ lv: "good", text: `펀딩 ${fr >= 0 ? "+" : ""}${fr.toFixed(3)}% · 롱 비율 ${longP.toFixed(0)}% · 미결제약정 24시간 ${pct(oiChg, 1)} — 쏠림 없음.` });
  }

  const cur = report?.signals?.[freq]?.current?.signal || null;

  const level = red ? "red" : (halve || blockLong || blockShort) ? "yellow" : "green";
  // 지금 관점에 적용하면?
  let verdict = null;
  if (cur) {
    const long = cur === "long";
    if (red) verdict = { act: "관망", why: "쉬는 구간" };
    else if ((long && blockLong) || (!long && blockShort)) verdict = { act: "관망", why: `${long ? "롱" : "숏"} 쏠림이라 ${long ? "롱" : "숏"} 신호 끔` };
    else if (level === "yellow") verdict = { act: "수량 절반", why: "주의 구간" };
    else verdict = { act: "관점대로", why: "걸리는 조건 없음" };
  }
  return { level, reasons, blockLong, blockShort, halve, verdict, signal: cur, at: Date.now() };
}

function renderFilter() {
  const box = $("filter-box");
  if (!box || !report) return;
  const st = judge();
  window.filterState = st;
  const head = { red: ["🔴", "쉬는 구간", "지금은 들어가지 마세요"], yellow: ["🟡", "주의 구간", "들어가려면 수량 절반, 손절은 더 넓게"], green: ["🟢", "들어가도 되는 구간", "걸리는 조건이 없어요"] }[st.level];
  const rg = report.regime;
  const v = st.verdict;
  const sigLine = v
    ? `<div class="rk-line">지금 ${UNIT[freq]} 관점 ${sideTag(st.signal)} → 필터 적용 시 <b class="${v.act === "관점대로" ? "pos" : v.act === "관망" ? "neg" : "warn"}">${v.act}</b> <span class="muted">(${v.why})</span></div>`
    : "";
  const share = rg?.off_share_30d != null ? ` · 최근 30일 중 쉬는 시간 ${Math.round(rg.off_share_30d)}%` : "";
  const upcoming = rg?.upcoming?.length
    ? `<div class="muted small">다음 발표: ${rg.upcoming.map((e) => `${e.name} ${kstClock(e.t)}`).join(" · ")} (KST)${share}</div>`
    : "";
  box.innerHTML =
    `<div class="fl-head fl-${st.level}"><span class="fl-light">${head[0]}</span><div><b>${head[1]}</b><div class="muted small">${head[2]}</div></div></div>` +
    sigLine +
    `<details class="more" ${st.level !== "green" ? "open" : ""}><summary>이유 ${st.reasons.length}가지 · 다음 발표 보기</summary>` +
    `<ul class="ana-diag">${st.reasons.map((r) => `<li class="ana-${r.lv}">${r.text}</li>`).join("")}</ul>` +
    upcoming + `</details>`;
  $("filter").hidden = false;

  const sf = $("sig-filter");
  if (sf) sf.innerHTML = v ? `🚦 필터 적용 시 <b class="${v.act === "관점대로" ? "pos" : v.act === "관망" ? "neg" : "warn"}">${v.act}</b> <span class="muted">· ${v.why}</span>` : "";
  window.renderRisk?.();
  window.renderBrief?.();
}

window.renderFilter = renderFilter;
setInterval(() => { if (report) renderFilter(); }, 60000); // 이벤트 카운트다운·시간대 갱신
