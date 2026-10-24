/**
 * Building-management email relay (Google Apps Script web app).
 *
 * The app's Supabase Edge Function `send-email` POSTs one message at a time as JSON:
 *   { token, to, subject, html, text, fromName }
 * and this script sends it from the Gmail account that owns the script. Reply: {"ok":true} or {"ok":false,"error":"..."}.
 *
 * Setup (README → "Email setup", option A):
 *   1. Paste this file into a new project at https://script.google.com (signed in as the sending Gmail account).
 *   2. Replace CHANGE_ME below with a long random string (e.g. `openssl rand -hex 32`). Keep it private: it is the
 *      only thing that stops strangers from sending mail through your account. Never commit the real value.
 *   3. Deploy → New deployment → Web app; Execute as: Me; Who has access: Anyone. Copy the Web app URL.
 *   4. Store the URL and the same token as Supabase secrets APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN.
 *
 * Quota: a consumer Gmail account can send to about 100 recipients a day through Apps Script.
 */
var TOKEN = 'CHANGE_ME';

var MAX_SUBJECT = 250;
var MAX_BODY = 200000;
var MAX_NAME = 100;
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Compares two strings in time that does not depend on where they differ. */
function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  }
  return diff === 0;
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function isText(v, max, allowEmpty) {
  return typeof v === 'string' && v.length <= max && (allowEmpty || v.trim().length > 0);
}

/** Returns an error code for a bad message, or null when it is valid. */
function invalid(m) {
  if (typeof m.to !== 'string' || !EMAIL.test(m.to.trim())) return 'to';
  if (!isText(m.subject, MAX_SUBJECT, false) || /[\r\n]/.test(m.subject)) return 'subject';
  if (!isText(m.html, MAX_BODY, false)) return 'html';
  if (!isText(m.text, MAX_BODY, false)) return 'text';
  if (m.fromName !== undefined && (!isText(m.fromName, MAX_NAME, true) || /[\r\n]/.test(m.fromName))) return 'fromName';
  return null;
}

function doPost(e) {
  var m;
  try {
    m = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return reply({ ok: false, error: 'bad json' });
  }
  if (!m || typeof m !== 'object') return reply({ ok: false, error: 'bad json' });
  // The token is checked first and never echoed back or logged.
  if (TOKEN === 'CHANGE_ME' || !safeEqual(m.token || '', TOKEN)) return reply({ ok: false, error: 'unauthorized' });
  var bad = invalid(m);
  if (bad) return reply({ ok: false, error: 'invalid ' + bad });
  if (MailApp.getRemainingDailyQuota() < 1) return reply({ ok: false, error: 'daily quota exhausted' });
  try {
    // GmailApp, not MailApp: MailApp folds a long Hebrew sender name mid-character, so one letter shows as "��".
    GmailApp.sendEmail(m.to.trim(), m.subject, m.text, { htmlBody: m.html, name: m.fromName || 'ועד הבית' });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) });
  }
}

/** A GET (e.g. opening the URL in a browser) only says the relay is up; it never sends anything. */
function doGet() {
  return reply({ ok: true, service: 'building-management email relay' });
}
