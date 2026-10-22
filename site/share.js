// 📸 공유: 카드 하나를 이미지로 저장하거나(PC) 바로 공유(휴대폰)한다. html2canvas 는 눌렀을 때만 불러온다.
// 🧭 목차 칩·영역 접기: 카드가 많아 처음 온 사람이 길을 잃지 않도록 5묶음으로 나눈다 (접은 상태는 브라우저에만 저장).

// 🗂️ 탭: 홈에는 "지금 비트코인 어디까지 움직이나"만, 나머지는 탭을 눌러야 보인다 (선택은 브라우저가 기억, 주소 #탭이름 으로 공유 가능)
const TABS = [
  { id: "home", name: "🔮 AI 예측", members: [".brief", ".pair", ".grid", "#tv"], freqTabs: true },
  { id: "market", name: "🚦 진입 분석", members: ["#futures", "#filter"] },
  { id: "news", name: "📰 뉴스", members: ["#news"] },
  { id: "verify", name: "🎯 적중률", members: ["#game", "#paper", "#lab", "#accuracy"], freqTabs: true },
  { id: "operator", name: "💼 실전 계좌", members: ["#mypos"] },
  { id: "tools", name: "🧮 계산기", members: ["#calc-nav", "#calc", "#risk", "#avg", "#pnl", "#edge", "#kimp"] },
  { id: "mine", name: "🩺 매매 진단", members: ["#my-analysis"] },
  { id: "say", name: "🗳 롱숏 투표", members: ["#say"] },
];
let activeTab = "home";

function showTab(id, push = true) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  activeTab = tab.id;
  for (const t of TABS) for (const sel of t.members) document.querySelectorAll(sel).forEach((el) => el.classList.toggle("tab-hidden", t.id !== tab.id));
  document.querySelector(".tabs")?.classList.toggle("tab-hidden", !tab.freqTabs);
  document.querySelectorAll("#group-nav a").forEach((a) => a.setAttribute("aria-selected", String(a.dataset.tab === tab.id)));
  try { localStorage.setItem("driftbtc_tab", tab.id); } catch (e) {}
  if (push && location.hash !== "#" + tab.id) history.replaceState(null, "", "#" + tab.id);
  // 숨겨져 있던 그래프가 크기를 다시 잡도록 (일부 브라우저는 크기 감지가 늦어 직접 호출)
  setTimeout(() => { dispatchEvent(new Event("resize")); refitCharts(); }, 60);
  document.dispatchEvent(new CustomEvent("tabshown", { detail: tab.id }));
  if (push) window.scrollTo({ top: 0, behavior: "smooth" });
}

function buildTabs() {
  const nav = $("group-nav");
  if (!nav) return;
  nav.innerHTML = "";
  for (const t of TABS) {
    const a = document.createElement("a");
    a.href = "#" + t.id;
    a.dataset.tab = t.id;
    a.textContent = t.name;
    a.addEventListener("click", (e) => { e.preventDefault(); showTab(t.id); });
    nav.appendChild(a);
  }
  // 카드 안의 "#market" 같은 링크도 탭 전환으로
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='#']");
    if (!a) return;
    const id = a.getAttribute("href").slice(1);
    if (TABS.some((t) => t.id === id)) { e.preventDefault(); showTab(id); }
  });
  addEventListener("hashchange", () => { const id = location.hash.slice(1); if (TABS.some((t) => t.id === id)) showTab(id, false); });
  let start = location.hash.slice(1);
  if (!TABS.some((t) => t.id === start)) { try { start = localStorage.getItem("driftbtc_tab") || "home"; } catch (e) { start = "home"; } }
  showTab(start, false);
}

// 화면에 보이게 된 Chart.js 그래프들의 크기를 직접 다시 잡는다
function refitCharts() {
  const list = [typeof chart !== "undefined" && chart, typeof eqChart !== "undefined" && eqChart, typeof paperChart !== "undefined" && paperChart,
    ...(typeof anaCharts !== "undefined" ? Object.values(anaCharts) : [])];
  for (const c of list) { try { c && c.canvas && c.canvas.offsetParent !== null && c.resize(); } catch (e) {} }
}
window.refitCharts = refitCharts;

// 접힌 '자세히' 안의 그래프도 펼칠 때 크기를 다시 잡도록
document.addEventListener("toggle", (e) => { if (e.target.tagName === "DETAILS" && e.target.open) setTimeout(() => { dispatchEvent(new Event("resize")); refitCharts(); }, 60); }, true);

let h2cLoading = null;
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (!h2cLoading) h2cLoading = new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = ok; s.onerror = no;
    document.head.appendChild(s);
  });
  return h2cLoading;
}

async function shareCard(btn) {
  const card = btn.closest(".card");
  const name = btn.dataset.name || "btcagent";
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "만드는 중…";
  try {
    await loadHtml2canvas();
    btn.style.visibility = "hidden";
    const canvas = await html2canvas(card, { backgroundColor: css("--card"), scale: 2, useCORS: true, logging: false });
    btn.style.visibility = "";
    // 아래에 출처 한 줄
    const out = document.createElement("canvas");
    out.width = canvas.width; out.height = canvas.height + 56;
    const ctx = out.getContext("2d");
    ctx.fillStyle = css("--card"); ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = css("--muted"); ctx.font = "24px sans-serif";
    ctx.fillText(`BTC Agent · rudalstb.github.io/driftbtc · ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })} KST · 투자 권유 아님`, 24, out.height - 20);
    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    const file = new File([blob], `${name}-${Date.now()}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "BTC Agent", text: "비트코인 AI 예측 범위 · BTC Agent" });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=share-" + name); } catch (e) {}
  } catch (e) {
    if (e?.name !== "AbortError") alert("이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

document.querySelectorAll(".share-btn").forEach((b) => b.addEventListener("click", () => shareCard(b)));

// 📈 화면 이용 집계: 어떤 영역이 화면에 들어왔는지 영역 이름만 하루 1번 보낸다 (입력값·개인정보 없음)
// 스크롤·크기 변경 때 직접 위치를 재서, 카드의 40% 또는 화면의 40% 중 작은 쪽이 보이면 본 것으로 친다
function trackSections() {
  if (!window.VISIT_URL) return;
  let seen = {};
  try { seen = JSON.parse(sessionStorage.getItem("driftbtc_seen") || "{}"); } catch (e) {}
  let pending = false;
  const check = () => {
    pending = false;
    const vh = innerHeight || document.documentElement.clientHeight;
    for (const el of document.querySelectorAll("[data-sec]")) {
      const id = el.dataset.sec;
      if (seen[id] || el.hidden || el.classList.contains("tab-hidden")) continue;
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (visible < Math.min(0.4 * r.height, 0.4 * vh)) continue;
      seen[id] = 1;
      try { sessionStorage.setItem("driftbtc_seen", JSON.stringify(seen)); } catch (e) {}
      try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=" + encodeURIComponent(id)); } catch (e) {}
    }
  };
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(check); } };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  setTimeout(check, 1500); // 첫 화면 (데이터가 채워진 뒤)
  setInterval(check, 15000); // 접기·펼치기나 늦게 나타나는 카드
}

buildTabs();
trackSections();
