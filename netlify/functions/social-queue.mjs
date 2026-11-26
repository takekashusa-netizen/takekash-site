// Posting bridge for the owner's Mac (autoclip-pipeline worker/social_bridge.py). Owner sign-in token only.
// GET  /api/social-queue[?peek=1]             -> { posts: [{id, platforms, title, caption, mediaUrl, contentId}] }
// POST /api/social-queue/result {id, platform, status, url?, error?, note?}
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";
import social from "../../lib/social.cjs";
const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export default async (req) => {
  await access.ensureSigningSecret(getStore("keys"));
  const auth = req.headers.get("authorization") || "", env = process.env;
  const email = auth.startsWith("Bearer ") ? access.verifyToken(auth.slice(7), env) : null;
  if (!email || !access.isOwner(email, env)) return json(401, { error: "Owner only" });
  const store = getStore("social"), url = new URL(req.url);
  if (req.method === "GET") return json(200, { posts: await social.claimDue(store, { claim: url.searchParams.get("peek") !== "1" }) });
  if (req.method === "POST" && url.pathname.endsWith("/result")) {
    let b; try { b = await req.json(); } catch { return json(400, { error: "Invalid request" }); }
    try { const p = await social.recordResult(store, String(b.id || ""), String(b.platform || ""), b); return json(200, { ok: true, status: p.status }); }
    catch (e) { return json(400, { error: e.message }); }
  }
  return json(405, { error: "Method not allowed" });
};
export const config = { path: ["/api/social-queue", "/api/social-queue/result"] };
