// TakeKash mail layer. Every email the platform sends goes through here, so the delivery provider
// is one setting (MAIL_PROVIDER), not code spread across functions.
//   relay  -> POST to TakeKash's own mail relay (MAIL_RELAY_URL + MAIL_RELAY_TOKEN), when it runs on our server
//   resend -> Resend HTTP API (RESEND_API_KEY), the default until the own relay is live
//   log    -> writes the email to the function log only (development / no provider configured)
const PROVIDERS = {
  async relay(env, msg) {
    const r = await fetch(env.MAIL_RELAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.MAIL_RELAY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`relay ${r.status}`);
  },
  async resend(env, msg) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`resend ${r.status}`);
  },
  async log(_env, msg) { console.log("mail(log only):", msg.to, msg.subject); (globalThis.__mailLog ||= []).push(msg); },
};

function provider(env) {
  if (env.MAIL_PROVIDER && PROVIDERS[env.MAIL_PROVIDER]) return env.MAIL_PROVIDER;
  if (env.MAIL_RELAY_URL) return "relay";
  if (env.RESEND_API_KEY) return "resend";
  return "log";
}

async function send(env, { to, subject, html, replyTo, headers }) {
  const msg = { from: env.FROM_EMAIL || "TakeKash <hello@takekash.com>", to, subject, html, reply_to: replyTo || env.REPLY_TO || env.OWNER_EMAIL };
  if (headers) msg.headers = headers;   // e.g. List-Unsubscribe (RFC 8058) for list mail
  await PROVIDERS[provider(env)](env, msg);
}

module.exports = { send, provider };
