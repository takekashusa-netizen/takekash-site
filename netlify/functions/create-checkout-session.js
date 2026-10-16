// TakeKash clip tool — creates a Stripe Checkout Session for the pricing buttons.
// Called by the site as:  POST /api/create-checkout-session  { "priceId": "price_..." }
// Replies:                { "url": "https://checkout.stripe.com/..." }  or  { "error": "..." }
//
// Netlify env vars:
//   STRIPE_SECRET_KEY   a *restricted* live key (rk_live_...) with ONLY "Checkout Sessions: Write"
//                       (a full sk_live_ key also works, but a restricted one limits the damage if it ever leaks)
//   SITE_URL            (optional) where Stripe sends buyers back; default https://takekash.netlify.app

// Only these prices can be sold through this endpoint. Anything else is rejected.
const ALLOWED_PRICES = new Set([
  "price_1TusrSEzp7cPN80JFqijvMhd", // Creator  $19/mo
  "price_1TusqeEzp7cPN80JyfdJhJSJ", // Pro      $49/mo
]);

// Buyers are only ever sent back to one of our own sites.
const ALLOWED_ORIGINS = new Set([
  "https://takekash.netlify.app",
  "https://takekash.com",
  "https://www.takekash.com",
]);

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let priceId;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    priceId = JSON.parse(raw).priceId;
  } catch {
    return json(400, { error: "Invalid request" });
  }
  if (typeof priceId !== "string" || !ALLOWED_PRICES.has(priceId)) {
    return json(400, { error: "Unknown plan" });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set");
    return json(500, { error: "Checkout is not configured yet" });
  }

  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || "";
  const base = ALLOWED_ORIGINS.has(origin) ? origin : (process.env.SITE_URL || "https://takekash.netlify.app");

  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${base}/?checkout=success`,
    cancel_url: `${base}/#pricing`,
    allow_promotion_codes: "true",
    "metadata[product]": "takekash", // lets the webhook tell clip-tool sales from EditFlow sales
  });

  let res, data;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    data = await res.json();
  } catch (err) {
    console.error("Stripe request failed:", err);
    return json(502, { error: "Could not reach the payment provider. Try again." });
  }

  if (!res.ok || !data.url) {
    console.error("Stripe error:", JSON.stringify(data && data.error));
    return json(502, { error: (data && data.error && data.error.message) || "Checkout failed" });
  }
  return json(200, { url: data.url });
};
