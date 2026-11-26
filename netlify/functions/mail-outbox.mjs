// TakeKash Gmail sender hand-off (no shared secret; Google identity token from the owner's account).
//   POST /api/mail-outbox      {max}                 -> up to `max` queued emails (leased for 15 min)
//   POST /api/mail-outbox/ack  {sent:[id], failed:[{id,error}]}
// Leases not acked in 15 minutes go back in the queue; a message that fails 3 times is parked for the owner.
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";
import g from "../../lib/google-oidc.cjs";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const LEASE_MS = 15 * 60e3;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const auth = req.headers.get("authorization") || "";
  const claims = auth.startsWith("Bearer ")
    ? await g.verify(auth.slice(7), { ownerEmail: access.ownerEmail(process.env), pinStore: getStore("keys") }).catch(() => null) : null;
  if (!claims) return json(401, { error: "unauthorized" });

  const box = getStore("mail-outbox"), now = Date.now();
  await box.setJSON("sender:lastPoll", { at: new Date(now).toISOString() });
  let body = {}; try { body = await req.json(); } catch {}

  if (new URL(req.url).pathname.endsWith("/ack")) {
    for (const id of (body.sent || []).slice(0, 200)) await box.delete(`lease:${id}`);
    for (const f of (body.failed || []).slice(0, 200)) {
      const m = await box.get(`lease:${f.id}`, { type: "json" });
      if (!m) continue;
      await box.delete(`lease:${f.id}`);
      m.tries = (m.tries || 0) + 1; m.lastError = String(f.error || "").slice(0, 300);
      await box.setJSON(m.tries >= 3 ? `failed:${f.id}` : `msg:${f.id}`, m);
    }
    return json(200, { ok: true });
  }

  for (const { key } of (await box.list({ prefix: "lease:" })).blobs) {          // expired leases -> back to queue
    const m = await box.get(key, { type: "json" });
    if (m && now - m.leasedAt > LEASE_MS) { await box.delete(key); await box.setJSON(`msg:${m.id}`, m); }
  }
  const max = Math.max(0, Math.min(Number(body.max) || 20, 50));
  const out = [];
  for (const { key } of (await box.list({ prefix: "msg:" })).blobs) {
    if (out.length >= max) break;
    const m = await box.get(key, { type: "json" });
    if (!m) continue;
    const lease = await box.setJSON(`lease:${m.id}`, { ...m, leasedAt: now }, { onlyIfNew: true });
    if (lease && lease.modified === false) continue;
    await box.delete(key);
    out.push({ id: m.id, to: m.to, subject: m.subject, html: m.html, replyTo: m.reply_to || null });
  }
  return json(200, { messages: out });
};

export const config = { path: ["/api/mail-outbox", "/api/mail-outbox/ack"] };
