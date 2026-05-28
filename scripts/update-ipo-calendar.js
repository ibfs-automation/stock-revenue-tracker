"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const OUTPUT_DATA_DIR = path.join(PUBLIC_DIR, "data");
const OUTPUT_CAL_DIR = path.join(PUBLIC_DIR, "calendars");
const TIME_ZONE = "Asia/Taipei";

const DEFAULT_WINDOW = {
  pastDays: Number(process.env.IPO_CALENDAR_PAST_DAYS || 120),
  futureDays: Number(process.env.IPO_CALENDAR_FUTURE_DAYS || 180)
};

const SOURCES = [
  {
    id: "mops-listed-basic",
    market: "TWSE",
    label: "上市",
    type: "csv",
    urls: [
      process.env.MOPS_LISTED_BASIC_URL,
      "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv"
    ].filter(Boolean),
    dateKeys: ["上市日期", "股票上市買賣日期", "掛牌日期", "listedDate", "ListingDate"]
  },
  {
    id: "mops-otc-basic",
    market: "TPEX",
    label: "上櫃",
    type: "csv",
    urls: [
      process.env.MOPS_OTC_BASIC_URL,
      "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv"
    ].filter(Boolean),
    dateKeys: ["上櫃日期", "上市日期", "股票上櫃買賣日期", "掛牌日期", "listedDate", "ListingDate"]
  },
  {
    id: "mops-emerging-basic",
    market: "ESB",
    label: "興櫃",
    type: "csv",
    urls: [
      process.env.MOPS_EMERGING_BASIC_URL,
      "https://mopsfin.twse.com.tw/opendata/t187ap03_R.csv"
    ].filter(Boolean),
    dateKeys: ["興櫃日期", "上市日期", "登錄日期", "掛牌日期", "listedDate", "registrationDate", "ListingDate"]
  },
  {
    id: "twse-applylisting-local",
    market: "TWSE",
    label: "上市",
    type: "json",
    urls: [
      process.env.TWSE_APPLYLISTING_LOCAL_URL,
      "https://openapi.twse.com.tw/v1/company/applylistingLocal",
      "https://openapi.twse.com.tw/v1/company/newlisting",
      "https://www.twse.com.tw/rwd/zh/company/applylisting?response=json&type=1"
    ].filter(Boolean),
    dateKeys: ["股票上市買賣日期", "上市買賣日期", "listedDate", "ListingDate"]
  },
  {
    id: "twse-applylisting-foreign",
    market: "TWSE",
    label: "上市",
    type: "json",
    urls: [
      process.env.TWSE_APPLYLISTING_FOREIGN_URL,
      "https://openapi.twse.com.tw/v1/company/applylistingForeign",
      "https://www.twse.com.tw/rwd/zh/company/applylisting?response=json&type=2"
    ].filter(Boolean),
    dateKeys: ["股票上市買賣日期", "上市買賣日期", "listedDate", "ListingDate"]
  },
  {
    id: "tpex-mainboard-applicants",
    market: "TPEX",
    label: "上櫃",
    type: "json",
    urls: [
      process.env.TPEX_MAINBOARD_APPLICANTS_URL,
      "https://www.tpex.org.tw/openapi/v1/tpex_esb_applicant_companies",
      "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_applicant_companies",
      "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_applying_status_company",
      "https://www.tpex.org.tw/www/zh-tw/mainboard/applying/status/company?response=json"
    ].filter(Boolean),
    dateKeys: ["股票上櫃買賣日期", "上櫃買賣日期", "櫃買賣日期", "listedDate", "ListingDate"]
  },
  {
    id: "tpex-esb-ipo",
    market: "ESB",
    label: "興櫃",
    type: "json",
    urls: [
      process.env.TPEX_ESB_IPO_URL,
      "https://www.tpex.org.tw/openapi/v1/tpex_esb_listed_ipo",
      "https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_listed_companies",
      "https://www.tpex.org.tw/www/zh-tw/esb/listed/ipo?response=json"
    ].filter(Boolean),
    dateKeys: ["登錄日期", "股票開始櫃檯買賣日期", "興櫃登錄日期", "listedDate", "registrationDate", "ListingDate"]
  }
];

const KEY_ALIASES = {
  code: ["公司代號", "證券代號", "股票代號", "代號", "Code", "symbol", "SecuritiesCode"],
  name: ["公司簡稱", "公司名稱", "證券簡稱", "股票名稱", "簡稱", "名稱", "Name", "name", "companyName"],
  applicationDate: ["申請日期", "送件日期", "applicationDate"],
  underwriter: ["承銷商", "輔導推薦證券商", "推薦證券商", "underwriter"],
  price: ["承銷價", "認購價格", "參考價", "underwritingPrice"],
  note: ["備註", "說明", "remarks", "note"]
};

const MILESTONES = [
  { id: "first-day", label: "掛牌", months: 0 },
  { id: "one-month", label: "掛牌一個月", months: 1 },
  { id: "two-month", label: "掛牌兩個月", months: 2 }
];

