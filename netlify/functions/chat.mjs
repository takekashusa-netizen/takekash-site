// Website chat (TakeKash's own help desk).
//   POST /api/chat/start {name,email,message,website}  -> {id,key}   (honeypot "website"; 6 per hour per visitor)
//   POST /api/chat/send  {id,key,message}              -> conversation
//   GET  /api/chat?id=&key=                            -> conversation (the widget polls this)
// The owner is emailed on every visitor message; replies come from the Admin Hub inbox and are emailed back.
import { getStore } from "@netlify/blobs";
import crypto from "crypto";
import crm from "../../lib/crm.cjs";
import mail from "../../lib/mail.cjs";
import access from "../../lib/seo/access.cjs";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const site = (env) => env.SITE_URL || "https://takekash.netlify.app";

async function notifyOwner(env, conv, text) {
  await mail.send(env, {
    to: access.ownerEmail(env), replyTo: conv.email,
    subject: `💬 Chat from ${conv.name || conv.email}`,
    html: `<p><b>${esc(conv.name || "")}</b> &lt;${esc(conv.email)}&gt; wrote:</p><blockquote style="border-left:3px solid #2fe07c;padding-left:10px">${esc(text).replace(/\n/g, "<br>")}</blockquote><p><a href="${site(env)}/admin/hub#inbox">Reply in the Admin Hub inbox →</a></p>`,
  }).catch(() => {});
}

export default async (req, context) => {
  const env = process.env, store = getStore("crm"), url = new URL(req.url);
  if (req.method === "GET") {
    const c = await crm.getConv(store, url.searchParams.get("id"), url.searchParams.get("key") || "");
    return c ? json(200, crm.forVisitor(c)) : json(404, { error: "Conversation not found" });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let b; try { b = await req.json(); } catch { return json(400, { error: "Invalid request" }); }
  if (b.website) return json(200, { ok: true });   // bots fill the hidden field

  const ipHash = crypto.createHash("sha256").update(String(context?.ip || "x")).digest("hex").slice(0, 24);
  const rlKey = `rl:${ipHash}`, now = Date.now(), rl = (await store.get(rlKey, { type: "json" })) || { start: now, n: 0 };
  if (now - rl.start > 3600e3) { rl.start = now; rl.n = 0; }
  if (rl.n >= (url.pathname.endsWith("/start") ? 6 : 40)) return json(429, { error: "Too many messages. Try again in a bit." });
  rl.n += 1; await store.setJSON(rlKey, rl);

  try {
    if (url.pathname.endsWith("/start")) {
      const c = await crm.startConversation(store, { name: b.name, email: b.email, text: b.message });
      await notifyOwner(env, c, b.message);
      return json(200, { ok: true, id: c.id, key: c.key, ...crm.forVisitor(c) });
    }
    if (url.pathname.endsWith("/send")) {
      const c = await crm.getConv(store, b.id, b.key || "");
      if (!c) return json(404, { error: "Conversation not found" });
      await crm.addMessage(store, c, "visitor", b.message);
      await notifyOwner(env, c, b.message);
      return json(200, { ok: true, ...crm.forVisitor(c) });
    }
  } catch (e) { return json(400, { error: String(e.message || e) }); }
  return json(404, { error: "Not found" });
};
export const config = { path: ["/api/chat", "/api/chat/start", "/api/chat/send"] };
