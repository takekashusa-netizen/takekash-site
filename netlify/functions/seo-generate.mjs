// POST /api/seo-generate  { topic, category, brand, extra, platform, seed }
// Header Authorization: Bearer <token>  (subscriber)  — or none for the limited free trial.
import { getStore } from "@netlify/blobs";
import engine from "../../lib/seo/engine.cjs";
import access from "../../lib/seo/access.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app"]);
const cors = (req) => {
  const o = req.headers.get("origin");
  return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : {};
};
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  let input;
  try { input = await req.json(); } catch { return json(req, 400, { error: "Invalid request" }); }
  const topic = String(input.topic || "").slice(0, 200).trim();
  if (!topic) return json(req, 400, { error: "Enter a topic" });

  const env = process.env;
  const store = getStore("seo-access");

  // Who is asking?
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  let tier = "trial", email = null;
  if (token) {
    email = access.verifyToken(token, env);
    if (email && (access.isOwner(email, env) || (await access.isPaid(store, email)))) tier = "paid"; // owner via signed email link, never a shared key       // re-checked every run: cancels take effect
    else if (email) return json(req, 402, { error: "Your plan isn't active. Renew to keep full access.", code: "inactive" });
    else return json(req, 401, { error: "Sign-in expired. Get a new link.", code: "expired" });
  }

  const opts = {
    topic, category: String(input.category || "auto"), brand: String(input.brand || "").slice(0, 60),
    extra: String(input.extra || "").slice(0, 200), platform: String(input.platform || "youtube"), seed: Number(input.seed) || 7,
  };

  if (tier === "trial") {
    if (!access.TRIAL_PLATFORMS.has(opts.platform)) return json(req, 403, { error: "All-platforms mode is for members. Pick one platform for your free run.", code: "locked" });
    opts.seed = 7; // no remixing on trial
    const t = await access.useTrial(store, context.ip, env);
    if (!t.ok) return json(req, 429, { error: "You've used your free runs for this week.", code: "trial_used", resetsAt: t.resetsAt });
    return json(req, 200, { access: "trial", remaining: t.remaining, ...access.limitForTrial(engine.generate(opts)) });
  }
  if (!engine.PLATFORMS[opts.platform] && opts.platform !== "all") opts.platform = "all";
  return json(req, 200, { access: "paid", ...engine.generate(opts) });
};

export const config = { path: "/api/seo-generate" };
