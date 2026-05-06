const fs = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TRACKED_STOCKS_PATH = path.join(ROOT, "tracked-stocks.json");
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "revenue.json");
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const MOPS_API_BASE = "https://mops.twse.com.tw/mops/api";
const MOPS_PAGE_URL = "https://mops.twse.com.tw/mops/#/web/t05st10_ifrs";

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    isoLike: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`
  };
}

function targetRevenueMonth(date = new Date()) {
  const now = taipeiParts(date);
  let year = now.year;
  let month = now.month - 1;
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  const rocYear = year - 1911;
  return {
    westernYear: year,
    rocYear,
    month,
    yymm: `${rocYear}${String(month).padStart(2, "0")}`,
    label: `${year} 年 ${month} 月`
  };
}

async function mopsPost(apiName, body) {
  const response = await fetch(`${MOPS_API_BASE}/${apiName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://mops.twse.com.tw",
      "Referer": MOPS_PAGE_URL
    },
    body: JSON.stringify(body),
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`MOPS HTTP ${response.status}`);
  }

  return response.json();
}

function flattenCompanyList(result) {
  const groups = result && result.result && result.result.companyList;
  if (!Array.isArray(groups)) return [];

  return groups.flatMap(group => {
    const rows = Array.isArray(group.data) ? group.data : [];
    return rows.map(item => {
      const text = String(item.result || "").trim();
      const match = text.match(/^(\d{4,6})\s+(.+)$/);
      return {
        code: match ? match[1] : text.split(/\s+/)[0],
        name: match ? match[2] : text,
        marketTitle: group.title || "",
        rawText: text
      };
    });
  });
}

async function resolveCompany(query) {
  const keyword = String(query || "").trim();
  if (!keyword) throw new Error("Empty stock query");

  const result = await mopsPost("KeywordsQuery", {
    queryFunction: false,
    keyword
  });
  const companies = flattenCompanyList(result);
  if (!companies.length) throw new Error(`MOPS cannot find stock: ${keyword}`);

  return companies.find(company => company.code === keyword) || companies[0];
}

function dataPairsToObject(data) {
  const out = {};
  if (!Array.isArray(data)) return out;
  for (const row of data) {
    if (Array.isArray(row) && row.length >= 2) out[row[0]] = row[1];
  }
  return out;
}

function normalizeRevenueResult(company, target, mopsResult) {
  const now = taipeiParts().isoLike;
  const base = {
    sourceName: "公開資訊觀測站",
    sourceUrl: MOPS_PAGE_URL,
    sourceApi: `${MOPS_API_BASE}/t05st10_ifrs`,
    targetYymm: target.yymm,
    targetLabel: target.label,
    checkedAt: now,
    officialDatetime: mopsResult.datetime || null,
    message: mopsResult.message || ""
  };

  if (mopsResult.code !== 200 || !mopsResult.result) {
    return {
      ...base,
      status: "pending",
      verified: false,
      reason: mopsResult.message || "尚未公布"
    };
  }

  const reportedYymm = String(mopsResult.result.yymm || "");
  if (reportedYymm !== target.yymm) {
    return {
      ...base,
      status: "pending",
      verified: false,
      reportedYymm,
      reason: `官方回傳資料月份為 ${reportedYymm || "未知"}，不是目標月份 ${target.yymm}。`
    };
  }

  return {
    ...base,
    status: "updated",
    verified: true,
    reportedYymm,
    companyAbbreviation: mopsResult.result.companyAbbreviation || company.name,
    marketKindName: mopsResult.result.marketKindName || company.marketTitle,
    values: dataPairsToObject(mopsResult.result.data),
    rawData: mopsResult.result.data || [],
    note: mopsResult.result.note || ""
  };
}

async function fetchRevenueForStock(stock, target) {
  const mopsResult = await mopsPost("t05st10_ifrs", {
    companyId: stock.code,
    dataType: "2",
    year: String(target.rocYear),
    month: String(target.month),
    subsidiaryCompanyId: ""
  });

  return normalizeRevenueResult(stock, target, mopsResult);
}

