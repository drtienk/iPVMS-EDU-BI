# BI 應用 - 雙版本設置

## 📋 目錄結構

```
abc-bi-app/                    ✓ 原始版本 (英文)
abc-bi-app-chinese/            ✓ 新版本 (中英文混用)
```

---

## 🚀 開發環境啟動

### **原始 BI (英文版)**

用於上傳 **英文** Excel 檔案：

```bash
cd abc-bi-app
npm install              # 首次執行
npm run dev             # 啟動開發服務器 - localhost:5173
```

### **新 BI (中英文支持)**

用於上傳 **中文** 或 **中英文混用** 的 Excel 檔案：

```bash
cd abc-bi-app-chinese
npm install              # 首次執行
npm run dev             # 啟動開發服務器 - localhost:5174
```

---

## 📊 使用情況

| 檔案類型 | 使用版本 | 地址 |
|---------|---------|------|
| 英文（原始） | abc-bi-app | http://localhost:5173 |
| 中文 | abc-bi-app-chinese | http://localhost:5174 |
| 中英文混用 | abc-bi-app-chinese | http://localhost:5174 |

---

## ✅ 支持的欄位映射（中文版）

### CustomerProfitResult (最重要)

| 英文欄位 | 中文欄位 |
|---------|---------|
| CustomerID | 顧客代碼 |
| Customer | 顧客 |
| CustomerProfit | 客戶利潤 |
| Price | 銷貨收入 |
| ManufactureCost | 製造成本 |
| SalesProfit | 銷貨毛利 |
| ManagementCost | 銷貨作業成本 |
| ServiceCost | 資源直歸客戶成本 |
| TotalCost | 總銷貨成本 |
| CustomerProfitRatio | 客戶利潤率 |

### 其他基礎欄位

| 英文 | 中文 |
|-----|------|
| Year | 年 |
| Month | 月份 |
| PeriodNo | 期間資料版本 |
| Company | 公司 |
| Business Unit | 事業單位 |
| Activity Center | 作業中心 |
| Amount | 金額 |

---

## 🔧 技術改動（abc-bi-app-chinese 版本）

### 修改的文件：

1. **package.json**
   - 應用名稱改為 `abc-bi-app-chinese`

2. **vite.config.ts**
   - 開發伺服器端口改為 `5174`

3. **src/parseExcel.ts**
   - 新增 `FIELD_ALIASES` 欄位對應表
   - 更新 `trimKeys()` 函數自動添加中文欄位別名
   - 更新 `isSheetValid()` 支持中文欄位驗証

4. **src/normalize.ts**
   - 新增 `FIELD_ALIASES` 欄位別名表
   - 新增 `getFieldValue()` 通用欄位查詢函數
   - 更新所有 `get*()` 函數使用 `getFieldValue()` 來支持中英文混用

---

## ⚠️ 重要說明

- ✓ **原版 BI 保持不變**：不會影響現有的英文檔上傳
- ✓ **兩版本獨立**：可同時運行，互不影響
- ✓ **自動偵測**：中文版自動判斷欄位是英文還是中文
- ✓ **向後相容**：中文版仍支持英文欄位名稱

---

## 🧪 測試步驟

1. **啟動原版**：`npm run dev` (port 5173)
2. **上傳原始英文檔** → 應該正常工作
3. **啟動新版**：`cd abc-bi-app-chinese && npm run dev` (port 5174)
4. **上傳中文檔** → 應該正常工作
5. **上傳中英文混用檔** → 應該正常工作

---

## 📝 後續計劃

- [ ] 驗證中文版是否支持所有類型的 Excel 檔
- [ ] 確認兩版本的計算結果一致
- [ ] 如無問題，考慮合併回單一版本或保持雙版本
