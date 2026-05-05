# 免費發布成同事可看的網址

這個方案使用 GitHub Pages + GitHub Actions，不需要付費。你的電腦關機後，網站仍會保留；排程也會由 GitHub 在雲端執行。

## 你需要先做一次

1. 登入 GitHub。
2. 建立一個新的 public repository，例如 `stock-revenue-tracker`。
3. 把 repository 網址貼給 Codex，例如：

```text
https://github.com/你的帳號/stock-revenue-tracker
```

## 發布後會得到的網址

通常會是：

```text
https://你的帳號.github.io/stock-revenue-tracker/
```

## 追蹤股票清單

編輯 `tracked-stocks.json`：

```json
[
  "2330",
  "2317",
  "台達電"
]
```

每月 1 到 11 號台北時間 17:00，GitHub Actions 會自動抓公開資訊觀測站的前月營收並發布新版網頁。
