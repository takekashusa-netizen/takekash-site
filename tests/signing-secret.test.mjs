// Safeguard: every function that signs or checks a link must load the self-made signing key first,
// so a missing SEO_TOKEN_SECRET / STRIPE_WEBHOOK_SECRET on the host can never pause the site again.
import fs from "fs"; import path from "path"; import assert from "assert";
const dir = "netlify/functions";
const files = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(mjs|js|mts)$/.test(f)).map((f) => path.join(dir, f));
const SIGNS = /confirmToken|signToken|verifyToken|signDownload|verifyDownload|lists\.cjs|portal\.cjs|ebooks\.cjs/;
const EXEMPT = new Set(["netlify/functions/stripe-webhook.js"]);   // needs STRIPE_WEBHOOK_SECRET itself to verify Stripe
const missing = files.filter((f) => !EXEMPT.has(f)).filter((f) => { const s = fs.readFileSync(f, "utf8"); return SIGNS.test(s) && !s.includes("ensureSigningSecret"); });
assert.deepStrictEqual(missing, [], "functions signing links without ensureSigningSecret: " + missing.join(", "));
console.log("signing-secret: ok (" + files.length + " functions checked)");
