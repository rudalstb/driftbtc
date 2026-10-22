// 📰 한국어 코인 뉴스 (Vercel 서버리스 함수): 구글 뉴스(한국어) 검색 + 코인 전문지 RSS 의 '제목·링크·시각'만 모아 준다.
// 기사 본문은 가져오지 않고 제목을 누르면 원문으로 이동한다. 브라우저에서 직접 부르면 막혀서(CORS) 서버에서 받는다.
// GET ?feed=btc|eth|crypto|nq → { items: [{ title, link, source, t }] } 최신순 60개, 5분 캐시
const ORIGINS = ["https://rudalstb.github.io", "https://btcagentai.com", "https://www.btcagentai.com"];
const pickOrigin = (request) => { const o = request?.headers?.get("origin"); return ORIGINS.includes(o) ? o : ORIGINS[0]; };
const G = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:3d")}&hl=ko&gl=KR&ceid=KR:ko`;
const PRESS = [
  { url: "https://www.blockmedia.co.kr/feed", source: "블록미디어" },
  { url: "https://www.tokenpost.kr/rss", source: "토큰포스트" },
  { url: "https://www.coinreaders.com/rss/rss_news.php", source: "코인리더스" },
];
const FEEDS = {
  btc: { google: ["비트코인"], press: true, filter: /비트코인|BTC|btc/ },
  eth: { google: ["이더리움"], press: true, filter: /이더리움|ETH|이더/ },
  crypto: { google: ["가상자산 OR 코인 OR 암호화폐"], press: true, filter: /코인|비트|이더|가상자산|암호화폐|블록체인|BTC|ETH|XRP|리플|솔라나|토큰|거래소|스테이블|알트|NFT|ETF|업비트|빗썸|바이낸스|김프|채굴|디파이|DeFi/i },
  nq: { google: ["나스닥 OR 뉴욕증시", "연준 금리"], press: false, filter: null },
};
const CACHE_MS = 5 * 60 * 1000;
const cache = {};

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const tag = (item, name) => { const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };

async function readRss(url, source) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`${source} ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    let title = tag(it, "title");
    let src = source || tag(it, "source");
    // 구글 뉴스 제목 끝의 " - 언론사" 를 떼어 출처로
    if (!source) { const m = title.match(/^(.*) - ([^-]{2,30})$/); if (m) { title = m[1]; src = src || m[2]; } }
    const link = tag(it, "link").replace(/\?utm_[^"]*$/, "");
    const t = Date.parse(tag(it, "pubDate")) || null;
    return { title, link, source: src || "뉴스", t };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link));
}

export async function GET(request) {
  const headers = { "Access-Control-Allow-Origin": pickOrigin(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const key = new URL(request.url).searchParams.get("feed") || "btc";
  const f = FEEDS[key];
  if (!f) return new Response(JSON.stringify({ error: "알 수 없는 뉴스 종류" }), { status: 400, headers });
  const c = cache[key];
  if (c && Date.now() - c.at < CACHE_MS) return new Response(c.body, { headers });
  const jobs = [...f.google.map((q) => readRss(G(q), null)), ...(f.press ? PRESS.map((p) => readRss(p.url, p.source)) : [])];
  const res = await Promise.allSettled(jobs);
  let items = [];
  const errors = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { errors.push(`${i < f.google.length ? "구글 뉴스" : PRESS[i - f.google.length].source}: ${String(r.reason?.message || r.reason)}`); return; }
    // 전문지 기사는 종류에 맞는 제목만 (코인 전체는 그대로)
    const fromPress = i >= f.google.length;
    items.push(...(fromPress && f.filter ? r.value.filter((x) => f.filter.test(x.title)) : r.value));
  });
  // 같은 제목 중복 제거 → 최신순
  const seen = new Set();
  items = items.filter((x) => { const k = x.title.replace(/\s/g, "").slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 60);
  const body = JSON.stringify({ feed: key, updated: Date.now(), items, errors });
  if (items.length) cache[key] = { at: Date.now(), body };
  return new Response(body, { status: items.length ? 200 : 502, headers });
}
