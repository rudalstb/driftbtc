// 📱 BTC Agent 서비스 워커: 홈 화면에 설치할 수 있게 하고, 한 번 본 화면은 빠르게·끊겨도 열리게 한다.
// - 페이지(HTML)와 data/*.json: 늘 네트워크 먼저 (최신 예측이 중요), 끊겼을 때만 저장본
// - 스크립트·스타일·그림: 저장본을 바로 쓰고 뒤에서 새로 받아 둔다 (배포 때마다 ?v= 가 바뀌어 낡은 파일이 남지 않음)
// - 다른 사이트(거래소·API) 요청은 건드리지 않는다
const CACHE = "btcagent-v1";

// 같은 파일은 최신 1개만 남긴다 (data/*.json?t=…, bundle.js?v=… 처럼 주소 끝이 매번 바뀌어 쌓이지 않게)
async function keep(c, req, res) {
  const path = new URL(req.url).pathname;
  for (const k of await c.keys()) if (new URL(k.url).pathname === path && k.url !== req.url) await c.delete(k);
  await c.put(req, res);
}

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "favicon.svg", "icons/icon-192.png"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await fetch(req);
    if (r.ok) await keep(c, req, r.clone());
    return r;
  } catch (e) {
    return (await c.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? c.match("./") : Response.error());
  }
}

async function staleWhileRevalidate(req, ev) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req); // 주소까지 같은 것만 (새 버전 ?v= 는 새로 받는다)
  const fresh = fetch(req).then(async (r) => { if (r.ok) await keep(c, req, r.clone()); return r; }).catch(() => hit);
  if (hit) { ev.waitUntil(fresh); return hit; }
  return fresh;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate" || url.pathname.includes("/data/") || url.pathname.endsWith(".html")) e.respondWith(networkFirst(req));
  else if (/\.(js|css|svg|png|webmanifest)$/.test(url.pathname)) e.respondWith(staleWhileRevalidate(req, e));
});

// 🔔 급변 푸시 (api/push.js 가 보냄): 알림을 띄우고, 누르면 사이트를 연다
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "BTC Agent", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "BTC Agent", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || "btc-agent",
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./";
  e.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(c.url).origin === location.origin && "focus" in c) { c.navigate?.(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
