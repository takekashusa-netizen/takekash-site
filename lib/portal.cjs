// Customer portal: every clip job a customer has made, their allowance, and live download links.
// Storage is the site's own Blobs ("clip-requests", "clip-quota", "seo-access"); no outside service holds customer data.
const D = require("./seo/delivery.cjs");
const T = require("./timeline.cjs");

const MAX_JOBS = 100;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function indexJob(store, email, id) {
  const key = `jobs:${email}`;
  const ids = (await store.get(key, { type: "json" })) || [];
  if (!ids.includes(id)) ids.unshift(id);
  await store.setJSON(key, ids.slice(0, MAX_JOBS));
}

async function hasJobs(store, email) {
  return ((await store.get(`jobs:${email}`, { type: "json" })) || []).length > 0;
}

// Only fields a customer should see: never the callback key, slot keys or internal claim data.
function publicJob(r, now = Date.now()) {
  const live = r.download && r.downloadExp && r.downloadExp > now;
  return {
    id: r.id,
    source: hostOf(r.url),
    url: r.url,
    status: r.status,
    clips: r.reserved || 0,
    delivered: r.delivered || 0,
    requestedAt: r.at,
    finishedAt: r.finishedAt || null,
    download: live ? r.download : null,
    downloadExpires: live ? new Date(r.downloadExp).toISOString() : null,
    steps: T.forCustomer(r.events),
  };
}

async function allowance(quota, accessStore, email, now = Date.now()) {
  const plan = await D.planFor(accessStore, email);
  const month = new Date(now).toISOString().slice(0, 7);
  const prefix = plan === "free" ? `slot:${email}:free:` : `slot:${email}:${month}:`;
  const used = (await quota.list({ prefix })).blobs.length;
  const limit = D.PLAN_CLIPS[plan];
  return { plan, used, limit, left: Math.max(0, limit - used), perJob: D.PER_JOB[plan], resets: plan === "free" ? null : month };
}

async function overview({ requests, quota, access }, email, now = Date.now()) {
  const ids = (await requests.get(`jobs:${email}`, { type: "json" })) || [];
  const jobs = [];
  for (const id of ids) {
    const r = await requests.get(`req:${id}`, { type: "json" });
    if (r && r.email === email) jobs.push(publicJob(r, now));
  }
  return { email, allowance: await allowance(quota, access, email, now), jobs };
}

module.exports = { MAX_JOBS, indexJob, hasJobs, publicJob, allowance, overview };
