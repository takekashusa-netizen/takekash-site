// POST /api/upload-start {name, size, type} -> {key, putUrl, ut}
// Instant service: the customer uploads their own video file straight to clip storage (no YouTube, no Mac).
// The PUT link is presigned for 2 hours; `ut` proves the key came from us when they submit it as a clip request.
import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import access from "../../lib/seo/access.cjs";
import S3 from "../../lib/s3.cjs";

export const UPLOAD_ORIGINS = ["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app"];
const ORIGINS = new Set([...UPLOAD_ORIGINS, ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {}; };
const json = (req, s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
export const MAX_BYTES = 5 * 1024 ** 3;                  // single-PUT limit of S3-compatible storage
const TYPES = /^video\/(mp4|quicktime|x-matroska|webm|x-msvideo|mpeg|x-m4v)$/;

// Storage keys come from the site's own environment settings (Netlify), entered by the owner. Never in code.
export function storageConfig(env = process.env) {
  const c = { endpoint: env.BUCKET_ENDPOINT, bucket: env.BUCKET_NAME, region: env.BUCKET_REGION || "auto",
              accessKeyId: env.BUCKET_ACCESS_KEY_ID, secretAccessKey: env.BUCKET_SECRET_ACCESS_KEY };
  return c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey ? { ...c, endpoint: c.endpoint.replace(/\/$/, "") } : null;
}
export function uploadToken(key, env = process.env) {
  const base = env.SEO_TOKEN_SECRET || env.STRIPE_WEBHOOK_SECRET;   // set by access.ensureSigningSecret()
  if (!base) throw new Error("No signing secret configured");
  return crypto.createHmac("sha256", "upload:" + base).update(key).digest("base64url");
}
export const validUpload = (url, ut) => {
  const m = /^upload:\/\/(uploads\/[a-f0-9]{20}\/[A-Za-z0-9._-]{1,80})$/.exec(String(url || ""));
  if (!m || typeof ut !== "string") return null;
  const want = uploadToken(m[1]);
  return ut.length === want.length && crypto.timingSafeEqual(Buffer.from(ut), Buffer.from(want)) ? m[1] : null;
};

export default async (req, context) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method === "GET") return json(req, 200, { enabled: !!storageConfig() });   // homepage shows the upload tab only when on
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });
  await access.ensureSigningSecret(getStore("keys"));
  const cfg = storageConfig();
  if (!cfg) return json(req, 503, { error: "Uploads open soon. Paste a link for now." });
  const keys = getStore("keys");                          // first upload: let our own origins PUT straight to the bucket
  if (!(await keys.get("storage-cors", { type: "json" }))) {
    const c = await S3.applyCors(cfg, UPLOAD_ORIGINS).catch((e) => ({ ok: false, status: String(e.message || e).slice(0, 60) }));
    if (c.ok) await keys.setJSON("storage-cors", { at: new Date().toISOString() });
    else console.error("bucket CORS not set", c.status);
  }
  let b; try { b = await req.json(); } catch { return json(req, 400, { error: "Invalid request." }); }
  const size = Number(b.size) || 0, type = String(b.type || "");
  if (!TYPES.test(type)) return json(req, 400, { error: "Upload a video file (MP4, MOV, MKV or WebM)." });
  if (size < 1e6 || size > MAX_BYTES) return json(req, 400, { error: "Video must be between 1 MB and 5 GB." });
  const store = getStore("clip-requests");                // 5 upload links per visitor per day
  const ipKey = "rlu:" + crypto.createHash("sha256").update(String(context?.ip || "x")).digest("hex").slice(0, 24);
  const now = Date.now(), rl = (await store.get(ipKey, { type: "json" })) || { start: now, n: 0 };
  if (now - rl.start > 864e5) { rl.start = now; rl.n = 0; }
  if (rl.n >= 5) return json(req, 429, { error: "Too many uploads today. Try again tomorrow." });
  rl.n += 1; await store.setJSON(ipKey, rl);
  const safe = (String(b.name || "video.mp4").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "") || "video.mp4").slice(-80);
  const key = `uploads/${crypto.randomBytes(10).toString("hex")}/${safe}`;
  return json(req, 200, { key, ut: uploadToken(key), putUrl: S3.presign(cfg, "PUT", key, { expires: 7200 }) });
};

export const config = { path: "/api/upload-start" };
