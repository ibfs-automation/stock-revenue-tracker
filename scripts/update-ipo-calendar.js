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
    id: "twse-applylisting-local",
    market: "TWSE",
    label: "上市",
    type: "json",
    pageUrls: [
      "https://www.twse.com.tw/zh/listed/listed/apply-listing.html"
    ],
    urls: [
      process.env.TWSE_APPLYLISTING_LOCAL_URL,
      "https://openapi.twse.com.tw/v1/company/applylistingLocal"
    ].filter(Boolean),
    includeUrlPatterns: [/openapi\.twse\.com\.tw\/v1\/company\/applylistingLocal/i, /\/company\/applylisting/i, /\/zh\/listed\/listed\/apply-listing/i],
    fieldOrder: [
      "索引",
      "公司代號",
      "公司簡稱",
      "申請日期",
      "董事長",
      "申請時股本(仟元)",
      "上市審議委員會審議日期",
      "交易所董事會通過上市日期",
      "上市契約報請主管機關備查日期",
      "股票上市買賣日期",
      "承銷商",
      "承銷價",
      "備註"
    ],
    dateKeys: ["股票上市買賣日期", "上市買賣日期", "listedDate", "ListingDate"]
  },
  {
    id: "twse-applylisting-foreign",
    market: "TWSE",
    label: "上市",
    type: "json",
    pageUrls: [
      "https://www.twse.com.tw/zh/listed/listed/apply-listing.html"
    ],
    urls: [
      process.env.TWSE_APPLYLISTING_FOREIGN_URL,
      "https://openapi.twse.com.tw/v1/company/applylistingForeign"
    ].filter(Boolean),
    includeUrlPatterns: [/openapi\.twse\.com\.tw\/v1\/company\/applylistingForeign/i, /\/company\/applylisting/i, /\/zh\/listed\/listed\/apply-listing/i],
    fieldOrder: [
      "索引",
      "公司代號",
      "公司簡稱",
      "申請日期",
      "董事長",
      "申請時股本(仟元)",
      "上市審議委員會審議日期",
      "交易所董事會通過上市日期",
      "上市契約報請主管機關備查日期",
      "股票上市買賣日期",
      "承銷商",
      "承銷價",
      "備註"
    ],
    dateKeys: ["股票上市買賣日期", "上市買賣日期", "listedDate", "ListingDate"]
  },
  {
    id: "twse-newlisting",
    market: "TWSE",
    label: "上市",
    type: "json",
    pageUrls: [
      "https://www.twse.com.tw/zh/listed/listed/apply-listing.html"
    ],
    urls: [
      process.env.TWSE_NEWLISTING_URL,
      "https://openapi.twse.com.tw/v1/company/newlisting"
    ].filter(Boolean),
    includeUrlPatterns: [/openapi\.twse\.com\.tw\/v1\/company\/newlisting/i, /\/company\/newlisting/i, /\/zh\/listed\/listed\/apply-listing/i],
    fieldOrder: [
      "公司代號",
      "公司簡稱",
      "申請日期",
      "董事長",
      "申請時股本(仟元)",
      "上市審議委員會審議日期",
      "交易所董事會通過上市日期",
      "上市契約報請主管機關備查日期",
      "證期局核准上市契約日期",
      "股票上市買賣日期",
      "承銷商",
      "承銷價",
      "備註"
    ],
    dateKeys: ["股票上市買賣日期", "上市買賣日期", "listedDate", "ListingDate"]
  },
  {
    id: "twse-newlisting-html",
    market: "TWSE",
    label: "上市",
    type: "html",
    pageUrls: [
      "https://www.twse.com.tw/zh/listed/listed/apply-listing.html"
    ],
    urls: [
      process.env.TWSE_NEWLISTING_HTML_URL,
      "https://www.twse.com.tw/company/newlisting?response=html&yy="
    ].filter(Boolean),
    includeUrlPatterns: [/\/company\/newlisting/i, /\/zh\/listed\/listed\/apply-listing/i],
    dateKeys: ["股票上市買賣日期", "上市買賣日期", "Listing Date", "listedDate", "ListingDate"]
  },
  {
    id: "tpex-mainboard-applicants",
    market: "TPEX",
    label: "上櫃",
    type: "auto",
    pageUrls: [
      "https://www.tpex.org.tw/zh-tw/mainboard/applying/status/company.html"
    ],
    urls: [
      process.env.TPEX_MAINBOARD_APPLICANTS_CSV_URL,
      "https://www.tpex.org.tw/www/zh-tw/mainboard/applying/status/company?response=csv&charset=utf-8",
      "https://www.tpex.org.tw/www/zh-tw/mainboard/applying/status/company?response=csv",
      "https://www.tpex.org.tw/zh-tw/mainboard/applying/status/company?response=csv",
      process.env.TPEX_MAINBOARD_APPLICANTS_URL
    ].filter(Boolean),
    excludeUrlPatterns: [/\/data\/menu\//i, /menu\.json/i],
    includeUrlPatterns: [/\/mainboard\/applying\/status\/company/i],
    fieldOrder: [
      "申請日期",
      "股票代號",
      "公司名稱",
      "董事長",
      "申請時股本",
      "上櫃審議委員會審議日期",
      "櫃買董事會通過上櫃日期",
      "櫃買同意上櫃契約日期或證期局核准上櫃契約日期",
      "股票上櫃買賣日期",
      "主辦承銷商",
      "承銷價",
      "備註"
    ],
    dateKeys: ["股票上櫃買賣日期", "上櫃買賣日期", "櫃買賣日期", "listedDate", "ListingDate"]
  },
  {
    // tpex_esb_applicant_companies lists companies that applied through ESB and are now
    // confirmed for TPEX mainboard listing. The ListingDate field is the TPEX 上櫃日期,
    // NOT the ESB 登錄日期. Treating this as a TPEX source ensures dedupeCompanies can
    // suppress the corresponding ESB entry for the same code.
    id: "tpex-esb-graduates",
    market: "TPEX",
    label: "上櫃",
    type: "json",
    pageUrls: [],
    urls: [
      "https://www.tpex.org.tw/openapi/v1/tpex_esb_applicant_companies"
    ],
    includeUrlPatterns: [/tpex_esb_applicant_companies/i],
    dateKeys: ["ListingDate", "上櫃買賣日期", "股票上櫃買賣日期", "掛牌日期"]
  },
  {
    id: "tpex-esb-ipo",
    market: "ESB",
    label: "興櫃",
    type: "auto",
    pageUrls: [
      "https://www.tpex.org.tw/web/regular_emerging/emerging_stock/emerging_stock_list.php?l=zh-tw"
    ],
    urls: (() => {
      const westernYear = new Date().getFullYear();
      // latestEmerge supports GET and returns {tables:[{fields,data}]} for the given calendar year.
      // Fetching two years covers the year-end boundary (e.g. companies listed in Dec of prior year).
      const apiBase = "https://www.tpex.org.tw/www/zh-tw/company/latestEmerge?code=&id=&response=json&date=";
      return [
        `${apiBase}${westernYear}`,
        `${apiBase}${westernYear - 1}`,
        process.env.TPEX_ESB_IPO_CSV_URL,
        "https://www.tpex.org.tw/storage/emerging_register/EmergingNewListPrice.csv"
        // NOTE: tpex_esb_applicant_companies is intentionally excluded here.
        // Its ListingDate field is the TPEX 上櫃日期, not the ESB 登錄日期.
        // It is handled as a TPEX source (tpex-esb-graduates) instead.
      ].filter(Boolean);
    })(),
    includeUrlPatterns: [/\/esb\/listed\/ipo/i, /EmergingNewListPrice/i, /regular_emerging\/emerging_stock/i, /\/company\/latestEmerge/i],
    detailLinkPattern: /\/esb\/listed\/ipo\/detail\.html/i,
    allowRawTextRows: true,
    fieldOrder: ["序號", "股票代號", "公司簡稱", "登錄日期", "認購價格", "公開說明書", "網址"],
    dateKeys: ["登錄日期", "登錄日", "預計登錄日期", "預計掛牌日期", "掛牌日期", "掛牌日", "興櫃日期", "興櫃登錄日期", "興櫃掛牌日期", "上興櫃日期", "櫃檯買賣日期", "櫃檯買賣開始日", "櫃檯買賣開始日期", "股票開始櫃檯買賣日期", "開始櫃檯買賣日期", "開始買賣日", "開始買賣日期", "興櫃買賣開始日", "興櫃買賣開始日期", "興櫃股票櫃檯買賣開始日期"]
  }
];

