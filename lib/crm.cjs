// TakeKash CRM: one customer list built from every place a person shows up, plus the website chat inbox
// and outreach leads. Replaces a separate help-desk / CRM vendor. Storage: Netlify Blobs store "crm".
//   conv:<id>      -> {id, email, name, status open|closed, key, messages:[{from, text, at}], createdAt, updatedAt, unread}
//   contact:<email>-> {tags:[], notes:"", stage}     (owner-edited extras)
//   lead:<email>   -> {email, name, subject, source, stage new|contacted|replied|won|lost, createdAt, updatedAt}
const crypto = require("crypto");
const norm = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const STAGES = ["new", "contacted", "replied", "won", "lost"];
const MAX_MSGS = 200;

async function startConversation(store, { name, email, text }, now = new Date()) {
  email = norm(email); name = clean(name, 80); text = clean(text, 4000);
  if (!validEmail(email)) throw new Error("Enter a valid email");
  if (!text) throw new Error("Type a message");
  const id = crypto.randomBytes(10).toString("hex"), key = crypto.randomBytes(18).toString("base64url"), at = now.toISOString();
  const conv = { id, email, name, status: "open", key, unread: 1, createdAt: at, updatedAt: at, messages: [{ from: "visitor", text, at }] };
  await store.setJSON(`conv:${id}`, conv);
  return conv;
}
async function getConv(store, id, key) {
  if (!/^[a-f0-9]{20}$/.test(String(id))) return null;
  const c = await store.get(`conv:${id}`, { type: "json" });
  if (!c) return null;
  if (key !== undefined) {
    const a = Buffer.from(String(key)), b = Buffer.from(c.key);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  }
  return c;
}
async function addMessage(store, conv, from, text, now = new Date()) {
  text = clean(text, 4000); if (!text) throw new Error("Type a message");
  conv.messages.push({ from, text, at: now.toISOString() });
  if (conv.messages.length > MAX_MSGS) conv.messages = conv.messages.slice(-MAX_MSGS);
  conv.updatedAt = now.toISOString();
  conv.unread = from === "visitor" ? (conv.unread || 0) + 1 : 0;
  if (from === "visitor") conv.status = "open";
  await store.setJSON(`conv:${conv.id}`, conv);
  return conv;
}
const forVisitor = (c) => ({ id: c.id, status: c.status, messages: c.messages.map((m) => ({ from: m.from, text: m.text, at: m.at })) });

async function listAll(store, prefix, limit = 2000) {
  const out = [];
  for (const { key } of (await store.list({ prefix })).blobs) {
    if (out.length >= limit) break;
    const v = await store.get(key, { type: "json" }); if (v) out.push({ _key: key, ...v });
  }
  return out;
}

// Contacts = union of clip requests, portal/customer index, email subscribers, chat, paid members, leads.
async function contacts(stores) {
  const map = new Map();
  const touch = (email, at, src, extra = {}) => {
    email = norm(email); if (!validEmail(email)) return;
    const c = map.get(email) || { email, name: "", sources: [], firstSeen: at || null, lastSeen: at || null, jobs: 0, delivered: 0, lists: [], paid: false, plan: null, conversations: 0, lead: null };
    if (!c.sources.includes(src)) c.sources.push(src);
    if (at) { if (!c.firstSeen || at < c.firstSeen) c.firstSeen = at; if (!c.lastSeen || at > c.lastSeen) c.lastSeen = at; }
    for (const [k, v] of Object.entries(extra)) {
      if (k === "jobs" || k === "delivered" || k === "conversations") c[k] += v;
      else if (k === "lists") c.lists = [...new Set([...c.lists, ...v])];
      else if (v !== undefined && v !== null && v !== "") c[k] = v;
    }
    map.set(email, c);
  };
  if (stores.requests) for (const r of await listAll(stores.requests, "req:")) touch(r.email, r.at, "clip request", { jobs: 1, delivered: r.status === "delivered" ? 1 : 0, plan: r.plan });
  if (stores.mail) for (const s of await listAll(stores.mail, "sub:")) touch(s.email, s.createdAt, "email list", { name: s.name, lists: s.status === "active" ? s.lists || [] : [], subStatus: s.status });
  if (stores.crm) for (const c of await listAll(stores.crm, "conv:")) touch(c.email, c.createdAt, "chat", { name: c.name, conversations: 1 });
  if (stores.access) for (const a of await listAll(stores.access, "email:")) touch(a._key.slice(6), a.since ? new Date(a.since).toISOString() : null, "paid member", { paid: !!a.active, plan: a.plan });
  if (stores.crm) {
    for (const l of await listAll(stores.crm, "lead:")) touch(l.email, l.createdAt, "outreach lead", { name: l.name, lead: { stage: l.stage, subject: l.subject } });
    for (const x of await listAll(stores.crm, "contact:")) { const e = x._key.slice(8); const c = map.get(e); if (c) Object.assign(c, { tags: x.tags || [], notes: x.notes || "", stage: x.stage || null }); }
  }
  return [...map.values()].sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
}

async function saveContact(store, email, { tags, notes, stage }) {
  email = norm(email); if (!validEmail(email)) throw new Error("bad email");
  const prev = (await store.get(`contact:${email}`, { type: "json" })) || {};
  const next = {
    tags: tags !== undefined ? [...new Set((Array.isArray(tags) ? tags : String(tags).split(",")).map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 20) : prev.tags || [],
    notes: notes !== undefined ? clean(notes, 3000) : prev.notes || "",
    stage: stage !== undefined ? (STAGES.includes(stage) ? stage : null) : prev.stage || null,
  };
  await store.setJSON(`contact:${email}`, next); return next;
}

// Leads come in as CSV/TSV text "email,name,subject" or an array. Existing leads keep their stage.
function parseLeads(input) {
  if (Array.isArray(input)) return input;
  return String(input || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, "").trim());
    const i = p.findIndex((x) => x.includes("@"));
    return i < 0 ? null : { email: p[i], name: p[i === 0 ? 1 : 0] || "", subject: p.filter((_, k) => k !== i && k !== (i === 0 ? 1 : 0)).join(" ") };
  }).filter(Boolean);
}
async function importLeads(store, input, source = "import", now = new Date()) {
  let added = 0, updated = 0, skipped = 0;
  for (const raw of parseLeads(input).slice(0, 1000)) {
    const email = norm(raw.email); if (!validEmail(email)) { skipped++; continue; }
    const prev = await store.get(`lead:${email}`, { type: "json" });
    const lead = { email, name: clean(raw.name, 80) || prev?.name || "", subject: clean(raw.subject, 200) || prev?.subject || "", source: prev?.source || clean(source, 40), stage: prev?.stage || "new", createdAt: prev?.createdAt || now.toISOString(), updatedAt: now.toISOString() };
    await store.setJSON(`lead:${email}`, lead); prev ? updated++ : added++;
  }
  return { added, updated, skipped };
}
async function setLeadStage(store, email, stage, now = new Date()) {
  email = norm(email); if (!STAGES.includes(stage)) throw new Error("bad stage");
  const l = await store.get(`lead:${email}`, { type: "json" }); if (!l) throw new Error("no such lead");
  Object.assign(l, { stage, updatedAt: now.toISOString() }); await store.setJSON(`lead:${email}`, l); return l;
}

module.exports = { STAGES, startConversation, getConv, addMessage, forVisitor, listAll, contacts, saveContact, parseLeads, importLeads, setLeadStage };
