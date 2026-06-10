"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {
  addDays,
  collectCompanies,
  makeEvents,
  taipeiDateKey
} = require("./update-ipo-calendar");

const TIME_ZONE = "Asia/Taipei";
const SYNC_TAG_KEY = "ipoCalendar";
const SYNC_TAG_VALUE = "twse-tpex-esb";
const TOKEN_SCOPE = "https://www.googleapis.com/auth/calendar";
const DEFAULT_PAST_DAYS = Number(process.env.IPO_CALENDAR_PAST_DAYS || 120);
const DEFAULT_FUTURE_DAYS = Number(process.env.IPO_CALENDAR_FUTURE_DAYS || 180);
const WRITE_DELAY_MS = Number(process.env.GOOGLE_CALENDAR_WRITE_DELAY_MS || 200);
const MAX_WRITE_RETRIES = Number(process.env.GOOGLE_CALENDAR_MAX_WRITE_RETRIES || 6);
const DELETE_MISSING_EVENTS = process.env.IPO_CALENDAR_DELETE_MISSING === "1";

function parseArgs(argv) {
  const args = {};
  for (const item of argv.slice(2)) {
    const match = item.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
    else if (item === "--dry-run") args.dryRun = true;
  }
  return args;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function readServiceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || path.join(__dirname, "..", "google-service-account.json");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri || "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: TOKEN_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google token HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload.access_token;
}

