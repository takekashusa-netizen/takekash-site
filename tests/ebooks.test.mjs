// node tests/ebooks.test.mjs — ebook store security + delivery
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext, getStore } from "@netlify/blobs";
import fs from "fs"; import os from "os"; import path from "path";
let pass = 0; const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } pass++; console.log("ok -", m); };
const srv = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "eb-")), token: "t", port: 0 }); const { port } = await srv.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
Object.assign(process.env, { SEO_TOKEN_SECRET: "test-secret-xyz", STRIPE_SECRET_KEY: "rk_test_x", EBOOK_UPLOAD_CODE: "u".repeat(32), SITE_URL: "https://site.example" });
const sessions = { cs_test_PAIDbundle1234: { payment_status: "paid", metadata: { product: "ebook", sku: "bundle" }, customer_details: { email: "b@x.com" } },
  cs_test_UNPAIDxxxxxxx: { payment_status: "unpaid", metadata: { product: "ebook", sku: "legal" } },
  cs_test_PAIDlegal12345: { payment_status: "paid", metadata: { product: "ebook", sku: "legal" } },
  cs_test_PAIDclips12345: { payment_status: "paid", metadata: { product: "takekash" } } };
let lastCheckout;
const real = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  if (u.startsWith("https://api.stripe.com/v1/checkout/sessions/")) { const id = decodeURIComponent(u.split("/").pop()); return sessions[id] ? new Response(JSON.stringify(sessions[id])) : new Response('{"error":{"message":"no such"}}', { status: 404 }); }
  if (u === "https://api.stripe.com/v1/checkout/sessions") { lastCheckout = new URLSearchParams(o.body); return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/x" })); }
  return real(u, o);
};
const fn = (await import("../netlify/functions/ebooks.mjs")).default;
const E = (await import("../lib/ebooks.cjs")).default;
const call = async (p, { method = "GET", body, headers = {} } = {}) => { const r = await fn(new Request("https://site.example" + p, { method, headers: { "content-type": "application/json", ...headers }, body })); return { s: r.status, r }; };
const code = { "x-upload-code": "u".repeat(32) };
const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(5000, 65)]);

let x = await call("/api/ebook-checkout", { method: "POST", body: JSON.stringify({ sku: "legal" }) });
ok(x.s === 200 && lastCheckout.get("line_items[0][price_data][unit_amount]") === "2700" && lastCheckout.get("metadata[product]") === "ebook", "checkout: $27 single pack, server-side price");
await call("/api/ebook-checkout", { method: "POST", body: JSON.stringify({ sku: "bundle" }) });
ok(lastCheckout.get("line_items[0][price_data][unit_amount]") === "9700", "checkout: bundle $97");
ok((await call("/api/ebook-checkout", { method: "POST", body: JSON.stringify({ sku: "legal", price: 1 }) })) && lastCheckout.get("line_items[0][price_data][unit_amount]") === "2700", "client can't change the price");
ok((await call("/api/ebook-checkout", { method: "POST", body: JSON.stringify({ sku: "../x" }) })).s === 400, "unknown product refused");

ok((await call("/api/ebook-upload?sku=legal", { method: "POST", body: pdf, headers: { "x-upload-code": "wrong" } })).s === 401, "upload with wrong code refused");
ok((await call("/api/ebook-upload?sku=legal", { method: "POST", body: Buffer.from("<html>not a pdf</html>".repeat(100)), headers: code })).s === 400, "non-PDF upload refused");
ok((await call("/api/ebook-upload?sku=bundle", { method: "POST", body: pdf, headers: code })).s === 400, "can't upload to the bundle slot");
ok((await call("/api/ebook-upload?sku=legal", { method: "POST", body: pdf, headers: code })).s === 200, "owner upload accepted");
const stored = Buffer.from(await getStore("ebook-files").get("file:legal", { type: "arrayBuffer" }));
ok(!stored.includes(Buffer.from("%PDF")) && stored.length > pdf.length, "file is encrypted at rest");

ok((await call("/api/ebook-claim", { method: "POST", body: JSON.stringify({ session_id: "cs_test_UNPAIDxxxxxxx" }) })).s === 402, "unpaid session gets no links");
ok((await call("/api/ebook-claim", { method: "POST", body: JSON.stringify({ session_id: "cs_test_PAIDclips12345" }) })).s === 402, "a paid clip-plan session can't claim ebooks");
ok((await call("/api/ebook-claim", { method: "POST", body: JSON.stringify({ session_id: "../../v1/charges" }) })).s === 400, "malformed session id refused (no Stripe path tricks)");
x = await call("/api/ebook-claim", { method: "POST", body: JSON.stringify({ session_id: "cs_test_PAIDbundle1234" }) });
const bundle = await x.r.json();
ok(x.s === 200 && bundle.links.length === 10, "paid bundle -> 10 download links");
x = await call("/api/ebook-claim", { method: "POST", body: JSON.stringify({ session_id: "cs_test_PAIDlegal12345" }) });
const legal = (await x.r.json()).links;
ok(legal.length === 1 && legal[0].sku === "legal", "paid single pack -> only that pack");

const t = new URL(legal[0].url).searchParams.get("t");
x = await call(`/api/ebook-download?t=${encodeURIComponent(t)}`);
const body = Buffer.from(await x.r.arrayBuffer());
ok(x.s === 200 && body.equals(pdf) && x.r.headers.get("content-type") === "application/pdf", "valid link downloads the exact PDF (decrypted)");
const [b, m] = t.split("."); const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url")), k: "finance" })).toString("base64url") + "." + m;
ok((await call(`/api/ebook-download?t=${forged}`)).s === 403, "editing a link to get a different pack is refused");
ok((await call(`/api/ebook-download?t=${E.signDownload("cs_test_x", "legal", -10)}`)).s === 403, "expired link refused");
x = await call(`/api/ebook-download?t=${encodeURIComponent(new URL(bundle.links[0].url).searchParams.get("t"))}`);
ok(x.s === 503, "pack not uploaded yet -> clear 'being prepared' message, no crash");
for (let i = 0; i < 9; i++) await call(`/api/ebook-download?t=${encodeURIComponent(t)}`);
ok((await call(`/api/ebook-download?t=${encodeURIComponent(t)}`)).s === 429, "download cap (10 per purchase per file) enforced");
ok((await call("/api/ebook-status", { headers: code })).s === 200 && (await call("/api/ebook-status")).s === 401, "upload status is owner-only");
await srv.stop(); console.log(`\nALL ${pass} CHECKS PASS`);
