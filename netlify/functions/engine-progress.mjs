// POST /api/engine-progress {payload, mac}  — the clip engine reports each step (started, downloaded, clipped, uploaded)
// signed with the job's own callback key, so the owner and customer see live progress.
import { getStore } from "@netlify/blobs";
import D from "../../lib/seo/delivery.cjs";
import T from "../../lib/timeline.cjs";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const STEPS = new Set(["started", "downloaded", "clipped", "uploaded", "note"]);

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const raw = await req.text();
  if (raw.length > 4096) return json(413, { error: "too large" });
  let body; try { body = JSON.parse(raw); } catch { return json(400, { error: "bad json" }); }
  const store = getStore("clip-requests"), jid = D.peekJid(body);
  const r = jid ? await store.get(`req:${jid}`, { type: "json" }) : null;
  const p = r ? D.verifyMacCallback(r.cbk, body) : null;
  if (!p || p.jid !== jid || !STEPS.has(p.step)) return json(401, { error: "invalid signature" });
  await store.setJSON(`req:${jid}`, T.step(r, p.step, p.detail));
  return json(200, { ok: true });
};

export const config = { path: "/api/engine-progress" };
