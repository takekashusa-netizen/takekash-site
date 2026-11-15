import { BlobsServer } from "../node_modules/@netlify/blobs/dist/server.js";
import { setEnvironmentContext, getStore } from "../node_modules/@netlify/blobs/dist/main.js";
import fs from "fs"; import os from "os"; import path from "path"; import { createRequire } from "module";
const require = createRequire(import.meta.url); const D = require("../lib/seo/delivery.cjs");
const s = new BlobsServer({ directory: fs.mkdtempSync(path.join(os.tmpdir(), "r-")), token: "t", port: 0 }); const { port } = await s.start();
setEnvironmentContext({ siteID: "s", token: "t", edgeURL: `http://localhost:${port}` });
const q = getStore("clip-quota");
let total = 0; for (let i = 0; i < 4; i++) total += (await D.reserve(q, "seq@x.com", "free")).clips;
console.log("sequential free total (expect 3):", total);
const r = await D.reserve(q, "pro@x.com", "pro"); console.log("pro per job (expect 10):", r.clips);
await D.refund(q, r.slots, 4); console.log("after refunding 4, next pro job gets 10 again from the freed slots:", (await D.reserve(q, "pro@x.com", "pro")).clips);
// a slot key that already exists can never be created again (the property parallel spends rely on)
const w = await q.set("slot:z@x.com:free:1", "a", { onlyIfNew: true }), w2 = await q.set("slot:z@x.com:free:1", "b", { onlyIfNew: true });
console.log("create-only refuses an existing slot:", w2.modified === false);
await s.stop();
