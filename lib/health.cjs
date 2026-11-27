// Watchdog for the free stack: checks each moving part and returns problems in plain words.
// Engine polls every 5 min, Gmail sender every minute; thresholds leave room for GitHub's cron delays.
const MIN = 60e3;
const LIMITS = { engineStaleMin: 30, senderStaleMin: 15, queueOldMin: 60, outboxOldMin: 30 };

async function check({ requests, outbox }, now = Date.now()) {
  const problems = [];
  const eng = await requests.get("engine:lastPoll", { type: "json" });
  const queued = (await requests.list({ prefix: "queue:" })).blobs.length;
  // GitHub's cron often runs hours apart and jobs wake the engine on request, so a quiet engine with an empty
  // queue is normal: show it in the hub (info) but only email when a customer job is actually waiting on it.
  const sev = queued ? "alert" : "info";
  if (!eng) problems.push({ id: "engine-never", severity: sev, text: "The clip engine has never checked in." });
  else if (now - Date.parse(eng.at) > LIMITS.engineStaleMin * MIN) problems.push({ id: "engine-stale", severity: sev, text: `The clip engine last checked in ${Math.round((now - Date.parse(eng.at)) / MIN)} min ago${queued ? ` and ${queued} job(s) are waiting` : " (normal between jobs: GitHub's timer runs hours apart)"}.` });
  if (queued) {
    let oldest = null;                                  // queue entries carry no time; use the request's own
    for (const b of (await requests.list({ prefix: "queue:" })).blobs.slice(0, 200)) {
      const r = await requests.get(`req:${b.key.slice(6)}`, { type: "json" }).catch(() => null);
      const t = r && Date.parse(r.confirmedAt || r.at || "");
      if (t && (!oldest || t < oldest)) oldest = t;
    }
    if (oldest && now - oldest > LIMITS.queueOldMin * MIN) problems.push({ id: "queue-old", text: `${queued} clip job(s) waiting, the oldest for ${Math.round((now - oldest) / MIN)} min.` });
  }
  const snd = await outbox.get("sender:lastPoll", { type: "json" });
  const waiting = (await outbox.list({ prefix: "msg:" })).blobs.length;
  if (waiting && (!snd || now - Date.parse(snd.at) > LIMITS.senderStaleMin * MIN)) problems.push({ id: "sender-stale", text: `${waiting} email(s) waiting and the Gmail sender ${snd ? `last ran ${Math.round((now - Date.parse(snd.at)) / MIN)} min ago` : "has never run"} (open the TakeKash Gmail sender script and run setup).` });
  const failed = (await outbox.list({ prefix: "failed:" })).blobs.length;
  if (failed) problems.push({ id: `mail-failed-${failed}`, text: `${failed} email(s) failed to send. Retry them in Admin Hub → Email.` });
  return problems;
}

// Alert once per problem per 6 hours; returns the ones that should be emailed now.
async function due(store, problems, now = Date.now()) {
  const out = [];
  for (const p of problems.filter((x) => x.severity !== "info")) {
    const k = `alerted:${p.id}`, last = Number((await store.get(k)) || 0);
    if (now - last > 6 * 3600e3) { out.push(p); await store.set(k, String(now)); }
  }
  await store.setJSON("health:last", { at: new Date(now).toISOString(), problems });
  return out;
}
module.exports = { LIMITS, check, due };
