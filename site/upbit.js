// 🇰🇷 업비트 거래내역 계산기: 업비트 거래내역(엑셀 .xlsx · .csv · PDF 거래내역서 · 웹 화면 붙여넣기)을 넣으면
// 코인별 실현 손익·수수료·평균단가·남은 수량·지금 평가손익, 매도 건별 손익, 월별 합계를 계산한다.
// 계산 방식은 업비트와 같은 '이동평균 단가'(매수할 때마다 평균단가 갱신, 매도할 때 그 평균단가로 손익 확정).
// 파일은 브라우저 안에서만 읽고 어디에도 보내지 않는다. (엑셀 읽기 라이브러리는 엑셀 파일을 올릴 때만 불러온다)

const UB_XLSX = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const UB_COLS = {
  time: /체결\s*시간|체결\s*일시|거래\s*일시|^일시$|^시간$/,
  coin: /^코인$|코인명|자산|^화폐$/,
  market: /마켓/,
  kind: /^종류$|구분|거래\s*종류|^유형$/,
  qty: /거래\s*수량|체결\s*수량|^수량$/,
  price: /거래\s*단가|체결\s*가격|체결\s*단가|^단가$|^가격$/,
  amount: /거래\s*금액|체결\s*금액|^금액$/,
  fee: /수수료/,
  settle: /정산\s*금액/,
};
let ubLastResult = null;

