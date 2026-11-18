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
  if (!ev.length) { el.textContent = "⚡ 최근 24시간 급변 없음 — 5분 만에 ±1% 넘게 움직인 적이 없는 조용한 하루"; return; }
  const hm = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const items = ev.slice(-3).reverse().map((e) =>
    `${hm(e.t)} ${e.m > 0 ? "▲" : "▼"}${(Math.abs(e.m) * 100).toFixed(1)}% → ${e.after ? "30분 뒤 " + e.after : "지켜보는 중"}`);
  el.textContent = `⚡ 최근 24시간 급변 ${ev.length}번 (5분 ±1%) · ` + items.join(" · ");
  el.title = "5분 만에 1% 넘게 움직인 순간과, 30분 뒤 그 방향으로 이어졌는지(0.2% 이상) 되돌렸는지";
}

renderJumps();
setInterval(() => { if (!document.hidden) renderJumps(); }, 5 * 60 * 1000);
