// End-to-end test of SEO Studio access using a local Netlify Blobs server.
// Run: node tests/seo-access.test.mjs
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext } from "@netlify/blobs";
import { createRequire } from "module";
import crypto from "crypto";
import fs from "fs"; import os from "os"; import path from "path";
const require = createRequire(import.meta.url);

let pass = 0; const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } pass++; console.log("ok -", m); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blobs-"));
const server = new BlobsServer({ directory: dir, token: "tok", port: 0 });
const { port } = await server.start();
const url = `http://localhost:${port}`;
setEnvironmentContext({ siteID: "site", token: "tok", edgeURL: url });

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"; process.env.ADMIN_KEY = "owner-key";
process.env.RESEND_API_KEY = "re_x"; process.env.FROM_EMAIL = "TakeKash <hi@takekash.com>"; process.env.OWNER_EMAIL = "owner@x.com";
const sent = [];
const realFetch = globalThis.fetch;
let suggestDown = false;
globalThis.fetch = async (u, o) => {
  if (String(u).includes("resend.com")) { sent.push(JSON.parse(o.body)); return new Response("{}", { status: 200 }); }
  if (String(u).includes("suggestqueries.google.com")) {
    if (suggestDown) return new Response("x", { status: 503 });
    const q = new URL(u).searchParams.get("q");
    return new Response(JSON.stringify([q, [q + " loadout", q + " best settings", q + " tips", q]]), { status: 200 });
  }
  return realFetch(u, o);
};

