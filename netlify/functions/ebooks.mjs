// Ebook store API.
//   POST /api/ebook-checkout {sku}          -> Stripe Checkout (one-time payment)
//   POST /api/ebook-claim {session_id}       -> verifies the PAID session with Stripe, returns signed download links
//   GET  /api/ebook-download?t=<signed>      -> decrypts and streams the PDF (expiring, download-capped)
//   POST /api/ebook-upload?sku=..  (owner)   -> stores a PDF encrypted at rest; header x-upload-code
//   GET  /api/ebook-status (owner)           -> which packs are uploaded
import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import E from "../../lib/ebooks.cjs";

const SITE = () => process.env.SITE_URL || "https://site-production-000380c0.up.railway.app";
const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {}; };
const json = (req, s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const MAX_DOWNLOADS = 10;   // per purchase, per file

async function stripe(path, opts = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("payments not configured");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { ...opts, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000) });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || `stripe ${r.status}`);
  return d;
}

export function linksFor(sid, sku) {
  return E.CATALOG[sku].files.map((f) => ({ sku: f, title: E.CATALOG[f].title, url: `${SITE()}/api/ebook-download?t=${E.signDownload(sid, f)}` }));
}

function uploadCodeOk(req) {
  const want = process.env.EBOOK_UPLOAD_CODE || "", got = req.headers.get("x-upload-code") || "";
  return want.length >= 24 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url), path = url.pathname, files = getStore("ebook-files");

  if (path === "/api/ebook-checkout" && req.method === "POST") {
    let sku; try { ({ sku } = await req.json()); } catch { return json(req, 400, { error: "Invalid request" }); }
    const p = E.CATALOG[sku];
    if (!p) return json(req, 400, { error: "Unknown ebook" });
    const form = new URLSearchParams({
      mode: "payment", "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(p.price),
      "line_items[0][price_data][product_data][name]": p.title, "line_items[0][price_data][product_data][description]": p.tagline,
      success_url: `${SITE()}/ebooks/thanks?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${SITE()}/ebooks`,
      "metadata[product]": "ebook", "metadata[sku]": p.sku, allow_promotion_codes: "true",
    });
    try { const s = await stripe("checkout/sessions", { method: "POST", body: form.toString() }); return json(req, 200, { url: s.url }); }
    catch (e) { console.error("ebook checkout", e.message); return json(req, 502, { error: "Checkout is unavailable right now. Try again shortly." }); }
  }

  if (path === "/api/ebook-claim" && req.method === "POST") {
    let sid; try { ({ session_id: sid } = await req.json()); } catch { return json(req, 400, { error: "Invalid request" }); }
    if (!E.validSession(sid)) return json(req, 400, { error: "Invalid purchase link" });
    let s; try { s = await stripe(`checkout/sessions/${encodeURIComponent(sid)}`); } catch { return json(req, 404, { error: "We couldn't find that purchase." }); }
    if (s.payment_status !== "paid" || !s.metadata || s.metadata.product !== "ebook" || !E.CATALOG[s.metadata.sku]) return json(req, 402, { error: "This purchase isn't complete." });
    return json(req, 200, { title: E.CATALOG[s.metadata.sku].title, email: s.customer_details && s.customer_details.email, links: linksFor(sid, s.metadata.sku), license: E.LICENSE });
  }

  if (path === "/api/ebook-download" && req.method === "GET") {
    const p = E.verifyDownload(url.searchParams.get("t"));
    if (!p) return new Response("This download link is invalid or expired. Use the link in your purchase email, or reply to it for a fresh one.", { status: 403 });
    const counter = getStore("ebook-downloads"), ck = `n:${p.s}:${p.k}`;
    const n = Number((await counter.get(ck)) || 0);
    if (n >= MAX_DOWNLOADS) return new Response("Download limit reached for this purchase. Reply to your receipt email and we'll help.", { status: 429 });
    const sealed = await files.get(`file:${p.k}`, { type: "arrayBuffer" });
    if (!sealed) return new Response("This file is being prepared. Please try again in a little while.", { status: 503 });
    await counter.set(ck, String(n + 1));
    const pdf = E.open(Buffer.from(sealed));
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${String(E.CATALOG[p.k].n).padStart(2, "0")}-${p.k}-prompt-pack.pdf"`, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
  }

  if (path === "/api/ebook-upload" && req.method === "POST") {
    if (!uploadCodeOk(req)) return json(req, 401, { error: "Wrong upload code" });
    const sku = url.searchParams.get("sku");
    if (!E.CATALOG[sku] || E.CATALOG[sku].files.length !== 1) return json(req, 400, { error: "Unknown pack" });
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length < 1000 || buf.length > 30 * 1024 * 1024 || buf.subarray(0, 5).toString() !== "%PDF-") return json(req, 400, { error: "That isn't a PDF (or it's over 30 MB)." });
    await files.set(`file:${sku}`, E.seal(buf));
    return json(req, 200, { ok: true, sku, bytes: buf.length });
  }

  if (path === "/api/ebook-status" && req.method === "GET") {
    if (!uploadCodeOk(req)) return json(req, 401, { error: "Wrong upload code" });
    const have = new Set((await files.list({ prefix: "file:" })).blobs.map((b) => b.key.slice(5)));
    return json(req, 200, { packs: E.PACKS.map((p) => ({ sku: p.sku, title: p.short, uploaded: have.has(p.sku) })) });
  }
  return json(req, 404, { error: "Not found" });
};

export const config = { path: ["/api/ebook-checkout", "/api/ebook-claim", "/api/ebook-download", "/api/ebook-upload", "/api/ebook-status"] };
