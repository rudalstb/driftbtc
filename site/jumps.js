// ⚡ 최근 24시간 급변: 텔레그램 감시기(worker/watch.js)·alert_week.py 와 같은 규칙
// 5분 수익률이 ±1% 를 처음 넘은 1분봉 (그 전 30분 안에 넘은 적 없음) → 30분 뒤 종가가 알림 방향으로 0.2% 이상이면 '이어짐'
const JUMP = { pct: 0.01, win: 5, cool: 30, follow: 30, flat: 0.002, hosts: ["https://api.binance.com", "https://data-api.binance.vision"] };

async function jumpKlines() {
  const need = 24 * 60 + JUMP.win + JUMP.cool + 5;
  let start = Date.now() - need * 60000;
  for (const host of JUMP.hosts) {
    try {
      const out = [];
      while (out.length < need) {
        const r = await fetch(`${host}/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&limit=1000`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status);
        const rows = await r.json();
        if (!rows.length) break;
        out.push(...rows.map((x) => [x[0], +x[4], x[6] < Date.now()]));
        start = rows[rows.length - 1][0] + 60000;
        if (rows.length < 1000) break;
      }
      return out.filter((x) => x[2]); // 마감된 봉만
    } catch (e) { /* 다음 주소 */ }
  }
  return null;
}

function jumpEvents(k) {
  const c = k.map((x) => x[1]);
  const mv = (i) => (i >= JUMP.win ? c[i] / c[i - JUMP.win] - 1 : 0);
  const since = Date.now() - 24 * 3600 * 1000;
  const ev = [];
  for (let i = JUMP.win + JUMP.cool; i < k.length; i++) {
    const m = mv(i);
    if (Math.abs(m) < JUMP.pct || k[i][0] < since) continue;
    let quiet = true;
    for (let j = i - JUMP.cool; j < i; j++) if (Math.abs(mv(j)) >= JUMP.pct) { quiet = false; break; }
    if (!quiet) continue;
    const e = { t: k[i][0] + 60000, m };
    if (i + JUMP.follow < k.length) {
      const s = (c[i + JUMP.follow] / c[i] - 1) * Math.sign(m);
      e.after = s >= JUMP.flat ? "이어짐" : s <= -JUMP.flat ? "되돌림" : "제자리";
    }
    ev.push(e);
  }
  return ev;
}

async function renderJumps() {
  const el = document.getElementById("jumps-line");
  if (!el) return;
  const k = await jumpKlines();
  if (!k || k.length < 600) { el.hidden = true; return; }
  const ev = jumpEvents(k);
  el.hidden = false;
  if (!ev.length) { el.textContent = "⚡ 최근 24시간 급변 없음 — 5분 만에 ±1% 넘게 움직인 적이 없는 조용한 하루"; jumpBase(el); return; }
  const hm = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const items = ev.slice(-3).reverse().map((e) =>
    `${hm(e.t)} ${e.m > 0 ? "▲" : "▼"}${(Math.abs(e.m) * 100).toFixed(1)}% → ${e.after ? "30분 뒤 " + e.after : "지켜보는 중"}`);
  el.textContent = `⚡ 최근 24시간 급변 ${ev.length}번 (5분 ±1%) · ` + items.join(" · ");
  jumpBase(el);
  el.title = "5분 만에 1% 넘게 움직인 순간과, 30분 뒤 그 방향으로 이어졌는지(0.2% 이상) 되돌렸는지";
}

// 지난 1년 기준치 (jumps_stats.py 가 매주 계산) — 줄 끝에 작은 링크로
async function jumpBase(el) {
  try {
    const d = await (await fetch("data/jumps_stats.json", { cache: "no-store" })).json();
    const a = d.groups.all.h30;
    const link = document.createElement("a");
    link.href = "guide/sudden-moves.html";
    link.className = "jumps-base";
    link.textContent = ` · 1년 기준 30분 뒤 이어짐 ${Math.round(a.cont)}%·되돌림 ${Math.round(a.rev)}% →`;
    link.title = `지난 1년(${d.from} ~ ${d.to}) 급변 ${a.n}번 통계`;
    el.appendChild(link);
  } catch (e) { /* 통계 없으면 줄만 */ }
}

renderJumps();
setInterval(() => { if (!document.hidden) renderJumps(); }, 5 * 60 * 1000);

// 🔔 급변 푸시 받기: 사이트를 닫아도 5분 ±1% 급변 때 알림 (api/push.js 가 보냄, 서비스 워커가 띄움)
// - 아이폰은 '홈 화면에 추가'한 앱에서만 웹 푸시가 되므로, 사파리에서는 방법만 안내한다
(function () {
  const btn = document.getElementById("push-btn"), tip = document.getElementById("push-tip");
  if (!btn || !window.PUSH_URL || location.protocol !== "https:") return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const can = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!can && !(ios && !standalone)) return;
  const say = (t) => { tip.textContent = t; tip.hidden = !t; };
  const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  // 서비스 워커가 아직 없으면 직접 등록하고, 8초 안에 준비되지 않으면 멈춰 있지 않고 알려 준다
  const reg = () => Promise.race([
    navigator.serviceWorker.getRegistration().then((r) => r || navigator.serviceWorker.register("sw.js")).then(() => navigator.serviceWorker.ready),
    new Promise((_, no) => setTimeout(() => no(new Error("서비스 워커 준비 안 됨")), 8000)),
  ]);
  const label = (on) => { btn.textContent = on ? "🔕 급변 푸시 끄기" : "🔔 급변 푸시 받기 — 사이트를 닫아도 5분 ±1% 급변 때 알림"; btn.dataset.on = on ? "1" : ""; };
  const post = (body) => fetch(window.PUSH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  btn.hidden = false;
  label(false);
  if (can) reg().then((r) => r.pushManager.getSubscription()).then((s) => label(!!s)).catch(() => {});

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    if (!can) { say("아이폰은 사파리 공유 버튼 → '홈 화면에 추가'로 설치한 뒤, 설치한 앱에서 이 버튼을 누르면 알림을 받을 수 있어요."); return; }
    let step = "준비";
    say("확인하는 중…");
    try {
      const r = await reg();
      const cur = await r.pushManager.getSubscription();
      if (cur) {
        await post({ action: "unsub", endpoint: cur.endpoint }).catch(() => {});
        await cur.unsubscribe();
        label(false); say("급변 푸시를 껐어요.");
        return;
      }
      step = "알림 허용";
      if ((await Notification.requestPermission()) !== "granted") { say("알림이 막혀 있어요. 브라우저 주소창의 사이트 설정에서 알림을 허용해 주세요."); return; }
      step = "발송 키";
      const { key } = await (await fetch(window.PUSH_URL, { cache: "no-store" })).json();
      step = "구독";
      const sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      step = "확인 알림";
      const res = await post({ action: "sub", sub: sub.toJSON() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
      label(true);
      say("켜졌어요. 확인 알림이 하나 갔을 거예요. 5분 만에 ±1% 넘게 움직이면 바로 알려 드려요(일주일에 3번 안팎). 매매 신호가 아니라 '지금 크게 움직였다'는 알림이에요.");
      try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=push-on"); } catch (e) {}
    } catch (e) {
      say("알림을 켜지 못했어요 [" + step + ": " + (e.message || e) + "]. 잠시 뒤 다시 시도해 주세요.");
    }
  });
})();
