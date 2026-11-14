// POST /api/seo-auth { email }  → emails a 30-day sign-in link to subscribers.
// Always answers the same way, so it never reveals who is or isn't a customer.
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app"]);
const cors = (req) => {
  const o = req.headers.get("origin");
  return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : {};
};
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const SAME = { ok: true, message: "If that email has an active TakeKash plan, a sign-in link is on its way. Check your inbox." };

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  let email;
  try { email = access.normEmail((await req.json()).email); } catch { return json(req, 400, { error: "Invalid request" }); }
  if (!access.validEmail(email)) return json(req, 400, { error: "Enter a valid email" });

  const env = process.env;
  const store = getStore("seo-access");

  // At most 3 link emails per address per hour.
  const rlKey = `rl:${email}`, now = Date.now();
  const rl = (await store.get(rlKey, { type: "json" })) || { start: now, n: 0 };
  if (now - rl.start > 3600e3) { rl.start = now; rl.n = 0; }
  if (rl.n >= 3) return json(req, 200, SAME);
  rl.n += 1; await store.setJSON(rlKey, rl);

  if (!(await access.isPaid(store, email))) return json(req, 200, SAME);

  const origin = ORIGINS.has(req.headers.get("origin")) ? req.headers.get("origin") : (env.SITE_URL || "https://takekash.netlify.app");
  const link = `${origin}/seo?t=${encodeURIComponent(access.signToken(email, env))}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL, to: email, subject: "Your TakeKash SEO Studio sign-in link",
      html: `<p>Tap to unlock SEO Studio on this device:</p><p><a href="${link}"><b>Open SEO Studio →</b></a></p><p>The link works for 30 days. Didn't ask for it? Ignore this email.</p>`,
    }),
  }).catch((e) => ({ ok: false, text: async () => String(e) }));
  if (!res.ok) { console.error("seo-auth email failed:", await res.text()); return json(req, 502, { error: "Couldn't send the email right now. Try again in a minute." }); }
  return json(req, 200, SAME);
};

export const config = { path: "/api/seo-auth" };
