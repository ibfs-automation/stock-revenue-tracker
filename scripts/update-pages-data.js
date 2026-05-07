const fs = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TRACKED_STOCKS_PATH = path.join(ROOT, "tracked-stocks.json");
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "revenue.json");
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const MOPS_API_BASE = "https://mops.twse.com.tw/mops/api";
const MOPS_PAGE_URL = "https://mops.twse.com.tw/mops/#/web/t05st10_ifrs";
const FORM_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSdHksE_5L1Tp8ufBSfT3fsytyRh_PQxvCsAQ5LE9hAClgLP6xuK2H8VY4acOm5MAOc9Kzm3yDpa5i1/pub?gid=865931488&single=true&output=csv";

const COMPANY_PROFILE_URLS = [
  "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
  "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv",
  "https://mopsfin.twse.com.tw/opendata/t187ap03_R.csv"
];
const MANUAL_BASELINES = {
  "11504": {
    baselineUpdatedCodes: ["3675", "8098", "1560", "3305", "9958", "6672", "4441"],
    dailyUpdates: [
      { dateLabel: "5/1", count: 0, names: [] },
      { dateLabel: "5/2", count: 0, names: [] },
      { dateLabel: "5/3", count: 0, names: [] },
      { dateLabel: "5/4", count: 0, names: [] },
      { dateLabel: "5/5", count: 0, names: [] },
      {
        dateLabel: "5/6",
        count: 7,
        names: [
          "德微(3675)",
          "慶康科技(8098)",
          "中砂(1560)",
          "昇貿(3305)",
          "世紀鋼(9958)",
          "騰輝電子-KY(6672)",
          "振大環球(4441)"
        ]
      },
      { dateLabel: "5/7", count: 0, names: [] },
      { dateLabel: "5/8", count: 0, names: [] },
      { dateLabel: "5/9", count: 0, names: [] },
      { dateLabel: "5/10", count: 0, names: [] },
      { dateLabel: "5/11", count: 0, names: [] }
    ]
  }
};

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(value);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);

  const headers = rows.shift() || [];

  return rows.map(cells => Object.fromEntries(
    headers.map((header, index) => [
      String(header || "").trim(),
      String(cells[index] || "").trim()
    ])
  ));
}

function decodeCsvBuffer(buffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("�")) return utf8;

  try {
    return new TextDecoder("big5").decode(buffer);
  } catch (error) {
    return utf8;
  }
}

