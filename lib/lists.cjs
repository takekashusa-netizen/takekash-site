// TakeKash Lists: subscribers, lists, tags, double opt-in, one-click unsubscribe and timed sequences.
// Replaces an outside email-marketing tool. Data lives in the site's own Blobs store "mail"; every send
// goes through lib/mail.cjs. Built to the CAN-SPAM / Gmail+Yahoo bulk-sender rules: consent recorded,
// physical address and unsubscribe link in every email, RFC 8058 one-click unsubscribe headers.
const crypto = require("crypto");
const mail = require("./mail.cjs");

const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SITE = () => process.env.SITE_URL || "https://takekash.netlify.app";
const ADDRESS = () => process.env.MAIL_ADDRESS || "TakeKash · 1400 Andrews Pkwy · Allen, TX 75002 · USA";
const MAX_SENDS_PER_RUN = 200;

// ---- signed links (purpose-scoped, so a confirm link can't be used to unsubscribe and vice versa) ----
function key(env = process.env) {
  const base = env.SEO_TOKEN_SECRET || env.STRIPE_WEBHOOK_SECRET;
  if (!base) throw new Error("No signing secret (call access.ensureSigningSecret first)");
  return crypto.createHmac("sha256", base).update("takekash-lists-v1").digest();
}
const sign = (purpose, email, env) => crypto.createHmac("sha256", key(env)).update(`${purpose}:${normEmail(email)}`).digest("base64url").slice(0, 32);
function checkSig(purpose, email, sig, env) {
  const want = sign(purpose, email, env), got = String(sig || "");
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
const link = (path, purpose, email, env) => `${SITE()}${path}?e=${encodeURIComponent(normEmail(email))}&t=${sign(purpose, email, env)}`;

// ---- lists & sequences (config) ----
async function upsertList(store, { id, name, welcomeSequence = null }) {
  if (!ID_RE.test(id)) throw new Error("bad list id");
  const rec = { id, name: String(name || id).slice(0, 80), welcomeSequence };
  await store.setJSON(`list:${id}`, rec);
  return rec;
}
async function upsertSequence(store, { id, name, steps }) {
  if (!ID_RE.test(id)) throw new Error("bad sequence id");
  if (!Array.isArray(steps) || !steps.length || steps.length > 30) throw new Error("1-30 steps");
  const clean = steps.map((s, i) => {
    const delayHours = Number(s.delayHours);
    if (!(delayHours >= 0 && delayHours <= 24 * 90)) throw new Error(`step ${i + 1}: delayHours 0-2160`);
    if (!s.subject || !s.html) throw new Error(`step ${i + 1}: subject and html required`);
    return { delayHours, subject: String(s.subject).slice(0, 200), html: String(s.html) };
  });
  const rec = { id, name: String(name || id).slice(0, 80), steps: clean };
  await store.setJSON(`seq:${id}`, rec);
  return rec;
}

// Lists that exist out of the box (sequences are attached when their content is imported).
const DEFAULT_LISTS = [
  { id: "giveaway-2-ways", name: "2 Ways to Win giveaway", welcomeSequence: "giveaway-entrant" },
  { id: "takekash-updates", name: "TakeKash updates", welcomeSequence: null },
  { id: "trial-users", name: "TakeKash free trial", welcomeSequence: "trial-to-paid" },
  { id: "free-ad-trial", name: "Free Ad Trial (brands & shops)", welcomeSequence: "free-ad-trial" },
];
async function ensureDefaults(store) {
  for (const l of DEFAULT_LISTS) if (!(await store.get(`list:${l.id}`, { type: "json" }))) await store.setJSON(`list:${l.id}`, l);
  for (const q of require("./lists-seed.cjs").SEQUENCES) if (!(await store.get(`seq:${q.id}`, { type: "json" }))) await upsertSequence(store, q);
}

// ---- footer added to every list email ----
function footer(email, env) {
  return `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px"><p style="font-size:12px;color:#777;line-height:1.5">` +
    `You're getting this because you signed up at ${esc(SITE().replace(/^https?:\/\//, ""))}. ` +
    `<a href="${link("/unsubscribe", "unsub", email, env)}">Unsubscribe</a> any time.<br>${esc(ADDRESS())}</p>`;
}
const fill = (html, sub) => String(html).replace(/\{\{\s*first_name\s*\}\}/g, esc(sub.name || "there"));

async function sendToSubscriber(env, sub, subject, html) {
  const unsub = link("/api/unsubscribe", "unsub", sub.email, env);
  await mail.send(env, { to: sub.email, subject: fill(subject, sub), html: fill(html, sub) + footer(sub.email, env),
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
}

// ---- subscribe → confirm → active ----
async function subscribe(store, env, { email, name, list, source, ipHash }) {
  email = normEmail(email);
  if (!validEmail(email)) return { error: "Enter a valid email" };
  const L = await store.get(`list:${list}`, { type: "json" });
  if (!L) return { error: "Unknown list" };
  const now = new Date().toISOString();
  const sub = (await store.get(`sub:${email}`, { type: "json" })) || { email, lists: [], tags: [], createdAt: now, status: "pending" };
  if (name && !sub.name) sub.name = String(name).trim().slice(0, 60);
  sub.pendingLists = Array.from(new Set([...(sub.pendingLists || []), list]));
  sub.consent = { source: String(source || "form").slice(0, 60), at: now, ipHash: ipHash || null };
  if (sub.status === "unsubscribed") sub.status = "pending";   // re-subscribing always needs a fresh confirm
  await store.setJSON(`sub:${email}`, sub);
  if (sub.status === "active") { await activate(store, env, email); return { ok: true, already: true }; }
  await mail.send(env, { to: email, subject: `Confirm your ${L.name} signup`,
    html: `<p>Hi ${esc(sub.name || "there")},</p><p>Tap to confirm you want emails from TakeKash about <b>${esc(L.name)}</b>:</p>` +
      `<p><a href="${link("/subscribe/confirm", "confirm", email, env)}"><b>Yes, sign me up →</b></a></p>` +
      `<p style="font-size:12px;color:#777">Didn't sign up? Ignore this email and you won't hear from us.<br>${esc(ADDRESS())}</p>` });
  return { ok: true };
}

async function activate(store, env, email, now = Date.now()) {
  const sub = await store.get(`sub:${email}`, { type: "json" });
  if (!sub) return null;
  const newLists = (sub.pendingLists || []).filter((l) => !sub.lists.includes(l));
  sub.lists = Array.from(new Set([...sub.lists, ...(sub.pendingLists || [])]));
  sub.pendingLists = [];
  sub.status = "active";
  sub.confirmedAt = sub.confirmedAt || new Date(now).toISOString();
  await store.setJSON(`sub:${email}`, sub);
  for (const l of newLists) {
    const L = await store.get(`list:${l}`, { type: "json" });
    if (L && L.welcomeSequence) await enroll(store, L.welcomeSequence, email, now);
  }
  return sub;
}

async function confirm(store, env, email, sig) {
  email = normEmail(email);
  if (!checkSig("confirm", email, sig, env)) return { error: "This link isn't valid." };
  const sub = await activate(store, env, email);
  return sub ? { ok: true, lists: sub.lists } : { error: "We couldn't find that signup." };
}

async function unsubscribe(store, env, email, sig) {
  email = normEmail(email);
  if (!checkSig("unsub", email, sig, env)) return { error: "This link isn't valid." };
  const sub = await store.get(`sub:${email}`, { type: "json" });
  if (sub) {
    Object.assign(sub, { status: "unsubscribed", unsubAt: new Date().toISOString(), pendingLists: [] });
    await store.setJSON(`sub:${email}`, sub);
    for (const { key: k } of (await store.list({ prefix: "enr:" })).blobs) if (k.endsWith(`:${email}`)) await store.delete(k);
  }
  return { ok: true };   // same answer whether or not we knew the address
}

// ---- sequences ----
async function enroll(store, seqId, email, now = Date.now()) {
  const seq = await store.get(`seq:${seqId}`, { type: "json" });
  if (!seq) return false;
  const k = `enr:${seqId}:${email}`;
  if (await store.get(k, { type: "json" })) return false;   // never restart a sequence someone is already in
  await store.setJSON(k, { seq: seqId, email, step: 0, nextAt: now + seq.steps[0].delayHours * 3600e3, startedAt: now });
  return true;
}

// Called by the scheduled function: sends every step that's due, at most MAX_SENDS_PER_RUN per run.
async function runDue(store, env, now = Date.now()) {
  let sent = 0, done = 0, errors = 0;
  const seqs = {};
  for (const { key: k } of (await store.list({ prefix: "enr:" })).blobs) {
    if (sent >= MAX_SENDS_PER_RUN) break;
    const e = await store.get(k, { type: "json" });
    if (!e || e.nextAt > now) continue;
    const sub = await store.get(`sub:${e.email}`, { type: "json" });
    if (!sub || sub.status !== "active") { await store.delete(k); continue; }
    const seq = seqs[e.seq] || (seqs[e.seq] = await store.get(`seq:${e.seq}`, { type: "json" }));
    const step = seq && seq.steps[e.step];
    if (!step) { await store.delete(k); done++; continue; }
    try {
      await sendToSubscriber(env, sub, step.subject, step.html);
      sent++;
    } catch (err) {
      errors++; e.fails = (e.fails || 0) + 1;
      if (e.fails >= 5) { await store.delete(k); continue; }
      e.nextAt = now + 3600e3 * e.fails; await store.setJSON(k, e); continue;
    }
    const next = seq.steps[e.step + 1];
    if (!next) { await store.delete(k); done++; continue; }
    Object.assign(e, { step: e.step + 1, nextAt: now + next.delayHours * 3600e3, fails: 0 });
    await store.setJSON(k, e);
  }
  return { sent, done, errors };
}

// One-off broadcast to a list's active subscribers (owner action).
async function broadcast(store, env, listId, subject, html) {
  let sent = 0;
  for (const { key: k } of (await store.list({ prefix: "sub:" })).blobs) {
    const sub = await store.get(k, { type: "json" });
    if (sub && sub.status === "active" && sub.lists.includes(listId)) { await sendToSubscriber(env, sub, subject, html); sent++; }
  }
  return { sent };
}

module.exports = { DEFAULT_LISTS, ensureDefaults, normEmail, validEmail, sign, checkSig, link, upsertList, upsertSequence, subscribe, confirm, activate, unsubscribe, enroll, runDue, broadcast, footer };
