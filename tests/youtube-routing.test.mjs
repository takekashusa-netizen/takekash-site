// node tests/youtube-routing.test.mjs — YouTube links go to the owner's machine, never to the cloud engine (which YouTube blocks)
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext, getStore } from "@netlify/blobs";
import fs from "fs"; import os from "os"; import path from "path";
let pass = 0; const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } pass++; console.log("ok -", m); };
const srv = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "yt-")), token: "t", port: 0 }); const { port } = await srv.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
delete process.env.SEO_TOKEN_SECRET; delete process.env.STRIPE_WEBHOOK_SECRET; delete process.env.OWNER_EMAIL;
Object.assign(process.env, { MAIL_PROVIDER: "log", SITE_URL: "https://site.example" });
globalThis.__mailLog = [];
const D = (await import("../lib/seo/delivery.cjs")).default;
ok(D.needsOwnerMachine("https://www.youtube.com/watch?v=abc") && D.needsOwnerMachine("https://youtu.be/abc") && !D.needsOwnerMachine("https://www.twitch.tv/videos/1"), "YouTube detected, Twitch not");
const access = (await import("../lib/seo/access.cjs")).default;
await access.ensureSigningSecret(getStore("keys"));
const { confirmToken } = await import("../netlify/functions/clip-request.mjs");
const confirm = (await import("../netlify/functions/clip-confirm.mjs")).default;
const reqs = getStore("clip-requests");
async function run(id, url, email = "fan@x.com") {
  await reqs.setJSON(`req:${id}`, { id, url, email, at: new Date().toISOString(), status: "awaiting_confirm", events: [] });
  const r = await confirm(new Request("https://site.example/api/clip-confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, t: confirmToken(id) }) }));
  return { s: r.status, d: await r.json(), rec: await reqs.get(`req:${id}`, { type: "json" }), q: await reqs.get(`queue:${id}`) };
}
let x = await run("a".repeat(20), "https://www.youtube.com/watch?v=YmAv7cHneDk");
ok(x.s === 200 && x.d.status === "manual" && x.rec.ownerMachine && !x.q, "YouTube job is not sent to the cloud engine");
ok(x.rec.reserved > 0, "customer's clips stay reserved (they will be delivered)");
ok(globalThis.__mailLog.some((m) => m.to === "takekashusa@gmail.com" && /Mac/.test(m.subject)), "owner gets a 'make it on your Mac' email even with OWNER_EMAIL unset");
x = await run("b".repeat(20), "https://www.twitch.tv/videos/123", "other@x.com");
ok(x.d.status === "processing" && x.q, "Twitch job still goes to the cloud engine");
console.log(`youtube-routing: ${pass} passed`); await srv.stop(); process.exit(0);
