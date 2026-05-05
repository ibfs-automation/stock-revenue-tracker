# 台股月營收追蹤

這個網頁會讓你輸入台股代號或名稱，並用公開資訊觀測站的「月營業收入資訊」查詢前月營收。

## 使用方式

1. 安裝 Node.js 18 以上。
2. 在這個資料夾執行 `npm start`。
3. 開啟 `http://localhost:3000`。

## 免費分享給同事

### 方案 A：同一台電腦開著時分享

這個做法不需要付費雲端。請選一台會保持開機的電腦當主機，其他同事必須在同一個公司內網或 Wi-Fi。

1. 在主機電腦安裝 Node.js 18 以上。
2. 雙擊 `start-share.bat`。
3. 視窗會顯示可以分享的網址，例如 `http://192.168.1.20:3000`。
4. 把這個網址傳給同事。

如果同事打不開，通常是 Windows 防火牆擋住了。請在主機電腦允許 Node.js 通過私人網路，或請資訊同仁開放 TCP 連接埠 `3000`。

注意：主機電腦關機、睡眠、斷網，網站和自動更新都會停止。

### 方案 B：電腦關機也能跑，使用 GitHub Pages

這個做法不需要付費主機。網站會放在 GitHub Pages，排程由 GitHub Actions 在雲端執行。

限制：免費版沒有自己的後端資料庫，所以追蹤清單請維護 `tracked-stocks.json`，同事看得到網站，但不能直接在網站上永久新增股票。

1. 建立一個 GitHub repository。
2. 上傳本資料夾所有檔案。
3. 到 repository 的 Settings > Pages。
4. Build and deployment 的 Source 選 `GitHub Actions`。
5. 到 Actions 頁面執行 `Update revenue data and publish Pages`。
6. 發布完成後，把 GitHub Pages 網址傳給同事。

每月 1 到 11 號台北時間 17:00，GitHub Actions 會自動抓取前月營收並發布新版網頁。台北時間 17:00 等於 UTC 09:00，所以 workflow 使用 `0 9 1-11 * *`。

要改追蹤股票時，編輯 `tracked-stocks.json`，例如：

```json
[
  "2330",
  "2317",
  "台達電"
]
```

## 自動更新規則

- 時區：Asia/Taipei。
- 每月 1 到 11 號，下午 5 點後每日自動檢查一次。
- 目標月份永遠是前一個月，例如 5 月會查 4 月營收。
- 只有公開資訊觀測站回傳的資料月份等於目標月份時，頁面才會標記為「已更新」。
- 每筆資料會保存官方回傳時間、查詢時間、來源頁面、來源 API 與官方原始資料欄位。

資料會存在 `data/revenue-tracker.json`。