async function fetchCsv(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  if (!response.ok) {
    throw new Error(`CSV HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return parseCsv(decodeCsvBuffer(buffer));
}

async function readCompanyProfiles() {
  const profilesByCode = new Map();
  const profilesByName = new Map();

  for (const url of COMPANY_PROFILE_URLS) {
    try {
      const rows = await fetchCsv(url);

      for (const row of rows) {
        const code = String(row["公司代號"] || "").trim();
        const fullName = String(row["公司名稱"] || "").trim();
        const abbreviation = String(row["公司簡稱"] || "").trim();
        const industry = String(row["產業別"] || "").trim();

        if (!code) continue;

        const profile = {
          code,
          fullName,
          abbreviation: abbreviation || fullName || code,
          industry
        };

        profilesByCode.set(code, profile);

        for (const alias of [code, fullName, abbreviation]) {
          if (alias) profilesByName.set(String(alias).trim(), profile);
        }
      }
    } catch (error) {
      console.warn(`Cannot load company profile: ${url}`);
    }
  }

  return { profilesByCode, profilesByName };
}

function profileToCompany(profile) {
  return {
    code: profile.code,
    name: profile.abbreviation || profile.fullName || profile.code,
    legalName: profile.fullName || "",
    marketTitle: profile.industry || "",
    rawText: `${profile.code} ${profile.abbreviation || profile.fullName || ""}`.trim()
  };
}

function applyCompanyProfile(company, companyProfiles) {
  const profile = companyProfiles &&
    companyProfiles.profilesByCode.get(String(company.code));

  if (!profile) return company;

  return {
    ...company,
    legalName: company.name,
    name: profile.abbreviation || company.name,
    marketTitle: profile.industry || company.marketTitle
  };
}

function stockKey(query, companyProfiles) {
  const key = String(query || "").trim();
  const profile = companyProfiles && companyProfiles.profilesByName.get(key);
  return profile ? profile.code : key;
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

async function resolveCompany(query, companyProfiles) {
  const keyword = String(query || "").trim();
  if (!keyword) throw new Error("Empty stock query");

  const profile = companyProfiles && companyProfiles.profilesByName.get(keyword);
  if (profile) return profileToCompany(profile);

  const result = await mopsPost("KeywordsQuery", {
    queryFunction: false,
    keyword
  });

  const companies = flattenCompanyList(result);
  if (!companies.length) throw new Error(`MOPS cannot find stock: ${keyword}`);

  const company = companies.find(item => item.code === keyword) || companies[0];
  return applyCompanyProfile(company, companyProfiles);
}

function dataPairsToObject(data) {
  const out = {};
  if (!Array.isArray(data)) return out;

  for (const row of data) {
    if (Array.isArray(row) && row.length >= 2) out[row[0]] = row[1];
  }

  return out;
}

function shortCompanyName(company, mopsResult) {
  return (
    company.name ||
    mopsResult.result.companyAbbreviation ||
    company.legalName ||
    company.code ||
    ""
  );
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
    companyAbbreviation: shortCompanyName(company, mopsResult),
    marketKindName: company.marketTitle || mopsResult.result.marketKindName || "",
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

async function readFormOperations() {
  if (!FORM_CSV_URL) return [];

  try {
    return await fetchCsv(FORM_CSV_URL);
  } catch (error) {
    console.warn(`Cannot load Google Form CSV: ${error.message}`);
    return [];
  }
}

async function readTrackedStocks(companyProfiles) {
  const raw = await fs.readFile(TRACKED_STOCKS_PATH, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("tracked-stocks.json must be an array");
  }

  const selected = new Map();

  for (const item of parsed) {
    const query = String(item).trim();
    if (!query) continue;
    selected.set(stockKey(query, companyProfiles), query);
  }

  const operations = await readFormOperations();

  for (const row of operations) {
    const action = String(row["操作"] || "").trim();
    const query = String(row["股票代號或簡稱"] || "").trim();

    if (!query) continue;

    const key = stockKey(query, companyProfiles);

    if (action === "新增") {
      selected.set(key, query);
    }

    if (action === "刪除") {
      selected.delete(key);
    }
  }

  return [...selected.values()];
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
  const id = String(stock.id || "");
  const isCodeId = /^\d+$/.test(id);
  const trackedName = id && !isCodeId ? id : "";
  const code = stock.code || (isCodeId ? id : "");

  const name = (
    (stock.revenue && stock.revenue.companyAbbreviation) ||
    stock.name ||
    trackedName ||
    ""
  );

  if (name && code && name !== code) return `${name}(${code})`;
  return name || code || "";
}

function mergeUnique(left, right) {
  return [...new Set([...(left || []), ...(right || [])].filter(Boolean))];
}

function buildAnnouncement(stocks, target, previousSnapshot) {
  const now = taipeiParts();
  const pending = stocks.filter(stock => stock.lastStatus !== "updated");
  const updatedStocks = stocks.filter(stock => stock.lastStatus === "updated");

  const previousAnnouncement = previousSnapshot && previousSnapshot.announcement
    ? previousSnapshot.announcement
    : {};

  const sameTargetMonth = previousSnapshot &&
    previousSnapshot.target &&
    previousSnapshot.target.yymm === target.yymm;

  const manualBaseline = MANUAL_BASELINES[target.yymm] || null;
  const previousHasBaseline = sameTargetMonth &&
    Array.isArray(previousAnnouncement.baselineUpdatedCodes);

  const previousDailyUpdates = previousHasBaseline &&
    Array.isArray(previousAnnouncement.dailyUpdates)
    ? previousAnnouncement.dailyUpdates
    : manualBaseline
      ? manualBaseline.dailyUpdates
      : [];

  let previousBaselineCodes;

  if (previousHasBaseline) {
    previousBaselineCodes = new Set(
      previousAnnouncement.baselineUpdatedCodes.map(String)
    );
  } else if (manualBaseline) {
    previousBaselineCodes = new Set(
      manualBaseline.baselineUpdatedCodes.map(String)
    );
  } else if (sameTargetMonth && Array.isArray(previousSnapshot.stocks)) {
    previousBaselineCodes = new Set(
      previousSnapshot.stocks
        .filter(stock => stock && stock.lastStatus === "updated")
        .map(stock => String(stock.code))
    );
  } else {
    previousBaselineCodes = new Set();
  }

  const dailyByDate = new Map();

  for (let day = 1; day <= 11; day++) {
    const dateLabel = `${now.month}/${day}`;
    const previous = previousDailyUpdates.find(item => item.dateLabel === dateLabel);

    dailyByDate.set(dateLabel, {
      dateLabel,
      count: previous && Array.isArray(previous.names) ? previous.names.length : 0,
      names: previous && Array.isArray(previous.names) ? previous.names : []
    });
  }

  const todayKey = `${now.month}/${now.day}`;
  const canRecordToday = now.day >= 1 && now.day <= 11 && now.hour >= 17;
  let baselineUpdatedCodes = new Set(previousBaselineCodes);

  if (!canRecordToday && dailyByDate.has(todayKey)) {
    dailyByDate.set(todayKey, {
      dateLabel: todayKey,
      count: 0,
      names: []
    });
  }

  if (canRecordToday && dailyByDate.has(todayKey)) {
    const newlyUpdated = updatedStocks.filter(stock =>
      !previousBaselineCodes.has(String(stock.code))
    );

    const today = dailyByDate.get(todayKey);
    today.names = mergeUnique(today.names, newlyUpdated.map(displayName));
    today.count = today.names.length;

    baselineUpdatedCodes = new Set(
      updatedStocks.map(stock => String(stock.code))
    );
  }

  const dailyUpdates = Array.from(dailyByDate.values());
  const displayNameByAlias = new Map();

  for (const stock of stocks) {
    const formatted = displayName(stock);

    const aliases = [
      stock.id,
      stock.code,
      stock.name,
      stock.legalName,
      stock.revenue && stock.revenue.companyAbbreviation
    ].filter(Boolean);

    for (const alias of aliases) {
      displayNameByAlias.set(String(alias), formatted);
    }
  }

  for (const item of dailyUpdates) {
    item.names = mergeUnique([], item.names.map(name =>
      displayNameByAlias.get(String(name)) || name
    ));
    item.count = item.names.length;
  }

  return {
    generatedAt: now.isoLike,
    headline: `${canRecordToday ? "截止今日17:00" : "尚未到今日17:00"} ${target.month}月月營收`,
    newlyUpdatedCount: updatedStocks.length,
    newlyUpdatedNames: updatedStocks.map(displayName).filter(Boolean),
    dailyUpdates,
    pendingCount: pending.length,
    pendingNames: pending.map(displayName).filter(Boolean),
    baselineTargetYymm: target.yymm,
    baselineUpdatedCodes: [...baselineUpdatedCodes]
  };
}

async function buildSnapshot() {
  const previousSnapshot = await readPreviousSnapshot();
  const target = targetRevenueMonth();
  const companyProfiles = await readCompanyProfiles();
  const queries = await readTrackedStocks(companyProfiles);
  const stocks = [];

  for (const query of queries) {
    try {
      const company = await resolveCompany(query, companyProfiles);
      const revenue = await fetchRevenueForStock(company, target);

      stocks.push({
        id: query,
        code: company.code,
        name: company.name,
        legalName: company.legalName || "",
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
        legalName: "",
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
