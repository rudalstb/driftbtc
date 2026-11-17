// BTC Agent 실시간 감시 (Cloudflare Worker, 1분마다 실행)
//
// GitHub 작업은 1시간에 1번만 돌아서 급변을 늦게 알린다. 이 Worker 는 1분마다 비트코인 1분봉을 보고
// 아래 일이 "처음" 생긴 순간에만 텔레그램으로 바로 보낸다 (저장소 없이 캔들 기록만으로 중복을 막는다).
//   ⚡ 5분 동안 ±1% 이상 급변 (30분 안에 이미 알렸으면 건너뜀)
//   🚨 이번 1시간 예측 95% 범위를 벗어남 (그 시간에 위·아래 각각 1번)
//   🚨 오늘(1일) 예측 95% 범위를 벗어남 (그날 위·아래 각각 1번)
// 예측 범위는 사이트가 매시간 만드는 data/forecast.json 을 그대로 쓴다.
//
// 필요한 Secret: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// 선택 변수: MOVE_PCT (기본 1 = ±1%), MOVE_MIN (기본 5분)
// Cron Trigger: "* * * * *"  (1분마다)
// 브라우저로 Worker 주소를 열면 지금 상태만 보여 준다 (알림은 보내지 않음).
// 주소 뒤에 ?test=<TELEGRAM_CHAT_ID> 를 붙여 열면 테스트 알림을 1번 보낸다.

const SITE = "https://btc.rudals.app/";
const FORECAST = SITE + "data/forecast.json";
const M = 60 * 1000;
const COOLDOWN_MIN = 30;

