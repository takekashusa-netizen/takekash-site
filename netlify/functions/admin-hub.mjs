// TakeKash Admin Hub — owner only, full access.
//   POST /api/admin-hub/signin {email}       -> emails the owner a 30-day sign-in link (same answer for anyone)
//   GET  /api/admin-hub                      -> everything: engine, mail, jobs (with every step), subscribers, lists
//   POST /api/admin-hub {action, ...}        -> requeue | cancel | note | retryMail | upsertList | upsertSequence | broadcast
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";
import mail from "../../lib/mail.cjs";
import lists from "../../lib/lists.cjs";
import D from "../../lib/seo/delivery.cjs";
import T from "../../lib/timeline.cjs";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const all = async (store, prefix, limit = 500) => {
  const out = [];
  for (const { key } of (await store.list({ prefix })).blobs) {
    if (out.length >= limit) break;
    const v = await store.get(key, { type: "json" });
    if (v) out.push({ key, ...v });
  }
  return out;
};

async function overview() {
  const req = getStore("clip-requests"), box = getStore("mail-outbox"), m = getStore("mail");
  const jobs = (await all(req, "req:", 1000)).map(({ key, cbk, slots, ...r }) => r)
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200);
  const subs = (await all(m, "sub:", 5000)).map(({ key, ...s }) => s);
  const byStatus = subs.reduce((a, s) => ((a[s.status] = (a[s.status] || 0) + 1), a), {});
  const perList = {};
  for (const s of subs) if (s.status === "active") for (const l of s.lists || []) perList[l] = (perList[l] || 0) + 1;
  return {
    engine: {
      lastPoll: await req.get("engine:lastPoll", { type: "json" }),
      queued: (await req.list({ prefix: "queue:" })).blobs.length,
      running: (await all(req, "running:")).map((r) => ({ id: r.key.slice(8), at: new Date(r.at).toISOString(), run: r.run, tries: r.tries })),
    },
    mail: {
      provider: mail.provider(process.env),
      senderLastPoll: await box.get("sender:lastPoll", { type: "json" }),
      queued: (await box.list({ prefix: "msg:" })).blobs.length,
      sending: (await box.list({ prefix: "lease:" })).blobs.length,
      failed: (await all(box, "failed:", 50)).map(({ key, html, ...f }) => f),
    },
    jobs,
    jobCounts: jobs.reduce((a, j) => ((a[j.status] = (a[j.status] || 0) + 1), a), {}),
    subscribers: { total: subs.length, byStatus, perList, recent: subs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50) },
    lists: (await all(m, "list:")).map(({ key, ...l }) => l),
    sequences: (await all(m, "seq:")).map(({ key, ...s }) => ({ id: s.id, name: s.name, steps: s.steps.map((x) => ({ delayHours: x.delayHours, subject: x.subject })) })),
    customers: (await req.list({ prefix: "jobs:" })).blobs.length,
    stepLabels: T.LABELS,
  };
}

async function act(b) {
  const req = getStore("clip-requests"), box = getStore("mail-outbox"), m = getStore("mail");
  const job = async (id) => (/^[a-z0-9]{8,40}$/.test(String(id)) ? req.get(`req:${id}`, { type: "json" }) : null);
  switch (b.action) {
    case "requeue": {
      const r = await job(b.id); if (!r) return { error: "no such job" };
      r.cbk = D.newCallbackKey(); r.status = "processing"; T.step(r, "requeued", "by owner");
      await req.setJSON(`req:${r.id}`, r); await req.delete(`running:${r.id}`);
      await req.setJSON(`queue:${r.id}`, { jid: r.id, url: r.url, clips: r.reserved || 1, cbk: r.cbk });
      return { ok: true };
    }
    case "cancel": {
      const r = await job(b.id); if (!r) return { error: "no such job" };
      await req.delete(`queue:${r.id}`); await req.delete(`running:${r.id}`);
      if (r.slots && r.reserved) await D.refund(getStore("clip-quota"), r.slots);
      Object.assign(r, { status: "failed", reserved: 0 }); T.step(r, "cancelled", "allowance refunded");
      await req.setJSON(`req:${r.id}`, r); return { ok: true };
    }
    case "note": {
      const r = await job(b.id); if (!r) return { error: "no such job" };
      await req.setJSON(`req:${r.id}`, T.step(r, "note", String(b.text || "").slice(0, 300))); return { ok: true };
    }
    case "retryMail": {
      const f = await box.get(`failed:${b.id}`, { type: "json" }); if (!f) return { error: "no such email" };
      await box.delete(`failed:${b.id}`); await box.setJSON(`msg:${b.id}`, { ...f, tries: 0 }); return { ok: true };
    }
    case "upsertList": return { ok: true, list: await lists.upsertList(m, b.list) };
    case "upsertSequence": return { ok: true, sequence: await lists.upsertSequence(m, b.sequence) };
    case "broadcast": {
      if (!b.list || !b.subject || !b.html) return { error: "list, subject and html required" };
      return { ok: true, ...(await lists.broadcast(m, process.env, b.list, b.subject, b.html)) };
    }
    default: return { error: "unknown action" };
  }
}

export default async (req) => {
  await access.ensureSigningSecret(getStore("keys"));
  const env = process.env, url = new URL(req.url);
  await lists.ensureDefaults(getStore("mail"));

  if (url.pathname.endsWith("/signin")) {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });
    let email; try { email = access.normEmail((await req.json()).email); } catch { return json(400, { error: "Invalid request" }); }
    const SAME = { ok: true, message: "If that's the owner email, a sign-in link is on its way." };
    if (!access.isOwner(email, env)) return json(200, SAME);
    const rl = getStore("portal"), k = `rl-admin`, now = Date.now(), v = (await rl.get(k, { type: "json" })) || { start: now, n: 0 };
    if (now - v.start > 3600e3) { v.start = now; v.n = 0; }
    if (v.n >= 5) return json(200, SAME);
    v.n += 1; await rl.setJSON(k, v);
    const link = `${env.SITE_URL || "https://takekash.netlify.app"}/admin/hub?t=${encodeURIComponent(access.signToken(email, env))}`;
    await mail.send(env, { to: email, subject: "TakeKash Admin Hub sign-in", html: `<p><a href="${link}"><b>Open the Admin Hub →</b></a></p><p>Works for 30 days on this device. Didn't ask? Ignore this email.</p>` });
    return json(200, SAME);
  }

  const auth = req.headers.get("authorization") || "";
  const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), env) : null;
  if (!email || !access.isOwner(email, env)) return json(401, { error: "Owner only. Sign in first." });
  if (req.method === "GET") return json(200, await overview());
  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return json(400, { error: "Invalid request" }); }
    try { const r = await act(b); return json(r.error ? 400 : 200, r); } catch (e) { return json(400, { error: String(e.message || e) }); }
  }
  return json(405, { error: "Method not allowed" });
};

export const config = { path: ["/api/admin-hub", "/api/admin-hub/signin"] };
