// Every 15 minutes: turn scheduled posts that are due into "post now" emails for the owner.
import { getStore } from "@netlify/blobs";
import social from "../../lib/social.cjs";
import mail from "../../lib/mail.cjs";
import access from "../../lib/seo/access.cjs";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export default async () => {
  const env = process.env, site = env.SITE_URL || "https://takekash.netlify.app";
  const r = await social.runDue(getStore("social"), (p) => mail.send(env, {
    to: access.ownerEmail(env), subject: `📣 Time to post: ${(p.title || p.caption).slice(0, 60)}`,
    html: `<p><b>Post now on:</b> ${p.platforms.map(esc).join(", ")}${p.account ? ` (${esc(p.account)})` : ""}</p>${p.title ? `<p><b>Title:</b> ${esc(p.title)}</p>` : ""}<p><b>Caption (copy this):</b></p><pre style="white-space:pre-wrap;font:14px sans-serif;background:#f3f5f4;padding:10px;border-radius:8px">${esc(p.caption)}</pre>${p.mediaUrl ? `<p><a href="${esc(p.mediaUrl)}">Download the video →</a></p>` : ""}<p><a href="${site}/admin/hub#social">Mark it posted in the Admin Hub →</a></p>`,
  }));
  console.log("[social-run]", r);
};
export const config = { schedule: "*/15 * * * *" };
