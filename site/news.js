// 📰 뉴스 탭: 트레이딩뷰 공식 뉴스 위젯(Timeline)을 붙인다. 외부 사이트에 넣도록 트레이딩뷰가 제공하는 무료 위젯이라 이용약관에 맞다.
// 탭을 처음 열 때만 불러오고, 종목을 바꾸면 위젯을 다시 그린다.

const NEWS_FEEDS = {
  btc: { name: "₿ 비트코인", cfg: { feedMode: "symbol", symbol: "BINANCE:BTCUSDT" } },
  eth: { name: "Ξ 이더리움", cfg: { feedMode: "symbol", symbol: "BINANCE:ETHUSDT" } },
  crypto: { name: "🪙 코인 전체", cfg: { feedMode: "market", market: "crypto" } },
  nq: { name: "나스닥100", cfg: { feedMode: "symbol", symbol: "CME_MINI:NQ1!" } },
};
let newsFeed = "btc";
try { newsFeed = NEWS_FEEDS[localStorage.getItem("driftbtc_news")] ? localStorage.getItem("driftbtc_news") : "btc"; } catch (e) {}
let newsShown = null; // 지금 그려진 피드 + 테마

function newsTheme() { return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }

function renderNews() {
  const box = $("news-widget");
  if (!box) return;
  const key = newsFeed + "|" + newsTheme();
  if (newsShown === key) return;
  newsShown = key;
  document.querySelectorAll("#news-feed button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.feed === newsFeed)));
  box.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "tradingview-widget-container";
  const inner = document.createElement("div");
  inner.className = "tradingview-widget-container__widget";
  wrap.appendChild(inner);
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-timeline.js";
  s.async = true;
  s.text = JSON.stringify({
    ...NEWS_FEEDS[newsFeed].cfg,
    isTransparent: true,
    displayMode: "regular",
    width: "100%",
    height: 720,
    colorTheme: newsTheme(),
    locale: "kr",
  });
  wrap.appendChild(s);
  box.appendChild(wrap);
}

document.querySelectorAll("#news-feed button").forEach((b) =>
  b.addEventListener("click", () => {
    newsFeed = b.dataset.feed;
    try { localStorage.setItem("driftbtc_news", newsFeed); } catch (e) {}
    renderNews();
  })
);
document.addEventListener("tabshown", (e) => { if (e.detail === "news") renderNews(); });
if (typeof activeTab !== "undefined" && activeTab === "news") renderNews(); // 뉴스 탭 주소로 바로 연 경우
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { if (activeTab === "news") renderNews(); });