function parseArgs(argv) {
  const args = {};
  for (const item of argv.slice(2)) {
    const match = item.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, days) {
  const date = parseIsoDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function addMonths(dateKey, months) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return formatIsoDate(date);
}

function parseIsoDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function formatIcsDate(dateKey) {
  return dateKey.replaceAll("-", "");
}

function normalizeKey(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[()（）_－-]/g, "")
    .toLowerCase();
}

function getValue(row, keys) {
  if (!row || typeof row !== "object") return "";

  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }

  const normalized = new Map(Object.keys(row).map(key => [normalizeKey(key), key]));
  for (const key of keys) {
    const actual = normalized.get(normalizeKey(key));
    if (actual && row[actual] !== undefined && row[actual] !== null && String(row[actual]).trim() !== "") {
      return String(row[actual]).trim();
    }
  }

  return "";
}

function parseTaiwanDate(value) {
  const text = String(value || "").trim();
  if (!text || /^[-—]+$/.test(text)) return null;

  const compactWestern = text.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (compactWestern) {
    return `${compactWestern[1]}-${compactWestern[2]}-${compactWestern[3]}`;
  }

  const compactRoc = text.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (compactRoc) {
    return `${Number(compactRoc[1]) + 1911}-${compactRoc[2]}-${compactRoc[3]}`;
  }

  const iso = text.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  const roc = text.match(/(\d{2,3})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})/);
  if (roc) {
    const year = Number(roc[1]) + 1911;
    return `${year}-${roc[2].padStart(2, "0")}-${roc[3].padStart(2, "0")}`;
  }

  return null;
}

function objectRows(payload) {
  if (Array.isArray(payload)) return payload;

  if (payload && Array.isArray(payload.data) && Array.isArray(payload.fields)) {
    return payload.data.map(row => Object.fromEntries(payload.fields.map((field, index) => [field, row[index]])));
  }

  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.result)) return payload.result;
  if (payload && payload.result && Array.isArray(payload.result.data)) return payload.result.data;

  return [];
}

