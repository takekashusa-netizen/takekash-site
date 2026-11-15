// SEO Studio access rules. Pure logic: the storage object is passed in, so it can be tested.
// Paid = an active TakeKash subscription (recorded by the Stripe webhook).
// Trial = anonymous, server-enforced limits.
const crypto = require("crypto");

const TRIAL_RUNS = 3;                       // free generations...
const TRIAL_WINDOW_MS = 7 * 24 * 3600e3;    // ...per 7 days, per visitor IP
const TOKEN_TTL_MS = 30 * 24 * 3600e3;      // sign-in link / session lasts 30 days
const TRIAL_PLATFORMS = new Set(["youtube", "shorts", "tiktok", "instagram", "twitch", "website"]);

const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const b64u = (s) => Buffer.from(s).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url").toString("utf8");

// Signing key derives from a secret already in Netlify (no new env var needed); SEO_TOKEN_SECRET overrides.
function signingKey(env) {
  const base = env.SEO_TOKEN_SECRET || env.STRIPE_WEBHOOK_SECRET;
  if (!base) throw new Error("No signing secret configured");
  return crypto.createHmac("sha256", base).update("takekash-seo-token-v1").digest();
}
function signToken(email, env, now = Date.now()) {
  const body = b64u(JSON.stringify({ e: normEmail(email), x: now + TOKEN_TTL_MS }));
  const mac = crypto.createHmac("sha256", signingKey(env)).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verifyToken(token, env, now = Date.now()) {
  if (typeof token !== "string" || token.length > 600 || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = crypto.createHmac("sha256", signingKey(env)).update(body).digest("base64url");
  const a = Buffer.from(mac || ""), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(unb64u(body)); return p.x > now && p.e ? p.e : null; } catch { return null; }
}

// Entitlements store layout:  email:<email> -> {active, sub, since, updated}   sub:<subId> -> email
async function grant(store, email, sub, now = Date.now(), plan = null) {
  email = normEmail(email); if (!email) return;
  const prev = (await store.get(`email:${email}`, { type: "json" })) || {};
  await store.setJSON(`email:${email}`, { active: true, sub: sub || prev.sub || null, plan: plan || prev.plan || "creator", since: prev.since || now, updated: now });
  if (sub) await store.setJSON(`sub:${sub}`, { email });
}
async function setSubStatus(store, sub, active, now = Date.now()) {
  const link = await store.get(`sub:${sub}`, { type: "json" });
  if (!link || !link.email) return false;
  const prev = (await store.get(`email:${link.email}`, { type: "json" })) || {};
  await store.setJSON(`email:${link.email}`, { ...prev, active, sub, updated: now });
  return true;
}
// Owner = OWNER_EMAIL (already set in Netlify for order alerts). Proven by the emailed link, so it can't be spoofed.
function isOwner(email, env) { const o = normEmail(env.OWNER_EMAIL); return !!o && normEmail(email) === o; }
async function isPaid(store, email) {
  const rec = await store.get(`email:${normEmail(email)}`, { type: "json" });
  return !!(rec && rec.active);
}

// Trial counter keyed by a hash of the IP (no raw IPs stored).
const ipKey = (ip, env) => "trial:" + crypto.createHmac("sha256", signingKey(env)).update(String(ip || "unknown")).digest("hex").slice(0, 32);
async function useTrial(store, ip, env, now = Date.now()) {
  const key = ipKey(ip, env);
  let rec = (await store.get(key, { type: "json" })) || { start: now, used: 0 };
  if (now - rec.start > TRIAL_WINDOW_MS) rec = { start: now, used: 0 };
  if (rec.used >= TRIAL_RUNS) return { ok: false, remaining: 0, resetsAt: rec.start + TRIAL_WINDOW_MS };
  rec.used += 1;
  await store.setJSON(key, rec);
  return { ok: true, remaining: TRIAL_RUNS - rec.used, resetsAt: rec.start + TRIAL_WINDOW_MS };
}

// Trial output: one platform, top 3 titles, description, 8 tags or hashtags capped, no tag tiers.
function limitForTrial(out) {
  const results = {};
  for (const [k, r] of Object.entries(out.results)) {
    results[k] = { ...r, titles: r.titles.slice(0, 3), locked: true };
    if (r.tags) { results[k].tags = r.tags.slice(0, 8); results[k].tagChars = results[k].tags.join(", ").length; }
    if (r.hashtags) results[k].hashtags = r.hashtags.slice(0, 3);
    if (r.twitchTags) results[k].twitchTags = r.twitchTags.slice(0, 4);
    if (r.keywords) results[k].keywords = { focus: r.keywords.focus, secondary: [] };
  }
  return { analysis: out.analysis, results, tiers: null };
}

module.exports = { TRIAL_RUNS, TRIAL_WINDOW_MS, TRIAL_PLATFORMS, normEmail, validEmail, signToken, verifyToken, grant, setSubStatus, isOwner, isPaid, useTrial, limitForTrial };
