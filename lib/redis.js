// Redis 연결 공용 모듈 (api/visit.js 와 같은 방식). 일반 Redis(REDIS_URL, TCP) 또는 Upstash REST 둘 다 지원.
import { createClient } from "redis";

export function redisConfig() {
  const env = process.env;
  if (env.REDIS_URL) return { tcp: env.REDIS_URL };
  const urlKey =
    Object.keys(env).find((k) => /REST_API_URL$/.test(k) && env[k]) ||
    (env.UPSTASH_REDIS_REST_URL && "UPSTASH_REDIS_REST_URL") ||
    Object.keys(env).find((k) => /_URL$/.test(k) && /^https:\/\/[^/]+\.upstash\.io/.test(env[k] || ""));
  if (!urlKey) return null;
  const tokenKey = urlKey.replace(/URL$/, "TOKEN");
  const token = env[tokenKey] || env.UPSTASH_REDIS_REST_TOKEN;
  return token ? { url: env[urlKey].replace(/\/$/, ""), token } : null;
}

let tcpClient = null;
async function tcp(url) {
  if (!tcpClient) {
    const c = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false } });
    c.on("error", () => { tcpClient = null; });
    c.on("end", () => { tcpClient = null; });
    tcpClient = c.connect().then(() => c).catch((e) => { tcpClient = null; throw e; });
  }
  return tcpClient;
}

// commands: [["GET","key"], ...] → 결과 배열
export async function redis(cfg, commands) {
  if (cfg.tcp) {
    const c = await tcp(cfg.tcp);
    return Promise.all(commands.map((cmd) => c.sendCommand(cmd.map(String))));
  }
  const res = await fetch(cfg.url + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  return (await res.json()).map((r) => r.result);
}
