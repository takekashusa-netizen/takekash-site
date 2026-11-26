// Free engine hand-off: only a real GitHub OIDC token for customer-job.yml on main gets tickets;
// each job is handed out once; tickets are freshly signed; finished jobs release their claim.
import { BlobsServer } from "../node_modules/@netlify/blobs/dist/server.js";
import { setEnvironmentContext, getStore } from "../node_modules/@netlify/blobs/dist/main.js";
import fs from "fs"; import os from "os"; import path from "path"; import assert from "assert"; import crypto from "crypto";
const s = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "q-")), token: "t", port: 0 }); const { port } = await s.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
process.env.MAIL_PROVIDER = "log"; process.env.DOWNLOAD_PREFIX = "https://bucket/clips/";

// fake GitHub: our own RSA key published as its JWKS
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => String(u).includes("token.actions.githubusercontent.com") ? new Response(JSON.stringify({ keys: [jwk] })) : realFetch(u, o);
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims, key = privateKey) => { const h = b({ alg: "RS256", kid: "k1" }), p = b(claims); return `${h}.${p}.${crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url")}`; };
const t = Math.floor(Date.now() / 1000);
const good = { iss: "https://token.actions.githubusercontent.com", aud: "takekash-engine", exp: t + 300, iat: t, repository: "takekashusa-netizen/autoclip-pipeline",
  ref: "refs/heads/main", job_workflow_ref: "takekashusa-netizen/autoclip-pipeline/.github/workflows/customer-job.yml@refs/heads/main", event_name: "schedule", run_id: "1" };

const { default: queue } = await import("../netlify/functions/engine-queue.mjs");
const { default: done } = await import("../netlify/functions/clip-job-done.mjs");
const D = (await import("../lib/seo/delivery.cjs")).default;
const call = (tok) => queue(new Request("https://x/api/engine-queue", { method: "POST", headers: tok ? { Authorization: `Bearer ${tok}` } : {} }));

const store = getStore("clip-requests"), cbk = D.newCallbackKey();
await store.setJSON("req:cccccccccccccccccccc", { id: "cccccccccccccccccccc", email: "c@x.com", url: "https://www.twitch.tv/videos/9", status: "processing", reserved: 3, slots: [], cbk });
await store.setJSON("queue:cccccccccccccccccccc", { jid: "cccccccccccccccccccc", url: "https://www.twitch.tv/videos/9", clips: 3, cbk });

for (const [name, tok] of [["no token", null], ["fork pull_request", jwt({ ...good, event_name: "pull_request" })], ["other repo", jwt({ ...good, repository: "evil/repo" })],
  ["other branch", jwt({ ...good, ref: "refs/heads/x" })], ["other workflow", jwt({ ...good, job_workflow_ref: "takekashusa-netizen/autoclip-pipeline/.github/workflows/x.yml@refs/heads/main" })],
  ["wrong audience", jwt({ ...good, aud: "other" })], ["expired", jwt({ ...good, exp: t - 10 })], ["forged signature", jwt(good, crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey)]]) {
  assert.equal((await call(tok)).status, 401, name); console.log(`${name} -> 401`);
}
const first = await (await call(jwt(good))).json();
assert.equal(first.tickets.length, 1); console.log("real engine token gets 1 ticket");
const tk = JSON.parse(Buffer.from(first.tickets[0].ticket, "base64").toString());
assert.ok(Math.abs(tk.iat - t) < 5 && tk.cbk === cbk); console.log("ticket freshly signed, carries the job's callback key");
assert.equal((await (await call(jwt(good))).json()).tickets.length, 0); console.log("same job never handed out twice");
assert.ok(await store.get("running:cccccccccccccccccccc")); console.log("claim recorded");

// engine finishes -> HMAC callback -> delivered, claim released

const raw = Buffer.from(JSON.stringify({ v: 1, jid: "cccccccccccccccccccc", status: "done", delivered: 3, iat: t, download: "https://bucket/clips/c.zip?s=1" }));
const mac = crypto.createHmac("sha256", Buffer.from(cbk, "base64")).update(raw).digest("hex");
const res = await done(new Request("https://x/api/clip-job-done", { method: "POST", body: JSON.stringify({ payload: raw.toString("base64"), mac }) }));
assert.equal(res.status, 200);
const r = await store.get("req:cccccccccccccccccccc", { type: "json" });
assert.equal(r.status, "delivered"); assert.equal(await store.get("running:cccccccccccccccccccc"), null);
console.log("callback accepted -> delivered, claim released, portal link stored:", !!r.download);
globalThis.fetch = realFetch; await s.stop(); console.log("engine queue tests passed");
