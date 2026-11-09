// 카카오 애드핏 광고 자리 (rudals-portal 의 ads.js 와 같은 방식)
// 화면 너비를 보고 휴대폰용·PC용 중 '하나만' 불러온다. 둘 다 넣고 하나를 숨기면 보이지 않는 광고가 되어 정책 위반이 될 수 있다.
// 자리: <div class="ad-slot" data-ad-slot="이름"></div>
//   article-mid : 가이드 글 중간 (이 파일이 두 번째 소제목 앞에 자동으로 만든다, 소제목 4개 미만 글은 없음)
//   article-end : 가이드 글·목록·소개 끝
//   app-bottom  : 메인 화면 맨 아래 (차트·예측·신호등 사이에는 넣지 않는다)
// 광고 칸 요청·채움 횟수만 rudals.app 공용 집계(/api/ad)로 보낸다: 앱 이름·자리·기기 종류·상태뿐.
(() => {
  if (location.hostname !== "btc.rudals.app") return; // 로컬·미리보기 주소에서는 광고를 부르지 않는다
  const PC = window.matchMedia("(min-width: 760px)").matches;
  const UNITS = {
    "article-mid": PC ? ["DAN-QKnefxDZP2HIWVqN", 300, 250] : ["DAN-gnULSc4AfIkijj4B", 320, 100],
    "article-end": ["DAN-nawuRXsR5yaK5dwz", 300, 250],
    "app-bottom": PC ? ["DAN-ieRs8ZDzCb2l2F49", 728, 90] : ["DAN-AdaQYd3JVEAaqKGe", 320, 100],
  };
  let loaded = false;
  const quiet = navigator.webdriver;
  const report = (slot, state) => {
    if (quiet) return;
    const q = new URLSearchParams({ app: "btc", slot, dev: PC ? "pc" : "m", state });
    fetch("https://rudals.app/api/ad?" + q, { cache: "no-store", keepalive: true, credentials: "omit" }).catch(() => {});
  };
  // 애드핏은 광고를 받으면 칸 안에 iframe 을 넣고 보이게 바꾼다. 20초 안에 그렇게 되면 '채움'
  const watch = (ins, slot) => {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (ins.querySelector("iframe") && ins.style.display !== "none") {
        clearInterval(t);
        report(slot, "fill");
      } else if (tries >= 20) clearInterval(t);
    }, 1000);
  };

  function fill(el) {
    const u = UNITS[el.dataset.adSlot];
    if (!u || el.dataset.filled) return;
    const ins = document.createElement("ins");
    ins.className = "kakao_ad_area";
    ins.style.display = "none";
    ins.setAttribute("data-ad-unit", u[0]);
    ins.setAttribute("data-ad-width", String(u[1]));
    ins.setAttribute("data-ad-height", String(u[2]));
    el.appendChild(ins);
    el.dataset.filled = "1";
    report(el.dataset.adSlot, "req");
    watch(ins, el.dataset.adSlot);
  }

  function load() {
    if (loaded) return;
    loaded = true;
    const s = document.createElement("script");
    s.src = "https://t1.kakaocdn.net/kas/static/ba.min.js";
    s.async = true;
    document.body.appendChild(s);
  }

  // 가이드 글 중간 자리
  const page = document.querySelector("main.page");
  if (page && /\/guide\/[^/]+\.html$/.test(location.pathname)) {
    const heads = page.querySelectorAll(":scope > h2");
    if (heads.length >= 4) {
      const slot = document.createElement("div");
      slot.className = "ad-slot";
      slot.dataset.adSlot = "article-mid";
      slot.setAttribute("aria-label", "광고");
      heads[1].before(slot);
    }
  }

  document.querySelectorAll("[data-ad-slot]").forEach(fill);
  if (document.querySelector(".kakao_ad_area")) load();
})();
