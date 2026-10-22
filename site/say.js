// 💬 오늘 한마디 · 롱/숏 투표 (전부 익명). 서버: api/say.js
// 브라우저 번호(vid)는 방문자 집계와 같은 것을 쓴다. 운영자는 주소 뒤에 ?admin=키 를 한 번 붙이면 모든 글에 삭제 버튼이 생긴다.

let sayData = null;
let sayAdminKey = null;
try {
  const q = new URLSearchParams(location.search).get("admin");
  if (q) { localStorage.setItem("driftbtc_admin_key", q); history.replaceState(null, "", location.pathname + location.hash); }
  sayAdminKey = localStorage.getItem("driftbtc_admin_key");
} catch (e) {}

const sayVid = () => { try { return localStorage.getItem("driftbtc_vid"); } catch (e) { return null; } };
const sayEsc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sayAgo = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`; };

async function sayApi(body) {
  if (!window.SAY_URL) return null;
  try {
    const r = body
      ? await fetch(window.SAY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vid: sayVid(), ...body }) })
      : await fetch(`${window.SAY_URL}?vid=${encodeURIComponent(sayVid() || "")}&t=${Date.now()}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.status);
    return j;
  } catch (e) {
    sayToast(e.message);
    return null;
  }
}

function sayToast(msg) {
  const el = $("say-msg");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(sayToast.t);
  sayToast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

function renderSay() {
  const d = sayData;
  const box = $("say-box");
  if (!box) return;
  if (!d || d.enabled === false) { box.innerHTML = `<div class="mp-empty">지금은 투표를 불러올 수 없어요.</div>`; return; }
  const n = d.votes.long + d.votes.short;
  const lp = n ? Math.round((d.votes.long / n) * 100) : 50;
  const ai = report?.signals?.["1d"]?.current?.signal;
  // 어제 투표 vs 실제: 1일 관점의 최근 채점(오늘 09시 결과) 수익률 부호로 어제→오늘 방향을 본다
  const rec = report?.signals?.["1d"]?.recent;
  const last = rec?.length ? rec[rec.length - 1] : null;
  const yn = d.yesterday.long + d.yesterday.short;
  let yLine = "";
  if (yn >= 3 && last) {
    const yl = Math.round((d.yesterday.long / yn) * 100);
    const crowd = yl >= 50 ? "long" : "short";
    const actualUp = (last.signal === "long" ? last.ret_pct : -last.ret_pct) >= 0;
    const crowdHit = (crowd === "long") === actualUp;
    const aiHit = last.hit;
    yLine = `<div class="say-y muted small">어제: 방문자 ${yl >= 50 ? yl : 100 - yl}%가 ${crowd === "long" ? "롱" : "숏"}(${yn}표) ${crowdHit ? "✅" : "❌"} · AI 1일 관점 ${last.signal === "long" ? "롱" : "숏"} ${aiHit ? "✅" : "❌"} · 실제 ${actualUp ? "상승" : "하락"}</div>`;
  }
  const posts = d.posts.length
    ? d.posts.map((p) => `<div class="say-post" data-id="${p.id}">
        <div class="say-meta"><span class="say-anon">익명</span>${p.vote ? `<span class="${p.vote === "long" ? "pos" : "neg"}">${p.vote === "long" ? "롱" : "숏"}</span>` : ""}<span class="muted">${sayAgo(p.t)}</span>
          <span class="say-actions">${p.mine || sayAdminKey ? `<button data-act="delete">삭제</button>` : `<button data-act="report">신고</button>`}</span></div>
        <div class="say-text">${sayEsc(p.text)}</div></div>`).join("")
    : `<div class="mp-empty">아직 한마디가 없어요. 첫 글을 남겨 보세요.</div>`;
  box.innerHTML = `
    <div class="say-vote">
      <button class="say-btn long ${d.my === "long" ? "on" : ""}" data-side="long">🟢 롱 ${d.my === "long" ? "✓" : ""}</button>
      <div class="say-bar-wrap">
        <div class="ls-bar"><i style="width:${lp}%"></i></div>
        <div class="ls-label"><span class="pos">롱 ${lp}%</span><span class="muted">${n}표${(() => { const p = report?.forecasts?.["1d"]?.next; return p?.point ? ` · 오늘 AI 콜 ${p.point_dir >= 0 ? "⬆" : "⬇"} ${usd(p.point)}` : ai ? ` · AI 1일 관점 ${ai === "long" ? "🟢 롱" : "🔴 숏"}` : ""; })()}</span><span class="neg">숏 ${100 - lp}%</span></div>
      </div>
      <button class="say-btn short ${d.my === "short" ? "on" : ""}" data-side="short">🔴 숏 ${d.my === "short" ? "✓" : ""}</button>
    </div>
    ${yLine}
    <form class="say-form" id="say-form">
      <input id="say-text" maxlength="200" placeholder="오늘 한마디 (200자, 익명)" autocomplete="off">
      <button type="submit">남기기</button>
    </form>
    <div class="say-list">${posts}</div>
    <div class="muted small">전부 익명 · 한마디는 최근 7일치 표시 · 하루 1표(바꾸거나 다시 눌러 취소) · 링크·연락처·홍보·욕설은 자동 차단 · 신고 3번이면 숨김 · 투자 권유 아니며 책임은 작성자에게</div>`;

  box.querySelectorAll(".say-btn").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    // 이미 고른 쪽을 다시 누르면 표 취소
    const j = await sayApi(sayData?.my === b.dataset.side ? { action: "unvote" } : { action: "vote", side: b.dataset.side });
    if (j) { sayData = j; renderSay(); try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=say-vote"); } catch (e) {} }
    else b.disabled = false;
  }));
  $("say-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = $("say-text");
    const text = inp.value.trim();
    if (!text) return;
    inp.disabled = true;
    const j = await sayApi({ action: "post", text });
    if (j) { sayData = j; renderSay(); try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=say-post"); } catch (e) {} }
    else inp.disabled = false;
  });
  box.querySelectorAll(".say-actions button").forEach((b) => b.addEventListener("click", async () => {
    const id = b.closest(".say-post").dataset.id;
    const act = b.dataset.act;
    if (act === "delete" && !confirm("이 글을 지울까요?")) return;
    const day = sayData.posts.find((p) => p.id === id)?.day || sayData.day;
    const j = await sayApi({ action: act, id, day, key: sayAdminKey || undefined });
    if (!j) return;
    if (act === "report") sayToast(j.hidden ? "신고가 쌓여 숨겼어요" : j.reported ? "신고했어요" : "이미 신고한 글이에요");
    sayData = j; renderSay();
  }));
}

async function loadSay() {
  const j = await sayApi();
  if (j) { sayData = j; renderSay(); }
}

if ($("say-box")) {
  setTimeout(loadSay, 800); // 방문자 번호(vid)가 먼저 만들어진 뒤
  setInterval(loadSay, 60000);
}
window.renderSay = renderSay;
