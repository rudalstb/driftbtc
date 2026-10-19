// 📸 공유: 카드 하나를 이미지로 저장하거나(PC) 바로 공유(휴대폰)한다. html2canvas 는 눌렀을 때만 불러온다.
// 🧭 목차 칩·영역 접기: 카드가 많아 처음 온 사람이 길을 잃지 않도록 5묶음으로 나눈다 (접은 상태는 브라우저에만 저장).

const GROUPS = [
  { id: "g-tools", name: "🧮 도구", desc: "목표 가격 확률 · 들어갈 수량", members: [".calc", "#risk"] },
  { id: "g-market", name: "📊 시장 상황", desc: "선물 지표 · 지금 들어가도 될까", members: ["#futures", "#filter"] },
  { id: "g-mine", name: "🔍 내 매매 해부", desc: "내 거래 내역 파일로 약점 찾기", members: ["#my-analysis"] },
  { id: "g-operator", name: "🧑‍💻 운영자 실전 공개", desc: "실제 포지션 · 청산 기록 · 매매 해부", members: ["#mypos"] },
  { id: "g-verify", name: "✅ 검증", desc: "롱/숏 게임 · 가상 계좌 · 가격 차트 · 정확도 · 어떻게 만들었나", members: [".game", "#paper", ".chart-card", "#accuracy", ".method-card"] },
];

function buildGroups() {
  // 처음 온 사람에겐 '운영자 실전 공개'와 '검증'을 접어 두어 첫 화면을 가볍게 (한 번이라도 손대면 그 상태를 기억)
  let collapsed = { "g-operator": true, "g-verify": true };
  try { const saved = localStorage.getItem("driftbtc_groups"); if (saved) collapsed = JSON.parse(saved); } catch (e) {}
  const nav = $("group-nav");
  for (const g of GROUPS) {
    const first = g.members.map((s) => document.querySelector(s)).find(Boolean);
    if (!first) continue;
    const head = document.createElement("div");
    head.className = "group-head" + (collapsed[g.id] ? " closed" : "");
    head.id = g.id;
    head.innerHTML = `<div><b>${g.name}</b> <span class="muted small">${g.desc}</span></div><button class="group-toggle" aria-expanded="${!collapsed[g.id]}" title="접기/펼치기">▾</button>`;
    first.parentNode.insertBefore(head, first);
    const apply = () => {
      const closed = head.classList.contains("closed");
      for (const sel of g.members) document.querySelectorAll(sel).forEach((el) => { el.classList.toggle("group-hidden", closed && !el.hasAttribute("hidden")); });
      head.querySelector(".group-toggle").setAttribute("aria-expanded", String(!closed));
    };
    head.querySelector(".group-toggle").addEventListener("click", () => {
      head.classList.toggle("closed");
      collapsed[g.id] = head.classList.contains("closed");
      try { localStorage.setItem("driftbtc_groups", JSON.stringify(collapsed)); } catch (e) {}
      apply();
    });
    apply();
    if (nav) {
      const chip = document.createElement("a");
      chip.href = "#" + g.id;
      chip.textContent = g.name;
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        if (head.classList.contains("closed")) head.querySelector(".group-toggle").click();
        head.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(chip);
    }
  }
  // 숨김 속성이 나중에 풀리는 카드(운영자·선물 등)도 접힘 상태를 따르도록
  new MutationObserver(() => {
    for (const g of GROUPS) {
      const head = $(g.id);
      if (!head || !head.classList.contains("closed")) continue;
      for (const sel of g.members) document.querySelectorAll(sel).forEach((el) => { if (!el.hasAttribute("hidden")) el.classList.add("group-hidden"); });
    }
  }).observe(document.querySelector("main"), { attributes: true, subtree: true, attributeFilter: ["hidden"] });
}

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
  const name = btn.dataset.name || "driftbtc";
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
    ctx.fillText(`DriftBTC · rudalstb.github.io/driftbtc · ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })} KST · 투자 권유 아님`, 24, out.height - 20);
    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    const file = new File([blob], `${name}-${Date.now()}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "DriftBTC", text: "비트코인 움직임 예측 · DriftBTC" });
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
      if (seen[id] || el.hidden || el.classList.contains("group-hidden")) continue;
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

buildGroups();
trackSections();