async function fetchJsonFromFirstAvailable(source) {
  const errors = [];

  for (const url of source.urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 ipo-calendar-generator"
        }
      });

      if (!response.ok) {
        errors.push(`${url} HTTP ${response.status}`);
        continue;
      }

      const text = await response.text();
      const payload = JSON.parse(text.replace(/^\uFEFF/, ""));
      return { url, rows: objectRows(payload) };
    } catch (error) {
      errors.push(`${url} ${error.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  const pushValue = () => {
    row.push(value.replace(/^\uFEFF/, ""));
    value = "";
  };
  const pushRow = () => {
    if (row.length || value) {
      pushValue();
      rows.push(row);
      row = [];
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      pushValue();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (row.length || value) pushRow();
  if (!rows.length) return [];

  const headers = rows[0].map(header => String(header || "").trim());
  return rows.slice(1)
    .filter(values => values.some(item => String(item || "").trim() !== ""))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

async function fetchCsvFromFirstAvailable(source) {
  const errors = [];

  for (const url of source.urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "text/csv, text/plain, */*",
          "User-Agent": "Mozilla/5.0 ipo-calendar-generator"
        }
      });

      if (!response.ok) {
        errors.push(`${url} HTTP ${response.status}`);
        continue;
      }

      const text = await response.text();
      if (/^\s*</.test(text)) {
        errors.push(`${url} returned HTML instead of CSV`);
        continue;
      }

      return { url, rows: parseCsv(text) };
    } catch (error) {
      errors.push(`${url} ${error.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

async function fetchRowsFromFirstAvailable(source) {
  return source.type === "csv"
    ? fetchCsvFromFirstAvailable(source)
    : fetchJsonFromFirstAvailable(source);
}

function normalizeCompany(source, row) {
  const listedDate = parseTaiwanDate(getValue(row, source.dateKeys));
  if (!listedDate) return null;

  const code = getValue(row, KEY_ALIASES.code);
  const name = getValue(row, KEY_ALIASES.name);
  if (!code && !name) return null;

  return {
    id: `${source.market}-${code || name}-${listedDate}`,
    market: source.market,
    marketLabel: source.label,
    code,
    name,
    listedDate,
    applicationDate: parseTaiwanDate(getValue(row, KEY_ALIASES.applicationDate)),
    underwriter: getValue(row, KEY_ALIASES.underwriter),
    price: getValue(row, KEY_ALIASES.price),
    note: getValue(row, KEY_ALIASES.note),
    sourceId: source.id,
    raw: row
  };
}

async function collectCompanies() {
  const companies = [];
  const sourceReports = [];

  for (const source of SOURCES) {
    try {
      const result = await fetchRowsFromFirstAvailable(source);
      const normalized = result.rows.map(row => normalizeCompany(source, row)).filter(Boolean);
      companies.push(...normalized);
      sourceReports.push({
        id: source.id,
        status: "ok",
        url: result.url,
        rows: result.rows.length,
        acceptedRows: normalized.length
      });
    } catch (error) {
      sourceReports.push({
        id: source.id,
        status: "failed",
        message: error.message
      });
    }
  }

  return { companies: dedupeCompanies(companies), sourceReports };
}

function dedupeCompanies(companies) {
  const seen = new Set();
  const unique = [];

  for (const company of companies) {
    const key = `${company.market}|${company.code}|${company.name}|${company.listedDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(company);
  }

  return unique.sort((a, b) => a.listedDate.localeCompare(b.listedDate) || a.market.localeCompare(b.market));
}

function makeEvents(companies, fromDate, toDate) {
  const events = [];

  for (const company of companies) {
    for (const milestone of MILESTONES) {
      const date = addMonths(company.listedDate, milestone.months);
      if (date < fromDate || date > toDate) continue;

      const title = `${company.name || company.code}(${company.code || "-"}) ${milestone.label}${company.marketLabel}`;
      const description = [
        `市場：${company.marketLabel}`,
        `公司：${company.name || ""} ${company.code ? `(${company.code})` : ""}`.trim(),
        `掛牌/登錄日：${company.listedDate}`,
        company.applicationDate ? `申請日：${company.applicationDate}` : "",
        company.underwriter ? `承銷商/推薦券商：${company.underwriter}` : "",
        company.price ? `價格：${company.price}` : "",
        company.note ? `備註：${company.note}` : "",
        `資料來源：${company.sourceId}`
      ].filter(Boolean).join("\n");

      events.push({
        uid: stableUid(company, milestone),
        title,
        date,
        endDate: addDays(date, 1),
        market: company.market,
        marketLabel: company.marketLabel,
        milestone: milestone.id,
        milestoneLabel: milestone.label,
        company,
        description
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function stableUid(company, milestone) {
  const hash = crypto
    .createHash("sha1")
    .update(`${company.market}|${company.code}|${company.name}|${company.listedDate}|${milestone.id}`)
    .digest("hex")
    .slice(0, 20);
  return `${hash}@taiwan-ipo-calendar.local`;
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line) {
  const chunks = [];
  let current = "";

  for (const char of line) {
    const next = current + char;
    if (Buffer.byteLength(next, "utf8") > 72) {
      chunks.push(current);
      current = " " + char;
    } else {
      current = next;
    }
  }

  chunks.push(current);
  return chunks.join("\r\n");
}

function buildIcs(events, calendarName) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Taiwan IPO Calendar//TWSE TPEx ESB//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-TIMEZONE:${TIME_ZONE}`
  ];

  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(event.endDate)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `DESCRIPTION:${escapeIcsText(event.description)}`,
      `CATEGORIES:${escapeIcsText([event.marketLabel, event.milestoneLabel].join(","))}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

async function writeOutputs(events, companies, sourceReports, fromDate, toDate) {
  await fs.mkdir(OUTPUT_DATA_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_CAL_DIR, { recursive: true });

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    timeZone: TIME_ZONE,
    window: { fromDate, toDate },
    sourceReports,
    companies,
    events
  };

  await fs.writeFile(
    path.join(OUTPUT_DATA_DIR, "ipo-calendar.json"),
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  await fs.writeFile(
    path.join(PUBLIC_DIR, "ipo-calendar.ics"),
    buildIcs(events, "台股掛牌日曆"),
    "utf8"
  );

  const filteredCalendars = [
    { file: "twse.ics", name: "台股掛牌日曆 - 上市", filter: event => event.market === "TWSE" },
    { file: "tpex.ics", name: "台股掛牌日曆 - 上櫃", filter: event => event.market === "TPEX" },
    { file: "esb.ics", name: "台股掛牌日曆 - 興櫃", filter: event => event.market === "ESB" },
    { file: "first-day.ics", name: "台股掛牌日曆 - 首日", filter: event => event.milestone === "first-day" },
    { file: "one-month.ics", name: "台股掛牌日曆 - 一個月", filter: event => event.milestone === "one-month" },
    { file: "two-month.ics", name: "台股掛牌日曆 - 兩個月", filter: event => event.milestone === "two-month" }
  ];

  for (const calendar of filteredCalendars) {
    await fs.writeFile(
      path.join(OUTPUT_CAL_DIR, calendar.file),
      buildIcs(events.filter(calendar.filter), calendar.name),
      "utf8"
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const today = taipeiDateKey();
  const fromDate = args.from || addDays(today, -DEFAULT_WINDOW.pastDays);
  const toDate = args.to || addDays(today, DEFAULT_WINDOW.futureDays);

  const { companies, sourceReports } = await collectCompanies();
  const events = makeEvents(companies, fromDate, toDate);

  await writeOutputs(events, companies, sourceReports, fromDate, toDate);

  const failed = sourceReports.filter(report => report.status !== "ok");
  console.log(`Generated ${events.length} calendar events from ${companies.length} companies.`);
  console.log(`Window: ${fromDate} to ${toDate}`);
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

module.exports = {
  addMonths,
  buildIcs,
  collectCompanies,
  makeEvents,
  normalizeCompany,
  parseTaiwanDate,
  taipeiDateKey,
  addDays
};
