const rows = document.querySelector("#stockRows");
const addForm = document.querySelector("#addForm");
const stockQuery = document.querySelector("#stockQuery");
const refreshBtn = document.querySelector("#refreshBtn");
const targetLabel = document.querySelector("#targetLabel");
const pageStatus = document.querySelector("#pageStatus");
const shareUrl = document.querySelector("#shareUrl");
const announcement = document.querySelector("#announcement");
const announcementTitle = document.querySelector("#announcementTitle");
const dailyUpdates = document.querySelector("#dailyUpdates");
const orphanedSection = document.querySelector("#orphanedSection");
const orphanedNames = document.querySelector("#orphanedNames");
const pendingCount = document.querySelector("#pendingCount");
const pendingNames = document.querySelector("#pendingNames");
const excelDownload = document.querySelector("#excelDownload");
const excelTitle = document.querySelector("#excelTitle");
const excelLink = document.querySelector("#excelLink");

const formatter = new Intl.NumberFormat("zh-TW");

function money(value) {
  if (!value) return "尚無資料";
  const number = Number(String(value).replaceAll(",", ""));
  if (!Number.isFinite(number)) return value;
  return `${formatter.format(number)} 千元`;
}

function pct(value) {
  if (!value) return "尚無資料";
  return `${value}%`;
}

function statusText(stock) {
  if (stock.lastStatus === "updated") return "已更新";
  if (stock.lastStatus === "error") return "查詢錯誤";
  if (stock.lastStatus === "new") return "尚未查詢";
  return "尚未公布";
}

function statusClass(stock) {
  if (stock.lastStatus === "updated") return "updated";
  if (stock.lastStatus === "error") return "error";
  return "pending";
}

function render(snapshot) {
  targetLabel.textContent = snapshot.target ? snapshot.target.label : "讀取中";
  pageStatus.textContent = snapshot.stocks.length ? `追蹤 ${snapshot.stocks.length} 檔` : "尚未加入股票";
  const networkUrl = snapshot.share && snapshot.share.networkUrls && snapshot.share.networkUrls[0];
  shareUrl.textContent = networkUrl || (snapshot.mode === "github-pages" ? "GitHub Pages" : "同機使用");
  renderAnnouncement(snapshot.announcement);
  renderExcelDownload(snapshot.excelReport);

  if (!snapshot.stocks.length) {
    rows.innerHTML = '<tr><td colspan="8" class="empty">尚未加入股票</td></tr>';
    return;
  }

  rows.innerHTML = snapshot.stocks.map(stock => {
    const revenue = stock.revenue || {};
    const values = revenue.values || {};
    const officialTime = revenue.officialDatetime || "尚無";
    const message = stock.lastMessage ? `<span class="minor">${escapeHtml(stock.lastMessage)}</span>` : "";
    return `
      <tr>
        <td>
          <div class="stock-name">
            <strong>${escapeHtml(stockDisplayName(stock))}</strong>
            <span>${escapeHtml(revenue.marketKindName || stock.marketTitle || "")}</span>
          </div>
        </td>
        <td>${escapeHtml(revenue.targetLabel || (snapshot.target && snapshot.target.label) || "")}</td>
        <td>${escapeHtml(money(values["本月"]))}</td>
        <td>${escapeHtml(pct(values["增減百分比"]))}</td>
        <td>${escapeHtml(money(values["本年累計"]))}</td>
        <td>
          <span class="badge ${statusClass(stock)}">${statusText(stock)}</span>
          ${message}
        </td>
        <td>${escapeHtml(officialTime)}</td>
        <td><button class="remove-button" data-code="${escapeHtml(stock.code)}" title="移除">×</button></td>
      </tr>
    `;
  }).join("");
}

function stockDisplayName(stock) {
  const revenue = stock.revenue || {};
  const trackedName = stock.id && !/^\d+$/.test(String(stock.id)) ? stock.id : "";
  const name = revenue.companyAbbreviation || trackedName || stock.name || "";
  const code = stock.code || (stock.id && /^\d+$/.test(String(stock.id)) ? stock.id : "");

  if (name && code && name !== code) return `${name}(${code})`;
  return name || code || "";
}

function renderExcelDownload(report) {
  if (!report || !report.available || !report.file) {
    excelDownload.hidden = true;
    return;
  }

  excelDownload.hidden = false;
  excelTitle.textContent = `${report.targetLabel || "本月"} 月營收 Excel`;
  excelLink.href = report.file;
  excelLink.download = report.file.split("/").pop() || "";
}

function renderAnnouncement(data) {
  if (!data) {
    announcement.hidden = true;
    return;
  }

  announcement.hidden = false;
  announcementTitle.textContent = data.headline || "截止今日17:00";
  dailyUpdates.innerHTML = formatDailyUpdates(data.dailyUpdates);

  // 顯示未分類到日期的已公布公司（timing 遺留）
  if (data.orphanedUpdatedCount > 0) {
    orphanedSection.hidden = false;
    orphanedNames.textContent = formatNameList(data.orphanedUpdatedNames);
  } else {
    orphanedSection.hidden = true;
  }

  pendingCount.textContent = data.pendingCount || 0;
  pendingNames.textContent = formatNameList(data.pendingNames);
}

function formatDailyUpdates(updates) {
  if (!Array.isArray(updates) || !updates.length) return "";

  return updates.map(item => `
    <p>
      <strong>${escapeHtml(item.dateLabel)}新增公告 ${Number(item.count) || 0}家，如下：</strong>
      <span>${escapeHtml(formatNameList(item.names))}</span>
    </p>
  `).join("");
}

function formatNameList(names) {
  return Array.isArray(names) && names.length ? names.join("、") : "無";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "操作失敗");
  return body;
}

async function load() {
  pageStatus.textContent = "讀取中";
  const snapshot = await loadSnapshot();
  render(snapshot);
}

async function loadSnapshot() {
  try {
    return await requestJson("/api/stocks");
  } catch (error) {
    return requestJson(`./data/revenue.json?t=${Date.now()}`);
  }
}

addForm.addEventListener("submit", async event => {
  event.preventDefault();
  const query = stockQuery.value.trim();
  if (!query) return;

  if (shareUrl.textContent === "GitHub Pages") {
    pageStatus.textContent = "免費雲端版請修改 tracked-stocks.json 後重新發布";
    return;
  }

  const button = addForm.querySelector("button");
  button.disabled = true;
  pageStatus.textContent = "查詢公開資訊觀測站";

  try {
    const result = await requestJson("/api/stocks", {
      method: "POST",
      body: JSON.stringify({ query })
    });
    stockQuery.value = "";
    render(result.snapshot);
  } catch (error) {
    pageStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  pageStatus.textContent = "正在檢查";

  try {
    const result = await requestJson("/api/refresh", { method: "POST" });
    render(result.snapshot);
  } catch (error) {
    pageStatus.textContent = error.message;
  } finally {
    refreshBtn.disabled = false;
  }
});

rows.addEventListener("click", async event => {
  const button = event.target.closest("[data-code]");
  if (!button) return;

  if (shareUrl.textContent === "GitHub Pages") {
    pageStatus.textContent = "雲端版請透過表單或 tracked-stocks.json 調整追蹤清單";
    return;
  }

  const code = button.dataset.code;
  button.disabled = true;

  try {
    const result = await requestJson(`/api/stocks/${encodeURIComponent(code)}`, {
      method: "DELETE"
    });
    render(result.snapshot);
  } catch (error) {
    pageStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

load().catch(error => {
  pageStatus.textContent = error.message;
});
