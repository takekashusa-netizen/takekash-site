// takekash site on Railway: static pages + the same API functions the site ran on Netlify.
import http from "http"; import fs from "fs"; import path from "path"; import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const PORT = +process.env.PORT || 8080;
const MAX_BODY = 1024 * 1024;   // 1 MB: nothing legitimate sends more

// ---- functions ----
const routes = new Map();
for (const f of fs.readdirSync(path.join(ROOT, "netlify/functions"))) {
  if (!f.endsWith(".mjs")) continue;
  const mod = await import(pathToFileURL(path.join(ROOT, "netlify/functions", f)).href);
  for (const p of [].concat(mod.config?.path || [])) routes.set(p, mod.default);
}
// classic (event-style) handlers
const lambda = (h) => async (req) => {
  const body = ["GET", "HEAD"].includes(req.method) ? "" : await req.text();
  const headers = {}; req.headers.forEach((v, k) => (headers[k] = v));
  const r = await h({ httpMethod: req.method, headers, body, isBase64Encoded: false, path: new URL(req.url).pathname, queryStringParameters: Object.fromEntries(new URL(req.url).searchParams) });
  return new Response(r.body ?? "", { status: r.statusCode || 200, headers: r.headers || {} });
};
const checkout = lambda(require(path.join(ROOT, "netlify/functions/create-checkout-session.js")).handler);
const webhook = lambda(require(path.join(ROOT, "netlify/functions/stripe-webhook.js")).handler);
for (const p of ["/api/create-checkout-session", "/.netlify/functions/create-checkout-session"]) routes.set(p, checkout);
for (const p of ["/api/stripe-webhook", "/.netlify/functions/stripe-webhook"]) routes.set(p, webhook);
// admin snapshot (owner sign-in only), same rule as the Netlify version
const access = require(path.join(ROOT, "lib/seo/access.cjs"));
routes.set("/api/admin-data", async (req) => {
  const a = req.headers.get("authorization") || "", email = a.startsWith("Bearer ") ? access.verifyToken(a.slice(7), process.env) : null;
  if (!email || !access.isOwner(email, process.env)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  return new Response(fs.readFileSync(path.join(ROOT, "netlify/functions/admin-data/snapshot.json")), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
});
routes.set("/healthz", async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }));

// ---- static ----
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain", ".webp": "image/webp" };
const BLOCK = /^\/(netlify|lib|server|scripts|tests|node_modules|\.git)(\/|$)|^\/(package(-lock)?\.json|Dockerfile|ADMIN-SETUP\.txt|README\.md|_redirects|vercel\.json)$|\/\./;
const REDIRECTS = { "/privacy": "/privacy-policy", "/terms": "/terms-of-service" };
function staticFile(p) {
  if (BLOCK.test(p)) return null;
  const clean = path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, "");
  const base = path.join(ROOT, clean);
  if (!base.startsWith(ROOT)) return null;
  for (const c of [base, base + ".html", path.join(base, "index.html")]) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "SAMEORIGIN",
  "strict-transport-security": "max-age=31536000; includeSubDomains", "permissions-policy": "camera=(), microphone=(), geolocation=()" };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (REDIRECTS[url.pathname]) { res.writeHead(301, { location: REDIRECTS[url.pathname], ...SECURITY }); return res.end(); }
    const fn = routes.get(url.pathname);
    if (fn) {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413, SECURITY); return res.end(); } chunks.push(c); }
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(",") : v);
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const r = await fn(new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), { ip });
      const out = {}; r.headers.forEach((v, k) => (out[k] = v));
      res.writeHead(r.status, { ...SECURITY, ...out }); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, SECURITY); return res.end(); }
    const file = staticFile(url.pathname);
    if (!file) { const nf = staticFile("/404") || null; res.writeHead(404, { "content-type": "text/html; charset=utf-8", ...SECURITY }); return res.end(nf ? fs.readFileSync(nf) : "Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600", ...SECURITY });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error("request failed", e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json", ...SECURITY });
    res.end('{"error":"server error"}');
  }
}).listen(PORT, () => console.log(`site listening on ${PORT} (${routes.size} api routes)`));
