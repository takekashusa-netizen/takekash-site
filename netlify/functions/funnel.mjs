// POST /api/track {event} (public, allow-listed page events only)   GET /api/funnel (owner only)
import { getStore } from "@netlify/blobs";
import funnel from "../../lib/seo/funnel.cjs";
import access from "../../lib/seo/access.cjs";
const ORIGINS = new Set(["https://takekash.com", "https://www.takekash.com", "https://takekash.netlify.app", ...(process.env.SITE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const cors = (req) => { const o = req.headers.get("origin"); return ORIGINS.has(o) ? { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Content-Type, Authorization", Vary: "Origin" } : {}; };
const json = (req, s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
const PUBLIC = new Set(["unlock_click", "kit_made", "page_seo", "page_kit", "page_home", "page_ebooks"]);

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const store = getStore("funnel");
  if (req.method === "POST") {
    let ev; try { ev = (await req.json()).event; } catch { return json(req, 400, { error: "bad request" }); }
    if (!PUBLIC.has(ev)) return json(req, 400, { error: "unknown event" });
    await funnel.track(store, ev);
    return json(req, 200, { ok: true });
  }
  const auth = req.headers.get("authorization") || "";
  const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), process.env) : null;
  if (!email || !access.isOwner(email, process.env)) return json(req, 401, { error: "Owner only" });
  return json(req, 200, await funnel.report(store, Math.min(60, Number(new URL(req.url).searchParams.get("days")) || 14)));
};
export const config = { path: ["/api/track", "/api/funnel"] };
