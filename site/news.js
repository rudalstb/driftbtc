// 📰 뉴스 탭: 기본은 한국어 뉴스(구글 뉴스 한국어 + 코인 전문지 RSS 제목, 서버 중계 api/news.js).
// "🌐 해외 뉴스" 를 고르면 트레이딩뷰 공식 뉴스 위젯(영어)을 보여 준다. 탭을 열 때만 불러온다.

const NEWS_FEEDS = {
  btc: { name: "₿ 비트코인", tv: { feedMode: "symbol", symbol: "BINANCE:BTCUSDT" } },
  eth: { name: "Ξ 이더리움", tv: { feedMode: "symbol", symbol: "BINANCE:ETHUSDT" } },
  crypto: { name: "🪙 코인 전체", tv: { feedMode: "market", market: "crypto" } },
  nq: { name: "나스닥·증시", tv: { feedMode: "symbol", symbol: "CME_MINI:NQ1!" } },
};
let newsFeed = "btc", newsLang = "ko";
try {
  newsFeed = NEWS_FEEDS[localStorage.getItem("driftbtc_news")] ? localStorage.getItem("driftbtc_news") : "btc";
  newsLang = localStorage.getItem("driftbtc_news_lang") === "en" ? "en" : "ko";
} catch (e) {}
let newsShown = null, newsTimer = null;

function newsTheme() { return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
const newsEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newsAgo = (t) => {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
};

async function renderKoNews(force = false) {
  const box = $("news-widget");
  if (!force && newsShown === "ko|" + newsFeed) return;
  newsShown = "ko|" + newsFeed;
  box.innerHTML = `<div class="mp-empty">한국어 뉴스를 불러오는 중…</div>`;
  try {
    const r = await fetch(`${window.NEWS_URL}?feed=${newsFeed}`, { cache: "no-store", signal: AbortSignal.timeout?.(15000) });
    const j = await r.json();
    if (!j.items?.length) throw new Error(j.error || "뉴스가 없어요");
    if (newsShown !== "ko|" + newsFeed) return; // 그사이 다른 버튼을 눌렀으면 버림
    box.innerHTML = `<ul class="news-list">` + j.items.map((x) =>
      `<li><a href="${newsEsc(x.link)}" target="_blank" rel="noopener nofollow">${newsEsc(x.title)}</a><div class="muted small">${newsEsc(x.source)}${x.t ? ` · ${newsAgo(x.t)}` : ""}</div></li>`
    ).join("") + `</ul>`;
    $("news-updated").textContent = `${new Date(j.updated).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })} 기준 · ${j.items.length}건`;
  } catch (e) {
    box.innerHTML = `<div class="mp-empty">한국어 뉴스를 지금은 불러올 수 없어요 (${newsEsc(e.message)}). "🌐 해외 뉴스"를 눌러 보세요.</div>`;
  }
}

function renderTvNews() {
  const box = $("news-widget");
  const key = "en|" + newsFeed + "|" + newsTheme();
  if (newsShown === key) return;
  newsShown = key;
  box.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "tradingview-widget-container";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  wrap.appendChild(inner);
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-timeline.js";
  s.async = true;
  s.text = JSON.stringify({ ...NEWS_FEEDS[newsFeed].tv, isTransparent: true, displayMode: "regular", width: "100%", height: 720, colorTheme: newsTheme(), locale: "kr" });
  wrap.appendChild(s);
  box.appendChild(wrap);
  $("news-updated").textContent = "트레이딩뷰 · 영어 기사";
}

function renderNews(force = false) {
  if (!$("news-widget")) return;
  document.querySelectorAll("#news-feed button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.feed === newsFeed)));
  document.querySelectorAll("#news-lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === newsLang)));
  $("news-widget").classList.toggle("tv", newsLang === "en");
  if (newsLang === "en") renderTvNews(); else renderKoNews(force);
  clearInterval(newsTimer);
  if (newsLang === "ko") newsTimer = setInterval(() => { if (activeTab === "news") renderKoNews(true); }, 5 * 60 * 1000);
}

document.querySelectorAll("#news-feed button").forEach((b) => b.addEventListener("click", () => {
  newsFeed = b.dataset.feed;
  try { localStorage.setItem("driftbtc_news", newsFeed); } catch (e) {}
  renderNews();
}));
document.querySelectorAll("#news-lang button").forEach((b) => b.addEventListener("click", () => {
  newsLang = b.dataset.lang;
  try { localStorage.setItem("driftbtc_news_lang", newsLang); } catch (e) {}
  newsShown = null;
  renderNews();
}));
document.addEventListener("tabshown", (e) => { if (e.detail === "news") renderNews(); });
if (typeof activeTab !== "undefined" && activeTab === "news") renderNews(); // 뉴스 탭 주소로 바로 연 경우
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { if (activeTab === "news" && newsLang === "en") renderNews(); });
