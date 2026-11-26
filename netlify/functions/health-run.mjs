// Every 15 minutes: check the clip engine, job queue and email sender; email the owner about new problems.
// The latest result also shows in Admin Hub → System.
import { getStore } from "@netlify/blobs";
import health from "../../lib/health.cjs";
import mail from "../../lib/mail.cjs";
import access from "../../lib/seo/access.cjs";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export default async () => {
  const env = process.env, problems = await health.check({ requests: getStore("clip-requests"), outbox: getStore("mail-outbox") });
  const now = await health.due(getStore("health"), problems);
  if (now.length) {
    try { await mail.send(env, { to: access.ownerEmail(env), subject: `⚠️ TakeKash needs attention (${now.length})`, html: `<ul>${now.map((p) => `<li>${esc(p.text)}</li>`).join("")}</ul><p><a href="${env.SITE_URL || "https://takekash.netlify.app"}/admin/hub">Open the Admin Hub →</a></p>` }); }
    catch (e) { console.error("health alert email failed", e); }
  }
  console.log("[health-run]", problems.map((p) => p.id).join(",") || "ok");
};
export const config = { schedule: "*/15 * * * *" };