const KEY_ALIASES = {
  code: ["公司代號", "證券代號", "股票代號", "有價證券代號", "代號", "Code", "symbol", "SecuritiesCode"],
  name: ["公司簡稱", "公司名稱", "發行公司名稱", "證券簡稱", "證券名稱", "股票簡稱", "股票名稱", "有價證券名稱", "股票代號及名稱", "證券代號及名稱", "有價證券代號及名稱", "公司代號及名稱", "簡稱", "名稱", "Name", "name", "companyName"],
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

const MARKET_MILESTONES = {
  TWSE: MILESTONES,
  TPEX: MILESTONES,
  ESB: MILESTONES.filter(milestone => milestone.id === "first-day")
};

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

function moveWeekendToMonday(dateKey) {
  const date = parseIsoDate(dateKey);
  const day = date.getUTCDay();
  if (day === 6) return addDays(dateKey, 2);
  if (day === 0) return addDays(dateKey, 1);
  return dateKey;
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

function extractStockCode(value) {
  const matches = String(value || "").match(/(^|[^\d])(\d{4,6})(?!\d)/g) || [];
  for (const match of matches) {
    const code = (match.match(/\d{4,6}/) || [])[0];
    if (code) return code;
  }
  return "";
}

function valueLooksLikeDateKey(key) {
  return /日期|date|年月日|time/i.test(String(key || ""));
}

function valueLooksLikeNameKey(key) {
  return /公司(?:簡稱|名稱|代號及名稱)|發行公司名稱|證券(?:簡稱|名稱|代號及名稱)|股票(?:簡稱|名稱|代號及名稱)|有價證券(?:名稱|代號及名稱)|簡稱$|^名稱$|company|name/i.test(String(key || ""));
}

function normalizeRowForSource(source, row) {
  if (Array.isArray(row)) {
    return Object.fromEntries((source.fieldOrder || []).map((field, index) => [field, row[index] || ""]));
  }

  if (row && typeof row === "object") {
    const keys = Object.keys(row);
    const numericKeys = keys.filter(key => /^\d+$/.test(key));
    if (numericKeys.length && numericKeys.length === keys.length && source.fieldOrder) {
      return Object.fromEntries(source.fieldOrder.map((field, index) => [field, row[index] || row[String(index)] || ""]));
    }
  }

  return row;
}

function normalizeStockCode(row) {
  const direct = extractStockCode(getValue(row, KEY_ALIASES.code));
  if (direct) return direct;

  for (const [key, value] of Object.entries(row || {})) {
    if (valueLooksLikeDateKey(key)) continue;
    const code = extractStockCode(value);
    if (code) return code;
  }

  return "";
}

function normalizeCompanyName(row, code) {
  const direct = getValue(row, KEY_ALIASES.name);
  const candidates = [
    direct,
    ...Object.entries(row || {})
      .filter(([key]) => valueLooksLikeNameKey(key) && !valueLooksLikeDateKey(key))
      .map(([, value]) => String(value || ""))
  ];

  for (const candidate of candidates) {
    const cleaned = String(candidate || "")
      .replace(new RegExp(`(^|[^\\d])${code}(?!\\d)`, "g"), " ")
      .replace(/[()（）]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned && cleaned !== code && !/^\d+$/.test(cleaned) && !parseTaiwanDate(cleaned)) {
      return cleaned;
    }
  }

  return "";
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rowRawText(row) {
  return String((row && (row.__rawText || row.__rowText || row.__pageText)) || "").replace(/\s+/g, " ").trim();
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

function extractDateFromTextByKeys(text, keys) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return null;

  const datePattern = "(20\\d{2}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{2,3}\\s*(?:年|[./-])\\s*\\d{1,2}\\s*(?:月|[./-])\\s*\\d{1,2}\\s*(?:日)?)";
  for (const key of keys || []) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) continue;
    const match = body.match(new RegExp(`${regexEscape(cleanKey)}[^\\d]{0,24}${datePattern}`));
    if (match) {
      const parsed = parseTaiwanDate(match[1]);
      if (parsed) return parsed;
    }
  }

  const keywordMatch = body.match(new RegExp(`(?:登錄|掛牌|開始(?:櫃檯)?買賣|上興櫃)[^\\d]{0,24}${datePattern}`));
  if (keywordMatch) return parseTaiwanDate(keywordMatch[1]);

  const dates = [...body.matchAll(new RegExp(datePattern, "g"))]
    .map(match => parseTaiwanDate(match[1]))
    .filter(Boolean);
  return dates[0] || null;
}

function normalizeCompanyNameFromText(text, code) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return "";

  const labeled = body.match(/(?:公司(?:簡稱|名稱)|證券(?:簡稱|名稱)|股票(?:簡稱|名稱)|簡稱|名稱)\s*[:：]?\s*([^\s，,、;；]+)/);
  if (labeled && labeled[1]) {
    const cleaned = labeled[1].replace(/[()（）]/g, "").trim();
    if (cleaned && cleaned !== code && !parseTaiwanDate(cleaned)) return cleaned;
  }

  const withoutDates = body
    .replace(/20\d{2}[/-]\d{1,2}[/-]\d{1,2}/g, " ")
    .replace(/\d{2,3}\s*(?:年|[./-])\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2}\s*(?:日)?/g, " ")
    .replace(new RegExp(`(^|[^\\d])${regexEscape(code)}(?!\\d)`, "g"), " ")
    .replace(/最近登錄興櫃公司|資料查詢|下載近期將掛牌股票認購價格|公司簡稱|公司名稱|證券簡稱|證券名稱|股票名稱|股票代號|證券代號|登錄日期|登錄日|掛牌日期|掛牌日|開始買賣日期|開始櫃檯買賣日期|興櫃|上興櫃|詳情|詳細資料/g, " ")
    .replace(/[()（）:：，,、;；｜|\/\\]+/g, " ");

  const tokens = withoutDates.split(/\s+/).filter(Boolean);
  return tokens.find(token => /[一-鿿]/.test(token) && token.length <= 16 && !/日期|代號|名稱|查詢|資料|下載|公司$/.test(token)) || "";
}

