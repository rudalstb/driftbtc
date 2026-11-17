// 🏆 이번 주 범위 맞히기 (투표·게임 탭): 이번 주 BTC 종가가 들어올 범위를 고르고, 주가 끝나면 AI 68% 범위와 같은 잣대로 채점한다.
// 서버: api/week.js (익명, 브라우저 번호 해시로만 구분). 점수 = 맞히면 100 × AI 범위 폭 ÷ 내 범위 폭 (최대 300), 빗나가면 0

let weekData = null, weekBusy = false, weekDraft = null;

async function weekApi(body) {
  if (!window.WEEK_URL) return null;
  const vid = typeof sayVid === "function" ? sayVid() : null;
  try {
    const r = body
      ? await fetch(window.WEEK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vid, ...body }) })
      : await fetch(`${window.WEEK_URL}?vid=${encodeURIComponent(vid || "")}&t=${Date.now()}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return { error: j.error || "잠시 뒤 다시 시도해 주세요" };
    return j;
  } catch (e) {
    return { error: "서버에 연결하지 못했어요" };
  }
}

const wkUsd = (v) => "$" + Math.round(v).toLocaleString("en-US");
function wkKst(ms, withTime = true) {
  const d = new Date(ms + 9 * 3600 * 1000);
  const W = "일월화수목금토"[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${W})${withTime ? ` ${d.getUTCHours()}시` : ""}`;
}

async function loadWeek() {
  const j = await weekApi();
  if (j && !j.error) { weekData = j; weekRemember(); }
  renderWeek(j?.error);
}

// 이 브라우저가 참가한 주를 기억 (홈 배너·결과 안내용, 서버로 보내지 않음)
const WK_KEY = "driftbtc_week_joined";
function weekJoined() { try { return JSON.parse(localStorage.getItem(WK_KEY) || "{}"); } catch (e) { return {}; } }
function weekRemember() {
  const n = weekData?.now;
  if (!n?.my) return;
  const j = weekJoined();
  j[n.wk] = { lo: n.my.lo, hi: n.my.hi };
  const keep = Object.keys(j).sort().slice(-8);
  try { localStorage.setItem(WK_KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, j[k]])))); } catch (e) {}
  weekHome();
}

// 홈 '얼마나 움직일까' 카드 아래 한 줄: 서버에 묻지 않고 시계와 이 브라우저 기록만으로 만든다
function weekHome() {
  const el = $("week-home");
  if (!el) return;
  const now = Date.now(), D = 86400000;
  const d = new Date(now), wk = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * D;
  const id = new Date(wk).toISOString().slice(0, 10), lastId = new Date(wk - 7 * D).toISOString().slice(0, 10);
  const joined = weekJoined(), left = wk + 2 * D - now;
  const lastRes = joined[lastId] && now - wk < 3 * D ? ` · <b class="pos">지난주 내 결과가 나왔어요</b>` : "";
  let html = "";
  if (left > 0) html = joined[id] ? `🏆 이번 주 범위 맞히기 <b class="pos">참가 완료 ✓</b> · 결과는 다음 주 월요일 오전 9시${lastRes} →`
    : `🏆 이번 주 범위 맞히기 — AI와 대결 · <b>마감까지 ${Math.floor(left / 3600000)}시간</b>${lastRes} →`;
  else if (joined[id]) html = `🏆 이번 주 내 범위 ${wkUsd(joined[id].lo)} ~ ${wkUsd(joined[id].hi)} · 결과는 월요일 오전 9시 →`;
  el.innerHTML = html;
  el.hidden = !html;
}

