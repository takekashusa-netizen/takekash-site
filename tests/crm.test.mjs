// CRM: website chat (start/send/poll, key check, honeypot, rate limit), owner inbox reply, unified contacts, leads.
import { BlobsServer } from "../node_modules/@netlify/blobs/dist/server.js";
import { setEnvironmentContext, getStore } from "../node_modules/@netlify/blobs/dist/main.js";
import fs from "fs"; import os from "os"; import path from "path"; import assert from "assert";
const s = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "c-")), token: "t", port: 0 }); const { port } = await s.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
process.env.SEO_TOKEN_SECRET = "crm-test-secret-crm-test-secret-crm"; process.env.MAIL_PROVIDER = "log";
const { default: chat } = await import("../netlify/functions/chat.mjs");
const { default: hub } = await import("../netlify/functions/admin-hub.mjs");
const access = (await import("../lib/seo/access.cjs")).default;
const crm = (await import("../lib/crm.cjs")).default;
globalThis.__mailLog = [];
const post = (p, b, ip = "1.1.1.1") => chat(new Request(`https://x${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }), { ip });

assert.equal((await post("/api/chat/start", { email: "nope", message: "hi" })).status, 400);
const st = await (await post("/api/chat/start", { name: "Dre", email: "Dre@Gamer.com", message: "Can you clip my Warzone VOD?" })).json();
assert.ok(st.id && st.key); assert.equal(st.messages.length, 1); console.log("visitor starts a chat");
assert.ok(globalThis.__mailLog.some((m) => m.to === "takekashusa@gmail.com" && m.reply_to === "dre@gamer.com")); console.log("owner emailed, reply-to is the visitor");
assert.equal((await chat(new Request(`https://x/api/chat?id=${st.id}&key=wrong`))).status, 404); console.log("wrong key can't read the chat");
assert.equal((await post("/api/chat/send", { id: st.id, key: st.key, message: "Also Apex" })).status, 200);
const hp = await post("/api/chat/start", { email: "bot@x.com", message: "spam", website: "http://spam" }); assert.equal(hp.status, 200);
assert.equal((await crm.listAll(getStore("crm"), "conv:")).length, 1); console.log("honeypot bot dropped silently");
for (let i = 0; i < 6; i++) await post("/api/chat/start", { email: `a${i}@x.com`, message: "x" }, "9.9.9.9");
assert.equal((await post("/api/chat/start", { email: "a9@x.com", message: "x" }, "9.9.9.9")).status, 429); console.log("rate limited after 6 new chats/hour");

const owner = access.signToken("takekashusa@gmail.com", process.env);
const act = (b) => hub(new Request("https://x/api/admin-hub", { method: "POST", headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" }, body: JSON.stringify(b) }));
const get = async () => (await hub(new Request("https://x/api/admin-hub", { headers: { Authorization: `Bearer ${owner}` } }))).json();
let ov = await get(); const c = ov.inbox.find((x) => x.id === st.id);
assert.equal(c.messages.length, 2); assert.equal(c.unread, 2); assert.ok(!("key" in c)); console.log("owner inbox shows the chat without its secret key");
globalThis.__mailLog = [];
assert.equal((await act({ action: "reply", id: st.id, text: "Yes! Send the link." })).status, 200);
const sent = globalThis.__mailLog.find((m) => m.to === "dre@gamer.com"); assert.ok(sent && sent.html.includes(`c=${st.id}`)); console.log("reply emailed to the visitor with a link back into the chat");
const polled = await (await chat(new Request(`https://x/api/chat?id=${st.id}&key=${encodeURIComponent(st.key)}`))).json();
assert.equal(polled.messages.at(-1).from, "owner"); console.log("visitor sees the reply in the widget");
assert.equal((await act({ action: "closeChat", id: st.id })).status, 200);

// unified contacts
await getStore("clip-requests").setJSON("req:aaaaaaaaaaaaaaaaaaaa", { id: "aaaaaaaaaaaaaaaaaaaa", email: "dre@gamer.com", status: "delivered", at: "2026-11-20T00:00:00.000Z" });
await getStore("seo-access").setJSON("email:dre@gamer.com", { active: true, plan: "creator", since: Date.parse("2026-11-01") });
await getStore("mail").setJSON("sub:x", { email: "fan@x.com", status: "active", lists: ["takekash-updates"], createdAt: "2026-11-25T00:00:00.000Z" });
assert.equal((await act({ action: "importLeads", leads: "streamer@twitch.tv, Big Streamer, Clips for your channel\nnot-an-email\nfan@x.com\tFan\tCollab", source: "gmail outreach" })).status, 200);
assert.equal((await act({ action: "leadStage", email: "streamer@twitch.tv", stage: "contacted" })).status, 200);
const again = await (await act({ action: "importLeads", leads: "streamer@twitch.tv,Big Streamer,New subject" })).json();
assert.equal(again.updated, 1); assert.equal((await getStore("crm").get("lead:streamer@twitch.tv", { type: "json" })).stage, "contacted"); console.log("lead import keeps stage on re-import");
assert.equal((await act({ action: "saveContact", email: "dre@gamer.com", tags: "VIP, warzone", notes: "Wants weekly clips" })).status, 200);
ov = await get();
const dre = ov.contacts.find((x) => x.email === "dre@gamer.com");
assert.deepEqual(dre.sources.sort(), ["chat", "clip request", "paid member"]); assert.equal(dre.paid, true); assert.equal(dre.delivered, 1); assert.deepEqual(dre.tags, ["vip", "warzone"]);
const fan = ov.contacts.find((x) => x.email === "fan@x.com"); assert.ok(fan.sources.includes("email list") && fan.sources.includes("outreach lead"));
assert.equal(ov.leads.length, 2); console.log("one customer list across jobs, members, email, chat and leads; tags + notes saved");
await s.stop(); console.log("crm tests passed");
