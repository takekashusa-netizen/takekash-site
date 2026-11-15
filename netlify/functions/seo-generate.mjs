// POST /api/seo-generate  { topic, category, brand, extra, platform, seed }
// Header Authorization: Bearer <token>  (subscriber)  — or none for the limited free trial.
import { getStore } from "@netlify/blobs";
import engine from "../../lib/seo/engine.cjs";
import access from "../../lib/seo/access.cjs";
import funnel from "../../lib/seo/funnel.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app", ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => {
  const o = req.headers.get("origin");
  return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : {};
};
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });

// Live search demand: what people are actually typing into YouTube search right now
// (Google's public suggest endpoint, no key). Fails soft: no network -> no extra tier.
async function searchedNow(q, ms = 1500) {
  if (!q) return [];
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=en&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
    if (!r.ok) return [];
    const d = await r.json();
    return (Array.isArray(d[1]) ? d[1] : []).map((x) => String(x).toLowerCase().trim()).filter((x) => x && x !== q && x.length <= 60).slice(0, 10);
  } catch { return []; } finally { clearTimeout(t); }
}

function addSearched(out, searched) {
  if (!searched.length) return out;
  out.tiers = out.tiers || {};
  out.tiers.searched = searched;
  const yt = out.results && out.results.youtube;
  if (yt && yt.tags) {   // real searches go first in the YouTube tag budget
    const packed = engine.packYouTubeTags(searched.slice(0, 5).concat(yt.tags.filter((t) => !searched.includes(t))), 500);
    yt.tags = packed.tags; yt.tagChars = packed.used;
  }
  return out;
}

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
    if (!access.TRIAL_PLATFORMS.has(opts.platform)) { await funnel.track(getStore("funnel"), "locked_feature"); return json(req, 403, { error: "All-platforms mode is for members. Pick one platform for your free run.", code: "locked" }); }
    opts.seed = 7; // no remixing on trial
    const t = await access.useTrial(store, context.ip, env);
    await funnel.track(getStore("funnel"), t.ok ? "trial_run" : "trial_limit_hit");
    if (!t.ok) return json(req, 429, { error: "You've used your free runs for this week.", code: "trial_used", resetsAt: t.resetsAt });
    const searchedT = await searchedNow(engine.generate({ ...opts, platform: "youtube" }).analysis.core);
    const limited = access.limitForTrial(engine.generate(opts));
    if (searchedT.length) limited.searchedPreview = searchedT.slice(0, 2);   // tease 2 live searches on the trial
    return json(req, 200, { access: "trial", remaining: t.remaining, ...limited });
  }
  if (!engine.PLATFORMS[opts.platform] && opts.platform !== "all") opts.platform = "all";
  const full = addSearched(engine.generate(opts), await searchedNow(engine.generate({ ...opts, platform: "youtube" }).analysis.core));
  // Members: every run is saved (last 30) so it's on any device later.
  if (email) {
    try {
      const ms = getStore("seo-members"), key = `history:${email}`;
      const hist = (await ms.get(key, { type: "json" })) || [];
      const run = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
                    input: { topic: opts.topic, category: opts.category, brand: opts.brand, extra: opts.extra, platform: opts.platform }, output: full };
      await ms.setJSON(key, [run].concat(hist).slice(0, 30));
      full.savedId = run.id;
    } catch (e) { console.error("history save failed", e); }
  }
  await funnel.track(getStore("funnel"), "paid_run");
  return json(req, 200, { access: "paid", ...full });
};

export const config = { path: "/api/seo-generate" };
