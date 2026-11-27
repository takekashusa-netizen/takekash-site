// node tests/store.test.mjs — done-for-you clip store: server-side prices, paid-only orders, signed stream link, billing portal
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext, getStore } from "@netlify/blobs";
import fs from "fs"; import os from "os"; import path from "path";
let pass = 0; const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } pass++; console.log("ok -", m); };
const srv = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "st-")), token: "t", port: 0 }); const { port } = await srv.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
delete process.env.SEO_TOKEN_SECRET; delete process.env.STRIPE_WEBHOOK_SECRET;     // must work with the self-made key
Object.assign(process.env, { STRIPE_SECRET_KEY: "rk_test_x", SITE_URL: "https://site.example", MAIL_PROVIDER: "log" });
const sessions = {
  cs_test_PAIDstandard123: { payment_status: "paid", livemode: false, amount_total: 5000, metadata: { product: "service", sku: "standard" }, customer_details: { email: "Buyer@X.com" } },
  cs_test_UNPAIDxxxxxxxxx: { payment_status: "unpaid", metadata: { product: "service", sku: "basic" } },
  cs_test_PAIDebook123456: { payment_status: "paid", metadata: { product: "ebook", sku: "legal" } },
};
let lastCheckout, portalFor;
const real = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (u.startsWith("https://api.stripe.com/v1/checkout/sessions/")) { const id = decodeURIComponent(u.split("/").pop()); return sessions[id] ? new Response(JSON.stringify(sessions[id])) : new Response('{"error":{"message":"no such"}}', { status: 404 }); }
  if (u === "https://api.stripe.com/v1/checkout/sessions") { lastCheckout = new URLSearchParams(o.body); return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/x" })); }
  if (u.startsWith("https://api.stripe.com/v1/customers?email=")) { const e = decodeURIComponent(u.split("email=")[1].split("&")[0]); return new Response(JSON.stringify({ data: e === "buyer@x.com" ? [{ id: "cus_1" }] : [] })); }
  if (u === "https://api.stripe.com/v1/billing_portal/sessions") { portalFor = new URLSearchParams(o.body).get("customer"); return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/x" })); }
  if (u.includes("api.github.com")) return new Response(null, { status: 204 });
  if (u.startsWith("http://localhost")) return real(u, o);
  throw new Error("unexpected fetch " + u);
};
const fn = (await import("../netlify/functions/store.mjs")).default;
const access = (await import("../lib/seo/access.cjs")).default;
const call = async (p, body, headers = {}) => { const r = await fn(new Request("https://site.example" + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })); return { s: r.status, d: await r.json() }; };

let x = await call("/api/store/checkout", { sku: "standard", price: 1 });
ok(x.s === 200 && lastCheckout.get("line_items[0][price_data][unit_amount]") === "5000" && lastCheckout.get("metadata[product]") === "service", "checkout: $50 package, client can't set the price");
ok((await call("/api/store/checkout", { sku: "free" })).s === 400, "unknown package refused");

ok((await call("/api/store/claim", { session_id: "cs_test_UNPAIDxxxxxxxxx" })).s === 402, "unpaid session makes no order");
ok((await call("/api/store/claim", { session_id: "cs_test_PAIDebook123456" })).s === 402, "an ebook payment can't claim clips");
ok((await call("/api/store/claim", { session_id: "../../etc" })).s === 400, "bad session id refused");
x = await call("/api/store/claim", { session_id: "cs_test_PAIDstandard123" });
ok(x.s === 200 && x.d.order.clips === 6 && x.d.order.status === "awaiting_link" && x.d.token, "paid session creates the order");
const tok = x.d.token;
const sent = (globalThis.__mailLog || []).length;
await call("/api/store/claim", { session_id: "cs_test_PAIDstandard123" });
ok((globalThis.__mailLog || []).length === sent, "reloading the thanks page doesn't re-send order emails");

ok((await call("/api/store/link", { session_id: "cs_test_PAIDstandard123", t: "x".repeat(32), url: "https://www.twitch.tv/videos/1" })).s === 403, "wrong order token refused");
ok((await call("/api/store/link", { session_id: "cs_test_PAIDstandard123", t: tok, url: "https://evil.example/v" })).s === 400, "non-stream link refused");
x = await call("/api/store/link", { session_id: "cs_test_PAIDstandard123", t: tok, url: "https://www.twitch.tv/videos/123" });
ok(x.s === 200 && x.d.order.status === "processing" && x.d.order.jobId, "stream link queues the job");
const reqs = getStore("clip-requests");
const q = await reqs.get(`queue:${x.d.order.jobId}`, { type: "json" });
ok(q && q.clips === 6 && q.url === "https://www.twitch.tv/videos/123" && q.cbk, "engine queue gets the paid clip count");
const r = await reqs.get(`req:${x.d.order.jobId}`, { type: "json" });
ok(r.email === "buyer@x.com" && r.plan === "paid" && r.slots.length === 0, "job is tied to the buyer and uses no free allowance");
x = await call("/api/store/link", { session_id: "cs_test_PAIDstandard123", t: tok, url: "https://www.twitch.tv/videos/999" });
const all = await reqs.list({ prefix: "queue:" });
ok(all.blobs.length === 1, "a second link can't start a second job");

ok((await call("/api/billing-portal")).s === 401, "billing portal needs a sign-in");
const signed = access.signToken("buyer@x.com", process.env);
x = await call("/api/billing-portal", undefined, { authorization: `Bearer ${signed}` });
ok(x.s === 200 && portalFor === "cus_1" && x.d.url.startsWith("https://billing.stripe.com/"), "signed-in buyer gets their own Stripe billing portal");
x = await call("/api/billing-portal", undefined, { authorization: `Bearer ${access.signToken("nobody@x.com", process.env)}` });
ok(x.s === 404, "no billing on file answers plainly");

console.log(`store: ${pass} passed`); await srv.stop(); process.exit(0);
