// POST /api/mac-queue  (Authorization: Bearer <owner Admin Hub token>)
// The owner's Mac worker (autoclip-pipeline/worker/mac_customer_job.py) claims YouTube jobs here, because YouTube
// blocks cloud downloads. Same signed tickets and per-job HMAC callback as the cloud engine (/api/clip-job-done).
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";
import T from "../../lib/timeline.cjs";
import D from "../../lib/seo/delivery.cjs";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const BATCH = 2;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  await access.ensureSigningSecret(getStore("keys"));
  const auth = req.headers.get("authorization") || "";
  const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), process.env) : null;
  if (!email || !access.isOwner(email, process.env)) return json(401, { error: "unauthorized" });

  const store = getStore("clip-requests"), now = Date.now();
  await store.setJSON("mac:lastPoll", { at: new Date(now).toISOString() });   // worker health for the Admin Hub
  const { privateKey } = await D.siteKey(getStore("keys"));
  const tickets = [];
  const waiting = [];
  for (const { key } of (await store.list({ prefix: "macqueue:" })).blobs) { const job = await store.get(key, { type: "json" }); if (job) waiting.push({ key, job }); }
  const rank = (j) => (j.plan && j.plan !== "free" ? 0 : 1);           // paying customers first, then oldest
  waiting.sort((x, y) => rank(x.job) - rank(y.job) || String(x.job.at || "").localeCompare(String(y.job.at || "")));
  for (const { key, job } of waiting) {
    if (tickets.length >= BATCH) break;
    const id = key.slice("macqueue:".length);
    const lease = await store.setJSON(`running:${id}`, { at: now, run: "mac", mac: true, tries: job.tries || 1, job }, { onlyIfNew: true });
    if (lease && lease.modified === false) continue;
    await store.delete(key);
    const rec = await store.get(`req:${id}`, { type: "json" });
    if (rec) await store.setJSON(`req:${id}`, T.step(rec, "claimed", "owner's Mac worker"));
    tickets.push(D.makeTicket(privateKey, { jid: job.jid, url: job.url, clips: job.clips, cbk: job.cbk }));
  }
  return json(200, { tickets });
};

export const config = { path: "/api/mac-queue" };
