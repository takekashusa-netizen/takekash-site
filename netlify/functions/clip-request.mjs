// POST /api/clip-request { url, email }  — done-for-you clip order from the homepage.
// Saves the request (Netlify Blobs "clip-requests"), emails the owner the order, and confirms to the customer.
import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import funnel from "../../lib/seo/funnel.cjs";

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

  const id = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}`;
  await funnel.track(getStore("funnel"), "clip_request");
  await store.setJSON(`req:${id}`, { id, url, email, at: new Date().toISOString(), status: "new" });

  try {
    await sendEmail(env, env.OWNER_EMAIL, `New clip request: ${host}`,
      `<p><b>New clip request</b> (${esc(id)})</p><p>Stream: <a href="${esc(url)}">${esc(url)}</a><br>Customer: ${esc(email)}</p><p>Reply to this email to reach the customer.</p>`, email);
  } catch (e) {
    console.error("owner email failed", e);
    return json(req, 502, { error: "We couldn't send your request right now." });
  }
  try {
    await sendEmail(env, email, "We got your stream — clips are on the way",
      `<p>Thanks! We received your stream:</p><p><a href="${esc(url)}">${esc(url)}</a></p><p>We'll pull the best moments, cut out the dead time, and email your vertical clips with captions, titles and hashtags. Most streams come back the same day.</p><p>Questions? Just reply to this email.</p><p>— TakeKash</p>`,
      env.REPLY_TO || env.OWNER_EMAIL);
  } catch (e) { console.error("customer confirmation failed", e); }
  return json(req, 200, { ok: true, id, message: "Got it! Check your email for a confirmation. Your clips will follow." });
};

export const config = { path: "/api/clip-request" };
