// 📱 홈 화면에 설치 (PWA): 서비스 워커 등록 + 꼬리글의 "앱처럼 설치" 줄
// - 안드로이드·PC 크롬/엣지: 브라우저가 설치 가능하다고 알려 주면(beforeinstallprompt) 버튼을 보여 주고 눌러서 바로 설치
// - 아이폰 사파리: 자동 설치가 없어 "공유 → 홈 화면에 추가" 방법을 안내
// - 이미 설치된 앱으로 열었으면 아무것도 안 보인다
if ("serviceWorker" in navigator && location.protocol === "https:") { // 로컬 미리보기에서는 끈다 (낡은 스크립트가 남아 헷갈리지 않게)
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

(function () {
  const el = document.getElementById("pwa-install");
  if (!el) return;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) { try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=pwa-open"); } catch (e) {} return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
  let deferred = null;
  const show = () => { el.hidden = false; };
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; show(); });
  addEventListener("appinstalled", () => { el.hidden = true; try { navigator.sendBeacon?.(window.VISIT_URL + "?sec=pwa-installed"); } catch (e) {} });
  if (ios) show();
  el.addEventListener("click", async (ev) => {
    ev.preventDefault();
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      el.hidden = true;
    } else if (ios) {
      const tip = document.getElementById("pwa-tip");
      if (tip) tip.hidden = !tip.hidden;
    }
  });
})();
