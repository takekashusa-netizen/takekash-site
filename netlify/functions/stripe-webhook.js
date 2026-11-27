// EditFlow Pro fulfillment — Stripe webhook (no npm dependencies).
//
// Fires on checkout.session.completed. Only acts on sessions created from a
// Stripe PAYMENT LINK (the EditFlow Pro link), so checkouts from the TakeKash
// clip tool (created through the API) are ignored.
//
// Netlify → Site configuration → Environment variables:
//   STRIPE_WEBHOOK_SECRET   whsec_... from the Stripe webhook endpoint
//   (email goes through lib/mail.cjs: the Gmail sender outbox; no Resend key needed)
//   OWNER_EMAIL             where YOU get the "new customer" alert
//   REPLY_TO                (optional) where buyer replies go; defaults to OWNER_EMAIL
//   APP_ACCESS_URL          (optional) link to the app; also derives the Starter Pack link (<url>/starter-pack/). If unset, the buyer is told access follows personally
//   PACK_URL                (optional) override the Starter Pack link
//   PORTAL_URL              (optional) Stripe customer-portal link; if unset the email says to reply to cancel
//   EDITFLOW_PAYMENT_LINK_ID (optional) plink_... to pin this to one specific payment link

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const seoAccess = require("../../lib/seo/access.cjs");
const funnel = require("../../lib/seo/funnel.cjs");

const TOLERANCE_SECONDS = 300;

