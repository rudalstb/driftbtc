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