const ubNum = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/,/g, "").replace(/[^\d.\-eE]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const ubTime = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.round((v - 25569) * 86400000) - 9 * 3600000; // 엑셀 날짜 숫자 → 한국 시간 기준
  const s = String(v).trim().replace(/\./g, "-").replace(/\//g, "-").replace(/(\d{4}-\d{1,2}-\d{1,2})\s+/, "$1T");
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "+09:00");
  return Number.isNaN(t) ? null : t;
};
const ubKind = (v) => {
  const s = String(v || "");
  if (/매수|buy|bid/i.test(s)) return "buy";
  if (/매도|sell|ask/i.test(s)) return "sell";
  if (/입금|deposit/i.test(s)) return "dep";
  if (/출금|withdraw/i.test(s)) return "wd";
  return null;
};
const won = (v) => (v < 0 ? "−₩" : "₩") + Math.abs(Math.round(v)).toLocaleString("ko-KR");
const wonS = (v) => `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${won(v)}</span>`;
const qtyF = (v) => (Math.abs(v) >= 100 ? v.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : Math.abs(v) >= 1 ? v.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) : v.toFixed(8).replace(/0+$/, "").replace(/\.$/, ""));
const ubDate = (t) => { const d = new Date(t + 9 * 3600e3); return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`; };

// 표(2차원 배열) → 거래 목록
function ubRowsToTx(rows) {
  let head = -1, map = null;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const h = rows[r].map((x) => String(x ?? "").trim());
    const m = {};
    for (const [k, re] of Object.entries(UB_COLS)) { const i = h.findIndex((x, j) => re.test(x) && !Object.values(m).includes(j)); if (i >= 0) m[k] = i; }
    if (m.kind != null && m.qty != null && (m.coin != null || m.market != null)) { head = r; map = m; break; }
  }
  if (!map) return { error: "업비트 거래내역 형식이 아니에요. 업비트 → 입출금·투자내역 → 거래내역에서 받은 파일인지 확인해 주세요 (종류·코인·거래수량 열이 필요해요)." };
  const g = (row, k) => (map[k] != null ? row[map[k]] : null);
  const tx = [];
  let skipped = 0, otherMarket = 0;
  for (const row of rows.slice(head + 1)) {
    const kind = ubKind(g(row, "kind"));
    if (!kind) { if (row.some((c) => c !== "" && c != null)) skipped++; continue; }
    let coin = String(g(row, "coin") ?? "").trim().toUpperCase();
    const market = String(g(row, "market") ?? "").trim().toUpperCase();
    if (!coin && market) coin = market.split(/[-\/]/).pop();
    // 마켓이 원화가 아니면(BTC·USDT 마켓) 원화 손익을 낼 수 없어 따로 센다
    if ((kind === "buy" || kind === "sell") && market && !/KRW|원/.test(market)) { otherMarket++; continue; }
    const qty = Math.abs(ubNum(g(row, "qty")) || 0);
    const price = ubNum(g(row, "price")) || 0;
    const amount = ubNum(g(row, "amount")) ?? qty * price;
    const fee = Math.abs(ubNum(g(row, "fee")) || 0);
    const t = ubTime(g(row, "time"));
    if (!coin || !qty) { skipped++; continue; }
    tx.push({ t, coin, kind, qty, price: price || (qty ? amount / qty : 0), amount: Math.abs(amount), fee });
  }
  if (!tx.length) return { error: "읽을 수 있는 거래가 없어요." };
  tx.sort((a, b) => (a.t || 0) - (b.t || 0));
  return { tx, skipped, otherMarket };
}

// 붙여넣은 글 → 표. 머리글이 있는 탭 구분 표면 그대로 쓰고, 아니면 날짜를 기준으로 한 건씩 끊어 종류·코인·숫자를 순서대로 읽는다
const UB_DATE = /(\d{4}[.\-\/]\s?\d{1,2}[.\-\/]\s?\d{1,2}\.?\s+\d{1,2}:\d{2}(?::\d{2})?)/g;
function ubParsePaste(text) {
  // 웹에서 복사한 표는 탭으로 나뉘고 숫자에 쉼표가 있으므로, 탭이 있으면 탭으로만 나눈다 (쉼표로 나누면 1,100,000 이 깨짐)
  const rows = /\t/.test(text) ? text.split(/\r?\n/).map((l) => l.split("\t")) : parseCsv(text);
  const asTable = ubRowsToTx(rows);
  if (!asTable.error) return asTable;
  // 날짜가 나올 때마다 한 묶음 (체결시간·주문시간 두 번 나오면 종류가 없는 묶음은 버림)
  const parts = text.split(UB_DATE);
  const tx = [];
  let skipped = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const when = parts[i], body = parts[i + 1] || "";
    const kindM = body.match(/매수|매도|입금|출금/);
    if (!kindM) continue;
    const kind = ubKind(kindM[0]);
    const tokens = body.replace(/	/g, " ").split(/\s+/).filter(Boolean);
    const coin = (tokens.find((x) => /^[A-Z][A-Z0-9]{1,14}$/.test(x) && !/^(KRW|BTC|USDT)$/.test(x) ? true : false) ||
      tokens.find((x) => /^[A-Z][A-Z0-9]{1,14}$/.test(x) && x !== "KRW") || "").toUpperCase();
    const market = /BTC\s*마켓|BTC-|USDT\s*마켓|USDT-/.test(body) ? "OTHER" : "KRW";
    const after = body.slice(body.indexOf(kindM[0]) + kindM[0].length);
    const nums = (after.match(/-?\d[\d,]*\.?\d*/g) || []).map((x) => parseFloat(x.replace(/,/g, ""))).filter((x) => Number.isFinite(x));
    const [qty, price, amount, fee] = nums;
    if (!coin || !qty) { skipped++; continue; }
    if ((kind === "buy" || kind === "sell") && market !== "KRW") continue;
    tx.push({ t: ubTime(when.replace(/\.\s?/g, "-").replace(/-(\s)/, "$1")), coin, kind, qty, price: price || 0, amount: amount ?? qty * (price || 0), fee: fee || 0 });
  }
  if (!tx.length) return { error: "붙여넣은 내용에서 거래를 찾지 못했어요. 업비트 웹 → 투자내역 → 거래내역 표를 체결시간부터 복사했는지 확인해 주세요." };
  tx.sort((a, b) => (a.t || 0) - (b.t || 0));
  return { tx, skipped, otherMarket: 0 };
}

// 이동평균 단가로 손익 계산.
// 원가를 아는 물량(이 기록 안에서 산 것)과 원가를 모르는 물량(입금받은 것, 기록 시작 전에 산 것)을 따로 들고 간다.
// 팔 때는 원가를 아는 물량부터 빼고, 모자라는 만큼은 '원가 모름'으로 처리한다:
//   사용자가 그 코인 평균 매수가를 넣었으면 그 값으로 손익 계산, 안 넣었으면 실현 손익에서 빼고 따로 보여 준다.
let ubUserCost = {}; // 코인 → 사용자가 넣은 평균 매수가(원)
let ubLastRes = null;
const ubMonth = (t) => (t ? new Date(t + 9 * 3600e3).toISOString().slice(0, 7) : "날짜 없음");

function ubCompute(tx) {
  const coins = new Map();
  const sells = [];
  const months = new Map();
  let fees = 0, buyTotal = 0, sellTotal = 0;
  const month = (t) => { const k = ubMonth(t); if (!months.has(k)) months.set(k, { pnl: 0, fee: 0, n: 0, unknown: 0 }); return months.get(k); };
  for (const x of tx) {
    if (x.coin === "KRW") continue;
    const c = coins.get(x.coin) || { coin: x.coin, qty: 0, cost: 0, uq: 0, buy: 0, sell: 0, fee: 0, realized: 0, sells: 0, wins: 0, unknownSold: 0, unknownSoldAll: 0, unknownProceeds: 0, unknownIn: 0 };
    if (x.kind === "buy") {
      c.qty += x.qty; c.cost += x.amount + x.fee; c.buy += x.amount; c.fee += x.fee;
      fees += x.fee; buyTotal += x.amount; month(x.t).fee += x.fee;
    } else if (x.kind === "dep") {
      c.uq += x.qty; c.unknownIn += x.qty; // 외부에서 들어온 코인: 원가 모름
    } else if (x.kind === "wd") {
      // 출금은 원가 모르는 물량부터 (다시 내보낸 것일 가능성이 높아서), 남으면 원가 아는 물량에서 평균단가로
      const fromU = Math.min(c.uq, x.qty); c.uq -= fromU;
      const rest = x.qty - fromU;
      if (rest > 0 && c.qty > 0) { const avg = c.cost / c.qty; const q = Math.min(rest, c.qty); c.cost -= avg * q; c.qty -= q; }
    } else if (x.kind === "sell") {
      const got = x.amount - x.fee; // 수수료 뺀 받은 돈
      const perUnit = got / x.qty;
      const qKnown = Math.min(x.qty, c.qty);
      const qUnknown = x.qty - qKnown;
      const avg = c.qty > 0 ? c.cost / c.qty : 0;
      const costKnown = avg * qKnown;
      c.qty -= qKnown; c.cost = c.qty > 1e-12 ? c.cost - costKnown : 0; if (c.qty < 1e-12) c.qty = 0;
      // 원가 모르는 물량: 들고 있던 입금분에서 먼저, 그래도 모자라면 기록 시작 전에 산 것으로 본다
      c.uq = Math.max(0, c.uq - qUnknown);
      const user = ubUserCost[x.coin];
      let pnl = perUnit * qKnown - costKnown, costUsed = costKnown, unknownLeft = 0;
      if (qUnknown > 1e-12) {
        c.unknownSoldAll += qUnknown;
        if (user > 0) { pnl += (perUnit - user) * qUnknown; costUsed += user * qUnknown; }
        else { unknownLeft = qUnknown; c.unknownSold += qUnknown; c.unknownProceeds += perUnit * qUnknown; month(x.t).unknown += perUnit * qUnknown; }
      }
      const counted = qKnown > 1e-12 || (qUnknown > 1e-12 && user > 0); // 손익을 낼 수 있었던 매도인가
      c.sell += x.amount; c.fee += x.fee; fees += x.fee; sellTotal += x.amount;
      if (counted) { c.realized += pnl; c.sells++; if (pnl > 0) c.wins++; const m = month(x.t); m.pnl += pnl; m.n++; }
      month(x.t).fee += x.fee;
      sells.push({ t: x.t, coin: x.coin, qty: x.qty, price: x.price, avg: qKnown ? avg : user || 0, pnl: counted ? pnl : null, fee: x.fee,
        pct: counted && costUsed ? (pnl / costUsed) * 100 : null, unknownQty: unknownLeft, partial: qUnknown > 1e-12 });
    }
    coins.set(x.coin, c);
  }
  const list = [...coins.values()];
  const unknownCoins = list.filter((c) => c.unknownSold > 1e-12 || c.uq > 1e-12 || c.unknownIn > 1e-12 || (ubUserCost[c.coin] > 0)).map((c) => c.coin);
  const realized = list.reduce((s, c) => s + c.realized, 0);
  const counted = sells.filter((s) => s.pnl != null);
  return {
    list, sells, months, fees, buyTotal, sellTotal, realized, wins: counted.filter((s) => s.pnl > 0).length, countedSells: counted.length,
    unknownCoins, unknownProceeds: list.reduce((s, c) => s + c.unknownProceeds, 0),
    from: tx[0]?.t, to: tx[tx.length - 1]?.t, n: tx.length,
  };
}

async function ubLoadPrices(coins) {
  if (!window.UPBIT_URL || !coins.length) return {};
  try {
    const r = await fetch(`${window.UPBIT_URL}?markets=${coins.map((c) => "KRW-" + c).join(",")}`, { cache: "no-store" });
    const j = await r.json();
    return j.prices || {};
  } catch (e) { return {}; }
}

async function ubRender(res) {
  ubLastRes = res;
  const out = $("ub-result");
  const r = ubCompute(res.tx);
  ubLastResult = r;
  const holding = r.list.filter((c) => c.qty > 1e-10 || c.uq > 1e-10);
  const prices = await ubLoadPrices(holding.map((c) => c.coin));
  let unreal = 0, evalSum = 0, costSum = 0, unknownEval = 0;
  for (const c of holding) {
    const p = prices["KRW-" + c.coin];
    if (!p) continue;
    c.now = p;
    const user = ubUserCost[c.coin];
    // 원가 아는 물량 + (사용자가 원가를 넣었으면) 원가 모르는 물량까지 평가손익에 넣는다
    const qEval = c.qty + (user > 0 ? c.uq : 0);
    const cEval = c.cost + (user > 0 ? user * c.uq : 0);
    c.evalQty = qEval; c.evalCost = cEval;
    c.unreal = qEval > 0 ? p * qEval - cEval : null;
    if (c.unreal != null) { unreal += c.unreal; evalSum += p * qEval; costSum += cEval; }
    if (!(user > 0) && c.uq > 1e-10) unknownEval += p * c.uq;
  }
  const rate = r.countedSells ? Math.round((r.wins / r.countedSells) * 100) : null;
  const tile = (k, v, sub = "") => `<div class="ana-tile"><div class="label">${k}</div><div class="ana-val">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}</div>`;
  const tiles =
    tile("실현 손익", wonS(r.realized), r.unknownProceeds ? `원가 모르는 매도 ${won(r.unknownProceeds)}는 빼고` : "판 코인에서 확정된 손익 (수수료 뺀 뒤)") +
    tile("낸 수수료", won(r.fees), `매수·매도 합계 · 거래 ${r.n}건`) +
    tile("지금 평가손익", evalSum ? wonS(unreal) : "—", !holding.length ? "남은 코인 없음" : evalSum ? `평가 ${won(evalSum)}${unknownEval ? ` · 원가 모름 ${won(unknownEval)} 별도` : ""}` : "지금 시세를 못 받았어요") +
    tile("실현 + 평가", wonS(r.realized + unreal), costSum ? `보유 원가 ${won(costSum)}` : "") +
    tile("매도 승률", rate != null ? `${rate}%` : "—", `<span class="pos">${r.wins}번 이익</span> · <span class="neg">${r.countedSells - r.wins}번 손실</span>`) +
    tile("매수 · 매도 총액", `${won(r.buyTotal)}`, `매도 ${won(r.sellTotal)}`) +
    tile("기간", r.from ? `${ubDate(r.from)}` : "—", r.to ? `~ ${ubDate(r.to)}` : "") +
    tile("수수료 비중", r.realized > 0 ? `${((r.fees / r.realized) * 100).toFixed(1)}%` : "—", "실현 이익 대비");

  // 원가 모르는 코인: 평균 매수가를 넣으면 다시 계산
  const unk = r.list.filter((c) => r.unknownCoins.includes(c.coin));
  const unkBox = unk.length
    ? `<div class="ub-unknown"><div class="label">⚠ 원가를 모르는 코인이 있어요</div>
       <div class="muted small">산 기록 없이 판 것(기록 시작 전에 샀거나 다른 곳에서 입금받은 코인)은 원가를 몰라서 <b>실현 손익에서 빼 두었어요</b>. 그 코인의 평균 매수가를 알면 넣어 주세요 — 바로 다시 계산해요. 모르면 비워 두세요.</div>
       <div class="ub-unknown-grid">${unk.map((c) => `<label class="calc-field"><span><b>${c.coin}</b> 평균 매수가 (₩) <span class="muted">· 원가 모르는 ${qtyF(c.unknownSoldAll + c.uq)}개${c.unknownProceeds ? ` · 판 금액 ${won(c.unknownProceeds)}` : ""}</span></span>
         <input type="number" inputmode="decimal" step="any" data-coin="${c.coin}" class="ub-cost" value="${ubUserCost[c.coin] || ""}" placeholder="모르면 비워 두기"></label>`).join("")}</div></div>`
    : "";

  const coinRows = r.list.sort((a, b) => b.realized + (b.unreal || 0) - (a.realized + (a.unreal || 0))).map((c) => {
    const isUnk = r.unknownCoins.includes(c.coin), user = ubUserCost[c.coin];
    const qtyAll = c.qty + c.uq;
    return `<tr><td><b>${c.coin}</b>${isUnk ? ` <span class="warn small" title="원가를 모르는 물량이 있어요">${user > 0 ? "✏️" : "⚠"}</span>` : ""}</td>` +
      `<td>${won(c.buy)}</td><td>${won(c.sell)}</td><td>${wonS(c.realized)}${c.unknownProceeds && !(user > 0) ? `<div class="muted small">+원가 모름 매도 ${won(c.unknownProceeds)}</div>` : ""}</td><td class="hide-m">${won(c.fee)}</td>` +
      `<td>${qtyAll > 1e-10 ? qtyF(qtyAll) : "—"}${c.uq > 1e-10 && !(user > 0) ? `<div class="muted small">원가 모름 ${qtyF(c.uq)}</div>` : ""}</td><td class="hide-m">${c.evalQty ? won(c.evalCost / c.evalQty) : c.qty > 1e-10 ? won(c.cost / c.qty) : "—"}</td>` +
      `<td>${c.unreal != null && c.now ? `${wonS(c.unreal)}<div class="muted small">현재 ${won(c.now)} · ${((c.unreal / c.evalCost) * 100).toFixed(1)}%</div>` : qtyAll > 1e-10 ? `<span class="muted small">${c.now ? "원가 모름" : "시세 없음"}</span>` : "—"}</td></tr>`;
  }).join("");
  const sellRows = [...r.sells].reverse().slice(0, 300).map((s) =>
    `<tr><td class="muted small">${s.t ? ubDate(s.t) : "—"}</td><td><b>${s.coin}</b></td><td>${qtyF(s.qty)}</td><td>${won(s.price)}</td><td class="hide-m">${s.avg ? won(s.avg) : "?"}</td>` +
    `<td>${s.pnl != null ? `${wonS(s.pnl)}${s.pct != null ? `<div class="muted small">${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(2)}%${s.unknownQty > 1e-12 ? " · 일부 원가 모름" : ""}</div>` : ""}` : `<span class="muted small">원가 모름</span>`}</td><td class="hide-m">${won(s.fee)}</td></tr>`).join("");
  const monthRows = [...r.months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([m, v]) =>
    `<tr><td>${m.replace("-", "년 ")}월</td><td>${v.n}번 매도</td><td>${wonS(v.pnl)}${v.unknown ? `<div class="muted small">+원가 모름 ${won(v.unknown)}</div>` : ""}</td><td>${won(v.fee)}</td></tr>`).join("");
  out.innerHTML =
    unkBox +
    (res.otherMarket ? `<div class="muted small">BTC·USDT 마켓 거래 ${res.otherMarket}건은 원화 손익을 낼 수 없어 뺐어요.</div>` : "") +
    `<div class="ana-tiles">${tiles}</div>` +
    `<div class="label game-sub">코인별</div><div class="table-wrap"><table class="compact ub"><thead><tr><th>코인</th><th>산 금액</th><th>판 금액</th><th>실현 손익</th><th class="hide-m">수수료</th><th>남은 수량</th><th class="hide-m">평균단가</th><th>지금 평가손익</th></tr></thead><tbody>${coinRows}</tbody></table></div>` +
    `<div class="label game-sub">월별</div><div class="table-wrap"><table class="compact"><thead><tr><th>월</th><th>매도</th><th>실현 손익</th><th>수수료</th></tr></thead><tbody>${monthRows}</tbody></table></div>` +
    `<details class="more" open><summary>매도 건별 손익 (${r.sells.length}건${r.sells.length > 300 ? " · 최근 300건만" : ""})</summary><div class="table-wrap"><table class="compact"><thead><tr><th>날짜</th><th>코인</th><th>수량</th><th>판 가격</th><th class="hide-m">평균단가</th><th>손익</th><th class="hide-m">수수료</th></tr></thead><tbody>${sellRows}</tbody></table></div></details>` +
    `<div class="muted small">계산 방식: 업비트와 같은 이동평균 단가 — 살 때마다 (산 금액+수수료)로 평균단가를 갱신하고, 팔 때 (판 금액−수수료) − 평균단가×수량을 실현 손익으로 봐요. 산 기록보다 많이 판 물량·입금받은 코인은 원가를 몰라 손익에서 빼고 따로 보여 주며, 평균 매수가를 넣으면 그 값으로 계산해요. 출금은 원가 모르는 물량부터 빼요. 세금 신고용이 아닌 참고용이에요.</div>`;
  out.querySelectorAll(".ub-cost").forEach((inp) => inp.addEventListener("change", () => {
    const v = Number(inp.value);
    if (v > 0) ubUserCost[inp.dataset.coin] = v; else delete ubUserCost[inp.dataset.coin];
    ubRender(ubLastRes);
  }));
  $("ub-clear").hidden = false;
}

// 📄 PDF 거래내역서: pdf.js 로 글자와 위치를 읽어 줄 단위로 다시 맞춘 뒤(같은 높이 = 한 줄, 칸 사이가 벌어지면 탭),
// 엑셀·붙여넣기와 같은 해석기(ubParsePaste)로 넘긴다. 비밀번호가 걸린 PDF 는 열 수 없어 안내만 한다.
const UB_PDF = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const UB_PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

async function ubPdfText(file) {
  if (!window.pdfjsLib) await new Promise((ok, no) => { const s = document.createElement("script"); s.src = UB_PDF; s.onload = ok; s.onerror = () => no(new Error("PDF 읽기 도구를 불러오지 못했어요")); document.head.appendChild(s); });
  pdfjsLib.GlobalWorkerOptions.workerSrc = UB_PDF_WORKER;
  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") throw new Error("비밀번호가 걸린 PDF예요. PDF를 연 뒤 '인쇄 → PDF로 저장'으로 잠금 없는 사본을 만들어 올려 주세요");
    throw e;
  }
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    // 같은 줄(높이 차이 3 이내)끼리 묶고 왼쪽부터 정렬
    const rows = [];
    for (const it of items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: str });
    }
    rows.sort((a, b) => b.y - a.y); // PDF 좌표는 아래가 0
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "", end = null;
      for (const p of r.parts) {
        if (end != null) line += p.x - end > 6 ? "\t" : (p.x - end > 1 ? " " : "");
        line += p.s;
        end = p.x + p.w;
      }
      lines.push(line.trim());
    }
  }
  return lines.join("\n");
}

async function ubHandle(file) {
  const st = $("ub-status");
  st.textContent = "읽는 중…";
  try {
    let rows;
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      // PDF 는 표 모양이 제각각이라 글자를 줄 단위로 되살려 붙여넣기 해석기로 읽는다
      st.textContent = "PDF 읽는 중…";
      const text = await ubPdfText(file);
      const res = ubParsePaste(text);
      if (res.error) { st.innerHTML = `<span class="neg">PDF에서 거래를 찾지 못했어요. 업비트 거래내역서 PDF가 맞는지 확인해 주세요. (글자를 그림으로 넣은 PDF는 읽을 수 없어요)</span>`; $("ub-result").innerHTML = ""; return; }
      st.innerHTML = `<span class="pos">✅ ${file.name}</span> · PDF에서 거래 ${res.tx.length}건 읽음${res.skipped ? ` · 알아볼 수 없는 줄 ${res.skipped}개 건너뜀` : ""} · 이 파일은 내 브라우저 안에서만 처리됐어요.`;
      await ubRender(res);
      try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=upbit-pdf"); } catch (e) {}
      return;
    }
    if (/\.xlsx?$/i.test(file.name)) {
      if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement("script"); s.src = UB_XLSX; s.onload = ok; s.onerror = () => no(new Error("엑셀 읽기 도구를 불러오지 못했어요")); document.head.appendChild(s); });
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    } else {
      let text = await file.text();
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      // 업비트 CSV 가 EUC-KR 로 저장된 경우
      if (!/종류|코인|체결/.test(text.slice(0, 500))) text = new TextDecoder("euc-kr").decode(await file.arrayBuffer());
      rows = parseCsv(text);
    }
    const res = ubRowsToTx(rows);
    if (res.error) { st.innerHTML = `<span class="neg">${res.error}</span>`; $("ub-result").innerHTML = ""; return; }
    st.innerHTML = `<span class="pos">✅ ${file.name}</span> · 거래 ${res.tx.length}건 읽음${res.skipped ? ` · 알아볼 수 없는 줄 ${res.skipped}개 건너뜀` : ""} · 이 파일은 내 브라우저 안에서만 처리됐어요.`;
    await ubRender(res);
    try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=upbit-used"); } catch (e) {}
  } catch (e) {
    st.innerHTML = `<span class="neg">파일을 읽지 못했어요: ${e.message}</span>`;
  }
}

$("ub-file")?.addEventListener("change", (e) => { if (e.target.files[0]) ubHandle(e.target.files[0]); });
$("ub-run")?.addEventListener("click", async () => {
  const text = $("ub-paste").value.trim();
  const st = $("ub-status");
  if (!text) { st.innerHTML = `<span class="neg">먼저 업비트 거래내역을 붙여넣어 주세요.</span>`; return; }
  const res = ubParsePaste(text);
  if (res.error) { st.innerHTML = `<span class="neg">${res.error}</span>`; $("ub-result").innerHTML = ""; return; }
  st.innerHTML = `<span class="pos">✅ 붙여넣은 거래 ${res.tx.length}건 읽음</span>${res.skipped ? ` · 알아볼 수 없는 줄 ${res.skipped}개 건너뜀` : ""} · 내 브라우저 안에서만 처리됐어요.`;
  await ubRender(res);
  try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=upbit-paste"); } catch (e) {}
});
const ubDrop = $("ub-drop");
if (ubDrop) {
  ubDrop.addEventListener("dragover", (e) => { e.preventDefault(); ubDrop.classList.add("over"); });
  ubDrop.addEventListener("dragleave", () => ubDrop.classList.remove("over"));
  ubDrop.addEventListener("drop", (e) => { e.preventDefault(); ubDrop.classList.remove("over"); if (e.dataTransfer.files[0]) ubHandle(e.dataTransfer.files[0]); });
}
$("ub-clear")?.addEventListener("click", () => { $("ub-result").innerHTML = ""; $("ub-status").textContent = ""; $("ub-file").value = ""; $("ub-paste").value = ""; $("ub-clear").hidden = true; ubUserCost = {}; });
$("ub-sample")?.addEventListener("click", (e) => {
  e.preventDefault();
  const csv = "체결시간,코인,마켓,종류,거래수량,거래단가,거래금액,수수료,정산금액,주문시간\n" +
    "2026-10-01 10:00:00,BTC,KRW,매수,0.01,110000000,1100000,550,1100550,2026-10-01 10:00:00\n" +
    "2026-10-05 14:30:00,BTC,KRW,매수,0.01,105000000,1050000,525,1050525,2026-10-05 14:30:00\n" +
    "2026-10-10 09:15:00,BTC,KRW,매도,0.015,112000000,1680000,840,1679160,2026-10-10 09:15:00\n" +
    "2026-10-12 21:00:00,XRP,KRW,매수,1000,800,800000,400,800400,2026-10-12 21:00:00\n" +
    "2026-10-15 11:20:00,XRP,KRW,매도,1000,760,760000,380,759620,2026-10-15 11:20:00\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "upbit_sample.csv";
  a.click();
});
