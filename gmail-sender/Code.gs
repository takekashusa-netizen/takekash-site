/**
 * TakeKash Gmail sender — runs inside the owner's Google account (Apps Script), free.
 * Every minute it proves who it is with a Google identity token (no password or API key anywhere),
 * pulls queued emails from takekash.com, sends them from this Gmail account, and reports back.
 * Setup: run setup() once and tap Allow. That's all.
 */
var SITE = 'https://takekash.netlify.app';

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendQueued').timeBased().everyMinutes(1).create();
  sendQueued();
}

function sendQueued() {
  var quota = MailApp.getRemainingDailyQuota();       // Gmail's own daily limit for this account
  if (quota < 1) return;
  var token = ScriptApp.getIdentityToken();
  var res = UrlFetchApp.fetch(SITE + '/api/mail-outbox', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ max: Math.min(quota, 20) })
  });
  if (res.getResponseCode() !== 200) { console.warn('outbox ' + res.getResponseCode()); return; }
  var msgs = JSON.parse(res.getContentText()).messages || [];
  if (!msgs.length) return;
  var sent = [], failed = [];
  msgs.forEach(function (m) {
    try {
      MailApp.sendEmail({ to: m.to, subject: m.subject, htmlBody: m.html, name: 'TakeKash', replyTo: m.replyTo || undefined });
      sent.push(m.id);
    } catch (e) { failed.push({ id: m.id, error: String(e) }); }
  });
  UrlFetchApp.fetch(SITE + '/api/mail-outbox/ack', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ sent: sent, failed: failed })
  });
}