function isNonListingSignalRow(source, row) {
  if (!source || source.market !== "ESB") return false;
  const text = JSON.stringify(row || {});
  return /申請加入.*推薦證券商|推薦證券商.*申請加入|推薦證券商.*生效|加入.*推薦證券商|增為.*推薦證券商|推薦證券商.*異動/.test(text);
}

function rowFromPositionalCells(source, cells) {
  if (!source || source.market !== "ESB") return null;
  const values = (cells || []).map(cell => String(cell || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (values.length < 4) return null;

  const codeIndex = values.findIndex(value => /^\d{4,6}$/.test(value));
  if (codeIndex < 0) return null;
  const dateIndex = values.findIndex((value, index) => index > codeIndex && !!parseTaiwanDate(value));
  if (dateIndex < 0) return null;
  const name = values.slice(codeIndex + 1, dateIndex).find(value => /[一-鿿A-Za-z]/.test(value) && !parseTaiwanDate(value));
  if (!name) return null;

  return {
    股票代號: values[codeIndex],
    公司代號: values[codeIndex],
    證券代號: values[codeIndex],
    公司簡稱: name,
    證券簡稱: name,
    股票名稱: name,
    登錄日期: parseTaiwanDate(values[dateIndex]),
    __rawText: values.join(" ")
  };
}

function rowLooksLikeCandidate(source, row) {
  const text = JSON.stringify(row || "");
  if (!text || text.length < 8) return false;
  if (/menu|children|\[object Object\]|"搜尋"|查詢條件|網站導覽/i.test(text)) return false;
  if (isNonListingSignalRow(source, row)) return false;

  const hasCode = !!normalizeStockCode(row);
  const hasNamedKey = Object.keys(row || {}).some(key => (
    valueLooksLikeNameKey(key)
    || (source.dateKeys || []).some(dateKey => normalizeKey(dateKey) === normalizeKey(key))
    || KEY_ALIASES.code.some(codeKey => normalizeKey(codeKey) === normalizeKey(key))
  ));
  const hasDate = !!parseTaiwanDate(getValue(row, source.dateKeys)) || !!extractDateFromTextByKeys(rowRawText(row), source.dateKeys);

  return (hasCode && (hasNamedKey || hasDate)) || (hasCode && /登錄|興櫃|上櫃|上市|買賣|掛牌|櫃檯/.test(text));
}

// Recursively find all {fields: string[], data: array[]} blocks at any nesting depth.
// This handles any JSON structure a data provider may use — flat, wrapped in "tables",
// wrapped in "result", or any other key — without needing per-site special cases.
function findFieldsDataBlocks(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return [];
  const blocks = [];
  if (Array.isArray(obj)) {
    for (const item of obj) blocks.push(...findFieldsDataBlocks(item, depth + 1));
  } else {
    if (
      Array.isArray(obj.fields) && obj.fields.length > 0 &&
      Array.isArray(obj.data) && obj.data.length > 0
    ) {
      blocks.push(obj);
    }
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === "object") {
        blocks.push(...findFieldsDataBlocks(obj[key], depth + 1));
      }
    }
  }
  return blocks;
}

function objectRows(payload) {
  if (Array.isArray(payload)) return payload;

  // Generic recursive scan: find any {fields, data} block at any depth
  const blocks = findFieldsDataBlocks(payload);
  if (blocks.length) {
    const allRows = [];
    for (const block of blocks) {
      allRows.push(...block.data.map(row =>
        Array.isArray(row)
          ? Object.fromEntries(block.fields.map((field, index) => [field, row[index]]))
          : row
      ));
    }
    if (allRows.length) return allRows;
  }

  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.result)) return payload.result;
  if (payload && payload.result && Array.isArray(payload.result.data)) return payload.result.data;

  return [];
}

function normalizeParsedRowsForSource(source, rows) {
  const output = [];

  for (const row of rows || []) {
    output.push(row);
    const values = Array.isArray(row) ? row : (row && typeof row === "object" ? Object.values(row) : []);
    const positional = rowFromPositionalCells(source, values);
    if (positional) output.push(positional);
  }

  return output;
}