async function readTrackedStocks() {
  const raw = await fs.readFile(TRACKED_STOCKS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("tracked-stocks.json must be an array");
  return [...new Set(parsed.map(item => String(item).trim()).filter(Boolean))];
}

async function readPreviousSnapshot() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function displayName(stock) {
  return (
    (stock.revenue && stock.revenue.companyAbbreviation) ||
    stock.name ||
    stock.code ||
    stock.id ||
    ""
  );
}

function mergeUnique(left, right) {
  return [...new Set([...(left || []), ...(right || [])].filter(Boolean))];
}

function buildAnnouncement(stocks, target, previousSnapshot) {
  const previousByCode = new Map();
  for (const stock of previousSnapshot && Array.isArray(previousSnapshot.stocks) ? previousSnapshot.stocks : []) {
    if (stock && stock.code) previousByCode.set(String(stock.code), stock);
  }

  const updatedStocks = stocks.filter(stock => stock.lastStatus === "updated");
  const previousDailyUpdates = previousSnapshot &&
    previousSnapshot.announcement &&
    Array.isArray(previousSnapshot.announcement.dailyUpdates)
    ? previousSnapshot.announcement.dailyUpdates
    : [];
  const hasAnyDailyAnnouncement = previousDailyUpdates.some(item =>
    Array.isArray(item.names) && item.names.length > 0
  );

  const newlyUpdated = hasAnyDailyAnnouncement
    ? updatedStocks.filter(stock => {
        const previous = previousByCode.get(String(stock.code));
        return !previous ||
          previous.lastStatus !== "updated" ||
          !previous.revenue ||
          previous.revenue.reportedYymm !== stock.revenue.reportedYymm;
      })
    : updatedStocks;

  const pending = stocks.filter(stock => stock.lastStatus !== "updated");
  const now = taipeiParts();
  const todayKey = `${now.month}/${now.day}`;
  const previousDailyUpdates = previousSnapshot &&
  const dailyByDate = new Map(previousDailyUpdates.map(item => [item.dateLabel, item]));
  const todayExisting = dailyByDate.get(todayKey);
  const todayNames = mergeUnique(
    todayExisting && todayExisting.names,
    newlyUpdated.map(displayName)
  );

  dailyByDate.set(todayKey, {
    dateLabel: todayKey,
    count: todayNames.length,
    names: todayNames
  });

  const dailyUpdates = Array.from({ length: 11 }, (_, index) => {
    const dateLabel = `${now.month}/${index + 1}`;
    const item = dailyByDate.get(dateLabel);
    return item || {
      dateLabel,
      count: 0,
      names: []
    };
  });

  return {
    generatedAt: now.isoLike,
    headline: `截止今日17:00 ${target.month}月月營收`,
    newlyUpdatedCount: newlyUpdated.length,
    newlyUpdatedNames: newlyUpdated.map(displayName).filter(Boolean),
    dailyUpdates,
    pendingCount: pending.length,
    pendingNames: pending.map(displayName).filter(Boolean)
  };
}

async function buildSnapshot() {
  const previousSnapshot = await readPreviousSnapshot();
  const target = targetRevenueMonth();
  const queries = await readTrackedStocks();
  const stocks = [];

  for (const query of queries) {
    try {
      const company = await resolveCompany(query);
      const revenue = await fetchRevenueForStock(company, target);
      stocks.push({
        id: company.code,
        code: company.code,
        name: company.name,
        marketTitle: company.marketTitle,
        lastCheckedAt: revenue.checkedAt,
        lastStatus: revenue.status,
        lastMessage: revenue.reason || revenue.message || "",
        revenue
      });
    } catch (error) {
      stocks.push({
        id: query,
        code: query,
        name: query,
        marketTitle: "",
        lastCheckedAt: taipeiParts().isoLike,
        lastStatus: "error",
        lastMessage: error.message,
        revenue: {
          status: "error",
          verified: false,
          targetYymm: target.yymm,
          targetLabel: target.label,
          checkedAt: taipeiParts().isoLike,
          reason: error.message,
          sourceName: "公開資訊觀測站",
          sourceUrl: MOPS_PAGE_URL
        }
      });
    }
  }

  return {
    mode: "github-pages",
    stocks,
    target,
    announcement: buildAnnouncement(stocks, target, previousSnapshot),
    schedule: {
      timeZone: TAIPEI_TIME_ZONE,
      window: "每月 1 到 11 號，下午 5 點後每日自動檢查一次",
      source: "公開資訊觀測站月營業收入資訊"
    },
    share: {
      localUrl: "",
      networkUrls: []
    },
    updatedAt: taipeiParts().isoLike
  };
}

async function main() {
  const snapshot = await buildSnapshot();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Tracked stocks: ${snapshot.stocks.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
