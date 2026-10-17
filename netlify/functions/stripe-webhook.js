// EditFlow Pro fulfillment — Stripe webhook (no npm dependencies).
//
// Fires on checkout.session.completed. Only acts on sessions created from a
// Stripe PAYMENT LINK (the EditFlow Pro link), so checkouts from the TakeKash
// clip tool (created through the API) are ignored.
//
// Netlify → Site configuration → Environment variables:
//   STRIPE_WEBHOOK_SECRET   whsec_... from the Stripe webhook endpoint
//   RESEND_API_KEY          from resend.com
//   FROM_EMAIL              e.g. "EditFlow <hello@yourdomain.com>" (domain verified in Resend)
//   OWNER_EMAIL             where YOU get the "new customer" alert
//   REPLY_TO                (optional) where buyer replies go; defaults to OWNER_EMAIL
//   APP_ACCESS_URL          (optional) link to the app; also derives the Starter Pack link (<url>/starter-pack/). If unset, the buyer is told access follows personally
//   PACK_URL                (optional) override the Starter Pack link
//   EDITFLOW_PAYMENT_LINK_ID (optional) plink_... to pin this to one specific payment link

const crypto = require("crypto");

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

async function sendEmail({ to, subject, html, replyTo }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.FROM_EMAIL, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
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

  if (evt.type !== "checkout.session.completed") return { statusCode: 200, body: "ignored" };

  const s = evt.data.object;

  // Clip-tool (TakeKash) sale: created by /api/create-checkout-session, tagged metadata.product=takekash.
  // No buyer email is defined for it yet, so just alert the owner. Fail with 500 so Stripe retries.
  if (s.metadata && s.metadata.product === "takekash") {
    const who = (s.customer_details && s.customer_details.email) || "(no email)";
    const amt = typeof s.amount_total === "number" ? `$${(s.amount_total / 100).toFixed(2)}` : "";
    try {
      await sendEmail({
        to: process.env.OWNER_EMAIL,
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
      to: process.env.OWNER_EMAIL,
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
    try {
      await sendEmail({
        to: email,
        replyTo: process.env.REPLY_TO || process.env.OWNER_EMAIL,
        subject: "You're in — EditFlow Pro",
        html: `<p>Hey ${esc(name)},</p>
               <p>Thanks for subscribing to EditFlow Pro${amount ? ` (${esc(amount)}/mo)` : ""}. Your payment went through.</p>
               ${access}
               <p>Reply to this email if anything looks off — I read every one.</p>`,
      });
    } catch (err) {
      console.error("Buyer email failed:", err);
    }
  }

  return { statusCode: 200, body: "ok" };
};