// 📸 결과·도전장 이미지: 화면 밖에 작은 카드를 그려 html2canvas 로 찍는다
async function weekShare(btn, kind) {
  const n = weekData?.now, L = weekData?.last;
  const box = document.createElement("div");
  box.className = "wk-shot";
  if (kind === "result" && L?.me) {
    const me = L.me, aiS = L.ai_hit ? 100 : 0;
    const vs = me.score > aiS ? "🎉 AI보다 잘했어요!" : me.score === aiS ? "🤝 AI와 같은 점수" : "🤖 이번 주는 AI 승";
    box.innerHTML = `<div class="wk-shot-t">🏆 비트코인 범위 맞히기 · ${L.wk.slice(5).replace("-", "/")} 주 결과</div>
      <div class="wk-shot-big">${me.rank}위 <span>/ ${L.n}명</span></div>
      <div>내 범위 <b>${wkUsd(me.lo)} ~ ${wkUsd(me.hi)}</b> · ${me.hit ? `<b class="pos">적중 ${me.score}점</b>` : `<b class="neg">빗나감 0점</b>`}</div>
      <div>정답 <b>${wkUsd(L.close)}</b> · 🤖 AI ${L.ai ? `${wkUsd(L.ai.lo)}~${wkUsd(L.ai.hi)} ${aiS}점` : "기록 없음"}</div>
      <div class="wk-shot-vs">${vs}</div>`;
  } else if (n?.my) {
    box.innerHTML = `<div class="wk-shot-t">🏆 비트코인 범위 맞히기 · 이번 주 도전장</div>
      <div class="wk-shot-big">${wkUsd(n.my.lo)} ~ ${wkUsd(n.my.hi)}</div>
      <div>${wkKst(n.close_at)} 비트코인 가격이 이 안에 들어온다고 골랐어요 · 폭 ${(((n.my.hi / n.my.lo) - 1) * 100).toFixed(1)}%</div>
      ${n.ai ? `<div>🤖 AI 범위 ${wkUsd(n.ai.lo)} ~ ${wkUsd(n.ai.hi)} · 맞히면 내 점수 <b>${Math.min(300, Math.round((100 * (n.ai.hi - n.ai.lo)) / (n.my.hi - n.my.lo)))}점</b></div>` : ""}
      <div class="wk-shot-vs">너도 AI랑 겨뤄 볼래? 마감 ${wkKst(n.deadline)}</div>`;
  } else return;
  box.insertAdjacentHTML("beforeend", `<div class="wk-shot-foot">BTC Agent · btc.rudals.app · 로그인 없이 익명 참가 · 투자 권유 아님</div>`);
  document.body.appendChild(box);
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "만드는 중…";
  try {
    await loadHtml2canvas();
    const canvas = await html2canvas(box, { backgroundColor: css("--card"), scale: 2, logging: false });
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const file = new File([blob], `btcagent-week-${Date.now()}.png`, { type: "image/png" });
    const text = "비트코인 범위 맞히기 · AI와 대결 https://btc.rudals.app/#say";
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: "BTC Agent", text });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
    try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=share-week-" + kind); } catch (e) {}
  } catch (e) {
    if (e?.name !== "AbortError") alert("이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    box.remove(); btn.disabled = false; btn.textContent = old;
  }
}

// 입력 초안: 내 제출값 → 없으면 AI 68% 범위 → 없으면 지금 가격 ±3%
function weekInit() {
  const n = weekData?.now;
  if (weekDraft) return;
  const base = (typeof live !== "undefined" && live) || n?.ai?.price;
  if (n?.my) weekDraft = { lo: n.my.lo, hi: n.my.hi };
  else if (n?.ai) weekDraft = { lo: Math.round(n.ai.lo / 100) * 100, hi: Math.round(n.ai.hi / 100) * 100 };
  else if (base) weekDraft = { lo: Math.round((base * 0.97) / 100) * 100, hi: Math.round((base * 1.03) / 100) * 100 };
}

function weekScorePreview(lo, hi) {
  const ai = weekData?.now?.ai;
  if (!ai || !(hi > lo)) return "";
  const s = Math.min(300, Math.round((100 * (ai.hi - ai.lo)) / (hi - lo)));
  return `맞히면 <b>${s}점</b> <span class="muted">(AI 100점 기준 · 폭 ${(((hi / lo) - 1) * 100).toFixed(1)}%)</span>`;
}

