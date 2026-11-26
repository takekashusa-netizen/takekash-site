// GET /api/portal  (Authorization: Bearer <sign-in token>)  -> { email, allowance, jobs[] }
// POST /api/portal { email }  -> emails a 30-day portal sign-in link to anyone who has clip jobs or a plan.
// POST always answers the same way, so it never reveals who is or isn't a customer.
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";
import portal from "../../lib/portal.cjs";
import mail from "../../lib/mail.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app", ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" } : {}; };
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const SAME = { ok: true, message: "If that email has TakeKash clips or a plan, a sign-in link is on its way. Check your inbox." };

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const env = process.env;
  const stores = { requests: getStore("clip-requests"), quota: getStore("clip-quota"), access: getStore("seo-access") };

  if (req.method === "GET") {
    const auth = req.headers.get("authorization") || "";
    const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), env) : null;
    if (!email) return json(req, 401, { error: "Your sign-in link expired. Request a new one." });
    return json(req, 200, await portal.overview(stores, email));
  }

  if (req.method === "POST") {
    let email;
    try { email = access.normEmail((await req.json()).email); } catch { return json(req, 400, { error: "Invalid request" }); }
    if (!access.validEmail(email)) return json(req, 400, { error: "Enter a valid email" });

    const rlStore = getStore("portal"), rlKey = `rl:${email}`, now = Date.now();   // 3 links per address per hour
    const rl = (await rlStore.get(rlKey, { type: "json" })) || { start: now, n: 0 };
    if (now - rl.start > 3600e3) { rl.start = now; rl.n = 0; }
    if (rl.n >= 3) return json(req, 200, SAME);
    rl.n += 1; await rlStore.setJSON(rlKey, rl);

    const known = access.isOwner(email, env) || (await portal.hasJobs(stores.requests, email)) || (await access.isPaid(stores.access, email));
    if (!known) return json(req, 200, SAME);
    const origin = ORIGINS.has(req.headers.get("origin")) ? req.headers.get("origin") : (env.SITE_URL || "https://takekash.netlify.app");
    const link = `${origin}/portal?t=${encodeURIComponent(access.signToken(email, env))}`;
    try {
      await mail.send(env, { to: email, subject: "Your TakeKash clips portal",
        html: `<p>Tap to open your clips, downloads and allowance:</p><p><a href="${link}"><b>Open my portal →</b></a></p><p>The link works for 30 days on this device. Didn't ask for it? Ignore this email.</p>` });
    } catch (e) { console.error("portal link email failed", e); return json(req, 502, { error: "Couldn't send the email right now. Try again in a minute." }); }
    return json(req, 200, SAME);
  }
  return json(req, 405, { error: "Method not allowed" });
};

export const config = { path: "/api/portal" };
