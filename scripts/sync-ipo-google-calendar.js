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

async function upsertEvent(token, calendarId, event) {
  const body = toGoogleEvent(event);
  const id = body.id;
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  try {
    await googleRequest(token, "PUT", `${base}/${encodeURIComponent(id)}`, body);
    return "updated";
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    await googleRequest(token, "POST", base, body);
    return "created";
  } catch (error) {
    if (error.status !== 409) throw error;
    await googleRequest(token, "PUT", `${base}/${encodeURIComponent(id)}`, body);
    return "updated";
  }
}

async function deleteEvent(token, calendarId, eventId) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  try {
    await googleRequest(token, "DELETE", url);
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

  if (args.dryRun) {
    console.log(`Dry run: ${events.length} events from ${companies.length} companies.`);
    console.log(`Window: ${fromDate} to ${toDate}`);
    console.log(events.slice(0, 10).map(event => `${event.date} ${event.title}`).join("\n"));
    return;
  }

  const serviceAccount = await readServiceAccount();
  const token = await getAccessToken(serviceAccount);
  const existing = await listExistingEvents(token, calendarId, fromDate, toDate);
  const desiredIds = new Set(events.map(calendarEventId));

  const stats = { created: 0, updated: 0, deleted: 0 };
  for (const event of events) {
    const result = await upsertEvent(token, calendarId, event);
    stats[result] += 1;
  }

  for (const item of existing) {
    if (!desiredIds.has(item.id)) {
      const deleted = await deleteEvent(token, calendarId, item.id);
      if (deleted) stats.deleted += 1;
    }
  }

  console.log(`Synced Google Calendar: ${stats.created} created, ${stats.updated} updated, ${stats.deleted} deleted.`);
  console.log(`Events: ${events.length}. Companies: ${companies.length}. Window: ${fromDate} to ${toDate}.`);

  const failed = sourceReports.filter(report => report.status !== "ok");
  if (failed.length) {
    console.warn("Some sources failed:");
    for (const report of failed) console.warn(`- ${report.id}: ${report.message}`);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
