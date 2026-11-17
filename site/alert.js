// 🔔 가격 알림 (계산기 탭 "이 가격 될까?" 아래): 목표 가격을 저장해 두면 실시간 BTC 가격이 닿을 때 브라우저 알림으로 알려 준다.
// - 알림 목록은 이 브라우저에만 저장 (서버로 보내지 않음), 최대 5개
// - 이 사이트 탭이 열려 있는 동안만 확인한다 (닫혀 있으면 못 알려 줌 → 화면에 그대로 안내)
// - 브라우저 알림 권한이 없으면 화면 위 알림 띠로만 보여 준다
// - 목록마다 "24시간 안에 닿을 확률"을 지금 변동성으로 계속 다시 계산해 보여 준다

const ALERT_KEY = "driftbtc_alerts";
const ALERT_MAX = 5;
let alerts = [];
try { alerts = JSON.parse(localStorage.getItem(ALERT_KEY) || "[]").filter((a) => a && a.target > 0); } catch (e) {}

function alertSave() {
  try { localStorage.setItem(ALERT_KEY, JSON.stringify(alerts)); } catch (e) {}
}

// 24시간 안에 한 번이라도 닿을 확률 (계산기와 같은 방법)
function alertProb(target) {
  if (live == null || typeof calcSigma !== "function") return null;
  const s = calcSigma("1h:24");
  if (!s) return null;
  const d = Math.abs(Math.log(target / live));
  return d === 0 ? 1 : Math.min(1, 2 * (1 - normCdf(d / s)));
}

function alertAdd(target) {
  if (!(target > 0) || live == null) return;
  if (alerts.filter((a) => !a.hit).length >= ALERT_MAX) { alertMsg(`알림은 ${ALERT_MAX}개까지예요. 하나를 지우고 다시 눌러 주세요.`); return; }
  alerts.push({ target, from: live, up: target >= live, at: Date.now(), hit: null });
  alertSave();
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then(() => renderAlerts());
  }
  renderAlerts();
  alertMsg(`${usd(target)} 알림을 저장했어요.`);
}

function alertMsg(t) {
  const el = $("alert-msg");
  if (!el) return;
  el.textContent = t;
  clearTimeout(alertMsg.timer);
  alertMsg.timer = setTimeout(() => { el.textContent = ""; }, 4000);
}

function alertFire(a) {
  const title = `🔔 BTC ${usd(a.target)} 도달`;
  const body = `지금 ${usd(live)} · 알림 건 때 ${usd(a.from)} (${a.up ? "위로" : "아래로"} ${Math.abs((a.target / a.from - 1) * 100).toFixed(2)}%)`;
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "favicon.svg", tag: "driftbtc-" + a.at });
      n.onclick = () => { focus(); n.close(); };
    }
  } catch (e) {}
  // 알림 권한이 없어도 화면으로 알 수 있게: 눌러서 닫을 때까지 위에 떠 있다
  const bar = $("alert-toast");
  if (bar) { bar.innerHTML = `${title} <span class="muted">${body}</span> <b class="alert-x">✕</b>`; bar.hidden = false; }
}

function alertCheck() {
  if (live == null) return;
  let changed = false;
  for (const a of alerts) {
    if (a.hit) continue;
    if ((a.up && live >= a.target) || (!a.up && live <= a.target)) {
      a.hit = Date.now();
      changed = true;
      alertFire(a);
    }
  }
  if (changed) { alertSave(); renderAlerts(); }
}

function renderAlerts() {
  const box = $("alert-list");
  if (!box) return;
  const perm = !("Notification" in window) ? "none" : Notification.permission;
  const permTxt = perm === "granted" ? "" : perm === "denied"
    ? `<div class="small warn">브라우저 알림이 막혀 있어요. 닿으면 이 화면 위에만 표시돼요 (주소창 자물쇠 → 알림 허용).</div>`
    : perm === "none" ? `<div class="small muted">이 브라우저는 알림을 지원하지 않아 화면에만 표시돼요.</div>` : "";
  const rows = alerts.slice().sort((a, b) => (a.hit ? 1 : 0) - (b.hit ? 1 : 0) || b.at - a.at).map((a) => {
    const i = alerts.indexOf(a);
    const dist = live != null ? (a.target / live - 1) * 100 : null;
    const p = a.hit ? null : alertProb(a.target);
    const pTxt = p == null ? "" : `<span class="${p >= 0.5 ? "pos" : p >= 0.2 ? "warn" : "muted"}">24시간 안 ${Math.round(p * 100)}%</span>`;
    const when = a.hit ? new Date(a.hit + 9 * 3600 * 1000) : null;
    const hitTxt = when ? `<span class="pos">✓ 닿음 ${when.getUTCMonth() + 1}/${when.getUTCDate()} ${String(when.getUTCHours()).padStart(2, "0")}:${String(when.getUTCMinutes()).padStart(2, "0")}</span>` : "";
    return `<div class="alert-row${a.hit ? " done" : ""}"><span>${a.up ? "▲" : "▼"} <b>${usd(a.target)}</b>${dist != null && !a.hit ? ` <span class="muted">(${pct(dist, 2)})</span>` : ""}</span>` +
      `<span class="small">${a.hit ? hitTxt : pTxt}</span><button class="alert-del" data-i="${i}" title="지우기" aria-label="알림 지우기">✕</button></div>`;
  }).join("");
  box.innerHTML = (rows || `<div class="muted small">저장한 알림이 없어요. 목표 가격을 넣고 🔔 버튼을 눌러 보세요.</div>`) + permTxt +
    `<div class="muted small">이 사이트 탭이 열려 있는 동안만 확인해요 (다른 탭을 봐도 괜찮아요). 알림 목록은 이 브라우저에만 저장돼요.</div>`;
  box.querySelectorAll(".alert-del").forEach((b) => b.addEventListener("click", () => { alerts.splice(Number(b.dataset.i), 1); alertSave(); renderAlerts(); }));
  // 홈 카드의 바로가기 줄: 걸어 둔 알림 수
  const home = $("alert-home");
  if (home) {
    const n = alerts.filter((a) => !a.hit).length;
    home.innerHTML = `🎯 원하는 가격까지 닿을 확률 계산 · 🔔 가격 알림${n ? ` <b class="pos">${n}개 대기 중</b>` : ""} →`;
  }
}

$("alert-add")?.addEventListener("click", () => {
  if (!calcTargetUsd) { alertMsg("먼저 목표 가격을 넣어 주세요."); $("calc-target")?.focus(); return; }
  alertAdd(calcTargetUsd);
});
setInterval(alertCheck, 2000);
$("alert-toast")?.addEventListener("click", (e) => { e.currentTarget.hidden = true; });
setInterval(() => { if (typeof activeTab === "undefined" || activeTab === "tools") renderAlerts(); }, 15000);
renderAlerts();
document.addEventListener("reportloaded", renderAlerts);
// 홈의 바로가기: 계산기 탭으로 옮긴 뒤 "이 가격 될까?" 카드로 내려간다
$("alert-home")?.addEventListener("click", () => setTimeout(() => { $("calc")?.scrollIntoView({ behavior: "smooth", block: "start" }); $("calc-target")?.focus({ preventScroll: true }); }, 60));
