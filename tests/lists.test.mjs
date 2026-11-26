// TakeKash Lists: double opt-in, signed links, welcome sequence timing, one-click unsubscribe, compliance footer.
import { BlobsServer } from "../node_modules/@netlify/blobs/dist/server.js";
import { setEnvironmentContext, getStore } from "../node_modules/@netlify/blobs/dist/main.js";
import fs from "fs"; import os from "os"; import path from "path"; import assert from "assert";
const s = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "l-")), token: "t", port: 0 }); const { port } = await s.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
process.env.MAIL_PROVIDER = "log"; process.env.SEO_TOKEN_SECRET = "lists-test-secret-lists-test-secret";
const { default: handler } = await import("../netlify/functions/lists.mjs");
const L = (await import("../lib/lists.cjs")).default;
const store = getStore("mail"), env = process.env, sent = () => globalThis.__mailLog || [];
const post = (p, b, ip = "1.1.1.1") => handler(new Request(`https://takekash.netlify.app${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), { ip });

await L.ensureDefaults(store);
await L.upsertSequence(store, { id: "giveaway-entrant", name: "Entrant funnel", steps: [
  { delayHours: 0, subject: "You're entered, {{first_name}}", html: "<p>Welcome {{first_name}}</p>" },
  { delayHours: 24, subject: "Way #2 to win", html: "<p>Day 2</p>" } ] });

let r = await post("/api/subscribe", { email: "Fan@X.com", name: "Jay", list: "giveaway-2-ways", source: "giveaway-page" });
assert.equal(r.status, 200);
assert.equal((await store.get("sub:fan@x.com", { type: "json" })).status, "pending"); console.log("signup is pending until confirmed");
assert.ok(sent().at(-1).subject.includes("Confirm")); console.log("confirm email sent");
assert.equal((await (await post("/api/subscribe", { email: "z@x.com", list: "nope" })).json()).error, "Unknown list"); console.log("unknown list rejected");

assert.equal((await post("/api/subscribe/confirm", { e: "fan@x.com", t: L.sign("unsub", "fan@x.com", env) })).status, 400); console.log("unsubscribe token can't confirm");
assert.equal((await post("/api/subscribe/confirm", { e: "fan@x.com", t: L.sign("confirm", "fan@x.com", env) })).status, 200);
const sub = await store.get("sub:fan@x.com", { type: "json" });
assert.equal(sub.status, "active"); assert.deepEqual(sub.lists, ["giveaway-2-ways"]); console.log("confirmed -> active on list");

const t0 = Date.now();
assert.equal((await L.runDue(store, env, t0)).sent, 1);
const m1 = sent().at(-1);
assert.equal(m1.subject, "You're entered, Jay"); assert.ok(m1.html.includes("Unsubscribe") && m1.html.includes("Allen, TX"));
assert.equal(m1.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click"); console.log("step 1 sent with name, unsubscribe link, address, one-click header");
assert.equal((await L.runDue(store, env, t0 + 3600e3)).sent, 0); console.log("step 2 waits its 24h");
assert.equal((await L.runDue(store, env, t0 + 25 * 3600e3)).sent, 1); console.log("step 2 sent after 24h");
assert.equal((await L.runDue(store, env, t0 + 99 * 3600e3)).sent, 0); console.log("sequence finished, nothing repeats");

await L.enroll(store, "giveaway-entrant", "fan@x.com", t0);
const u = await handler(new Request(`https://takekash.netlify.app/api/unsubscribe?e=fan%40x.com&t=${L.sign("unsub", "fan@x.com", env)}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "Content-Type": "application/x-www-form-urlencoded" } }), { ip: "2" });
assert.equal(u.status, 200); assert.equal((await store.get("sub:fan@x.com", { type: "json" })).status, "unsubscribed");
assert.equal((await L.runDue(store, env, t0 + 999 * 3600e3)).sent, 0); console.log("one-click unsubscribe stops everything");
assert.equal((await handler(new Request("https://takekash.netlify.app/api/unsubscribe?e=fan%40x.com&t=forged", { method: "POST" }), { ip: "3" })).status, 400); console.log("forged unsubscribe rejected");

for (let i = 0; i < 5; i++) await post("/api/subscribe", { email: `r${i}@x.com`, list: "takekash-updates" }, "9.9.9.9");
assert.equal((await post("/api/subscribe", { email: "r9@x.com", list: "takekash-updates" }, "9.9.9.9")).status, 429); console.log("6th signup per hour from one visitor blocked");
await s.stop(); console.log("lists tests passed");
