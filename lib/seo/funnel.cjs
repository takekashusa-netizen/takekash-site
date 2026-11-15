// Daily funnel counters in Netlify Blobs ("funnel"): day:YYYY-MM-DD -> {event: count}.
// Counts are approximate under heavy concurrency (read-modify-write); fine for spotting trends.
const EVENTS = ["trial_run", "trial_limit_hit", "locked_feature", "unlock_click", "checkout_started", "purchase",
                "signin_requested", "paid_run", "clip_request", "kit_made", "page_seo", "page_kit", "page_home"];
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

async function track(store, event, n = 1) {
  if (!EVENTS.includes(event)) return false;
  try {
    const key = `day:${day()}`;
    const rec = (await store.get(key, { type: "json" })) || {};
    rec[event] = (rec[event] || 0) + n;
    await store.setJSON(key, rec);
    return true;
  } catch (e) { console.error("funnel track failed", e); return false; }  // tracking never breaks a request
}

async function report(store, days = 14) {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = day(Date.now() - i * 864e5);
    rows.push({ day: d, ...((await store.get(`day:${d}`, { type: "json" })) || {}) });
  }
  const totals = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (k !== "day") totals[k] = (totals[k] || 0) + v;
  const rate = (a, b) => (totals[b] ? Math.round((100 * (totals[a] || 0)) / totals[b]) : null);
  return { days, rows, totals, rates: {
    trial_to_limit: rate("trial_limit_hit", "trial_run"), unlock_click_rate: rate("unlock_click", "trial_run"),
    click_to_checkout: rate("checkout_started", "unlock_click"), checkout_to_purchase: rate("purchase", "checkout_started"),
  } };
}
module.exports = { EVENTS, track, report };
