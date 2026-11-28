// node tests/uploads.test.mjs — instant service: customer uploads the file, cloud engine clips it (no YouTube, no Mac)
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext, getStore } from "@netlify/blobs";
import fs from "fs"; import os from "os"; import path from "path";
let pass = 0; const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } pass++; console.log("ok -", m); };
const srv = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "up-")), token: "t", port: 0 }); const { port } = await srv.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
delete process.env.SEO_TOKEN_SECRET; delete process.env.STRIPE_WEBHOOK_SECRET;
Object.assign(process.env, { MAIL_PROVIDER: "log", SITE_URL: "https://site.example" }); globalThis.__mailLog = [];
const start = (await import("../netlify/functions/upload-start.mjs")).default;
const request = (await import("../netlify/functions/clip-request.mjs")).default;
const post = (fn, body, ip = "1.2.3.4") => fn(new Request("https://site.example/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { ip });
const vid = { name: "My Podcast Ep 12 (final).mp4", size: 300e6, type: "video/mp4" };

let r = await start(new Request("https://site.example/x")); ok((await r.json()).enabled === false, "homepage keeps the link form until uploads are switched on");
r = await post(start, vid);
ok(r.status === 503, "no storage keys yet: upload politely unavailable, links still work");
Object.assign(process.env, { BUCKET_ENDPOINT: "https://t3.storageapi.dev", BUCKET_NAME: "clip-b", BUCKET_ACCESS_KEY_ID: "AK", BUCKET_SECRET_ACCESS_KEY: "SK" });
const S3 = (await import("../lib/s3.cjs")).default; let corsCalls = 0; S3.applyCors = async () => { corsCalls++; return { ok: true, status: 200 }; };   // no network in tests
r = await post(start, { ...vid, type: "application/pdf" }); ok(r.status === 400, "non-video files refused");
r = await post(start, { ...vid, size: 6 * 1024 ** 3 }); ok(r.status === 400, "files over 5 GB refused");
const up = await (await post(start, vid)).json();
ok(corsCalls === 1, "bucket CORS set once, on the first upload");
ok(/^uploads\/[a-f0-9]{20}\/My_Podcast_Ep_12_final_.mp4$/.test(up.key) && up.putUrl.startsWith("https://t3.storageapi.dev/clip-b/uploads/") && /X-Amz-Expires=7200/.test(up.putUrl), "presigned 2-hour PUT link to the bucket, safe file name");
r = await post(request, { url: `upload://${up.key}`, email: "pod@x.com", ut: "forged" });
ok(r.status === 400, "forged upload token refused");
r = await post(request, { url: "upload://uploads/aaaaaaaaaaaaaaaaaaaa/x.mp4", email: "pod@x.com", ut: up.ut });
ok(r.status === 400, "token can't be reused for another file");
r = await post(request, { url: `upload://${up.key}`, email: "pod@x.com", ut: up.ut });
const d = await r.json(); ok(r.status === 200 && d.ok, "real upload becomes a clip request (confirm email sent)");
const D = (await import("../lib/seo/delivery.cjs")).default;
ok(!D.needsOwnerMachine(`upload://${up.key}`), "uploaded files go to the cloud engine, never the Mac");
for (let i = 0; i < 4; i++) await post(start, vid, "9.9.9.9");
ok((await post(start, vid, "9.9.9.9")).status === 200 && (await post(start, vid, "9.9.9.9")).status === 429, "5 upload links per visitor per day");
console.log(`uploads: ${pass} passed`); await srv.stop(); process.exit(0);