const gen = (await import("../netlify/functions/seo-generate.mjs")).default;
const auth = (await import("../netlify/functions/seo-auth.mjs")).default;
const webhook = require("../netlify/functions/stripe-webhook.js").handler;
const member = (await import("../netlify/functions/seo-member.mjs")).default;
const funnelFn = (await import("../netlify/functions/funnel.mjs")).default;
const fcall = async (method, body, tok) => { const r = await funnelFn(new Request("https://takekash.netlify.app/api/" + (method === "POST" ? "track" : "funnel"), { method, headers: { "content-type": "application/json", origin: "https://takekash.com", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };
const mcall = async (method, body, tok, qs = "") => { const r = await member(new Request("https://takekash.netlify.app/api/seo-member" + qs, { method, headers: { "content-type": "application/json", origin: "https://takekash.com", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };

const post = (body, headers = {}) => new Request("https://takekash.netlify.app/api/x", { method: "POST", headers: { "content-type": "application/json", origin: "https://takekash.com", ...headers }, body: JSON.stringify(body) });
const ctx = (ip) => ({ ip });
const call = async (fn, body, headers, ip = "1.1.1.1") => { const r = await fn(post(body, headers), ctx(ip)); return { status: r.status, body: await r.json(), headers: r.headers }; };
const stripeEvent = (evt) => {
  const raw = JSON.stringify(evt), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", "whsec_test").update(`${t}.${raw}`).digest("hex");
  return { httpMethod: "POST", body: raw, isBase64Encoded: false, blobs: Buffer.from(JSON.stringify({ url, token: "tok" })).toString("base64"),
    headers: { "stripe-signature": `t=${t},v1=${sig}`, "x-nf-site-id": "site" } };
};
const topic = { topic: "warzone sniper montage", platform: "youtube" };

// --- Trial
let r = await call(gen, topic);
ok(r.status === 200 && r.body.access === "trial" && r.body.remaining === 2, "trial run 1 allowed, 2 left");
ok(r.body.results.youtube.titles.length === 3 && r.body.results.youtube.tags.length <= 8 && r.body.tiers === null, "trial output is limited (3 titles, ≤8 tags, no tiers)");
ok(r.headers.get("access-control-allow-origin") === "https://takekash.com", "CORS allows takekash.com");
r = await call(gen, { ...topic, platform: "all" });
ok(r.status === 403 && r.body.code === "locked", "all-platforms is locked on trial (and doesn't burn a run)");
await call(gen, topic); r = await call(gen, topic);
ok(r.status === 200 && r.body.remaining === 0, "trial run 3 allowed, 0 left");
r = await call(gen, topic);
ok(r.status === 429 && r.body.code === "trial_used", "4th trial run blocked");
r = await call(gen, topic, {}, "2.2.2.2");
ok(r.status === 200 && r.body.access === "trial", "a different visitor gets their own trial");

// --- Non-subscriber asks for a link: same answer, no email
r = await call(auth, { email: "nobody@x.com" });
ok(r.status === 200 && sent.length === 0, "non-subscriber gets the neutral reply and no email");

// --- Purchase via webhook unlocks
let w = await webhook(stripeEvent({ type: "checkout.session.completed", data: { object: { id: "cs_1", metadata: { product: "takekash" }, customer_details: { email: "Buyer@Mail.com" }, subscription: "sub_1", amount_total: 1900 } } }));
ok(w.statusCode === 200, "checkout webhook accepted");
r = await call(auth, { email: "buyer@mail.com" });
const link = sent.find((m) => m.to === "buyer@mail.com");
ok(r.status === 200 && link, "subscriber gets a sign-in email");
const token = decodeURIComponent(link.html.match(/\?t=([^"]+)"/)[1]);
ok(link.html.includes("https://takekash.com/seo?t="), "link points back to the site they came from");
r = await call(gen, { ...topic, platform: "all" }, { authorization: `Bearer ${token}` }, "1.1.1.1");
ok(r.status === 200 && r.body.access === "paid" && Object.keys(r.body.results).length === 6 && r.body.tiers, "paid: all platforms + full tiers, even from a used-up trial IP");
ok(r.body.results.youtube.titles.length === 6, "paid: full 6 titles");

// --- Live search demand
ok(Array.isArray(r.body.tiers.searched) && r.body.tiers.searched[0] === "warzone sniper loadout", "paid: 'Searched now' tier from live YouTube searches");
ok(r.body.results.youtube.tags[0] === "warzone sniper loadout" && r.body.results.youtube.tagChars <= 500, "paid: real searches lead the YouTube tags, still within 500 chars");
r = await call(gen, topic, {}, "5.5.5.5");
ok(r.body.searchedPreview && r.body.searchedPreview.length === 2, "trial: 2 live searches shown as a preview");
suggestDown = true;
r = await call(gen, { ...topic, platform: "all" }, { authorization: `Bearer ${token}` });
ok(r.status === 200 && !r.body.tiers.searched, "search service down: generation still works, tier just omitted");
suggestDown = false;

// --- Member saves + presets
let m = await mcall("GET", null, token);
ok(m.status === 200 && m.body.history.length >= 1 && m.body.history[0].input.topic, "member runs are saved automatically");
const firstId = m.body.history[0].id;
m = await mcall("PUT", { preset: { brand: "GtaxZombies", category: "gaming", extra: "ps5", platform: "tiktok" } }, token);
ok(m.status === 200 && (await mcall("GET", null, token)).body.preset.brand === "GtaxZombies", "channel preset saved and returned");
m = await mcall("DELETE", null, token, `?id=${firstId}`);
ok(!m.body.history.some((h) => h.id === firstId), "a saved run can be removed");
ok((await mcall("GET", null, null)).status === 401, "saves/presets are members-only");

// --- Tampered token
r = await call(gen, topic, { authorization: `Bearer ${token.slice(0, -2)}xx` });
ok(r.status === 401, "tampered token rejected");

// --- Cancellation revokes
w = await webhook(stripeEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled" } } }));
ok(w.statusCode === 200, "cancel webhook accepted");
r = await call(gen, topic, { authorization: `Bearer ${token}` });
ok(r.status === 402 && r.body.code === "inactive", "cancelled subscriber loses full access immediately");
w = await webhook(stripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active" } } }));
r = await call(gen, topic, { authorization: `Bearer ${token}` });
ok(r.status === 200 && r.body.access === "paid", "resubscribe/reactivation restores access");

// --- Owner key
r = await call(gen, { ...topic, platform: "all" }, { authorization: "Bearer owner-key" }, "9.9.9.9");
ok(r.status === 401, "the shared admin key does NOT unlock SEO Studio");
const n0 = sent.length; await call(auth, { email: "Owner@X.com" });
const ownerTok = decodeURIComponent(sent.slice(n0).find((m) => m.to === "owner@x.com").html.match(/\?t=([^"]+)"/)[1]);
r = await call(gen, { ...topic, platform: "all" }, { authorization: `Bearer ${ownerTok}` }, "9.9.9.9");
ok(r.status === 200 && r.body.access === "paid", "owner gets full access free via emailed link (no subscription)");

// --- Bad webhook signature still rejected
const bad = stripeEvent({ type: "checkout.session.completed", data: { object: {} } }); bad.headers["stripe-signature"] = "t=1,v1=00";
ok((await webhook(bad)).statusCode === 400, "unsigned webhook rejected");

// --- Rate limit on sign-in emails
const before = sent.length; for (let i = 0; i < 5; i++) await call(auth, { email: "buyer@mail.com" });
ok(sent.length - before === 2, "sign-in emails capped at 3/hour per address");

// --- Funnel
ok((await fcall("POST", { event: "unlock_click" })).status === 200, "page events are counted");
ok((await fcall("POST", { event: "purchase" })).status === 400, "visitors can't fake server-side events like purchases");
ok((await fcall("GET", null, token)).status === 401, "a regular member can't see the funnel");
const fr = await fcall("GET", null, ownerTok);
ok(fr.status === 200 && fr.body.totals.trial_run >= 4 && fr.body.totals.trial_limit_hit >= 1 && fr.body.totals.purchase === 1 && fr.body.totals.unlock_click === 1 && fr.body.totals.paid_run >= 1,
   `owner funnel adds up: ${JSON.stringify(fr.body.totals)}`);

await server.stop(); console.log(`\nALL ${pass} CHECKS PASS`);
