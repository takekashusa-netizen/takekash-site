// TakeKash Store (done-for-you clip packages) + billing self-service. No webhook needed: every paid
// state is read straight from Stripe with the session id, so it works even before a webhook is set up.
//
// POST /api/store/checkout   { sku }                      -> { url }   Stripe Checkout (payment), server-side price
// POST /api/store/claim      { session_id }               -> { order, token }  creates the order once it's paid
// POST /api/store/link       { session_id, t, url }       -> queues the clip job on the free engine
// POST /api/billing-portal   (Bearer portal sign-in token) -> { url }  Stripe customer portal for that email
import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import access from "../../lib/seo/access.cjs";
import S from "../../lib/store.cjs";
import T from "../../lib/timeline.cjs";
import D from "../../lib/seo/delivery.cjs";
import portal from "../../lib/portal.cjs";
import mail from "../../lib/mail.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app", ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" } : {}; };
const json = (req, s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const site = (req) => (ORIGINS.has(req.headers.get("origin")) ? req.headers.get("origin") : (process.env.SITE_URL || "https://takekash.netlify.app"));

async function stripe(path, opts = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("payments not configured");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { ...opts, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000) });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || `stripe ${r.status}`);
  return d;
}

async function paidOrder(orders, sid) {
  const have = await orders.get(`order:${sid}`, { type: "json" });
  if (have) return have;
  const s = await stripe(`checkout/sessions/${encodeURIComponent(sid)}`);
  const p = s.metadata && s.metadata.product === "service" && S.PACKAGES[s.metadata.sku];
  if (!p || s.payment_status !== "paid") return null;
  const o = { sid, sku: p.sku, clips: p.clips, email: access.normEmail((s.customer_details && s.customer_details.email) || ""), amount: s.amount_total, livemode: !!s.livemode, paidAt: new Date().toISOString(), status: "awaiting_link" };
  const made = await orders.setJSON(`order:${sid}`, o, { onlyIfNew: true });      // two tabs can't create it twice
  if (made && made.modified === false) return orders.get(`order:${sid}`, { type: "json" });
  return { ...o, fresh: true };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  await access.ensureSigningSecret(getStore("keys"));
  const env = process.env, path = new URL(req.url).pathname, orders = getStore("orders");
  let b = {}; try { b = await req.json(); } catch { if (path !== "/api/billing-portal") return json(req, 400, { error: "Invalid request" }); }

  if (path === "/api/store/checkout") {
    const p = S.PACKAGES[b.sku];
    if (!p) return json(req, 400, { error: "Unknown package" });
    const form = new URLSearchParams({
      mode: "payment", "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(p.price),
      "line_items[0][price_data][product_data][name]": `TakeKash: ${p.name}`, "line_items[0][price_data][product_data][description]": p.blurb,
      success_url: `${site(req)}/store/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${site(req)}/store`,
      "metadata[product]": "service", "metadata[sku]": p.sku, customer_creation: "always", allow_promotion_codes: "true",
    });
    try { const s = await stripe("checkout/sessions", { method: "POST", body: form.toString() }); return json(req, 200, { url: s.url }); }
    catch (e) { console.error("store checkout", e.message); return json(req, 502, { error: "Checkout is unavailable right now. Try again shortly." }); }
  }

  if (path === "/api/store/claim") {
    const sid = String(b.session_id || "");
    if (!S.SESSION_RE.test(sid)) return json(req, 400, { error: "Invalid order link" });
    let o; try { o = await paidOrder(orders, sid); } catch (e) { console.error("claim", e.message); return json(req, 502, { error: "We couldn't check that payment right now. Refresh in a minute." }); }
    if (!o) return json(req, 402, { error: "This payment isn't complete yet." });
    const t = S.orderToken(sid);
    if (o.fresh) {
      delete o.fresh;
      const link = `${site(req)}/store/thanks?session_id=${sid}`;
      try {
        if (o.email) await mail.send(env, { to: o.email, subject: `Your TakeKash order: ${S.PACKAGES[o.sku].name}`, html: `<p>Thanks for your order!</p><p>Send the stream you want clipped here: <a href="${link}"><b>add my stream link →</b></a></p><p>Your ${o.clips} clips are emailed to you when they're ready. Reply to this email with any questions.</p><p>— TakeKash</p>` });
        await mail.send(env, { to: access.ownerEmail(env), subject: `New order: ${S.PACKAGES[o.sku].name} (${o.email || "no email"})${o.livemode ? "" : " [TEST]"}`, html: `<p>${esc(S.PACKAGES[o.sku].name)} paid by ${esc(o.email)}: $${((o.amount || 0) / 100).toFixed(2)}${o.livemode ? "" : " (Stripe test mode)"}.</p><p>Waiting on their stream link.</p>` });
      } catch (e) { console.error("order emails", e); }
    }
    return json(req, 200, { order: S.publicOrder(o), token: t });
  }

  if (path === "/api/store/link") {
    const sid = String(b.session_id || "");
    if (!S.checkToken(sid, b.t)) return json(req, 403, { error: "This order link isn't valid." });
    const url = S.validStreamUrl(b.url);
    if (!url) return json(req, 400, { error: "Use a full Twitch, Kick or YouTube link." });
    const o = await orders.get(`order:${sid}`, { type: "json" });
    if (!o) return json(req, 404, { error: "Order not found. Refresh this page." });
    if (o.status !== "awaiting_link") return json(req, 200, { order: S.publicOrder(o), message: "Your clips are already on the way." });
    const lock = await orders.set(`lock:${sid}`, "1", { onlyIfNew: true });
    if (lock && lock.modified === false) return json(req, 200, { order: S.publicOrder(o), message: "Your clips are already on the way." });

    const id = crypto.randomBytes(10).toString("hex"), reqs = getStore("clip-requests");
    const r = T.step({ id, url, email: o.email, at: new Date().toISOString(), plan: "paid", order: sid, reserved: o.clips, slots: [], status: "processing", cbk: D.newCallbackKey() }, "requested");
    T.step(r, "confirmed", `paid order ${S.PACKAGES[o.sku].name}`); T.step(r, "queued");
    await reqs.setJSON(`req:${id}`, r);
    await reqs.setJSON(`queue:${id}`, { jid: id, url, clips: o.clips, cbk: r.cbk });
    try { await portal.indexJob(reqs, o.email, id); } catch (e) { console.error("portal index", e); }
    if (D.useGithubEngine()) await D.dispatchJob({}).catch(() => {});
    Object.assign(o, { status: "processing", url, jobId: id, linkedAt: new Date().toISOString() });
    await orders.setJSON(`order:${sid}`, o);
    try { await mail.send(env, { to: access.ownerEmail(env), subject: `Order job started: ${S.PACKAGES[o.sku].name}`, html: `<p>${esc(o.email)} sent <a href="${esc(url)}">${esc(url)}</a>. Job ${id} is queued (${o.clips} clips).</p>` }); } catch {}
    return json(req, 200, { order: S.publicOrder(o), message: "Got it. Your clips are being made now; we'll email you when they're ready." });
  }

  if (path === "/api/billing-portal") {
    const auth = req.headers.get("authorization") || "";
    const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), env) : null;
    if (!email) return json(req, 401, { error: "Your sign-in link expired. Request a new one." });
    try {
      const found = await stripe(`customers?email=${encodeURIComponent(email)}&limit=1`);
      const c = found.data && found.data[0];
      if (!c) return json(req, 404, { error: "There's no billing on file for this email yet." });
      const s = await stripe("billing_portal/sessions", { method: "POST", body: new URLSearchParams({ customer: c.id, return_url: `${site(req)}/portal` }).toString() });
      return json(req, 200, { url: s.url });
    } catch (e) { console.error("billing portal", e.message); return json(req, 502, { error: "Billing is unavailable right now. Reply to any TakeKash email and we'll help." }); }
  }

  return json(req, 404, { error: "Not found" });
};

export const config = { path: ["/api/store/checkout", "/api/store/claim", "/api/store/link", "/api/billing-portal"] };
