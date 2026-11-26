// Customer portal: sign-in gate, per-customer job isolation, allowance math, no secret fields leaked.
import { BlobsServer } from "../node_modules/@netlify/blobs/dist/server.js";
import { setEnvironmentContext, getStore } from "../node_modules/@netlify/blobs/dist/main.js";
import fs from "fs"; import os from "os"; import path from "path"; import assert from "assert";
const s = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "p-")), token: "t", port: 0 }); const { port } = await s.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
process.env.SEO_TOKEN_SECRET = "test-secret-test-secret-test-secret"; process.env.MAIL_PROVIDER = "log";
const { default: handler } = await import("../netlify/functions/portal.mjs");
const access = (await import("../lib/seo/access.cjs")).default;
const portal = (await import("../lib/portal.cjs")).default;
const D = (await import("../lib/seo/delivery.cjs")).default;

const req = getStore("clip-requests"), quota = getStore("clip-quota");
const now = Date.now();
await req.setJSON("req:aaaaaaaaaaaaaaaaaaaa", { id: "aaaaaaaaaaaaaaaaaaaa", email: "a@x.com", url: "https://www.twitch.tv/videos/1", status: "delivered", reserved: 3, delivered: 3, at: new Date().toISOString(), download: "https://b/clips/a.zip", downloadExp: now + 864e5, cbk: "SECRET", slots: ["x"] });
await req.setJSON("req:bbbbbbbbbbbbbbbbbbbb", { id: "bbbbbbbbbbbbbbbbbbbb", email: "b@x.com", url: "https://kick.com/v/2", status: "processing", reserved: 3 });
await portal.indexJob(req, "a@x.com", "aaaaaaaaaaaaaaaaaaaa");
await portal.indexJob(req, "a@x.com", "bbbbbbbbbbbbbbbbbbbb");   // someone else's id in a's list must NOT show
await D.reserve(quota, "a@x.com", "free", "aaaaaaaaaaaaaaaaaaaa");

const get = (tok) => handler(new Request("https://takekash.netlify.app/api/portal", { headers: tok ? { Authorization: `Bearer ${tok}` } : {} }));
assert.equal((await get(null)).status, 401); console.log("no token -> 401");
assert.equal((await get("forged.token")).status, 401); console.log("forged token -> 401");
const body = await (await get(access.signToken("a@x.com", process.env))).json();
assert.equal(body.jobs.length, 1); console.log("only own jobs listed:", body.jobs.map((j) => j.id));
assert.equal(body.jobs[0].download, "https://b/clips/a.zip"); console.log("live download link shown");
assert.ok(!JSON.stringify(body).includes("SECRET") && !("slots" in body.jobs[0])); console.log("callback key and slots never returned");
assert.deepEqual([body.allowance.plan, body.allowance.used, body.allowance.left], ["free", 3, 0]); console.log("allowance:", body.allowance);
const expired = portal.publicJob({ id: "z", url: "https://kick.com/x", status: "delivered", download: "u", downloadExp: now - 1 });
assert.equal(expired.download, null); console.log("expired link hidden");
const post = (email) => handler(new Request("https://takekash.netlify.app/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }));
const r1 = await (await post("a@x.com")).json(), r2 = await (await post("nobody@x.com")).json();
assert.equal(r1.message, r2.message); console.log("same answer for customers and strangers");
await s.stop(); console.log("portal tests passed");
