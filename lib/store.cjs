// TakeKash Store: done-for-you clip packages sold on takekash.com (replaces selling through Fiverr).
// Prices live server-side only; the browser sends a package id, never an amount.
// Prices match the live Fiverr gig today; pricing decision D1 (MASTER_LEDGER) may change them here, in one place.
const crypto = require("crypto");

const PACKAGES = {
  basic:    { sku: "basic",    name: "3 hand-picked clips",  clips: 3,  price: 2500, blurb: "Your 3 best moments, 9:16 with word-by-word captions, titles and hashtags." },
  standard: { sku: "standard", name: "6 hand-picked clips",  clips: 6,  price: 5000, blurb: "6 clips from one stream, captioned and ready to post on TikTok, Reels and Shorts." },
  premium:  { sku: "premium",  name: "10 hand-picked clips", clips: 10, price: 9000, blurb: "10 clips from one stream, plus bonus moments when the stream has more worth posting." },
};
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const VIDEO_HOSTS = /^(www\.|m\.|clips\.)?(twitch\.tv|kick\.com|youtube\.com|youtu\.be)$/i;

function key() {
  const base = process.env.SEO_TOKEN_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!base) throw new Error("No signing secret (call access.ensureSigningSecret first)");
  return crypto.createHmac("sha256", base).update("store-order-v1").digest();
}
// Proves the stream link comes from the buyer's own thanks page / receipt email.
const orderToken = (sid) => crypto.createHmac("sha256", key()).update(String(sid)).digest("base64url").slice(0, 32);
function checkToken(sid, t) {
  if (typeof t !== "string" || !SESSION_RE.test(String(sid))) return false;
  const want = orderToken(sid);
  return t.length === want.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want));
}
function validStreamUrl(url) {
  try { const u = new URL(String(url || "").trim()); return u.protocol === "https:" && VIDEO_HOSTS.test(u.hostname) ? u.toString() : null; }
  catch { return null; }
}
const publicOrder = (o) => o && ({ id: o.sid.slice(-10), package: PACKAGES[o.sku] ? PACKAGES[o.sku].name : o.sku, clips: o.clips, status: o.status, url: o.url || null, paidAt: o.paidAt, jobId: o.jobId || null });

module.exports = { PACKAGES, SESSION_RE, orderToken, checkToken, validStreamUrl, publicOrder };
