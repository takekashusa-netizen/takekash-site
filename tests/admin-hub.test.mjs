// Admin Hub (owner only, every job step, actions), Gmail outbox (Google token, aud pin, lease/ack), engine progress.
import { BlobsServer } from "../node_modules/@netlify/blobs/dist/server.js";
import { setEnvironmentContext, getStore } from "../node_modules/@netlify/blobs/dist/main.js";
import fs from "fs"; import os from "os"; import path from "path"; import assert from "assert"; import crypto from "crypto";
const s = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "a-")), token: "t", port: 0 }); const { port } = await s.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
process.env.SEO_TOKEN_SECRET = "hub-test-secret-hub-test-secret-hub";
const { default: hub } = await import("../netlify/functions/admin-hub.mjs");
const { default: outbox } = await import("../netlify/functions/mail-outbox.mjs");
const { default: progress } = await import("../netlify/functions/engine-progress.mjs");
const access = (await import("../lib/seo/access.cjs")).default;
const D = (await import("../lib/seo/delivery.cjs")).default;
const mail = (await import("../lib/mail.cjs")).default;
const T = (await import("../lib/timeline.cjs")).default;

// --- owner-only hub
const owner = access.signToken("takekashusa@gmail.com", process.env), other = access.signToken("fan@x.com", process.env);
const get = (tok) => hub(new Request("https://x/api/admin-hub", { headers: { Authorization: `Bearer ${tok}` } }));
assert.equal((await get(other)).status, 401); console.log("non-owner -> 401");
const req = getStore("clip-requests"), cbk = D.newCallbackKey();
await req.setJSON("req:dddddddddddddddddddd", T.step({ id: "dddddddddddddddddddd", email: "c@x.com", url: "https://kick.com/v/1", status: "processing", reserved: 3, slots: [], cbk, at: new Date().toISOString() }, "queued"));
let ov = await (await get(owner)).json();
assert.equal(ov.jobs[0].id, "dddddddddddddddddddd"); assert.ok(!("cbk" in ov.jobs[0])); assert.equal(ov.jobs[0].events[0].s, "queued");
console.log("owner sees jobs with every step, no secrets; mail provider default:", ov.mail.provider);

// --- engine progress (HMAC with the job's key)
const prog = (step, key = cbk) => { const raw = Buffer.from(JSON.stringify({ v: 1, jid: "dddddddddddddddddddd", step, iat: Math.floor(Date.now() / 1000) }));
  return progress(new Request("https://x/api/engine-progress", { method: "POST", body: JSON.stringify({ payload: raw.toString("base64"), mac: crypto.createHmac("sha256", Buffer.from(key, "base64")).update(raw).digest("hex") }) })); };
assert.equal((await prog("started")).status, 200); assert.equal((await prog("downloaded", D.newCallbackKey())).status, 401); assert.equal((await prog("hacked")).status, 401);
ov = await (await get(owner)).json(); assert.equal(ov.jobs[0].events.at(-1).s, "started"); console.log("engine progress recorded; wrong key / unknown step rejected");

// --- actions
const act = (b) => hub(new Request("https://x/api/admin-hub", { method: "POST", headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" }, body: JSON.stringify(b) }));
assert.equal((await act({ action: "requeue", id: "dddddddddddddddddddd" })).status, 200); assert.ok(await req.get("queue:dddddddddddddddddddd")); console.log("requeue puts job back in the engine queue");
assert.equal((await act({ action: "cancel", id: "dddddddddddddddddddd" })).status, 200);
const r = await req.get("req:dddddddddddddddddddd", { type: "json" }); assert.equal(r.status, "failed"); assert.equal(r.events.at(-1).s, "cancelled");
assert.equal(await req.get("queue:dddddddddddddddddddd"), null); console.log("cancel removes it from the queue and logs the step");
assert.equal((await act({ action: "upsertSequence", sequence: { id: "giveaway-entrant", name: "Entrants", steps: [{ delayHours: 0, subject: "Hi", html: "<p>x</p>" }] } })).status, 200); console.log("owner can create sequences");

// --- outbox: default provider queues mail; Google token gate
delete process.env.MAIL_PROVIDER;
await mail.send(process.env, { to: "c@x.com", subject: "Your clips", html: "<p>hi</p>" });
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "g1", alg: "RS256" };
const real = globalThis.fetch; globalThis.fetch = async (u, o) => String(u).includes("googleapis.com/oauth2") ? new Response(JSON.stringify({ keys: [jwk] })) : real(u, o);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"), now = Math.floor(Date.now() / 1000);
const gt = (c, k = privateKey) => { const h = b64({ alg: "RS256", kid: "g1" }), p = b64(c); return `${h}.${p}.${crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), k).toString("base64url")}`; };
const good = { iss: "https://accounts.google.com", aud: "123-abc.apps.googleusercontent.com", email: "takekashusa@gmail.com", email_verified: true, iat: now, exp: now + 3600 };
const pull = (tok, pathn = "/api/mail-outbox", body = { max: 10 }) => outbox(new Request(`https://x${pathn}`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
assert.equal((await pull(gt({ ...good, email: "evil@x.com" }))).status, 401); assert.equal((await pull(gt({ ...good, email_verified: false }))).status, 401);
assert.equal((await pull(gt(good, crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey))).status, 401); console.log("other account / unverified / forged Google token -> 401");
const got = await (await pull(gt(good))).json(); assert.equal(got.messages.length, 1); assert.equal(got.messages[0].subject, "Your clips"); console.log("owner's Gmail sender pulls the queued email");
assert.equal((await pull(gt({ ...good, aud: "999-other.apps.googleusercontent.com" }))).status, 401); console.log("token minted for another app rejected after pin");
assert.equal((await (await pull(gt(good))).json()).messages.length, 0); console.log("leased email not handed out twice");
assert.equal((await pull(gt(good), "/api/mail-outbox/ack", { sent: [got.messages[0].id] })).status, 200);
assert.equal((await getStore("mail-outbox").list({ prefix: "lease:" })).blobs.length, 0); console.log("ack clears the lease");
globalThis.fetch = real; await s.stop(); console.log("admin hub + outbox tests passed");
