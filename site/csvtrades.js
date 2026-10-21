// 🔍 내 매매 해부 (방문자용): 거래소에서 내려받은 '포지션/청산 내역' CSV 를 올리면
// 운영자 계좌에 쓰는 것과 같은 분석(analysis.js)을 본인 기록으로 보여 준다.
// 파일은 브라우저 안에서만 읽고, 어디로도 보내지 않는다.

const CSV_KEYS = {
  symbol: /symbol|심볼|종목|계약|contract|market|pair|futures/i,
  side: /^side$|direction|방향|롱.?숏|position ?side|포지션 ?방향|hold ?side|long\/short/i,
  entry: /open.*(price|가)|entry.*price|avg.*open|진입.*(가|가격)|개시.*가격|평균 ?진입/i,
  exit: /close.*(price|가)|exit.*price|avg.*close|청산.*(가|가격)|종료.*가격|평균 ?청산/i,
  size: /closed?.*(amount|qty|quantity|size|pos)|amount|qty|quantity|^size|수량|계약 ?수/i,
  net: /net.*(profit|pnl|income)|순.?(손익|이익|수익)|realized.*net|pnl.*after/i,
  pnl: /realized.*(pnl|profit)|^pnl$|profit ?&? ?loss|실현.?(손익|수익)|^손익$|수익금/i,
  fee: /^fee|fees?$|total.*fee|수수료|commission/i,
  funding: /funding|펀딩/i,
  opened: /open.*(time|date)|entry.*(time|date)|created|진입.*(시각|시간|일시)|개시.*(시간|일시)|시작/i,
  closed: /close.*(time|date)|exit.*(time|date)|updated|청산.*(시각|시간|일시)|종료.*(시간|일시)|^time$|^date$|일시/i,
};

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const numOf = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[,\s₩$]/g, "").replace(/usdt|usd|btc|%/gi, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const timeOf = (v) => {
  if (v == null || v === "") return null;
  if (/^\d{13}$/.test(String(v).trim())) return Number(v);
  if (/^\d{10}$/.test(String(v).trim())) return Number(v) * 1000;
  let s = String(v).trim().replace(/\//g, "-").replace(/\./g, "-").replace(/(\d)\s+(\d{1,2}:)/, "$1T$2");
  let t = Date.parse(s);
  if (Number.isNaN(t)) t = Date.parse(s.replace("T", " "));
  if (Number.isNaN(t)) return null;
  // 시간대 표기가 없으면 한국 시간으로 본다
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) && /T|\s\d{1,2}:/.test(s)) t -= 0; // Date.parse 가 이미 현지 시간으로 해석함 (방문자 브라우저 시간대)
  return t;
};
const sideOf = (v) => {
  const s = String(v || "").toLowerCase();
  if (/short|sell|숏|매도|공매도/.test(s)) return "short";
  if (/long|buy|롱|매수/.test(s)) return "long";
  return null;
};

// 머리글 행을 찾아 열 이름 → 역할 대응표를 만든다
function mapColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const head = rows[r].map((h) => h.trim());
    const map = {};
    for (const [key, re] of Object.entries(CSV_KEYS)) {
      const idx = head.findIndex((h, i) => re.test(h) && !Object.values(map).includes(i));
      if (idx >= 0) map[key] = idx;
    }
    if (map.symbol != null && (map.net != null || map.pnl != null) && map.closed != null) return { map, headerRow: r, head };
  }
  return null;
}

function rowsToTrades(rows) {
  const found = mapColumns(rows);
  if (!found) return { error: "열 이름을 알아볼 수 없어요. 종목·손익·청산 시각 열이 있는 '포지션(청산) 내역' 파일인지 확인해 주세요. 체결 하나하나가 줄로 나오는 '체결 내역' 파일은 아직 지원하지 않아요." };
  const { map, headerRow } = found;
  const get = (row, k) => (map[k] != null ? row[map[k]] : null);
  const trades = [];
  for (const row of rows.slice(headerRow + 1)) {
    const closed = timeOf(get(row, "closed"));
    const pnl = numOf(get(row, "pnl"));
    let net = numOf(get(row, "net"));
    const fee = Math.abs(numOf(get(row, "fee")) || 0), funding = numOf(get(row, "funding")) || 0;
    if (net == null && pnl != null) net = pnl - fee + funding;
    if (closed == null || net == null) continue;
    const entry = numOf(get(row, "entry")), exit = numOf(get(row, "exit"));
    let side = sideOf(get(row, "side"));
    if (!side && entry && exit && pnl != null && exit !== entry) side = (exit > entry) === (pnl > 0) ? "long" : "short";
    trades.push({
      id: `${get(row, "symbol")}-${closed}-${trades.length}`,
      symbol: String(get(row, "symbol") || "").trim().toUpperCase().replace(/[_\-\/ ]/g, "").replace(/PERP$/, "") || "?",
      side: side || "long",
      entry, exit, size: numOf(get(row, "size")),
      pnl: pnl ?? net, net,
      fees: pnl != null && net != null ? pnl - net : fee - funding,
      opened: timeOf(get(row, "opened")) ?? closed,
      closed,
    });
  }
  if (!trades.length) return { error: "숫자로 읽히는 줄이 없어요. 파일이 비어 있거나 형식이 다른 것 같아요." };
  return { trades, map: found.head.filter((_, i) => Object.values(map).includes(i)) };
}

function handleCsvFile(file) {
  const status = $("my-ana-status");
  const reader = new FileReader();
  reader.onload = () => {
    let text = reader.result;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const res = rowsToTrades(parseCsv(text));
    if (res.error) {
      status.innerHTML = `<span class="neg">${res.error}</span>`;
      $("my-ana").innerHTML = "";
      return;
    }
    const a = renderAnalysisInto(res.trades, { box: "my-ana", since: "my-ana-since", chart: "my-ana-chart" });
    window.myAnalysis = a; // 계산기 탭 '기대값·켈리'가 불러다 쓴다 (브라우저 안에서만)
    status.innerHTML = `<span class="pos">✅ ${file.name}</span> · ${res.trades.length}건 읽음 <span class="muted">(알아본 열: ${res.map.join(", ")})</span> · 이 파일은 내 브라우저 안에서만 처리됐고 어디에도 저장되지 않았어요.`;
    $("my-ana-clear").hidden = !a;
    try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=my-analysis-used"); } catch (e) {} // 쓰임새 집계만 (내용은 안 보냄)
  };
  reader.readAsText(file, "utf-8");
}

$("my-ana-file")?.addEventListener("change", (e) => { if (e.target.files[0]) handleCsvFile(e.target.files[0]); });
$("my-ana-clear")?.addEventListener("click", () => {
  $("my-ana").innerHTML = ""; $("my-ana-status").textContent = ""; $("my-ana-since").textContent = ""; $("my-ana-file").value = ""; $("my-ana-clear").hidden = true;
});
const dz = $("my-ana-drop");
if (dz) {
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files[0]) handleCsvFile(e.dataTransfer.files[0]); });
}
// 우리 형식 견본 파일
$("my-ana-sample")?.addEventListener("click", (e) => {
  e.preventDefault();
  const csv = "symbol,side,entry,exit,size,pnl,fee,opened,closed\nBTCUSDT,long,82000,83000,0.01,10,0.5,2026-10-12 09:00,2026-10-12 15:30\nETHUSDT,short,2500,2550,0.5,-25,0.6,2026-10-13 21:00,2026-10-14 02:00\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "btcagent_sample.csv";
  a.click();
});
