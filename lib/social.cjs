// TakeKash Social: own post calendar (replaces a paid scheduler). Store "social": post:<id>.
// It does not post to the networks itself (no account passwords/keys held). When a post is due, the owner gets an
// email with the caption ready to paste and the media link; marking it posted records the live URL.
const crypto = require("crypto");
const LIMITS = { tiktok: 2200, instagram: 2200, youtube: 100, x: 280, facebook: 5000, twitch: 500 };
const PLATFORMS = Object.keys(LIMITS);
const STATUSES = ["draft", "scheduled", "due", "posted", "cancelled"];
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);

function check(post) {
  const problems = [];
  if (!post.platforms.length) problems.push("Pick at least one platform");
  for (const p of post.platforms) {
    const text = p === "youtube" ? post.title || post.caption : post.caption;
    if (text.length > LIMITS[p]) problems.push(`${p}: ${text.length}/${LIMITS[p]} characters`);
    if (["tiktok", "instagram", "youtube"].includes(p) && !post.mediaUrl) problems.push(`${p} needs a video link`);
  }
  if ((post.caption.match(/#\w+/g) || []).length > 30) problems.push("Instagram allows at most 30 hashtags");
  return problems;
}

async function upsert(store, input, now = new Date()) {
  const id = input.id && /^[a-f0-9]{16}$/.test(input.id) ? input.id : crypto.randomBytes(8).toString("hex");
  const prev = (await store.get(`post:${id}`, { type: "json" })) || {};
  const post = {
    id, createdAt: prev.createdAt || now.toISOString(), updatedAt: now.toISOString(),
    platforms: [...new Set((input.platforms || prev.platforms || []).filter((p) => PLATFORMS.includes(p)))],
    caption: clean(input.caption ?? prev.caption, 5000), title: clean(input.title ?? prev.title, 200),
    mediaUrl: clean(input.mediaUrl ?? prev.mediaUrl, 1000), account: clean(input.account ?? prev.account, 80),
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : prev.scheduledAt || null,
    status: prev.status || "draft", postedUrls: prev.postedUrls || {}, remindedAt: prev.remindedAt || null,
  };
  if (post.mediaUrl && !/^https:\/\//.test(post.mediaUrl)) throw new Error("Video link must start with https://");
  const problems = check(post);
  if (input.schedule) { if (problems.length) throw new Error(problems.join("; ")); if (!post.scheduledAt) throw new Error("Pick a time"); post.status = "scheduled"; post.remindedAt = null; }
  await store.setJSON(`post:${id}`, post);
  return { post, problems };
}

async function list(store) {
  const out = [];
  for (const { key } of (await store.list({ prefix: "post:" })).blobs) { const v = await store.get(key, { type: "json" }); if (v) out.push(v); }
  return out.sort((a, b) => String(a.scheduledAt || "9").localeCompare(String(b.scheduledAt || "9")));
}

async function setStatus(store, id, status, postedUrls) {
  if (!STATUSES.includes(status)) throw new Error("bad status");
  const p = await store.get(`post:${id}`, { type: "json" }); if (!p) throw new Error("no such post");
  p.status = status; p.updatedAt = new Date().toISOString();
  if (postedUrls) for (const [k, v] of Object.entries(postedUrls)) if (PLATFORMS.includes(k) && /^https:\/\//.test(v)) p.postedUrls[k] = clean(v, 500);
  await store.setJSON(`post:${id}`, p); return p;
}

// Scheduled: scheduled posts whose time has come become "due" and the owner gets one reminder email.
async function runDue(store, sendMail, now = new Date()) {
  let due = 0;
  for (const p of await list(store)) {
    if (p.status !== "scheduled" || !p.scheduledAt || p.scheduledAt > now.toISOString()) continue;
    p.status = "due"; p.remindedAt = now.toISOString(); await store.setJSON(`post:${p.id}`, p); due++;
    await sendMail(p).catch(() => {});
  }
  return { due };
}

module.exports = { LIMITS, PLATFORMS, STATUSES, check, upsert, list, setStatus, runDue };
