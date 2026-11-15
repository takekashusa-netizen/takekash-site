// Run after bundling functions with zip-it-and-ship-it: node tests/admin-bundle.check.mjs /tmp/zisi/admin-data/admin-data.mjs
globalThis.Netlify = { env: { get: (k) => process.env[k] } };
process.env.STRIPE_WEBHOOK_SECRET = "whsec_x"; process.env.OWNER_EMAIL = "owner@x.com"; process.env.ADMIN_KEY = "a00f3654422035a84817ae304cb04418e4c3e60aabb7abe2";
const entry = process.argv[2];
const mod = await import(entry); const fn = mod.default || (mod.handler);
const { createRequire } = await import("module"); const require = createRequire(import.meta.url);
const access = require("../lib/seo/access.cjs");
const call = async (h) => (await fn(new Request("https://x/api/admin-data", { headers: h }))).status;
console.log("old leaked key ->", await call({ "x-admin-key": process.env.ADMIN_KEY }));
console.log("member token ->", await call({ authorization: "Bearer " + access.signToken("someone@x.com", process.env) }));
console.log("owner token ->", await call({ authorization: "Bearer " + access.signToken("owner@x.com", process.env) }));
