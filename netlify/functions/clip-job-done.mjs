// POST /api/clip-job-done  — signed callback from the clip engine (GitHub Actions HMAC, or legacy Railway Ed25519).
// Verified against Railway's Ed25519 public key (pinned in Blobs on first fetch).
import { getStore } from "@netlify/blobs";
import funnel from "../../lib/seo/funnel.cjs";
import D from "../../lib/seo/delivery.cjs";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function sendEmail(env, to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html, reply_to: env.REPLY_TO || env.OWNER_EMAIL }) });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const raw = await req.text();
  if (raw.length > 8192) return json(413, { error: "too large" });
  let body; try { body = JSON.parse(raw); } catch { return json(400, { error: "bad json" }); }
  const env = process.env, store = getStore("clip-requests");
  let p, r;
  if (typeof body.mac === "string") {               // free GitHub Actions engine: per-job HMAC key
    const jid = D.peekJid(body);
    r = jid ? await store.get(`req:${jid}`, { type: "json" }) : null;
    p = r ? D.verifyMacCallback(r.cbk, body) : null;
    if (!p || p.jid !== jid) return json(401, { error: "invalid signature" });
  } else {                                          // legacy Railway engine: Ed25519
    p = D.verifyCallback(await D.railwayPub(getStore("keys")), body);
    if (!p) return json(401, { error: "invalid signature" });
    r = await store.get(`req:${p.jid}`, { type: "json" });
  }
  if (!r) return json(404, { error: "unknown job" });
  if (r.status !== "processing") return json(200, { ok: true, already: r.status });   // idempotent: retries are harmless

  const delivered = Math.max(0, Math.min(Number(p.delivered) || 0, r.reserved || 0));
  await D.refund(getStore("clip-quota"), r.slots || [], (r.reserved || 0) - delivered);   // pay only for clips delivered
  Object.assign(r, { status: p.status === "done" && p.download ? "delivered" : "failed", delivered, finishedAt: new Date().toISOString() });
  if (r.status === "delivered") Object.assign(r, { download: p.download, downloadExp: Date.now() + 7 * 864e5 - 36e5 });   // shown in the customer portal
  await store.setJSON(`req:${p.jid}`, r);
  await funnel.track(getStore("funnel"), r.status === "delivered" ? "clip_delivered" : "clip_failed");

  try {
    if (r.status === "delivered") {
      await sendEmail(env, r.email, `Your ${delivered} clip${delivered === 1 ? "" : "s"} are ready`,
        `<p>Your clips from <a href="${esc(r.url)}">this stream</a> are ready:</p><p><a href="${esc(p.download)}"><b>Download your clips →</b></a></p><p>The link works for 7 days. Need titles, captions and hashtags? Use <a href="${process.env.SITE_URL || "https://takekash.netlify.app"}/seo">SEO Studio</a> or the <a href="${process.env.SITE_URL || "https://takekash.netlify.app"}/kit">Upload Kit</a>.</p><p>— TakeKash</p>`);
    } else {
      await sendEmail(env, r.email, "We couldn't make clips from that stream",
        `<p>We couldn't find clip-worthy moments in <a href="${esc(r.url)}">this stream</a>, or it couldn't be downloaded. Nothing was taken from your clip allowance.</p><p>Reply to this email and we'll take a look by hand.</p><p>— TakeKash</p>`);
      await sendEmail(env, env.OWNER_EMAIL, "Clip job failed", `<p>Request ${esc(p.jid)} for ${esc(r.email)} failed. Stream: ${esc(r.url)}</p>`);
    }
  } catch (e) { console.error("delivery email failed", e); return json(500, { error: "email failed" }); }   // 500 => Railway retries
  return json(200, { ok: true });
};

export const config = { path: "/api/clip-job-done" };
