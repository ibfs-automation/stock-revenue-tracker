const http = require("http");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "revenue-tracker.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const MOPS_API_BASE = "https://mops.twse.com.tw/mops/api";
const MOPS_PAGE_URL = "https://mops.twse.com.tw/mops/#/web/t05st10_ifrs";

const state = {
  stocks: [],
  runs: {},
  updatedAt: null
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
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

function createInitialState() {
  return {
    stocks: [],
    runs: {},
    updatedAt: taipeiParts().isoLike
  };
}

function localNetworkUrls(port = PORT) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }

  return urls;
}

async function loadState() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    state.stocks = Array.isArray(parsed.stocks) ? parsed.stocks : [];
    state.runs = parsed.runs && typeof parsed.runs === "object" ? parsed.runs : {};
    state.updatedAt = parsed.updatedAt || null;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    Object.assign(state, createInitialState());
    await saveState();
  }
}

async function saveState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  state.updatedAt = taipeiParts().isoLike;
  await fs.writeFile(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
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
  if (!keyword) throw new Error("請輸入股票代號或名稱。");

  const result = await mopsPost("KeywordsQuery", {
    queryFunction: false,
    keyword
  });
  const companies = flattenCompanyList(result);
  if (!companies.length) throw new Error("公開資訊觀測站查不到這個代號或名稱。");

  const exact = companies.find(company => company.code === keyword);
  return exact || companies[0];
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

async function fetchRevenueForStock(stock, target = targetRevenueMonth()) {
  const mopsResult = await mopsPost("t05st10_ifrs", {
    companyId: stock.code,
    dataType: "2",
    year: String(target.rocYear),
    month: String(target.month),
    subsidiaryCompanyId: ""
  });

  return normalizeRevenueResult(stock, target, mopsResult);
}

async function refreshOneStock(stock, target = targetRevenueMonth()) {
  try {
    const revenue = await fetchRevenueForStock(stock, target);
    stock.lastCheckedAt = revenue.checkedAt;
    stock.lastStatus = revenue.status;
    stock.lastMessage = revenue.reason || revenue.message || "";
    stock.revenue = revenue;
  } catch (error) {
    stock.lastCheckedAt = taipeiParts().isoLike;
    stock.lastStatus = "error";
    stock.lastMessage = error.message;
    stock.revenue = {
      status: "error",
      verified: false,
      targetYymm: target.yymm,
      targetLabel: target.label,
      checkedAt: stock.lastCheckedAt,
      reason: error.message,
      sourceName: "公開資訊觀測站",
      sourceUrl: MOPS_PAGE_URL
    };
  }
}

async function refreshAllStocks(trigger = "manual") {
  const target = targetRevenueMonth();
  for (const stock of state.stocks) {
    await refreshOneStock(stock, target);
  }
  await saveState();
  return {
    trigger,
    target,
    count: state.stocks.length,
    checkedAt: taipeiParts().isoLike
  };
}

async function addStock(query) {
  const company = await resolveCompany(query);
  const existing = state.stocks.find(stock => stock.code === company.code);
  if (existing) return existing;

  const stock = {
    id: company.code,
    code: company.code,
    name: company.name,
    marketTitle: company.marketTitle,
    createdAt: taipeiParts().isoLike,
    lastStatus: "new",
    lastMessage: "尚未查詢"
  };
  state.stocks.push(stock);
  await refreshOneStock(stock);
  await saveState();
  return stock;
}

async function removeStock(code) {
  const before = state.stocks.length;
  state.stocks = state.stocks.filter(stock => stock.code !== code);
  await saveState();
  return before !== state.stocks.length;
}

async function maybeRunScheduledCheck() {
  const now = taipeiParts();
  if (now.day < 1 || now.day > 11 || now.hour < 17) return;

  const key = `${now.dateKey}-17`;
  if (state.runs[key]) return;

  state.runs[key] = {
    startedAt: now.isoLike,
    status: "running"
  };
  await saveState();

  try {
    const result = await refreshAllStocks("scheduled");
    state.runs[key] = {
      ...state.runs[key],
      ...result,
      status: "done",
      finishedAt: taipeiParts().isoLike
    };
  } catch (error) {
    state.runs[key] = {
      ...state.runs[key],
      status: "error",
      error: error.message,
      finishedAt: taipeiParts().isoLike
    };
  }
  await saveState();
}

function snapshot() {
  return {
    stocks: state.stocks,
    target: targetRevenueMonth(),
    schedule: {
      timeZone: TAIPEI_TIME_ZONE,
      window: "每月 1 到 11 號，下午 5 點後每日自動檢查一次",
      source: "公開資訊觀測站月營業收入資訊"
    },
    share: {
      localUrl: `http://localhost:${PORT}`,
      networkUrls: localNetworkUrls()
    },
    updatedAt: state.updatedAt
  };
}

async function serveStatic(requestUrl, response) {
  const safePath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(file);
  } catch (error) {
    sendText(response, 404, "Not found");
  }
}

async function handleApi(request, response, requestUrl) {
  try {
    if (request.method === "GET" && requestUrl.pathname === "/api/stocks") {
      sendJson(response, 200, snapshot());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/stocks") {
      const body = await readJsonBody(request);
      const stock = await addStock(body.query);
      sendJson(response, 201, { stock, snapshot: snapshot() });
      return;
    }

    if (request.method === "DELETE" && requestUrl.pathname.startsWith("/api/stocks/")) {
      const code = decodeURIComponent(requestUrl.pathname.split("/").pop());
      const removed = await removeStock(code);
      sendJson(response, removed ? 200 : 404, { removed, snapshot: snapshot() });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/refresh") {
      const result = await refreshAllStocks("manual");
      sendJson(response, 200, { result, snapshot: snapshot() });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  if (requestUrl.pathname.startsWith("/api/")) {
    await handleApi(request, response, requestUrl);
    return;
  }
  await serveStatic(requestUrl, response);
}

async function start() {
  await loadState();
  await maybeRunScheduledCheck();
  setInterval(() => {
    maybeRunScheduledCheck().catch(error => {
      console.error("Scheduled check failed:", error);
    });
  }, 60 * 1000);

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => {
      sendJson(response, 500, { error: error.message });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Taiwan stock revenue tracker is running at http://localhost:${PORT}`);
    const urls = localNetworkUrls();
    if (urls.length) {
      console.log("Share with coworkers on the same network:");
      for (const url of urls) console.log(`  ${url}`);
    } else {
      console.log("No local network address was detected yet.");
    }
  });

  return server;
}

if (require.main === module) {
  start().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  addStock,
  fetchRevenueForStock,
  loadState,
  refreshAllStocks,
  resolveCompany,
  start,
  targetRevenueMonth,
  taipeiParts
};
