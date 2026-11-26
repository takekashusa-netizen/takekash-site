// TakeKash Lists API
//   POST /api/subscribe            {email, name?, list, source?}   -> double opt-in email (same answer always)
//   POST /api/subscribe/confirm    {e, t}                          -> activates + starts the list's welcome sequence
//   POST /api/unsubscribe?e=&t=    (RFC 8058 one-click; also used by the /unsubscribe page)
import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import access from "../../lib/seo/access.cjs";
import lists from "../../lib/lists.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app", ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : {}; };
const json = (req, s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const SAME = { ok: true, message: "Check your inbox to confirm. If you don't see it, look in spam or promotions." };

async function body(req) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) return req.json();
  if (type.includes("form")) return Object.fromEntries(new URLSearchParams(await req.text()));
  return {};
}

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  await access.ensureSigningSecret(getStore("keys"));
  const env = process.env, store = getStore("mail"), url = new URL(req.url), path = url.pathname;
  await lists.ensureDefaults(store);

  if (path === "/api/unsubscribe") {                           // one-click: params in the URL, body may be "List-Unsubscribe=One-Click"
    let e = url.searchParams.get("e"), t = url.searchParams.get("t");
    if (!e || !t) { try { ({ e, t } = await body(req)); } catch {} }
    const r = await lists.unsubscribe(store, env, e, t);
    return json(req, r.error ? 400 : 200, r.error ? { error: r.error } : { ok: true, message: "You're unsubscribed. You won't get any more of these emails." });
  }

  let b; try { b = await body(req); } catch { return json(req, 400, { error: "Invalid request" }); }

  if (path === "/api/subscribe/confirm") {
    const r = await lists.confirm(store, env, b.e, b.t);
    return json(req, r.error ? 400 : 200, r.error ? { error: r.error } : { ok: true, message: "You're in. Watch your inbox." });
  }

  // /api/subscribe — rate limit 5 per visitor per hour, and never reveal whether an address was already known
  const ipHash = crypto.createHash("sha256").update(String(context?.ip || "x")).digest("hex").slice(0, 24);
  const rlKey = `rl:${ipHash}`, now = Date.now(), rl = (await store.get(rlKey, { type: "json" })) || { start: now, n: 0 };
  if (now - rl.start > 3600e3) { rl.start = now; rl.n = 0; }
  if (rl.n >= 5) return json(req, 429, { error: "Too many signups from here. Try again later." });
  rl.n += 1; await store.setJSON(rlKey, rl);
  if (b.website) return json(req, 200, SAME);                  // honeypot field: bots fill it, people never see it
  const r = await lists.subscribe(store, env, { email: b.email, name: b.name, list: String(b.list || ""), source: b.source, ipHash });
  if (r.error) return json(req, 400, { error: r.error });
  return json(req, 200, SAME);
};

export const config = { path: ["/api/subscribe", "/api/subscribe/confirm", "/api/unsubscribe"] };