const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
const pct = (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
const kst = (ms) => { const d = new Date(ms + 9 * 3600 * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

// 캔들 [{t, h, l, c}] 오래된 순, 마감된 것만. Cloudflare 서버 위치에 따라 막히는 거래소가 달라서 여러 곳을 차례로 시도한다
// (예측 범위가 USDT 기준이라 USDT 가격을 먼저 쓰고, 달러 가격인 코인베이스는 마지막에).
const UA = { "User-Agent": "btc-agent-watch/1.0", Accept: "application/json" };
function sources(bar, limit) {
  const min = bar === "1m" ? 1 : 15;
  const binance = (host) => [`${host}/api/v3/klines?symbol=BTCUSDT&interval=${bar}&limit=${limit}`, (a) => a.map((x) => ({ t: +x[0], h: +x[2], l: +x[3], c: +x[4] }))];
  return [
    ["바이낸스", ...binance("https://data-api.binance.vision")],
    ["OKX", `https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=${bar}&limit=${Math.min(limit, 300)}`, (j) => j.data.map((x) => ({ t: +x[0], h: +x[2], l: +x[3], c: +x[4] }))],
    ["바이비트", `https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=${min}&limit=${limit}`, (j) => j.result.list.map((x) => ({ t: +x[0], h: +x[2], l: +x[3], c: +x[4] }))],
    ["크라켄", `https://api.kraken.com/0/public/OHLC?pair=XBTUSDT&interval=${min}`, (j) => Object.values(j.result).find(Array.isArray).slice(-limit).map((x) => ({ t: x[0] * 1000, h: +x[2], l: +x[3], c: +x[4] }))],
    ["코인베이스", `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${min * 60}`, (a) => a.slice(0, limit).map((x) => ({ t: x[0] * 1000, h: +x[2], l: +x[1], c: +x[4] }))],
  ];
}
async function candles(bar, limit, now, fails = []) {
  const ms = bar === "1m" ? M : 15 * M;
  for (const [name, url, parse] of sources(bar, limit)) {
    try {
      const r = await fetch(url, { headers: UA, cf: { cacheTtl: 0 } });
      if (!r.ok) { fails.push(`${name} ${r.status}`); continue; }
      const k = parse(await r.json()).filter((x) => x.t + ms <= now).sort((x, y) => x.t - y.t);
      // 최근 캔들이 빠져 있으면(지연된 응답) 다음 곳으로
      if (k.length && now - k[k.length - 1].t <= ms * 2 + M) return { src: name, k };
      fails.push(`${name} 비어 있음`);
    } catch (e) {
      fails.push(`${name} 오류`);
    }
  }
  return null;
}

// 창(start ~ 지금) 안에서 범위를 처음 벗어난 게 "가장 최근 1분봉"인지 (그 전 캔들은 한 번도 안 닿았는지)
function firstBreak(start, lo, hi, m1, m15) {
  const last = m1[m1.length - 1];
  if (!last || last.t < start) return null;
  const before = [
    ...m1.filter((k) => k.t >= start && k.t < last.t),
    ...(m15 || []).filter((k) => k.t + 15 * M > start && k.t < m1[0].t), // 1분봉이 없는 더 오래된 구간
  ];
  if (last.h >= hi && !before.some((k) => k.h >= hi)) return { dir: "up", px: last.h, level: hi };
  if (last.l <= lo && !before.some((k) => k.l <= lo)) return { dir: "down", px: last.l, level: lo };
  return null;
}

async function check(env, now = Date.now()) {
  const movePct = Number(env.MOVE_PCT || 1) / 100, moveMin = Number(env.MOVE_MIN || 5);
  const fails = [];
  const [one, quarter, fc] = await Promise.all([
    candles("1m", 61, now, fails),
    candles("15m", 100, now),
    fetch(FORECAST + "?t=" + Math.floor(now / M), { cf: { cacheTtl: 0 } }).then((r) => r.json()).catch(() => null),
  ]);
  if (!one || one.k.length < moveMin + COOLDOWN_MIN + 1) return { ok: false, error: "가격을 받지 못함", tried: fails, msgs: [] };
  const m1 = one.k, last = m1[m1.length - 1], price = last.c;
  const msgs = [];
  const f1h = fc?.forecasts?.["1h"], f1d = fc?.forecasts?.["1d"];
  const rangeTxt = f1h && now < Date.parse(f1h.next.t) ? `\n이번 시간 95% 범위 ${usd(f1h.next.lo95)} ~ ${usd(f1h.next.hi95)}` : "";

  // ⚡ 5분 급변: 최근 1분봉에서 처음 기준을 넘었고, 그 전 30분 동안은 넘은 적이 없을 때
  const move = (i) => (i - moveMin >= 0 ? m1[i].c / m1[i - moveMin].c - 1 : 0);
  const n = m1.length - 1, mv = move(n);
  let recent = false;
  for (let i = n - COOLDOWN_MIN; i < n; i++) if (Math.abs(move(i)) >= movePct) recent = true;
  if (Math.abs(mv) >= movePct && !recent) {
    msgs.push(`⚡ <b>BTC ${moveMin}분 새 ${pct(mv)} ${mv > 0 ? "급등" : "급락"}</b> (${kst(last.t + M)} KST)\n` +
      `${usd(price)} · ${moveMin}분 전 ${usd(m1[n - moveMin].c)}${rangeTxt}\n🔗 ${SITE}`);
  }

  // 🚨 예측 범위 이탈 (예측이 덮는 시간 안에서만)
  for (const [f, label, odds] of [[f1h, "이번 1시간", "1시간"], [f1d, "오늘(1일)", "하루"]]) {
    if (!f || now >= Date.parse(f.next.t)) continue;
    const b = firstBreak(Date.parse(f.as_of), f.next.lo95, f.next.hi95, m1, label.startsWith("오늘") ? quarter?.k : null);
    if (!b) continue;
    const up = b.dir === "up";
    msgs.push(`🚨 <b>${label} 예측 범위 ${up ? "위로" : "아래로"} 벗어남</b> (${kst(last.t + M)} KST)\n` +
      `BTC ${usd(b.px)} — 95% 범위 ${up ? "상단" : "하단"} ${usd(b.level)}을 ${up ? "넘었어요" : "깼어요"}\n` +
      `모델이 ${odds} 안에 이럴 확률을 5% 이하로 봤던 움직임이에요. ${up ? "숏 포지션 손절가를" : "롱 포지션 손절가를"} 확인하세요.\n🔗 ${SITE}`);
  }
  return { ok: true, src: one.src, skipped: fails.length ? fails : undefined, at: new Date(last.t + M).toISOString(), price, move_5m: +(mv * 100).toFixed(3),
    range_1h: f1h ? [f1h.next.lo95, f1h.next.hi95] : null, range_1d: f1d ? [f1d.next.lo95, f1d.next.hi95] : null, msgs };
}

async function send(env, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return r.status;
}

let lastRun = null, lastTest = 0;
export { check, firstBreak };
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await check(env);
      const sent = [];
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) for (const m of r.msgs) sent.push(await send(env, m));
      lastRun = { ...r, sent };
    })());
  },
  async fetch(request, env) {
    const r = await check(env);
    // 🧪 테스트 알림: ?test=<TELEGRAM_CHAT_ID> 로 열면 지금 값으로 만든 샘플을 1번 보낸다
    // (대화 번호는 주인만 알아서 남이 보내게 만들 수 없음, 같은 서버에서는 30초에 1번)
    const test = new URL(request.url).searchParams.get("test");
    if (test) {
      if (!env.TELEGRAM_BOT_TOKEN || test !== String(env.TELEGRAM_CHAT_ID)) return new Response("테스트 번호가 맞지 않아요", { status: 403 });
      if (Date.now() - lastTest < 30000) return new Response("30초 뒤에 다시 시도해 주세요", { status: 429 });
      lastTest = Date.now();
      const f = (a) => (a ? `${usd(a[0])} ~ ${usd(a[1])}` : "정보 없음");
      const text = `🧪 <b>테스트 알림</b> — 실시간 감시가 잘 연결됐어요\n` +
        (r.ok ? `BTC ${usd(r.price)} (${r.src}) · 5분 ${pct(r.move_5m / 100)}\n이번 시간 95% 범위 ${f(r.range_1h)}\n오늘 95% 범위 ${f(r.range_1d)}\n` : `⚠️ 지금은 가격을 받지 못했어요\n`) +
        `1분마다 확인해서 5분 ±${Number(env.MOVE_PCT || 1)}% 급변이나 이 범위를 벗어나면 바로 알려 드려요.\n🔗 ${SITE}`;
      const status = await send(env, text);
      return new Response(status === 200 ? "✅ 테스트 알림을 보냈어요. 텔레그램을 확인하세요." : `❌ 텔레그램 응답 ${status} — 토큰이나 대화 번호를 확인하세요.`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const body = { telegram_set: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), now: { ...r, msgs: r.msgs.length }, last_cron_run: lastRun && { at: lastRun.at, msgs: lastRun.msgs.length, sent: lastRun.sent } };
    return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  },
};
