// Local stand-in for Netlify: real function code + local Blobs, emails captured to a file.
import http from "http"; import fs from "fs"; import os from "os"; import path from "path";
const SITE = "/home/claude/takekash-site";
const { BlobsServer } = await import(SITE + "/node_modules/@netlify/blobs/dist/server.js");
const { setEnvironmentContext } = await import(SITE + "/node_modules/@netlify/blobs/dist/main.js");
const [SPORT, RPORT, EMAILS] = process.argv.slice(2);
const bs = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "e2eb-")), token: "t", port: 0 });
const { port } = await bs.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
Object.assign(process.env, { RESEND_API_KEY: "x", FROM_EMAIL: "TakeKash <hi@takekash.com>", OWNER_EMAIL: "owner@x.com", STRIPE_WEBHOOK_SECRET: "whsec_e2e",
  CLIP_API_BASE: `http://127.0.0.1:${RPORT}` });
const real = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (String(u).includes("resend.com")) { const m = JSON.parse(o.body); const all = fs.existsSync(EMAILS) ? JSON.parse(fs.readFileSync(EMAILS)) : []; all.push(m); fs.writeFileSync(EMAILS, JSON.stringify(all)); return new Response("{}"); }
  return real(u, o);
};
const routes = {};
for (const f of ["clip-request", "clip-confirm", "clip-job-done", "pubkey"]) {
  const m = await import(`${SITE}/netlify/functions/${f}.mjs`);
  for (const p of [].concat(m.config.path)) routes[p] = m.default;
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${SPORT}`), fn = routes[u.pathname];
  if (!fn) { res.writeHead(404); return res.end(); }
  let body = ""; for await (const c of req) body += c;
  const r = await fn(new Request(u, { method: req.method, headers: { ...req.headers, origin: "https://takekash.com" }, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), { ip: "1.2.3.4" });
  res.writeHead(r.status, { "content-type": "application/json" }); res.end(await r.text());
}).listen(+SPORT, () => console.log("site up"));