async function decodeResponseText(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  const charset = (contentType.match(/charset=([^;]+)/i) || [])[1] || "";

  const decode = encoding => {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      return buffer.toString("utf8");
    }
  };

  if (/big5|ms950|950/i.test(charset)) return decode("big5");
  if (/utf-?8/i.test(charset)) return decode("utf-8");

  const utf8 = decode("utf-8");
  if (utf8.includes("�") || (!/[公司股票登錄上市上櫃]/.test(utf8) && buffer.length > 0)) {
    const big5 = decode("big5");
    if (/[公司股票登錄上市上櫃]/.test(big5)) return big5;
  }

  return utf8;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function pageDataCandidates(html, pageUrl) {
  const candidates = [];
  const base = new URL(pageUrl);
  const text = String(html || "");

  for (const match of text.matchAll(/(?:href|src|action|data-url|url)=["']([^"']+)["']/gi)) {
    try {
      candidates.push(new URL(decodeHtml(match[1]), base).href);
    } catch {
      // Ignore non-URL attribute values.
    }
  }

  for (const match of text.matchAll(/["']([^"']*(?:response=|openapi|\.csv|\.json|download|storage)[^"']*)["']/gi)) {
    try {
      candidates.push(new URL(decodeHtml(match[1]), base).href);
    } catch {
      // Ignore script string values that are not URLs.
    }
  }

  const withoutHash = pageUrl.replace(/#.*/, "");
  const queryJoin = withoutHash.includes("?") ? "&" : "?";
  candidates.push(`${withoutHash}${queryJoin}response=json`);
  candidates.push(`${withoutHash}${queryJoin}response=csv`);
  candidates.push(`${withoutHash}${queryJoin}response=csv&charset=utf-8`);

  if (withoutHash.includes("/zh-tw/")) {
    const wwwUrl = withoutHash.replace("/zh-tw/", "/www/zh-tw/");
    const wwwJoin = wwwUrl.includes("?") ? "&" : "?";
    candidates.push(`${wwwUrl}${wwwJoin}response=json`);
    candidates.push(`${wwwUrl}${wwwJoin}response=csv`);
    candidates.push(`${wwwUrl}${wwwJoin}response=csv&charset=utf-8`);
  }

  return uniqueValues(candidates).filter(url => (
    /response=|openapi|\.csv(?:$|[?#])|\.json(?:$|[?#])|download|api/i.test(url)
  ));
}

async function discoveredSourceUrls(source) {
  const candidates = [];

  for (const pageUrl of source.pageUrls || []) {
    try {
      const response = await fetch(pageUrl, {
        headers: {
          "Accept": "text/html, */*",
          "User-Agent": "Mozilla/5.0 ipo-calendar-generator"
        }
      });
      if (!response.ok) continue;
      const html = await decodeResponseText(response);
      candidates.push(...pageDataCandidates(html, pageUrl));
      if (source.detailLinkPattern) candidates.push(pageUrl);
    } catch {
      // Discovery is best-effort; explicit source URLs still run below.
    }
  }

  candidates.push(...(source.urls || []));
  return uniqueValues(candidates).filter(url => sourceUrlAllowed(source, url));
}

function deepObjectRows(value, rows = []) {
  if (Array.isArray(value)) {
    if (value.length && value.every(item => item && typeof item === "object" && !Array.isArray(item))) {
      rows.push(...value);
    }
    for (const item of value) deepObjectRows(item, rows);
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.data) && Array.isArray(value.fields)) {
      rows.push(...objectRows(value));
    }
    for (const item of Object.values(value)) deepObjectRows(item, rows);
  }
  return rows;
}

function parseEmbeddedJsonRows(text) {
  const rows = [];
  const scriptMatches = [...String(text || "").matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of scriptMatches) {
    const body = decodeHtml(match[1] || "").trim();
    if (!body || !/[{\[]/.test(body)) continue;

    const candidates = [];
    if (/^\s*[{\[]/.test(body)) candidates.push(body);
    for (const jsonMatch of body.matchAll(/JSON\.parse\((["'`])([\s\S]*?)\1\)/g)) {
      try {
        candidates.push(JSON.parse(`"${jsonMatch[2].replace(/"/g, '\\"')}"`));
      } catch {
        candidates.push(jsonMatch[2]);
      }
    }

    for (const candidate of candidates) {
      try {
        rows.push(...deepObjectRows(JSON.parse(candidate)));
      } catch {
        // Ignore script bodies that are not plain JSON payloads.
      }
    }
  }

  return rows;
}

function detailLinkCandidatesFromHtml(source, html, pageUrl) {
  if (!source.detailLinkPattern) return [];

  const base = new URL(pageUrl);
  const links = [];
  for (const match of String(html || "").matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const href = new URL(decodeHtml(match[1]), base).href;
      if (source.detailLinkPattern.test(href)) links.push(href);
    } catch {
      // Ignore non-URL link targets.
    }
  }

  return uniqueValues(links);
}

function rowsFromRawText(source, url, text) {
  if (!source.allowRawTextRows) return [];

  const body = String(text || "").replace(/\s+/g, " ").trim();
  const code = extractStockCode(url) || extractStockCode(body);
  const date = extractDateFromTextByKeys(body, source.dateKeys);
  if (!code || !date) return [];

  const name = normalizeCompanyNameFromText(body, code);
  if (!name) return [];

  return [{
    公司代號: code,
    股票代號: code,
    證券代號: code,
    公司簡稱: name,
    證券簡稱: name,
    登錄日期: date,
    __rawText: body,
    __detailUrl: url
  }];
}

function dateIndexesFromRows(source, rows) {
  const dates = [];
  const keys = ["資料日期", "掛牌日期", "登錄日期", "date", "listedDate", ...(source.dateKeys || [])];

  for (const row of rows || []) {
    const normalized = normalizeRowForSource(source, row);
    const code = normalizeStockCode(normalized);
    if (code) continue;

    for (const key of keys) {
      const value = getValue(normalized, [key]);
      const parsed = parseTaiwanDate(value);
      if (parsed) dates.push(parsed);
    }
  }

  return uniqueValues(dates);
}

function compactDateVariants(dateKey) {
  const [year, month, day] = dateKey.split("-");
  const rocYear = String(Number(year) - 1911);
  const mm = month.padStart(2, "0");
  const dd = day.padStart(2, "0");
  return uniqueValues([
    `${year}${mm}${dd}`,
    `${rocYear}${mm}${dd}`,
    `${year}/${Number(month)}/${Number(day)}`,
    `${year}/${mm}/${dd}`,
    `${rocYear}/${Number(month)}/${Number(day)}`,
    `${rocYear}/${mm}/${dd}`,
    `${Number(month)}/${Number(day)}`,
    `${mm}/${dd}`,
    `${Number(month)}月${Number(day)}日`
  ]);
}

function responseLooksLikeData(url, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (/image\/|font\/|text\/css|javascript|application\/octet-stream|video\/|audio\//i.test(type)) {
    return false;
  }
  if (/\.(?:png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf|otf|pdf)(?:$|[?#])/i.test(url)) {
    return false;
  }

  return /json|csv|text\/plain|html/i.test(type)
    || /response=|openapi|\.csv(?:$|[?#])|\.json(?:$|[?#])|download|api/i.test(url);
}

function sourceUrlAllowed(source, url) {
  if ((source.excludeUrlPatterns || []).some(pattern => pattern.test(url))) return false;
  if (!(source.includeUrlPatterns || []).length) return true;
  return source.includeUrlPatterns.some(pattern => pattern.test(url));
}

async function fetchRowsFromDetailLinks(source, pageUrl, html) {
  const rows = [];
  const urlReports = [];
  const detailUrls = detailLinkCandidatesFromHtml(source, html, pageUrl).slice(0, Number(process.env.IPO_CALENDAR_MAX_DETAIL_PAGES || 120));

  for (const detailUrl of detailUrls) {
    try {
      const { text, contentType } = await fetchTextFromUrl(detailUrl, "text/html, application/json, text/plain, */*");
      const parsed = [
        ...parseRowsFromText(source, detailUrl, text, contentType),
        ...rowsFromRawText(source, detailUrl, textFromHtmlCell(text))
      ];
      urlReports.push({ url: `detail:${detailUrl}`, rows: parsed.length });
      if (parsed.length) rows.push(...parsed);
    } catch (error) {
      urlReports.push({ url: `detail:${detailUrl}`, rows: 0, error: error.message });
    }
  }

  if (detailUrls.length) {
    urlReports.unshift({ url: `detail-links:${pageUrl}`, rows: detailUrls.length });
  }

  return { rows, urlReports };
}

function dateExpansionUrlCandidates(source, pageUrl, dateKey) {
  const candidates = [];
  const variants = compactDateVariants(dateKey);

  for (const variant of variants) {
    try {
      const base = new URL(pageUrl);
      const withoutHtml = base.href.replace(/\.html(?:$|[?#].*)/i, "");
      const wwwHref = withoutHtml.replace("/zh-tw/", "/www/zh-tw/");
      for (const href of uniqueValues([withoutHtml, wwwHref])) {
        for (const pathSuffix of ["", "/detail"]) {
          for (const dateParam of ["date", "queryDate", "listedDate", "stk_date", "d"]) {
            const url = new URL(`${href}${pathSuffix}`);
            url.searchParams.set("response", "json");
            url.searchParams.set(dateParam, variant);
            candidates.push(url.href);
          }
        }
      }
    } catch {
      // Ignore malformed page URLs.
    }
  }

  return uniqueValues(candidates);
}

async function fetchRowsFromDateIndexes(source, pageUrl, indexRows) {
  const rows = [];
  const urlReports = [];
  const dates = dateIndexesFromRows(source, indexRows).slice(0, Number(process.env.IPO_CALENDAR_MAX_DATE_INDEXES || 80));

  for (const dateKey of dates) {
    for (const url of dateExpansionUrlCandidates(source, pageUrl, dateKey)) {
      try {
        const { text, contentType } = await fetchTextFromUrl(url, "text/html, application/json, text/csv, text/plain, */*");
        const parsed = parseRowsFromText(source, url, text, contentType);
        const rawRows = rowsFromRawText(source, url, textFromHtmlCell(text));
        const expanded = [...parsed, ...rawRows];
        urlReports.push({ url: `date-expand:${url}`, rows: expanded.length });
        if (expanded.length) rows.push(...expanded);
      } catch (error) {
        urlReports.push({ url: `date-expand:${url}`, rows: 0, error: error.message });
      }
    }
  }

  if (dates.length) urlReports.unshift({ url: `date-indexes:${pageUrl}`, rows: dates.length });
  return { rows, urlReports };
}

async function fetchJsonFromFirstAvailable(source) {
  const errors = [];
  const urls = await discoveredSourceUrls(source);

  for (const url of urls) {
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

      const text = await decodeResponseText(response);
      const payload = JSON.parse(text.replace(/^﻿/, ""));
      return { url, rows: objectRows(payload) };
    } catch (error) {
      errors.push(`${url} ${error.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

async function fetchTextFromUrl(url, accept) {
  const response = await fetch(url, {
    headers: {
      "Accept": accept,
      "User-Agent": "Mozilla/5.0 ipo-calendar-generator"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    contentType: response.headers.get("content-type") || "",
    text: await decodeResponseText(response)
  };
}

function parseRowsFromText(source, url, text, contentType = "") {
  const trimmed = String(text || "").replace(/^﻿/, "").trim();
  const parsers = [];

  if (source.type === "json" || /json/i.test(contentType) || /^[{[]/.test(trimmed)) {
    parsers.push(() => objectRows(JSON.parse(trimmed)));
  }

  if (source.type === "csv" || /csv|text\/plain/i.test(contentType) || /\.csv(?:$|[?#])|response=csv/i.test(url)) {
    parsers.push(() => /^\s*</.test(trimmed) ? [] : parseCsv(trimmed));
  }

  if (source.type === "html" || source.type === "auto" || /^\s*</.test(trimmed) || /html/i.test(contentType)) {
    parsers.push(() => parseHtmlTables(text));
    parsers.push(() => parseEmbeddedJsonRows(text));
  }

  for (const parse of parsers) {
    try {
      const rows = normalizeParsedRowsForSource(source, parse());
      if (rows.length) return rows;
    } catch {
      // Try the next parser; official pages differ by endpoint.
    }
  }

  return [];
}

async function fetchRowsFromAllAvailable(source) {
  const errors = [];
  const urlReports = [];
  const allRows = [];
  const urls = await discoveredSourceUrls(source);

  for (const url of urls) {
    try {
      const { text, contentType } = await fetchTextFromUrl(url, "text/html, application/json, text/csv, text/plain, */*");
      const rows = parseRowsFromText(source, url, text, contentType);
      urlReports.push({ url, rows: rows.length });
      if (rows.length) allRows.push(...rows);
      if (/html/i.test(contentType) || /^\s*</.test(text)) {
        const detailResult = await fetchRowsFromDetailLinks(source, url, text);
        urlReports.push(...detailResult.urlReports);
        if (detailResult.rows.length) allRows.push(...detailResult.rows);
      }
      const dateResult = await fetchRowsFromDateIndexes(source, url, rows);
      urlReports.push(...dateResult.urlReports);
      if (dateResult.rows.length) allRows.push(...dateResult.rows);
    } catch (error) {
      errors.push(`${url} ${error.message}`);
      urlReports.push({ url, rows: 0, error: error.message });
    }
  }

  if (allRows.length) {
    return {
      url: urlReports.filter(report => report.rows > 0).map(report => report.url).join(", "),
      urlReports,
      rows: allRows
    };
  }

  throw new Error(errors.join("\n") || "No parseable rows");
}

async function browserRowsForSource(source) {
  if (process.env.IPO_CALENDAR_DISABLE_BROWSER === "1" || !(source.pageUrls || []).length) {
    return { rows: [], reports: [] };
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { rows: [], reports: [{ url: "playwright", rows: 0, error: "Playwright is not installed" }] };
  }

  const browser = await chromium.launch({ headless: true });
  const rows = [];
  const reports = [];

  try {
    for (const pageUrl of source.pageUrls || []) {
      const page = await browser.newPage({ locale: "zh-TW", timezoneId: TIME_ZONE });
      const networkRows = [];
      const networkReports = [];
      const responsePromises = [];

      page.on("response", response => {
        const url = response.url();
        const contentType = response.headers()["content-type"] || "";
        if (!responseLooksLikeData(url, contentType) || !sourceUrlAllowed(source, url)) {
          return;
        }

        const task = response.body()
          .then(buffer => {
            const fakeResponse = {
              headers: { get: name => name.toLowerCase() === "content-type" ? contentType : "" },
              arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
            };
            return decodeResponseText(fakeResponse);
          })
          .then(text => {
            const parsed = parseRowsFromText(source, url, text, contentType);
            if (parsed.length) {
              networkRows.push(...parsed);
              networkReports.push({ url: `browser-response:${url}`, rows: parsed.length });
            }
          })
          .catch(error => {
            networkReports.push({ url: `browser-response:${url}`, rows: 0, error: error.message });
          });
        responsePromises.push(task);
      });

      try {
        await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60000 });
        await page.waitForTimeout(1500);

        const currentYear = new Date().getFullYear();
        const yearValues = [...new Set([String(currentYear), String(currentYear - 1911)])];
        for (const yearValue of yearValues) {
          await page.evaluate((year) => {
            const controls = [...document.querySelectorAll("input, select")];
            for (const control of controls) {
              const label = `${control.name || ""} ${control.id || ""} ${control.getAttribute("placeholder") || ""} ${control.getAttribute("aria-label") || ""}`;
              if (control.tagName === "SELECT") {
                const options = [...control.options];
                const option = options.find(item => item.value === year || item.textContent.trim() === year)
                  || options.find(item => item.value.includes(year) || item.textContent.trim().includes(year));
                if (option) {
                  control.value = option.value;
                  control.dispatchEvent(new Event("change", { bubbles: true }));
                }
              } else {
                const value = String(control.value || "");
                const looksLikeYearControl = /年|year/i.test(label) || /^(20\d{2}|\d{2,3})$/.test(value);
                const looksLikeSearchControl = /搜尋|查詢|公司|代號|簡稱|keyword|search|query|code|name/i.test(label);
                if (!looksLikeYearControl) continue;
                if (looksLikeSearchControl && !/年|year/i.test(label)) continue;
                control.value = year;
                control.dispatchEvent(new Event("input", { bubbles: true }));
                control.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          }, yearValue);

          const clicked = await page.evaluate(() => {
            const buttons = [...document.querySelectorAll("button, input[type=button], input[type=submit], a")];
            const target = buttons.find(button => /查詢|搜尋|送出|Search/i.test(button.textContent || button.value || ""))
              || buttons.find(button => button.type === "submit")
              || buttons.find(button => /btn|search|query|submit/i.test(`${button.className || ""} ${button.id || ""} ${button.name || ""}`));
            if (!target) {
              const form = document.querySelector("form");
              if (form) {
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                return true;
              }
              return false;
            }
            target.click();
            return true;
          });
          if (clicked) {
            await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1000);
          } else {
            await page.keyboard.press("Enter").catch(() => {});
            await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1000);
          }
        }

        await Promise.allSettled(responsePromises);

        const pageRows = await page.evaluate(() => {
          const text = element => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
          const parsed = [];

          for (const table of document.querySelectorAll("table")) {
            const rawRows = [...table.querySelectorAll("tr")]
              .map(tr => [...tr.querySelectorAll("th,td")].map(cell => text(cell)))
              .filter(row => row.some(Boolean));
            if (rawRows.length < 2) continue;

            let headerIndex = rawRows.findIndex(row => row.some(cell => /公司|證券|股票|代號|簡稱|名稱|買賣日期|登錄日期/.test(cell)));
            if (headerIndex < 0) headerIndex = 0;
            const headers = rawRows[headerIndex];
            for (const row of rawRows.slice(headerIndex + 1)) {
              parsed.push(Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
            }
          }

          const roleRows = [...document.querySelectorAll("[role=row]")].map(row => [...row.querySelectorAll("[role=cell], [role=gridcell], [role=columnheader]")].map(cell => text(cell))).filter(row => row.length);
          if (roleRows.length > 1) {
            const headerIndex = roleRows.findIndex(row => row.some(cell => /公司|證券|股票|代號|簡稱|名稱|買賣日期|登錄日期/.test(cell)));
            if (headerIndex >= 0) {
              const headers = roleRows[headerIndex];
              for (const row of roleRows.slice(headerIndex + 1)) {
                parsed.push(Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
              }
            }
          }

          const seenTexts = new Set();
          const rawCandidates = [
            ...document.querySelectorAll("a[href*='detail'], li, article, section, [class*='item'], [class*='card'], [class*='row']")
          ];
          for (const element of rawCandidates) {
            const rawText = text(element);
            if (!rawText || rawText.length > 500 || seenTexts.has(rawText)) continue;
            if (!/(^|[^\d])\d{4,6}(?!\d)/.test(rawText)) continue;
            if (!/(20\d{2}[/-]\d{1,2}[/-]\d{1,2}|\d{2,3}\s*(?:年|[./-])\s*\d{1,2}\s*(?:月|[./-])\s*\d{1,2})/.test(rawText)) continue;
            seenTexts.add(rawText);
            const link = element.matches("a[href]") ? element : element.querySelector("a[href]");
            parsed.push({
              __rawText: rawText,
              __detailUrl: link ? link.href : location.href
            });
          }

          return parsed;
        });

        const dateIndexRows = [...networkRows, ...pageRows].filter(row => {
          const text = JSON.stringify(row || {});
          return !/(^|[^\d])\d{4,6}(?!\d)/.test(text) && /資料日期|掛牌日期|登錄日期|202\d{5}|\d{3}\/\d{1,2}\/\d{1,2}/.test(text);
        });
        const dateIndexes = dateIndexesFromRows(source, dateIndexRows).slice(0, Number(process.env.IPO_CALENDAR_MAX_DATE_INDEXES || 80));
        const expandedDateRows = [];
        for (const dateKey of dateIndexes) {
          const variants = compactDateVariants(dateKey);
          const clickedDate = await page.evaluate((dateTexts) => {
            const normalize = value => String(value || "").replace(/\s+/g, "");
            const wanted = dateTexts.map(normalize);
            const elements = [...document.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit], td, li, div, span")]
              .filter(element => {
                const text = normalize(element.innerText || element.textContent || element.value || "");
                return text && wanted.some(item => text.includes(item));
              });
            const target = elements.find(element => /^(BUTTON|A|INPUT)$/.test(element.tagName) || element.getAttribute("role") === "button") || elements[0];
            if (!target) return false;
            target.click();
            return true;
          }, variants);

          if (!clickedDate) {
            await page.evaluate((dateTexts) => {
              const controls = [...document.querySelectorAll("input, select")];
              for (const control of controls) {
                const label = `${control.name || ""} ${control.id || ""} ${control.getAttribute("placeholder") || ""} ${control.getAttribute("aria-label") || ""}`;
                if (!/日期|date|day/i.test(label)) continue;
                const value = dateTexts[0];
                if (control.tagName === "SELECT") {
                  const option = [...control.options].find(item => dateTexts.includes(item.value) || dateTexts.includes(item.textContent.trim()));
                  if (option) control.value = option.value;
                } else {
                  control.value = value;
                  control.dispatchEvent(new Event("input", { bubbles: true }));
                }
                control.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }, variants);
            await page.evaluate(() => {
              const buttons = [...document.querySelectorAll("button, input[type=button], input[type=submit], a")];
              const target = buttons.find(button => /查詢|搜尋|送出|Search/i.test(button.textContent || button.value || ""));
              if (target) target.click();
            });
          }

          await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(800);
          await Promise.allSettled(responsePromises);
          const expandedText = await page.evaluate(() => document.body ? (document.body.innerText || document.body.textContent || "") : "");
          expandedDateRows.push(...rowsFromRawText(source, pageUrl, expandedText));
          expandedDateRows.push(...await page.evaluate(() => {
            const text = element => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
            const parsed = [];
            for (const table of document.querySelectorAll("table")) {
              const rawRows = [...table.querySelectorAll("tr")]
                .map(tr => [...tr.querySelectorAll("th,td")].map(cell => text(cell)))
                .filter(row => row.some(Boolean));
              if (rawRows.length < 2) continue;
              let headerIndex = rawRows.findIndex(row => row.some(cell => /公司|證券|股票|代號|簡稱|名稱|買賣日期|登錄日期|掛牌日期/.test(cell)));
              if (headerIndex < 0) headerIndex = 0;
              const headers = rawRows[headerIndex];
              for (const row of rawRows.slice(headerIndex + 1)) {
                parsed.push(Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
              }
            }
            return parsed;
          }));
        }

        const detailLinks = await page.evaluate(() => {
          const links = [...document.querySelectorAll("a[href]")].map(link => link.href).filter(Boolean);
          return [...new Set(links)];
        });
        const matchingDetailLinks = source.detailLinkPattern
          ? detailLinks.filter(url => source.detailLinkPattern.test(url)).slice(0, Number(process.env.IPO_CALENDAR_MAX_DETAIL_PAGES || 120))
          : [];
        const detailRows = [];
        for (const detailUrl of matchingDetailLinks) {
          const detailPage = await browser.newPage({ locale: "zh-TW", timezoneId: TIME_ZONE });
          const detailNetworkRows = [];
          const detailResponsePromises = [];
          detailPage.on("response", response => {
            const url = response.url();
            const contentType = response.headers()["content-type"] || "";
            if (!responseLooksLikeData(url, contentType) || !sourceUrlAllowed(source, url)) return;

            const task = response.body()
              .then(buffer => {
                const fakeResponse = {
                  headers: { get: name => name.toLowerCase() === "content-type" ? contentType : "" },
                  arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
                };
                return decodeResponseText(fakeResponse);
              })
              .then(text => {
                const parsed = parseRowsFromText(source, url, text, contentType);
                if (parsed.length) detailNetworkRows.push(...parsed);
              })
              .catch(error => {
                reports.push({ url: `browser-detail-response:${url}`, rows: 0, error: error.message });
              });
            detailResponsePromises.push(task);
          });
          try {
            await detailPage.goto(detailUrl, { waitUntil: "networkidle", timeout: 60000 });
            await detailPage.waitForTimeout(800);
            await Promise.allSettled(detailResponsePromises);
            const detailText = await detailPage.evaluate(() => document.body ? (document.body.innerText || document.body.textContent || "") : "");
            detailRows.push(...rowsFromRawText(source, detailUrl, detailText));
            detailRows.push(...detailNetworkRows);
            const detailPageRows = await detailPage.evaluate(() => {
              const text = element => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
              const parsed = [];
              for (const table of document.querySelectorAll("table")) {
                const rawRows = [...table.querySelectorAll("tr")]
                  .map(tr => [...tr.querySelectorAll("th,td")].map(cell => text(cell)))
                  .filter(row => row.some(Boolean));
                if (rawRows.length < 2) continue;
                let headerIndex = rawRows.findIndex(row => row.some(cell => /公司|證券|股票|代號|簡稱|名稱|買賣日期|登錄日期/.test(cell)));
                if (headerIndex < 0) headerIndex = 0;
                const headers = rawRows[headerIndex];
                for (const row of rawRows.slice(headerIndex + 1)) {
                  parsed.push(Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
                }
              }
              return parsed;
            });
            detailRows.push(...detailPageRows);
          } catch (error) {
            reports.push({ url: `browser-detail:${detailUrl}`, rows: 0, error: error.message });
          } finally {
            await detailPage.close().catch(() => {});
          }
        }

        rows.push(...networkRows, ...pageRows, ...expandedDateRows);
        rows.push(...detailRows);
        reports.push(...networkReports);
        reports.push({ url: `browser-dom:${pageUrl}`, rows: pageRows.length });
        if (dateIndexes.length) reports.push({ url: `browser-date-indexes:${pageUrl}`, rows: dateIndexes.length });
        if (expandedDateRows.length) reports.push({ url: `browser-date-expanded:${pageUrl}`, rows: expandedDateRows.length });
        if (matchingDetailLinks.length) reports.push({ url: `browser-detail-links:${pageUrl}`, rows: matchingDetailLinks.length });
        if (detailRows.length) reports.push({ url: `browser-detail-rows:${pageUrl}`, rows: detailRows.length });
      } catch (error) {
        reports.push({ url: `browser:${pageUrl}`, rows: 0, error: error.message });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { rows, reports };
}

async function fetchAutoFromFirstAvailable(source) {
  const errors = [];
  const urls = await discoveredSourceUrls(source);

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "text/html, application/json, text/csv, text/plain, */*",
          "User-Agent": "Mozilla/5.0 ipo-calendar-generator"
        }
      });

      if (!response.ok) {
        errors.push(`${url} HTTP ${response.status}`);
        continue;
      }

      const text = await decodeResponseText(response);
      const contentType = response.headers.get("content-type") || "";
      const trimmed = text.replace(/^﻿/, "").trim();
      let rows = [];

      if (/json/i.test(contentType) || /^[{[]/.test(trimmed)) {
        try {
          rows = objectRows(JSON.parse(trimmed));
        } catch {
          rows = [];
        }
      }

      if (!rows.length && !/^\s*</.test(trimmed)) {
        rows = parseCsv(trimmed);
      }

      if (!rows.length) {
        rows = parseHtmlTables(text);
      }

      if (!rows.length) {
        rows = parseEmbeddedJsonRows(text);
      }

      if (!rows.length) {
        errors.push(`${url} returned no parseable rows`);
        continue;
      }

      return { url, rows };
    } catch (error) {
      errors.push(`${url} ${error.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

function detectDelimiter(text) {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] || "";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;

  for (const delimiter of candidates) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index];
      const next = firstLine[index + 1];
      if (quoted && char === "\"" && next === "\"") {
        index += 1;
      } else if (char === "\"") {
        quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        count += 1;
      }
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  const pushValue = () => {
    row.push(value.replace(/^﻿/, ""));
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
    } else if (char === delimiter) {
      pushValue();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (row.length || value) pushRow();
  if (!rows.length) return [];

  const headerIndex = rows.findIndex(row => (
    row.length > 1
    && row.some(cell => /公司|證券|股票|代號|簡稱|名稱|買賣日期|登錄日期|掛牌日期|櫃檯買賣開始/i.test(String(cell || "")))
  ));
  const actualHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
  const headers = rows[actualHeaderIndex].map(header => String(header || "").trim());
  return rows.slice(actualHeaderIndex + 1)
    .filter(values => values.some(item => String(item || "").trim() !== ""))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

async function fetchCsvFromFirstAvailable(source) {
  const errors = [];
  const urls = await discoveredSourceUrls(source);

  for (const url of urls) {
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

      const text = await decodeResponseText(response);
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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function textFromHtmlCell(value) {
  return decodeHtml(String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function parseHtmlTables(text) {
  const rows = [];
  const tableMatches = [...String(text || "").matchAll(/<table[\s\S]*?<\/table>/gi)];
  const sources = tableMatches.length ? tableMatches.map(match => match[0]) : [String(text || "")];

  for (const table of sources) {
    const rawRows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map(match => [...match[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => textFromHtmlCell(cell[1])))
      .filter(row => row.some(cell => cell));

    if (rawRows.length < 2) continue;
    const headerIndex = rawRows.findIndex(row => row.some(cell => /公司代號|證券代號|股票代號/.test(cell)));
    const headers = rawRows[headerIndex >= 0 ? headerIndex : 0];

    for (const row of rawRows.slice((headerIndex >= 0 ? headerIndex : 0) + 1)) {
      rows.push(Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
    }
  }

  return rows;
}

async function fetchHtmlFromFirstAvailable(source) {
  const errors = [];
  const urls = await discoveredSourceUrls(source);

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "text/html, */*",
          "User-Agent": "Mozilla/5.0 ipo-calendar-generator"
        }
      });

      if (!response.ok) {
        errors.push(`${url} HTTP ${response.status}`);
        continue;
      }

      const text = await decodeResponseText(response);
      if (!/^\s*</.test(text)) {
        try {
          return { url, rows: objectRows(JSON.parse(text.replace(/^﻿/, ""))) };
        } catch {
          // Fall through to HTML table parsing error below.
        }
      }

      const rows = parseHtmlTables(text);
      if (!rows.length) {
        errors.push(`${url} returned no parseable tables`);
        continue;
      }
      return { url, rows };
    } catch (error) {
      errors.push(`${url} ${error.message}`);
    }
  }

  throw new Error(errors.join("\n"));
}

async function fetchRowsFromFirstAvailable(source) {
  const browserResult = await browserRowsForSource(source);
  let fetchedResult = { url: "", urlReports: [], rows: [] };
  try {
    fetchedResult = await fetchRowsFromAllAvailable(source);
  } catch (error) {
    if (!browserResult.rows.some(row => rowLooksLikeCandidate(source, normalizeRowForSource(source, row)))) throw error;
    fetchedResult = {
      url: "",
      urlReports: [{ url: "fetch-fallback", rows: 0, error: error.message }],
      rows: []
    };
  }
  return {
    url: [
      ...browserResult.reports.filter(report => report.rows > 0).map(report => report.url),
      fetchedResult.url
    ].filter(Boolean).join(", "),
    urlReports: [...browserResult.reports, ...(fetchedResult.urlReports || [])],
    rows: [...browserResult.rows, ...fetchedResult.rows]
  };
  if (source.type === "auto") return fetchAutoFromFirstAvailable(source);
  if (source.type === "csv") return fetchCsvFromFirstAvailable(source);
  if (source.type === "html") return fetchHtmlFromFirstAvailable(source);
  return fetchJsonFromFirstAvailable(source);
}

function normalizeCompany(source, row) {
  if (isNonListingSignalRow(source, row)) return null;

  const rawText = rowRawText(row);
  const listedDate = parseTaiwanDate(getValue(row, source.dateKeys)) || extractDateFromTextByKeys(rawText, source.dateKeys);
  if (!listedDate) return null;

  const code = normalizeStockCode(row);
  if (!code) return null;

  const name = normalizeCompanyName(row, code) || normalizeCompanyNameFromText(rawText, code);
  if (!name) return null;

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
      const normalizedRows = normalizeParsedRowsForSource(source, result.rows)
        .map(row => normalizeRowForSource(source, row))
        .filter(row => rowLooksLikeCandidate(source, row));
      const normalized = normalizedRows
        .map(row => normalizeCompany(source, row))
        .filter(Boolean);
      const codes = [...new Set(normalized.map(company => company.code).filter(Boolean))].sort();
      if (!normalized.length) {
        const samples = normalizedRows.slice(0, 5).map(row => Object.fromEntries(
          Object.entries(row || {}).slice(0, 12).map(([key, value]) => [key, String(value || "").slice(0, 120)])
        ));
        const error = new Error(`No rows contained a valid code, name, and target date. Parsed rows: ${result.rows.length}. Samples: ${JSON.stringify(samples)}`);
        error.urlReports = result.urlReports || [];
        error.rows = result.rows.length;
        throw error;
      }
      companies.push(...normalized);
      sourceReports.push({
        id: source.id,
        market: source.market,
        label: source.label,
        status: "ok",
        url: result.url,
        urlReports: result.urlReports || [],
        dateKeys: source.dateKeys,
        rows: result.rows.length,
        acceptedRows: normalized.length,
        codes: codes.slice(0, 80),
        moreCodes: Math.max(0, codes.length - 80)
      });
    } catch (error) {
      sourceReports.push({
        id: source.id,
        market: source.market,
        label: source.label,
        status: "failed",
        dateKeys: source.dateKeys,
        rows: error.rows || 0,
        acceptedRows: 0,
        urlReports: error.urlReports || [],
        message: error.message
      });
    }
  }

  return { companies: dedupeCompanies(companies), sourceReports };
}

function companyQuality(company) {
  let score = 0;
  if (company.code && !/^\d{1,2}$/.test(company.code)) score += 4;
  if (company.name && company.name !== company.code) score += 4;
  if (company.name && company.name.length <= 12) score += 2;
  if (company.underwriter) score += 1;
  if (company.note) score += 1;
  if (!/^mops-/.test(company.sourceId)) score += 1;
  return score;
}

function mergeCompany(existing, incoming) {
  const better = companyQuality(incoming) > companyQuality(existing) ? incoming : existing;
  const fallback = better === incoming ? existing : incoming;

  return {
    ...better,
    code: better.code || fallback.code,
    name: better.name && better.name !== better.code ? better.name : fallback.name,
    applicationDate: better.applicationDate || fallback.applicationDate,
    underwriter: better.underwriter || fallback.underwriter,
    price: better.price || fallback.price,
    note: better.note || fallback.note,
    sourceId: [existing.sourceId, incoming.sourceId].filter(Boolean).join(","),
    raw: better.raw
  };
}

function dedupeCompanies(companies) {
  const byKey = new Map();

  for (const company of companies) {
    const key = `${company.market}|${company.code}|${company.listedDate}`;
    byKey.set(key, byKey.has(key) ? mergeCompany(byKey.get(key), company) : company);
  }

  // When a company graduates from ESB (興櫃) to TPEX mainboard or TWSE, it remains
  // in the ESB dataset alongside the higher-market listing. Suppress ESB entries for
  // any code that also appears in TPEX or TWSE — a company can only trade on one
  // market at a time and the higher-market event is the relevant one.
  const higherMarketCodes = new Set(
    [...byKey.values()]
      .filter(c => c.market === "TWSE" || c.market === "TPEX")
      .map(c => c.code)
      .filter(Boolean)
  );
  for (const [key, company] of byKey) {
    if (company.market === "ESB" && higherMarketCodes.has(company.code)) {
      byKey.delete(key);
    }
  }

  return [...byKey.values()].sort((a, b) => a.listedDate.localeCompare(b.listedDate) || a.market.localeCompare(b.market));
}

function makeEvents(companies, fromDate, toDate) {
  const byKey = new Map();

  for (const company of companies) {
    if (!company.code || !/^\d{4,6}$/.test(company.code)) continue;
    const milestones = MARKET_MILESTONES[company.market] || MILESTONES;

    for (const milestone of milestones) {
      const rawDate = addMonths(company.listedDate, milestone.months);
      const date = milestone.months > 0 ? moveWeekendToMonday(rawDate) : rawDate;
      if (date < fromDate || date > toDate) continue;

      const milestoneLabel = company.market === "ESB"
        ? milestone.label.replace("掛牌", "登錄")
        : milestone.label;
      const title = `${company.name || company.code}(${company.code || "-"}) ${milestoneLabel}${company.marketLabel}`;
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

      const event = {
        uid: stableUid(company, milestone),
        title,
        date,
        endDate: addDays(date, 1),
        market: company.market,
        marketLabel: company.marketLabel,
        milestone: milestone.id,
        milestoneLabel,
        company,
        description
      };
      const eventKey = `${event.market}|${company.code}|${event.milestone}|${event.date}`;
      byKey.set(eventKey, event);
    }
  }

  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function stableUid(company, milestone) {
  const hash = crypto
    .createHash("sha1")
    .update(`${company.market}|${company.code}|${company.listedDate}|${milestone.id}`)
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
