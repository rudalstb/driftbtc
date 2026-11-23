// 📊 Google 애널리틱스(GA4, rudals.app 과 같은 속성). 로봇·http(로컬)·운영자 통계 페이지·관리자 키가 주소에 있을 때는 부르지 않는다.
// GA 는 page_view 에 주소창 주소(? 뒤 포함, # 뒤 제외)를 그대로 보낸다. ? 뒤에 비밀 값이 실리는 경우(admin)는 여기서 뺀다
(function () {
  if (window.__ga || location.protocol !== "https:" || navigator.webdriver) return;
  if (/stats\.html$/.test(location.pathname) || new URLSearchParams(location.search).has("admin")) return;
  window.__ga = 1;
  const GA = "G-Y894ZF86LJ";
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA);
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA;
  document.head.appendChild(s);
})();

// 📈 글 페이지 방문 집계 (시장 일지·주간·월간·가이드·안내 페이지 공통)
// 어떤 글을 몇 번 봤는지, 어디서 왔는지(검색·사이트 안·직접·기타 4가지)만 센다. 주소·검색어·개인정보는 보내지 않는다.
// 메인 화면과 같은 임의의 브라우저 번호로 방문자 수에도 넣는다 (같은 사람은 한 번).
(function () {
  if (location.protocol !== "https:") return;
  const URL_ = "https://driftbtc.vercel.app/api/visit";
  const path = location.pathname.replace(/^\/(driftbtc\/)?/, "").replace(/index\.html$/, "") || "index";
  let ref = "direct";
  if (document.referrer) {
    try {
      const h = new URL(document.referrer).hostname;
      ref = h === location.hostname ? "internal"
        : /(^|\.)(google|naver|daum|bing|yahoo|duckduckgo|zum|ecosia|yandex)\./.test(h) ? "search" : "other";
    } catch (e) { ref = "other"; }
  }
  let vid = "";
  try {
    vid = localStorage.getItem("driftbtc_vid") || "";
    if (!vid) {
      vid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("driftbtc_vid", vid);
    }
  } catch (e) {}
  fetch(`${URL_}?page=${encodeURIComponent(path)}&ref=${ref}${vid ? "&vid=" + vid : ""}`, { keepalive: true, cache: "no-store" }).catch(() => {});
})();

// 📚 일지·주간·월간 글 끝에 '다음에 읽을 글': 이전·다음 글(사이트맵에서 찾음) + 그날 상황에 맞는 가이드 1~2편
(async function () {
  const m = location.pathname.match(/(daily|weekly|monthly)\/(\d{4}-\d{2}(?:-\d{2})?)\.html$/);
  if (!m || document.querySelector(".read-next")) return;
  const [, kind, stem] = m;
  const NAME = { daily: "일지", weekly: "주간 일지", monthly: "성적표" };
  const label = (s) => kind === "monthly" ? `${+s.slice(5, 7)}월 ${NAME[kind]}` : `${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일 ${NAME[kind]}`;
  let list = [];
  try {
    const xml = await (await fetch("../sitemap.xml", { cache: "no-store" })).text();
    const re = new RegExp("/" + kind + "/([0-9]{4}-[0-9]{2}(?:-[0-9]{2})?)[.]html<", "g");
    list = [...new Set([...xml.matchAll(re)].map((x) => x[1]))].sort();
  } catch (e) {}
  const i = list.indexOf(stem);
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  // 그날 상황에 맞는 가이드: 급변이 있었으면 급변 통계, 청산 이야기가 있으면 강제 청산, 늘 예측 범위 읽는 법
  const text = document.querySelector("main")?.textContent || "";
  const guides = [];
  if (/움직인 순간이\s*\d+번/.test(text) || kind === "weekly") guides.push(["sudden-moves", "5분 1% 급변, 따라가야 할까? 1년치 통계"]);
  if (/청산/.test(text) && kind !== "monthly") guides.push(["liquidations", "강제 청산 데이터 보는 법"]);
  if (kind === "monthly") guides.push(["win-rate-reward", "승률과 손익비: 손익분기 승률과 기대값 계산"]);
  guides.push(["forecast-range", "예측 범위 읽는 법 (68%·95% 구간)"]);
  const box = document.createElement("section");
  box.className = "read-next";
  const a = (href, t) => { const x = document.createElement("a"); x.href = href; x.textContent = t; return x; };
  const h = document.createElement("h2"); h.textContent = "📚 다음에 읽을 글";
  const nav = document.createElement("div"); nav.className = "nav";
  nav.append(prev ? a(`${prev}.html`, "← " + label(prev)) : document.createElement("span"), next ? a(`${next}.html`, label(next) + " →") : a("./", `${NAME[kind]} 전체 보기`));
  const ul = document.createElement("ul");
  for (const [g, t] of guides.slice(0, 2)) { const li = document.createElement("li"); li.append(a(`../guide/${g}.html`, "📖 " + t)); ul.append(li); }
  box.append(h, nav, ul);
  const anchor = document.querySelector('.ad-slot[data-ad-slot="article-end"]') || document.querySelector("main footer");
  anchor ? anchor.before(box) : document.querySelector("main")?.append(box);
})();
