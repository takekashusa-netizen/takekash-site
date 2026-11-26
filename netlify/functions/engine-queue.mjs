// POST /api/engine-queue  (Authorization: Bearer <GitHub Actions OIDC token>)
// The free clip engine (GitHub Actions) calls this every few minutes and receives up to 3 job tickets.
// No shared secret: only the customer-job workflow on main in autoclip-pipeline can get a token that passes.
// Jobs claimed but not finished in 3 hours go back in the queue once; after that the owner is told.
import { getStore } from "@netlify/blobs";
import T from "../../lib/timeline.cjs";
import oidc from "../../lib/github-oidc.cjs";
import mail from "../../lib/mail.cjs";
import D from "../../lib/seo/delivery.cjs";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const BATCH = 3, STALE_MS = 3 * 3600e3;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = req.headers.get("authorization") || "";
  const claims = auth.startsWith("Bearer ") ? await oidc.verify(auth.slice(7)).catch(() => null) : null;
  if (!claims) return json(401, { error: "unauthorized" });

  const store = getStore("clip-requests"), now = Date.now();
  await store.setJSON("engine:lastPoll", { at: new Date(now).toISOString(), run: claims.run_id, event: claims.event_name });   // engine health for the admin hub

  // requeue stale claims (engine run died) once
  for (const { key } of (await store.list({ prefix: "running:" })).blobs) {
    const run = await store.get(key, { type: "json" });
    if (!run || now - run.at < STALE_MS) continue;
    const id = key.slice("running:".length);
    await store.delete(key);
    const rec = await store.get(`req:${id}`, { type: "json" });
    if ((run.tries || 1) < 2) { await store.setJSON(`queue:${id}`, { ...run.job, tries: (run.tries || 1) + 1 }); if (rec) await store.setJSON(`req:${id}`, T.step(rec, "requeued", "engine run did not finish in 3h")); }
    else await mail.send(process.env, { to: process.env.OWNER_EMAIL, subject: "ACTION NEEDED: clip job stuck",
      html: `<p>Clip job ${id} was claimed twice and never finished. Make it by hand or check the engine runs.</p>` }).catch(() => {});
  }

  const { privateKey } = await D.siteKey(getStore("keys"));   // tickets are signed at claim time, so they're always fresh
  const tickets = [];
  for (const { key } of (await store.list({ prefix: "queue:" })).blobs) {
    if (tickets.length >= BATCH) break;
    const id = key.slice("queue:".length);
    const job = await store.get(key, { type: "json" });
    if (!job) continue;
    const lease = await store.setJSON(`running:${id}`, { at: now, run: claims.run_id, tries: job.tries || 1, job }, { onlyIfNew: true });
    if (lease && lease.modified === false) continue;   // another run took it
    await store.delete(key);
    const rec = await store.get(`req:${id}`, { type: "json" });
    if (rec) await store.setJSON(`req:${id}`, T.step(rec, "claimed", `engine run ${claims.run_id}`));
    tickets.push(D.makeTicket(privateKey, { jid: job.jid, url: job.url, clips: job.clips, cbk: job.cbk }));
  }
  return json(200, { tickets });
};

export const config = { path: "/api/engine-queue" };
