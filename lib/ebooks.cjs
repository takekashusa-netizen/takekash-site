// Ebook store: catalog, signed download tokens, encrypted-at-rest file storage.
const crypto = require("crypto");
const PACKS = [
  ["ecommerce", "E-Commerce & Amazon Seller", "Listings, ads and review responses in minutes, not hours.", "🛒", "#f59e0b", ["Listing title + bullet generator", "A+ Content copy", "Backend SEO keywords", "Review response templates", "PPC ad copy", "Seasonal promo copy"]],
  ["real-estate", "Real Estate Agent", "From listing description to closing gift note: your whole client workflow.", "🏡", "#22c55e", ["MLS listing descriptions", "Just listed / just sold posts", "3-part buyer follow-up", "Objection handling scripts", "Expired listing letter", "Closing note + referral ask"]],
  ["insurance", "Insurance Agent", "Policy explainers, renewals and objection scripts, compliance-aware by design.", "🛡️", "#3b82f6", ["Plain-language policy explainer", "Renewal / cross-sell email", "3-touch lead follow-up", "Life-event outreach (5 scenarios)", "Claims walkthrough", "Lapsed policy win-back"]],
  ["legal", "Legal Client Communications", "Intake summaries, status updates and document requests for PI & immigration teams.", "⚖️", "#a78bfa", ["Client intake summary", "Demand letter skeleton", "Status update email", "Document request checklist", "Settlement explainer", "Case closing letter"]],
  ["events", "Wedding & Event Planner", "Vendor emails, client proposals and day-of timelines.", "💍", "#ec4899", ["Vendor inquiry email", "Client proposal pitch", "Day-of timeline (table)", "Budget explainer", "Difficult conversation scripts", "Thank you + review request"]],
  ["fitness", "Fitness & Nutrition Coach", "Onboarding, check-ins and program write-ups that scale your client load.", "💪", "#ef4444", ["Onboarding + intake summary", "Program write-up narrative", "Weekly check-in", "Plateau / setback script", "Renewal / upsell email", "Client win celebration"]],
  ["recruiting", "Recruiter & HR", "Job descriptions, outreach and client updates for high candidate volume.", "🤝", "#14b8a6", ["Job description generator", "Cold sourcing outreach", "Candidate-friendly rejection", "Offer stage message", "Client search update", "Post-placement check-in"]],
  ["finance", "Financial Advisor", "Newsletters, meeting recaps and life-event outreach with compliance guardrails.", "📈", "#10b981", ["Market update newsletter", "Meeting recap email", "Portfolio review talking points", "Life-event outreach", "Volatility reassurance email", "Webinar follow-up"]],
  ["property", "Property Manager", "Tenant communications, notices and listings for every unit.", "🔑", "#f97316", ["Tenant welcome email", "Maintenance acknowledgment", "Rent reminder / late notice", "Lease renewal offer", "Move-out + deposit explainer", "Rental listing description"]],
  ["medical", "Medical & Dental Practice Admin", "HIPAA-aware reminders, billing explanations and review responses.", "🩺", "#06b6d4", ["Appointment reminders", "Insurance appeal skeleton", "Patient recall message", "HIPAA-safe review responses", "Billing / payment plan email", "New patient welcome"]],
].map(([sku, title, tagline, icon, color, highlights], i) => ({ sku, n: i + 1, title: `${title} AI Prompt Pack`, short: title, tagline, icon, color, highlights, price: 2700, files: [sku] }));
const BUNDLE = { sku: "bundle", title: "The Complete Professional Prompt Library (all 10 packs)", short: "All 10 packs", tagline: "100 done-for-you AI prompts across 10 professional niches.", icon: "📚", color: "#2fe07c", price: 9700, files: PACKS.map((p) => p.sku) };
const CATALOG = Object.fromEntries([...PACKS, BUNDLE].map((p) => [p.sku, p]));
const LICENSE = "Licensed for use in your own work and business. Resale or redistribution of the files is not permitted.";

const keyFrom = (label) => {
  const base = process.env.SEO_TOKEN_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!base) throw new Error("no signing secret configured");
  return crypto.createHmac("sha256", base).update(label).digest();
};
function signDownload(sid, sku, ttlSec = 7 * 86400, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ s: sid, k: sku, x: Math.floor(now / 1000) + ttlSec })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", keyFrom("ebook-dl-v1")).update(body).digest("base64url")}`;
}
function verifyDownload(tok, now = Date.now()) {
  if (typeof tok !== "string" || tok.length > 400 || !tok.includes(".")) return null;
  const [body, mac] = tok.split(".");
  const want = crypto.createHmac("sha256", keyFrom("ebook-dl-v1")).update(body).digest("base64url");
  if (!mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.x > now / 1000 && CATALOG[p.k] && CATALOG[p.k].files.length === 1 ? p : null; } catch { return null; }
}
// AES-256-GCM at rest (key EBOOK_KEY, else derived from the site secret)
const fileKey = () => process.env.EBOOK_KEY ? Buffer.from(process.env.EBOOK_KEY, "base64url") : keyFrom("ebook-file-v1");
function seal(buf) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", fileKey(), iv); const enc = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), enc]); }
function open(buf) { const b = Buffer.from(buf), d = crypto.createDecipheriv("aes-256-gcm", fileKey(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]); }
const validSession = (s) => /^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(String(s || ""));
module.exports = { PACKS, BUNDLE, CATALOG, LICENSE, signDownload, verifyDownload, seal, open, validSession };