function renderWeek(err) {
  const box = $("week-box");
  if (!box) return;
  if (!window.WEEK_URL || weekData?.enabled === false) { box.innerHTML = `<div class="muted small">지금은 게임을 불러올 수 없어요.</div>`; return; }
  if (!weekData) { box.innerHTML = `<div class="muted small">${err || "불러오는 중…"}</div>`; return; }
  const n = weekData.now, L = weekData.last;
  weekInit();
  const d = weekDraft || { lo: 0, hi: 0 };
  const left = n.deadline - Date.now();
  const leftTxt = left > 0 ? `마감까지 ${Math.floor(left / 3600000)}시간 ${Math.floor((left % 3600000) / 60000)}분` : "마감";
  let html = `<div class="wk-head small"><span>📅 ${wkKst(n.start, false)} ~ ${wkKst(n.close_at - 86400000, false)} · 정답: <b>${wkKst(n.close_at)} 가격</b></span><span class="${n.open ? "pos" : "muted"}">${leftTxt} · 참가 ${n.n}명</span></div>`;
  if (n.open) {
    html += `<div class="wk-form">
      <label class="calc-field"><span>아래 가격 ($)</span><input id="wk-lo" type="number" inputmode="decimal" step="100" value="${d.lo || ""}"></label>
      <label class="calc-field"><span>위 가격 ($)</span><input id="wk-hi" type="number" inputmode="decimal" step="100" value="${d.hi || ""}"></label>
    </div>
    <div class="calc-quick wk-quick"><button data-a="down">▼ 아래로 1%</button><button data-a="up">▲ 위로 1%</button><button data-a="narrow">↔ 좁게</button><button data-a="wide">⟷ 넓게</button>${n.ai ? `<button data-a="ai">🤖 AI와 같게</button>` : ""}</div>
    <div class="small" id="wk-preview">${weekScorePreview(d.lo, d.hi)}</div>
    <div class="wk-submit"><button class="alert-add" id="wk-go">${n.my ? "✏️ 범위 고치기" : "🎯 이 범위로 참가"}</button><span class="small" id="wk-msg"></span></div>
    ${n.my ? `<div class="small pos">✓ 참가했어요: ${wkUsd(n.my.lo)} ~ ${wkUsd(n.my.hi)} <span class="muted">(마감 전까지 고칠 수 있어요)</span> <button class="wk-share" data-k="invite">📣 도전장 공유</button></div>` : ""}`;
  } else {
    html += n.my ? `<div class="small">내 범위 <b>${wkUsd(n.my.lo)} ~ ${wkUsd(n.my.hi)}</b> · 결과는 ${wkKst(n.close_at)}에 나와요 <button class="wk-share" data-k="invite">📣 도전장 공유</button></div>` : `<div class="small muted">이번 주 참가는 마감됐어요. 다음 주 월요일 오전 9시에 다시 열려요.</div>`;
    if (n.crowd) html += `<div class="small">참가자 가운데값 범위 ${wkUsd(n.crowd.lo)} ~ ${wkUsd(n.crowd.hi)}</div>`;
  }
  if (n.ai) html += `<div class="small muted">🤖 AI 이번 주 68% 범위 ${wkUsd(n.ai.lo)} ~ ${wkUsd(n.ai.hi)} (100점 기준)</div>`;
  if (L) {
    const rows = L.top.map((e) => `<tr class="${e.mine ? "kh-now" : ""}"><td>${e.rank}</td><td>${e.mine ? "<b>나</b>" : e.name}</td><td>${wkUsd(e.lo)} ~ ${wkUsd(e.hi)}</td><td class="${e.hit ? "pos" : "muted"}">${e.score}</td></tr>`).join("");
    const me = (L.me && !L.top.some((e) => e.mine) ? `<div class="small">내 순위 <b>${L.me.rank}위</b> / ${L.n}명 · ${L.me.score}점</div>` : "") +
      (L.me ? `<div class="wk-submit"><button class="alert-add wk-share" data-k="result">📸 내 결과 이미지로 공유</button></div>` : "");
    html += `<div class="label game-sub">지난주 결과 (${L.wk.slice(5).replace("-", "/")} 주)</div>
      <div class="small">정답 <b>${wkUsd(L.close)}</b> · 🤖 AI ${L.ai ? `${wkUsd(L.ai.lo)}~${wkUsd(L.ai.hi)} <b class="${L.ai_hit ? "pos" : "neg"}">${L.ai_hit ? "적중 100점" : "빗나감 0점"}</b>` : "범위 기록 없음"}
      · 참가 ${L.n}명 중 맞힌 사람 ${L.hits}명 · <b>AI보다 잘한 사람 ${L.beat_ai}명</b></div>
      ${L.crowd ? `<div class="small muted">참가자 가운데값 범위 ${wkUsd(L.crowd.lo)} ~ ${wkUsd(L.crowd.hi)}</div>` : ""}
      ${rows ? `<div class="table-wrap"><table class="compact"><thead><tr><th>순위</th><th>참가자</th><th>범위</th><th>점수</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}${me}`;
  }
  html += `<p class="muted small">점수: 정답이 범위 안이면 100 × (AI 범위 폭 ÷ 내 범위 폭), 최대 300점 · 밖이면 0점. 좁게 맞힐수록 높아요. 같은 점수면 더 좁은 범위, 먼저 낸 사람이 앞. 로그인 없이 익명이고, 이 브라우저로만 내 참가를 알아봐요.</p>`;
  box.innerHTML = html;
  box.querySelectorAll(".wk-share").forEach((b) => b.addEventListener("click", () => weekShare(b, b.dataset.k)));

  if (!n.open) return;
  const lo = $("wk-lo"), hi = $("wk-hi");
  const sync = () => { weekDraft = { lo: Number(lo.value), hi: Number(hi.value) }; $("wk-preview").innerHTML = weekScorePreview(weekDraft.lo, weekDraft.hi); };
  lo.addEventListener("input", sync);
  hi.addEventListener("input", sync);
  box.querySelectorAll(".wk-quick button").forEach((b) => b.addEventListener("click", () => {
    let a = Number(lo.value), c = Number(hi.value);
    const mid = (a + c) / 2, half = (c - a) / 2;
    if (b.dataset.a === "up") { a *= 1.01; c *= 1.01; }
    else if (b.dataset.a === "down") { a *= 0.99; c *= 0.99; }
    else if (b.dataset.a === "narrow") { a = mid - half * 0.8; c = mid + half * 0.8; }
    else if (b.dataset.a === "wide") { a = mid - half * 1.25; c = mid + half * 1.25; }
    else if (b.dataset.a === "ai" && n.ai) { a = n.ai.lo; c = n.ai.hi; }
    lo.value = Math.round(a / 10) * 10; hi.value = Math.round(c / 10) * 10;
    sync();
  }));
  $("wk-go").addEventListener("click", async () => {
    if (weekBusy) return;
    const a = Number(lo.value), c = Number(hi.value), msg = $("wk-msg");
    if (!(a > 0 && c > a)) { msg.textContent = "아래 가격이 위 가격보다 작아야 해요"; msg.className = "small neg"; return; }
    weekBusy = true; msg.textContent = "보내는 중…"; msg.className = "small muted";
    const j = await weekApi({ lo: a, hi: c });
    weekBusy = false;
    if (j?.error) { msg.textContent = j.error; msg.className = "small neg"; return; }
    weekData = j; weekDraft = { lo: j.now.my.lo, hi: j.now.my.hi }; weekRemember();
    renderWeek();
    const m2 = $("wk-msg"); if (m2) { m2.textContent = "참가 완료! 결과는 다음 주 월요일 오전 9시에 나와요."; m2.className = "small pos"; }
  });
}

let weekLoaded = false;
document.addEventListener("tabshown", (e) => { if (e.detail === "say" && !weekLoaded) { weekLoaded = true; loadWeek(); } });
if (typeof activeTab !== "undefined" && activeTab === "say") { weekLoaded = true; loadWeek(); }
setInterval(() => { if (typeof activeTab !== "undefined" && activeTab === "say" && weekData && !weekBusy && document.activeElement?.tagName !== "INPUT") renderWeek(); }, 60 * 1000);
weekHome();
setInterval(weekHome, 10 * 60 * 1000);