async function googleRequest(token, method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`Google Calendar HTTP ${response.status}: ${text}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  if (!error || (error.status !== 403 && error.status !== 429)) return false;
  const errors = error.payload && error.payload.error && error.payload.error.errors;
  if (!Array.isArray(errors)) return /rate/i.test(String(error.message || ""));
  return errors.some(item => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(String(item.reason || item.message || "")));
}

async function googleWriteWithRetry(operation) {
  for (let attempt = 0; attempt <= MAX_WRITE_RETRIES; attempt += 1) {
    try {
      const result = await operation();
      if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS);
      return result;
    } catch (error) {
      if (!isRateLimitError(error) || attempt === MAX_WRITE_RETRIES) throw error;
      const waitMs = Math.min(60000, WRITE_DELAY_MS + (2 ** attempt) * 3000);
      console.warn(`Google Calendar rate limit hit; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${MAX_WRITE_RETRIES}.`);
      await sleep(waitMs);
    }
  }
}

function calendarEventId(event) {
  return "ipo" + crypto.createHash("sha1").update(event.uid).digest("hex");
}

function eventColorId(event) {
  if (event.milestone === "one-month") return "2";
  if (event.milestone === "two-month") return "5";
  if (event.market === "TWSE") return "7";
  if (event.market === "TPEX") return "11";
  if (event.market === "ESB") return "10";
  return "1";
}

function toGoogleEvent(event) {
  return {
    id: calendarEventId(event),
    summary: event.title,
    description: event.description,
    start: { date: event.date, timeZone: TIME_ZONE },
    end: { date: event.endDate, timeZone: TIME_ZONE },
    transparency: "transparent",
    colorId: eventColorId(event),
    extendedProperties: {
      private: {
        [SYNC_TAG_KEY]: SYNC_TAG_VALUE,
        ipoUid: event.uid,
        ipoMarket: event.market,
        ipoMilestone: event.milestone
      }
    }
  };
}

function monthSummary(events, monthPrefix) {
  return events
    .filter(event => event.date.startsWith(monthPrefix))
    .map(event => `${event.date} ${event.title}`)
    .sort();
}

function existingPrivateProperties(item) {
  return (item.extendedProperties && item.extendedProperties.private) || {};
}

function sameGoogleEvent(existing, desired) {
  const props = existingPrivateProperties(existing);
  return existing.summary === desired.summary
    && (existing.description || "") === (desired.description || "")
    && existing.colorId === desired.colorId
    && existing.transparency === desired.transparency
    && existing.start && existing.start.date === desired.start.date
    && existing.end && existing.end.date === desired.end.date
    && props[SYNC_TAG_KEY] === SYNC_TAG_VALUE
    && props.ipoUid === desired.extendedProperties.private.ipoUid
    && props.ipoMarket === desired.extendedProperties.private.ipoMarket
    && props.ipoMilestone === desired.extendedProperties.private.ipoMilestone;
}

async function listExistingEvents(token, calendarId, fromDate, toDate) {
  const items = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      privateExtendedProperty: `${SYNC_TAG_KEY}=${SYNC_TAG_VALUE}`,
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      timeMin: `${fromDate}T00:00:00+08:00`,
      timeMax: `${addDays(toDate, 1)}T00:00:00+08:00`
    });
    if (pageToken) params.set("pageToken", pageToken);

    const payload = await googleRequest(
      token,
      "GET",
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    );

    items.push(...(payload.items || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return items;
}

async function upsertEvent(token, calendarId, event, existingEvent) {
  const body = toGoogleEvent(event);
  const id = body.id;
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  if (existingEvent && sameGoogleEvent(existingEvent, body)) {
    return "skipped";
  }

  try {
    await googleWriteWithRetry(() => googleRequest(token, "PUT", `${base}/${encodeURIComponent(id)}`, body));
    return "updated";
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    await googleWriteWithRetry(() => googleRequest(token, "POST", base, body));
    return "created";
  } catch (error) {
    if (error.status !== 409) throw error;
    await googleWriteWithRetry(() => googleRequest(token, "PUT", `${base}/${encodeURIComponent(id)}`, body));
    return "updated";
  }
}

// Query Google Calendar by full-text search (no tag filter).
// Used to find ESB "登錄興櫃" events that predate the extendedProperties tag
// so they can be cleaned up after a company graduates to TPEX/TWSE.
async function listEventsByQuery(token, calendarId, query, fromDate, toDate) {
  const items = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      q: query,
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      timeMin: `${fromDate}T00:00:00+08:00`,
      timeMax: `${addDays(toDate, 1)}T00:00:00+08:00`
    });
    if (pageToken) params.set("pageToken", pageToken);

    const payload = await googleRequest(
      token,
      "GET",
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    );

    items.push(...(payload.items || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return items;
}

// Extract the 4-6 digit stock code from a calendar event summary like "敍豐(3485) 登錄興櫃".
function codeFromSummary(summary) {
  const match = String(summary || "").match(/\((\d{4,6})\)/);
  return match ? match[1] : "";
}

async function deleteEvent(token, calendarId, eventId) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  try {
    await googleWriteWithRetry(() => googleRequest(token, "DELETE", url));
    return true;
  } catch (error) {
    if (error.status === 404 || error.status === 410) return false;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const calendarId = args.calendar || process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    throw new Error("請設定 GOOGLE_CALENDAR_ID，或使用 --calendar=你的日曆ID。");
  }

  const today = taipeiDateKey();
  const fromDate = args.from || addDays(today, -DEFAULT_PAST_DAYS);
  const toDate = args.to || addDays(today, DEFAULT_FUTURE_DAYS);
  const { companies, sourceReports } = await collectCompanies();
  const events = makeEvents(companies, fromDate, toDate);
  const okSources = sourceReports.filter(report => report.status === "ok");
  const failedSources = sourceReports.filter(report => report.status !== "ok");
  const okMarkets = new Set(okSources.map(report => report.market).filter(Boolean));
  const requiredSourceGroups = [
    { label: "TWSE 上市", ids: ["twse-applylisting-local", "twse-applylisting-foreign", "twse-newlisting", "twse-newlisting-html"] },
    { label: "TPEX 上櫃", ids: ["tpex-mainboard-applicants"] },
    { label: "ESB 興櫃", ids: ["tpex-esb-ipo"] }
  ];
  const missingRequired = requiredSourceGroups
    .filter(group => !sourceReports.some(report => group.ids.includes(report.id) && report.status === "ok"))
    .map(group => group.label);

  if (missingRequired.length) {
    console.warn(`Source group(s) failed: ${missingRequired.join(", ")}. Successful markets will sync; failed markets will keep existing Calendar events untouched.`);
  }

  if (!events.length) {
    console.log(`No events generated. Companies: ${companies.length}. Window: ${fromDate} to ${toDate}.`);
    console.log("Source reports:");
    for (const report of sourceReports) {
      console.log(`- ${report.id}: ${report.status}, rows=${report.rows || 0}, accepted=${report.acceptedRows || 0}`);
      if (report.dateKeys && report.dateKeys.length) console.log(`  date keys: ${report.dateKeys.join(", ")}`);
      if (report.urlReports && report.urlReports.length) {
        for (const item of report.urlReports.filter(item => item.rows > 0).slice(0, 8)) {
          console.log(`  used: ${item.rows} rows from ${item.url}`);
        }
      }
      if (report.codes && report.codes.length) console.log(`  codes: ${report.codes.join(", ")}${report.moreCodes ? ` ... +${report.moreCodes}` : ""}`);
      if (report.message) console.log(`  ${report.message}`);
    }
    throw new Error("No events generated; aborting before touching Google Calendar.");
  }

  if (args.dryRun) {
    console.log(`Dry run: ${events.length} events from ${companies.length} companies.`);
    console.log(`Sources OK: ${okSources.length}/${sourceReports.length}`);
    console.log(`Window: ${fromDate} to ${toDate}`);
    console.log(events.slice(0, 10).map(event => `${event.date} ${event.title}`).join("\n"));
    return;
  }

  const serviceAccount = await readServiceAccount();
  const token = await getAccessToken(serviceAccount);
  const existing = await listExistingEvents(token, calendarId, fromDate, toDate);
  const existingById = new Map(existing.map(item => [item.id, item]));
  const desiredIds = new Set(events.map(calendarEventId));

  const stats = { created: 0, updated: 0, skipped: 0, deleted: 0, protected: 0 };
  for (const event of events) {
    const result = await upsertEvent(token, calendarId, event, existingById.get(calendarEventId(event)));
    stats[result] += 1;
  }

  for (const item of existing) {
    if (!desiredIds.has(item.id)) {
      if (!DELETE_MISSING_EVENTS) {
        stats.protected += 1;
        continue;
      }
      const market = existingPrivateProperties(item).ipoMarket;
      if (!okMarkets.has(market)) {
        stats.protected += 1;
        continue;
      }
      const deleted = await deleteEvent(token, calendarId, item.id);
      if (deleted) stats.deleted += 1;
    }
  }

  // Supplementary cleanup: find any "登錄興櫃" events (tagged or untagged) whose
  // stock code now appears in a TPEX/TWSE desired event — these are companies that
  // graduated from ESB and whose legacy ESB calendar event was never cleaned up.
  const tpexTwseCodes = new Set(
    events
      .filter(e => e.market === "TWSE" || e.market === "TPEX")
      .map(e => e.company && e.company.code)
      .filter(Boolean)
  );
  if (tpexTwseCodes.size > 0 && DELETE_MISSING_EVENTS) {
    try {
      const esbCandidates = await listEventsByQuery(token, calendarId, "登錄興櫃", fromDate, toDate);
      for (const item of esbCandidates) {
        if (desiredIds.has(item.id)) continue;  // already in desired set, leave it
        const code = codeFromSummary(item.summary);
        if (code && tpexTwseCodes.has(code)) {
          const deleted = await deleteEvent(token, calendarId, item.id);
          if (deleted) {
            stats.deleted += 1;
            console.log(`  cleanup: deleted stale ESB event "${item.summary}" (${item.id})`);
          }
        }
      }
    } catch (err) {
      console.warn(`Supplementary ESB cleanup failed (non-fatal): ${err.message}`);
    }
  }

  console.log(`Synced Google Calendar: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} unchanged, ${stats.deleted} deleted, ${stats.protected} protected.`);
  console.log(`Events: ${events.length}. Companies: ${companies.length}. Window: ${fromDate} to ${toDate}.`);
  const currentMonth = today.slice(0, 7);
  const summary = monthSummary(events, currentMonth);
  console.log(`Event summary for ${currentMonth}:`);
  for (const item of summary.slice(0, 160)) console.log(`  ${item}`);
  if (summary.length > 160) console.log(`  ... +${summary.length - 160} more`);

  console.log("Source reports:");
  for (const report of sourceReports) {
    console.log(`- ${report.id}: ${report.status}, rows=${report.rows || 0}, accepted=${report.acceptedRows || 0}`);
    if (report.dateKeys && report.dateKeys.length) console.log(`  date keys: ${report.dateKeys.join(", ")}`);
    if (report.urlReports && report.urlReports.length) {
      for (const item of report.urlReports.filter(item => item.rows > 0).slice(0, 8)) {
        console.log(`  used: ${item.rows} rows from ${item.url}`);
      }
    }
    if (report.codes && report.codes.length) console.log(`  codes: ${report.codes.join(", ")}${report.moreCodes ? ` ... +${report.moreCodes}` : ""}`);
    if (report.message) console.log(`  ${report.message}`);
  }
  if (failedSources.length) {
    console.warn("Some sources failed:");
    for (const report of failedSources) console.warn(`- ${report.id}: ${report.message}`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