function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );
  const t = parts.t;
  // a header can carry several v1 signatures (secret rotation); collect them all
  const v1s = header
    .split(",")
    .map((kv) => kv.trim())
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  if (!t || v1s.length === 0) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return v1s.some((sig) => {
    const sigBuf = Buffer.from(sig, "hex");
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// One mail layer for the whole site (Gmail sender / outbox); owner alerts go to the owner email even without OWNER_EMAIL set.
const mail = require("../../lib/mail.cjs");
async function sendEmail({ to, subject, html, replyTo }) {
  await mail.send(process.env, { to: to || seoAccess.ownerEmail(process.env), subject, html, replyTo: replyTo || undefined });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];

  if (!verifyStripeSignature(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)) {
    return { statusCode: 400, body: "Invalid signature" };
  }

  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Bad JSON" };
  }

  // SEO Studio entitlements live in Netlify Blobs ("seo-access").
  connectLambda(event);
  const seoStore = getStore("seo-access"); // connectLambda gives no uncached URL, so default consistency here (writes are unaffected)

  // Subscription ended or changed: turn SEO Studio access off/on to match. 500 on failure so Stripe retries.
  if (evt.type === "customer.subscription.deleted" || evt.type === "customer.subscription.updated") {
    const sub = evt.data.object;
    const active = evt.type === "customer.subscription.updated" && ["active", "trialing", "past_due"].includes(sub.status);
    try { await seoAccess.setSubStatus(seoStore, sub.id, active); }
    catch (err) { console.error("SEO access update failed:", err); return { statusCode: 500, body: "access update failed" }; }
    return { statusCode: 200, body: "ok" };
  }

  if (evt.type !== "checkout.session.completed") return { statusCode: 200, body: "ignored" };

  const s = evt.data.object;

  // Ebook sale: email the buyer their signed download links (the thanks page also shows them).
  if (s.metadata && s.metadata.product === "ebook") {
    const E = require("../../lib/ebooks.cjs");
    const email = s.customer_details && s.customer_details.email, p = E.CATALOG[s.metadata.sku];
    if (!p || s.payment_status !== "paid") return { statusCode: 200, body: "ignored" };
    const site = process.env.SITE_URL || "https://takekash.netlify.app";
    const links = p.files.map((f) => `<li><a href="${site}/api/ebook-download?t=${E.signDownload(s.id, f)}">${esc(E.CATALOG[f].title)}</a></li>`).join("");
    try {
      if (email) await sendEmail({ to: email, replyTo: process.env.REPLY_TO || seoAccess.ownerEmail(process.env), subject: `Your download: ${p.title}`,
        html: `<p>Thanks for your purchase! Your ${p.files.length > 1 ? "ebooks are" : "ebook is"} ready:</p><ul>${links}</ul><p>Links work for 7 days (up to 10 downloads each). Lost them? Open <a href="${site}/ebooks/thanks?session_id=${s.id}">your purchase page</a> any time.</p><p style="color:#666;font-size:12px">${esc(E.LICENSE)}</p>` });
      await sendEmail({ to: seoAccess.ownerEmail(process.env), subject: `Ebook sale: ${p.short} (${email || "no email"})`, html: `<p>${esc(p.title)} sold to ${esc(email)} for $${(s.amount_total / 100).toFixed(2)}.</p>` });
    } catch (err) { console.error("ebook email failed", err); return { statusCode: 500, body: "email failed" }; }
    return { statusCode: 200, body: "ok" };
  }

  // Clip-tool (TakeKash) sale: created by /api/create-checkout-session, tagged metadata.product=takekash.
  // No buyer email is defined for it yet, so just alert the owner. Fail with 500 so Stripe retries.
  if (s.metadata && s.metadata.product === "takekash") {
    const who = (s.customer_details && s.customer_details.email) || "(no email)";
    // Unlock SEO Studio for this buyer. Fail with 500 so Stripe retries rather than leave a paid customer locked out.
    try { if (s.customer_details && s.customer_details.email) await seoAccess.grant(seoStore, s.customer_details.email, s.subscription, Date.now(), (s.amount_total || 0) >= 4900 ? "pro" : "creator"); await funnel.track(getStore("funnel"), "purchase"); }
    catch (err) { console.error("SEO access grant failed:", err); return { statusCode: 500, body: "access grant failed" }; }
    const amt = typeof s.amount_total === "number" ? `$${(s.amount_total / 100).toFixed(2)}` : "";
    try {
      await sendEmail({
        to: seoAccess.ownerEmail(process.env),
        subject: `New TakeKash subscriber: ${who}`,
        html: `<p><b>New TakeKash (clip tool) subscriber</b></p>
               <p>Email: ${esc(who)}<br>Amount: ${esc(amt)}<br>Subscription: ${esc(s.subscription)}<br>Session: ${esc(s.id)}</p>`,
      });
    } catch (err) {
      console.error("Owner alert (TakeKash) failed:", err);
      return { statusCode: 500, body: "owner alert failed" };
    }
    return { statusCode: 200, body: "ok" };
  }

  const pinned = process.env.EDITFLOW_PAYMENT_LINK_ID;
  if (!s.payment_link || (pinned && s.payment_link !== pinned)) {
    return { statusCode: 200, body: "not an EditFlow payment link" };
  }

  const email = s.customer_details && s.customer_details.email;
  const name = (s.customer_details && s.customer_details.name) || "there";
  const amount = typeof s.amount_total === "number" ? `$${(s.amount_total / 100).toFixed(2)}` : "";

  // 1) Alert the owner first. If this fails, return 500 so Stripe retries — never lose a paying customer.
  try {
    await sendEmail({
      to: seoAccess.ownerEmail(process.env),
      subject: `New EditFlow Pro customer: ${email || "(no email)"}`,
      html: `<p><b>New EditFlow Pro subscriber</b></p>
             <p>Name: ${esc(name)}<br>Email: ${esc(email)}<br>Amount: ${esc(amount)}<br>
             Subscription: ${esc(s.subscription)}<br>Session: ${esc(s.id)}</p>`,
    });
  } catch (err) {
    console.error("Owner alert failed:", err);
    return { statusCode: 500, body: "owner alert failed" };
  }

  // 2) Confirm to the buyer. A failure here is logged, not retried (avoids duplicate owner alerts).
  if (email) {
    const appUrl = process.env.APP_ACCESS_URL;
    // Starter Pack lives at <app url>/starter-pack/ (override with PACK_URL if it ever moves)
    const packUrl = process.env.PACK_URL || (appUrl ? appUrl.replace(/\/?$/, "/") + "starter-pack/" : "");
    const access = appUrl
      ? `<p><a href="${esc(appUrl)}">Open EditFlow →</a></p>
         <p>Your <b>Starter Pack</b> is included: templates for finding clients, quotes, revisions, invoices and late payments, plus a quote calculator.<br>
         <a href="${esc(packUrl)}">Open the Starter Pack →</a></p>`
      : `<p>I'll send your access details personally within 24 hours.</p>`;
    // Always-true cancellation line: portal link if configured, otherwise "reply to cancel" (replies reach the owner).
    const portal = process.env.PORTAL_URL;
    const manage = portal
      ? `<p>Update your card or cancel anytime: <a href="${esc(portal)}">manage your subscription</a>.</p>`
      : `<p>To cancel or change your plan, just reply to this email.</p>`;
    try {
      await sendEmail({
        to: email,
        replyTo: process.env.REPLY_TO || seoAccess.ownerEmail(process.env),
        subject: "You're in — EditFlow Pro",
        html: `<p>Hey ${esc(name)},</p>
               <p>Thanks for subscribing to EditFlow Pro${amount ? ` (${esc(amount)}/mo)` : ""}. Your payment went through.</p>
               ${access}
               ${manage}
               <p>Reply to this email if anything looks off — I read every one.</p>`,
      });
    } catch (err) {
      console.error("Buyer email failed:", err);
    }
  }

  return { statusCode: 200, body: "ok" };
};
