// Step-by-step history for every clip job, so the owner (and the customer, in plain words) can see
// exactly where a job is: requested -> confirm email -> confirmed -> queued -> engine claimed ->
// downloading -> clipping -> uploading -> delivered/failed -> email sent.
const MAX_EVENTS = 60;

const LABELS = {
  requested: "Request received",
  confirm_email: "Confirm email sent",
  confirmed: "Customer confirmed",
  allowance: "Clips reserved from allowance",
  queued: "Queued for the clip engine",
  manual: "Sent to owner to make by hand",
  claimed: "Clip engine picked it up",
  started: "Engine started",
  downloaded: "Stream downloaded",
  clipped: "Clips made",
  uploaded: "Clips uploaded",
  delivered: "Delivered",
  failed: "Failed",
  delivery_email: "Download email sent",
  requeued: "Re-queued",
  cancelled: "Cancelled by owner",
  note: "Note",
};

function step(r, s, detail) {
  r.events = Array.isArray(r.events) ? r.events : [];
  r.events.push({ s, at: new Date().toISOString(), ...(detail ? { d: String(detail).slice(0, 300) } : {}) });
  if (r.events.length > MAX_EVENTS) r.events = r.events.slice(-MAX_EVENTS);
  return r;
}

// Customer view: plain labels, no internal detail.
const forCustomer = (events = []) => events.filter((e) => e.s !== "note" && e.s !== "allowance").map((e) => ({ step: LABELS[e.s] || e.s, at: e.at }));

module.exports = { LABELS, step, forCustomer };
