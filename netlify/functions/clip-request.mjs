// POST /api/clip-request { url, email }  — done-for-you clip order from the homepage.
// Saves the request (Netlify Blobs "clip-requests"), emails the owner the order, and confirms to the customer.
import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import funnel from "../../lib/seo/funnel.cjs";

// HMAC of the request id with the site's existing signing secret: proves the click came from the emailed link.
export function confirmToken(id) {
  const base = process.env.SEO_TOKEN_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!base) throw new Error("no signing secret configured");   // never fall back to a guessable key
  const key = crypto.createHmac("sha256", base).update("clip-confirm-v1").digest();
  return crypto.createHmac("sha256", key).update(String(id)).digest("base64url").slice(0, 32);
}

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app"]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {}; };
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const VIDEO_HOSTS = /^(www\.|m\.|clips\.)?(twitch\.tv|kick\.com|youtube\.com|youtu\.be)$/i;

async function sendEmail(env, to, subject, html, replyTo) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  let url, email;
  try { ({ url, email } = await req.json()); } catch { return json(req, 400, { error: "Invalid request." }); }
  email = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(req, 400, { error: "Enter a valid email." });
  let host;
  try { const u = new URL(String(url || "").trim()); host = u.hostname; url = u.toString(); } catch { return json(req, 400, { error: "Paste a full stream link (starting with https://)." }); }
  if (!VIDEO_HOSTS.test(host)) return json(req, 400, { error: "Use a Twitch, Kick or YouTube link." });

  const env = process.env;
  const store = getStore("clip-requests");
  // max 3 requests per visitor per day
  const ipKey = "rl:" + crypto.createHash("sha256").update(String(context.ip || "x")).digest("hex").slice(0, 24);
  const now = Date.now(), rl = (await store.get(ipKey, { type: "json" })) || { start: now, n: 0 };
  if (now - rl.start > 864e5) { rl.start = now; rl.n = 0; }
  if (rl.n >= 3) return json(req, 429, { error: "You've sent 3 requests today. We'll get to them first." });
  rl.n += 1; await store.setJSON(ipKey, rl);

  // Nothing runs until the customer confirms from their own inbox (stops spam to other people's
  // emails and anyone burning someone else's free clips). The link opens a page; a button click
  // does the POST, so email scanners that pre-open links can't start a job.
  const id = crypto.randomBytes(10).toString("hex");
  await funnel.track(getStore("funnel"), "clip_request");
  await store.setJSON(`req:${id}`, { id, url, email, at: new Date().toISOString(), status: "awaiting_confirm" });
  const origin = ORIGINS.has(req.headers.get("origin")) ? req.headers.get("origin") : "https://takekash.netlify.app";
  let link;
  try { link = `${origin}/confirm?id=${id}&t=${confirmToken(id)}`; }
  catch (e) { console.error(e); return json(req, 503, { error: "Requests are paused for a moment." }); }
  try {
    await sendEmail(env, email, "Confirm your clips from TakeKash",
      `<p>Tap to start your clips from:</p><p><a href="${esc(url)}">${esc(url)}</a></p><p><a href="${link}"><b>Confirm and start my clips →</b></a></p><p>Didn't request this? Ignore this email and nothing happens.</p><p>— TakeKash</p>`,
      env.REPLY_TO || env.OWNER_EMAIL);
  } catch (e) {
    console.error("confirm email failed", e);
    return json(req, 502, { error: "We couldn't email you right now." });
  }
  return json(req, 200, { ok: true, message: "Check your email and tap Confirm to start your clips." });
};

export const config = { path: "/api/clip-request" };
