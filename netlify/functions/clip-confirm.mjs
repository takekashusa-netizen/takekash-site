// POST /api/clip-confirm {id, t}  — customer clicked "Start my clips" from their email.
// Checks the allowance, signs a job ticket, and hands it to the Railway clip engine.
import { getStore } from "@netlify/blobs";
import T from "../../lib/timeline.cjs";
import mail from "../../lib/mail.cjs";
import crypto from "crypto";
import funnel from "../../lib/seo/funnel.cjs";
import D from "../../lib/seo/delivery.cjs";
import { confirmToken } from "./clip-request.mjs";
import access from "../../lib/seo/access.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app", ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {}; };
const json = (req, s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MESSAGES = {
  processing: "You're confirmed. Your clips are being made now; we'll email you a download link when they're ready.",
  delivered: "These clips were already delivered. Check your email for the download link.",
  manual: "You're confirmed. We're making these clips by hand and will email them to you.",
  failed: "We couldn't make clips from that stream. Your clip allowance was refunded.",
};

const sendEmail = (env, to, subject, html) => mail.send(env, { to, subject, html });   // one mail layer: own relay | Resend | log

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  await access.ensureSigningSecret(getStore("keys"));   // same self-made key clip-request signed with
  let id, t;
  try { ({ id, t } = await req.json()); } catch { return json(req, 400, { error: "Invalid request." }); }
  if (!/^[a-f0-9]{20}$/.test(String(id || "")) || typeof t !== "string") return json(req, 400, { error: "This link isn't valid." });
  const want = confirmToken(id);
  if (t.length !== want.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) return json(req, 403, { error: "This link isn't valid." });

  const env = process.env, store = getStore("clip-requests");
  const r = await store.get(`req:${id}`, { type: "json" });
  if (!r) return json(req, 404, { error: "We couldn't find that request." });
  if (r.status !== "awaiting_confirm") return json(req, 200, { ok: true, status: r.status, message: MESSAGES[r.status] || "Already confirmed." });
  if (Date.now() - Date.parse(r.at) > 48 * 3600e3) return json(req, 410, { error: "This link expired. Send your stream again from the homepage." });

  // one-time claim key (create-only): two simultaneous clicks can't both start a job
  const claim = await store.set(`claim:${id}`, new Date().toISOString(), { onlyIfNew: true });
  if (claim && claim.modified === false) return json(req, 200, { ok: true, status: "processing", message: MESSAGES.processing });
  r.status = "confirming"; await store.setJSON(`req:${id}`, r);

  const plan = await D.planFor(getStore("seo-access"), r.email);
  const quota = getStore("clip-quota");
  const res = await D.reserve(quota, r.email, plan, id);
  if (!res.clips) {
    r.status = "awaiting_confirm"; await store.setJSON(`req:${id}`, r); await store.delete(`claim:${id}`);
    return json(req, 402, { error: plan === "free" ? "You've used your 3 free clips. Pick a plan to keep going." : "You've used this month's clips. Upgrade to Pro for more.", upgrade: true });
  }
  Object.assign(r, { plan, reserved: res.clips, slots: res.slots, month: res.month, confirmedAt: new Date().toISOString() });
  T.step(r, "confirmed"); T.step(r, "allowance", `${res.clips} clip(s) on ${plan}`);
  await funnel.track(getStore("funnel"), "clip_confirmed");

  let sent = false;
  try {
    if (D.needsOwnerMachine(r.url)) {                      // YouTube blocks cloud downloads: the owner's Mac worker picks it up
      r.cbk = D.newCallbackKey(); r.ownerMachine = true;
      T.step(r, "queued", "YouTube link: waiting for the owner's Mac worker");
      r.status = "processing"; await store.setJSON(`req:${id}`, r);
      await store.setJSON(`macqueue:${id}`, { jid: id, url: r.url, clips: res.clips, cbk: r.cbk, plan, at: new Date().toISOString() });
      try { await sendEmail(env, access.ownerEmail(env), `YouTube clip job queued for your Mac: ${r.email}`, `<p>${esc(r.email)} confirmed ${res.clips} clip(s) from <a href="${esc(r.url)}">${esc(r.url)}</a>.</p><p>Your Mac worker picks this up automatically within a few minutes when the Mac is on. If it isn't set up yet, make the clips by hand.</p>`); } catch {}
      return json(req, 200, { ok: true, status: "processing", clips: res.clips, message: MESSAGES.processing + " Tip: YouTube links take longer; for the fastest clips next time, share the video file as a Google Drive or Dropbox link." });
    }
    if (process.env.CLIP_ENGINE === "railway") {          // legacy paid engine, kept only as an escape hatch
      const { privateKey } = await D.siteKey(getStore("keys"));
      const ticket = D.makeTicket(privateKey, { jid: id, url: r.url, clips: res.clips });
      const resp = await fetch(`${D.API_BASE}/api/customer-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ticket), signal: AbortSignal.timeout(15000) });
      sent = resp.status === 202;
      if (!sent) console.error("railway refused job", resp.status, await resp.text().catch(() => ""));
    } else {                                               // free engine: GitHub Actions pulls from this queue
      r.cbk = D.newCallbackKey(); await store.setJSON(`req:${id}`, r);   // stored first so the callback can be verified
      T.step(r, "queued"); await store.setJSON(`req:${id}`, r);
      await store.setJSON(`queue:${id}`, { jid: id, url: r.url, clips: res.clips, cbk: r.cbk, plan, at: new Date().toISOString() });
      sent = true;
      if (D.useGithubEngine()) await D.dispatchJob({}).catch((e) => console.error("engine wake-up failed (queue still runs)", e));
    }
  } catch (e) { console.error("railway submit failed", e); }

  r.status = sent ? "processing" : "manual";
  if (!sent) T.step(r, "manual");
  if (!sent) { await D.refund(quota, res.slots); r.reserved = 0; r.slots = []; }
  await store.setJSON(`req:${id}`, r);
  try {
    await sendEmail(env, access.ownerEmail(env), sent ? `Clip job started (${plan}): ${new URL(r.url).hostname}` : `ACTION NEEDED: clip request to make by hand`,
      `<p>${sent ? "Automatic job started" : "The clip engine didn't accept this job; please make it by hand."}</p><p>Stream: <a href="${esc(r.url)}">${esc(r.url)}</a><br>Customer: ${esc(r.email)} (${plan}, ${res.clips} clips)<br>Request: ${id}</p>`);
  } catch (e) { console.error("owner email failed", e); }
  return json(req, 200, { ok: true, status: r.status, clips: res.clips, message: MESSAGES[r.status] });
};

export const config = { path: "/api/clip-confirm" };
