// node tests/clip-request.test.mjs
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext } from "@netlify/blobs";
import fs from "fs"; import os from "os"; import path from "path";
let pass = 0; const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } pass++; console.log("ok -", m); };
const server = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "b-")), token: "t", port: 0 });
const { port } = await server.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
Object.assign(process.env, { STRIPE_WEBHOOK_SECRET: "whsec_t", RESEND_API_KEY: "x", FROM_EMAIL: "TakeKash <hi@takekash.com>", OWNER_EMAIL: "owner@x.com" });
const sent = []; const real = globalThis.fetch;
globalThis.fetch = async (u, o) => String(u).includes("resend.com") ? (sent.push(JSON.parse(o.body)), new Response("{}")) : real(u, o);
const fn = (await import("../netlify/functions/clip-request.mjs")).default;
const call = async (body, ip = "1.1.1.1") => { const r = await fn(new Request("https://takekash.netlify.app/api/clip-request", { method: "POST", headers: { "content-type": "application/json", origin: "https://takekash.com" }, body: JSON.stringify(body) }), { ip }); return { s: r.status, b: await r.json() }; };

let r = await call({ url: "https://www.twitch.tv/videos/123456", email: "Fan@Mail.com" });
ok(r.s === 200 && r.b.ok, "valid Twitch request accepted");
ok(sent.some((m) => m.to === "fan@mail.com" && m.html.includes("/confirm?id=")), "customer gets a confirm link (nothing runs until they click it)");
ok(!sent.some((m) => m.to === "owner@x.com"), "no job or owner alert before the customer confirms");
ok((await call({ url: "https://evil.example.com/x", email: "a@b.co" })).s === 400, "non-video sites rejected");
ok((await call({ url: "twitch.tv/x", email: "a@b.co" })).s === 400, "partial links rejected with a clear message");
ok((await call({ url: "https://youtu.be/abc", email: "nope" })).s === 400, "bad email rejected");
await call({ url: "https://kick.com/v/1", email: "a@b.co", }, "9.9.9.9"); await call({ url: "https://kick.com/v/2", email: "a@b.co" }, "9.9.9.9"); await call({ url: "https://kick.com/v/3", email: "a@b.co" }, "9.9.9.9");
ok((await call({ url: "https://kick.com/v/4", email: "a@b.co" }, "9.9.9.9")).s === 429, "max 3 requests per visitor per day");
await server.stop(); console.log(`\nALL ${pass} CHECKS PASS`);
