// Members only. GET /api/seo-member -> {preset, history}
// PUT {preset:{brand,category,extra,platform}} saves the channel preset; DELETE ?id=<runId> removes a saved run.
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";

const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app"]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS", Vary: "Origin" } : {}; };
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const clip = (v, n) => String(v || "").slice(0, n);

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const env = process.env, auth = req.headers.get("authorization") || "";
  const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), env) : null;
  const accessStore = getStore("seo-access");
  if (!email || !(access.isOwner(email, env) || (await access.isPaid(accessStore, email)))) return json(req, 401, { error: "Members only. Sign in first." });
  const store = getStore("seo-members");
  const hKey = `history:${email}`, pKey = `preset:${email}`;

  if (req.method === "GET") {
    return json(req, 200, { preset: (await store.get(pKey, { type: "json" })) || null, history: (await store.get(hKey, { type: "json" })) || [] });
  }
  if (req.method === "PUT") {
    let body; try { body = await req.json(); } catch { return json(req, 400, { error: "Invalid request" }); }
    const p = body.preset || {};
    const preset = { brand: clip(p.brand, 60), category: clip(p.category, 20) || "auto", extra: clip(p.extra, 200), platform: clip(p.platform, 20) || "all" };
    await store.setJSON(pKey, preset);
    return json(req, 200, { ok: true, preset });
  }
  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id");
    const hist = ((await store.get(hKey, { type: "json" })) || []).filter((h) => h.id !== id);
    await store.setJSON(hKey, hist);
    return json(req, 200, { ok: true, history: hist });
  }
  return json(req, 405, { error: "Method not allowed" });
};

export const config = { path: "/api/seo-member" };
