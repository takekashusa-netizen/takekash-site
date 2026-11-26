// Social calendar: platform limits, schedule validation, due reminders (one email each), mark posted.
import { BlobsServer } from "../node_modules/@netlify/blobs/dist/server.js";
import { setEnvironmentContext, getStore } from "../node_modules/@netlify/blobs/dist/main.js";
import fs from "fs"; import os from "os"; import path from "path"; import assert from "assert";
const s = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "so-")), token: "t", port: 0 }); const { port } = await s.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
process.env.SEO_TOKEN_SECRET = "soc-test-secret-soc-test-secret-soc"; process.env.MAIL_PROVIDER = "log";
const { default: hub } = await import("../netlify/functions/admin-hub.mjs");
const { default: run } = await import("../netlify/functions/social-run.mjs");
const access = (await import("../lib/seo/access.cjs")).default;
const owner = access.signToken("takekashusa@gmail.com", process.env);
const act = async (b) => { const r = await hub(new Request("https://x/api/admin-hub", { method: "POST", headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" }, body: JSON.stringify(b) })); return { status: r.status, body: await r.json() }; };

let r = await act({ action: "savePost", post: { platforms: ["x"], caption: "a".repeat(300), schedule: true, scheduledAt: new Date().toISOString() } });
assert.equal(r.status, 400); assert.match(r.body.error, /x: 300\/280/); console.log("X 280-character limit enforced");
r = await act({ action: "savePost", post: { platforms: ["tiktok"], caption: "Clutch 1v4 #warzone", schedule: true, scheduledAt: new Date().toISOString() } });
assert.match(r.body.error, /needs a video link/); console.log("TikTok post needs a video");
r = await act({ action: "savePost", post: { platforms: ["tiktok"], caption: "draft only" } }); assert.equal(r.status, 200); assert.equal(r.body.post.status, "draft"); assert.ok(r.body.problems.length); console.log("drafts save with a fix list");
r = await act({ action: "savePost", post: { platforms: ["tiktok", "youtube"], title: "Clutch 1v4", caption: "Clutch 1v4 #warzone", mediaUrl: "https://t3.storageapi.dev/x.mp4", account: "@takekashgaming", schedule: true, scheduledAt: new Date(Date.now() - 60e3).toISOString() } });
assert.equal(r.body.post.status, "scheduled"); const id = r.body.post.id;
await act({ action: "savePost", post: { platforms: ["x"], caption: "later", schedule: true, scheduledAt: new Date(Date.now() + 864e5).toISOString() } });
globalThis.__mailLog = []; await run(); await run();
assert.equal(globalThis.__mailLog.filter((m) => m.subject.startsWith("📣")).length, 1); assert.ok(globalThis.__mailLog[0].html.includes("Clutch 1v4 #warzone"));
console.log("due post emails the owner once with the caption; future post waits");
r = await act({ action: "postStatus", id, status: "posted", postedUrls: { tiktok: "https://www.tiktok.com/@takekashgaming/video/1", youtube: "javascript:alert(1)" } });
assert.equal(r.body.post.status, "posted"); assert.deepEqual(Object.keys(r.body.post.postedUrls), ["tiktok"]); console.log("marked posted; only https links kept");
await s.stop(); console.log("social tests passed");
