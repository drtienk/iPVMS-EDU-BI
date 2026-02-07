# ABC BI App – Project Status & Handover

## 【Project Status - 2026-02-07】

本文件為**完整交接文件**，供未接觸過本專案的新開發者或 AI Agent 快速理解系統、架構、功能位置與修改方式。所有描述皆對應實際程式碼與檔案路徑，便於後續維護與擴充。

---

## 1. Project Overview

### 1.1 Business Purpose

- **ABC BI App** 是一套**前端 BI（商業智慧）儀表板與下鑽分析**應用。
- 主要用途：上傳 Excel（.xlsx）中的**多張工作表**，經解析與正規化後存入**瀏覽器本機 IndexedDB**，並提供：
  - **顧客總覽儀表板**：多期間的總獲利、總營收、總服務成本、顧客數等圖表。
  - **期間下鑽**：點選圖表 bar 後，可依「按產品」「按銷售活動中心」「排序清單」「分布圖」等模式檢視該期或 1–3 期資料。
  - **顧客→產品→服務成本→作業動因→作業中心成本→資源**的**多層下鑽**（Page0 → Page1 → … → Page5）。

### 1.2 Primary Users

- 內部使用者：需檢視上傳的 ABC/獲利相關 Excel 報表，並做多期間比較與下鑽分析。
- 無後端與登入：資料僅存於本機，無雲端同步、無帳號權限。

### 1.3 Core Workflows

1. **上傳**：Header 點「Upload Excel」→ 選 .xlsx → 解析 → 正規化 → 寫入 IndexedDB（依 `periodNo` 覆寫該期所有表）。
2. **選期間**：Header 的 Period 下拉選單依 URL `periodNo` 與 IndexedDB 中的 `periods` 顯示可選期間。
3. **儀表板**：Page0 顯示 Total Profitability / Revenue / Service Cost / Customer Count 圖表；點 Total Profitability 的 bar 開啟下鑽面板。
4. **下鑽**：下鑽面板內可切換 By Product、By Sales Activity Center、Ranked List、Distribution；By Sales Activity Center 的 bar 可再點開「Drill-down 2」看該活動中心下的產品獲利。
5. **明細下鑽**：Page0 顧客表點列 → Page1（顧客產品利潤）→ Page2（服務成本彙總）→ Page3（作業動因）→ Page4（作業中心成本）→ Page5（資源明細）。全程經 URL 傳遞 `periodNo`、`customerId`、`activityCenterKey`、`activityCodeKey` 等。

### 1.4 High-Level Capability Summary

| 能力 | 說明 |
|------|------|
| Excel 匯入 | 多檔 .xlsx，每檔多 sheet，依 sheet 名稱對應 8 張固定表；驗證必填欄位後正規化並寫入 IndexedDB。 |
| 多期間 | 以 `periodNo`（YYYYMM）為單位儲存與查詢；儀表板與下鑽支援 1–3 期比較。 |
| 儀表板圖表 | 自製 SVG（SimpleChart bar/line），無 recharts/echarts。 |
| 下鑽圖表 | GroupedBarRows（多期間並排 bar），可選 onBarClick 開啟 Drill-down 2。 |
| 表格 | 使用 @tanstack/react-table（DataTable），排序、篩選、分頁。 |
| 導航 | React Router（/page0–page5）；Breadcrumb 顯示層級。 |
| 資料儲存 | 僅 IndexedDB（idb），無 localStorage 存表資料、無 Supabase/後端。 |

---

## 2. Technology Stack

| 類別 | 技術 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 路由 | react-router-dom v6 |
| 建置 | Vite 5 |
| 表格 | @tanstack/react-table v8 |
| Excel 讀取 | xlsx (SheetJS) v0.18.5 |
| 本機儲存 | IndexedDB（透過 idb v7） |
| 圖表 | 自製 SVG（SimpleChart、GroupedBarRows），無第三方圖表庫 |

- **無**：後端 API、Supabase、Firebase、localStorage 存表資料、Excel 匯出/下載功能。

---

## 3. Application Architecture Overview

### 3.1 系統分層與資料流

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Rendering Layer                                              │
│  App.tsx (Routes) → Header → Page0..Page5, DataTable,            │
│  SimpleChart, GroupedBarRows, Breadcrumb, PeriodSelector,        │
│  UploadExcelButton                                                │
└───────────────────────────┬─────────────────────────────────────┘
                             │
┌───────────────────────────▼─────────────────────────────────────┐
│  Configuration / Types Layer                                      │
│  types.ts (TableName, *Row, NormalizedFields, PeriodInfo)         │
│  parseExcel.ts (REQUIRED_SHEETS, REQUIRED_COLUMNS)                 │
│  dataApi.ts (TABLE_KEYS)                                          │
└───────────────────────────┬─────────────────────────────────────┘
                             │
┌───────────────────────────▼─────────────────────────────────────┐
│  Table/Grid Engine                                                 │
│  DataTable.tsx (@tanstack/react-table: sort, filter, pagination)  │
│  Column 定義在各 Page 內，無動態新增/刪除欄位                       │
└───────────────────────────┬─────────────────────────────────────┘
                             │
┌───────────────────────────▼─────────────────────────────────────┐
│  Tab / Drill-down “Tab” System                                    │
│  Page0 內：drilldownMode = 'ranked'|'hist'|'product'|'salesActivityCenter' │
│  無「Model Data / Period Data」多 sheet 切換；「表」= 8 張固定表   │
└───────────────────────────┬─────────────────────────────────────┘
                             │
┌───────────────────────────▼─────────────────────────────────────┐
│  Upload / Import Engine                                           │
│  UploadExcelButton → parseExcelFile() → normalizeAll() → saveUpload() │
└───────────────────────────┬─────────────────────────────────────┘
                             │
┌───────────────────────────▼─────────────────────────────────────┐
│  Data Persistence Layer                                            │
│  dataApi.ts (getTable, getTableData, saveUpload, listPeriods…)     │
│  db.ts (IndexedDB: periods, tables, upload_sessions, dim_*)        │
└───────────────────────────┬─────────────────────────────────────┘
                             │
┌───────────────────────────▼─────────────────────────────────────┐
│  Authentication / Cloud                                           │
│  無。無 Supabase、無 presence、無雲端同步。                         │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 資料流摘要

- **上傳**：File → `parseExcelFile` → raw per-sheet rows → `normalizeAll` → `saveUpload(periodNo, sheetStatus, normalizedData)` → IndexedDB `periods` + `tables`。
- **讀取**：各 Page 的 `useEffect` 依 `periodNo`（與必要時 `customerId`、`activityCenterKey` 等）呼叫 `getTable`/`getTableData` → IndexedDB。
- **刷新**：`RefreshContext.triggerRefresh()` 遞增 `refreshToken`，各頁依 `refreshToken` 重新拉資料；上傳完成後 Header 呼叫 `triggerRefresh()` 並可導向 `?periodNo=…`。

---

## 4. Folder / File Responsibility Map

路徑皆相對於 **`abc-bi-app/`**。

### 4.1 根目錄與入口

| 檔案 | 職責 | 主要函式/內容 | 觸發時機 | 依賴關係 | 修改風險 |
|------|------|----------------|----------|----------|----------|
| `index.html` | SPA 單頁 HTML，掛載 root | — | 載入應用 | — | 低 |
| `package.json` | 依賴與腳本 | `dev`, `build`, `preview` | 安裝/建置 | — | 低 |
| `vite.config.ts` | Vite 設定 | — | 建置 | — | 低 |
| `tsconfig.json` | TypeScript 編譯設定 | — | 編譯 | — | 低 |

### 4.2 `src/` 核心

| 檔案 | 職責 | 主要函式/內容 | 觸發時機 | 依賴關係 | 修改風險 |
|------|------|----------------|----------|----------|----------|
| `main.tsx` | React 掛載、Router、全域 CSS | `ReactDOM.createRoot`, `BrowserRouter`, `App` | 應用啟動 | App, index.css | 低 |
| `App.tsx` | 路由與整體版面 | `Routes`, `RefreshProvider`, `Header`, `Page0`–`Page5` | 每次導航 | 所有 Page、Header、RefreshContext | 中（改路由會影響所有頁） |
| `index.css` | 全域樣式 | 變數、.header、.table、.breadcrumb、.drilldown-* 等 | 載入時 | 各元件 class 名稱 | 低 |

### 4.3 `src/types.ts`

| 職責 | 內容 |
|------|------|
| 標準化欄位 | `NormalizedFields`（periodNo, company, buCode, customerId, activityCenterKey, activityCodeKey） |
| 表名枚舉 | `TableName`（8 張表） |
| 每張表的 Row 型別 | `ResourceRow`, `ActivityCenterModelRow`, `ActivityDriverRow`, `CustomerServiceCostRow`, `IncomeStatmentRow`, `CustomerProfitResultRow`, `ProductProfitResultRow`, `CustomerProductProfitRow` |
| 其他 | `PeriodInfo`, `NormalizedData` |

- **何時使用**：所有與「表」與「列」相關的型別；parseExcel、normalize、dataApi、各 Page 皆依賴。
- **修改注意**：新增/刪除表需同步改 `TableName`、對應 Row、`parseExcel` 的 REQUIRED_*、`dataApi` 的 TABLE_KEYS、`normalize.ts` 的 tables 列表與欄位對應。**高風險**。

### 4.4 `src/db.ts`

| 職責 | 主要內容 |
|------|----------|
| IndexedDB Schema | `BIDB`：`periods`, `tables`, `upload_sessions`, `dim_customers`, `dim_products`, `fact_customer_product` |
| 連線 | `dbPromise`, `getDb()` |
| 刪除期間 | `deletePeriod(periodNo)` 刪除該期所有 stores 相關 key |
| 輔助 | `formatUploadedAt`, `saveUploadSession`, `putDimCustomers`, `putDimProducts`, `putFactCustomerProduct`, `deleteSessionByPeriod` |

- **Key 慣例**：`periods` 以 `periodNo` 為 key；`tables` 以 `"${periodNo}:${tableName}"` 為 key。
- **修改注意**：改 schema 需升 `DB_VERSION` 並在 `upgrade` 中處理；改 key 格式會影響既有資料。**高風險**。

### 4.5 `src/dataApi.ts`

| 職責 | 主要函式 |
|------|----------|
| 期間列表 | `getAllPeriods()`, `listPeriods()` |
| 讀表 | `getTableData<T>(periodNo, tableName)`, `getTable<T>(periodNo, tableName)` |
| 期間資訊 | `getPeriodInfo(periodNo)` |
| 寫入上傳結果 | `saveUpload(periodNo, sheetStatus, normalizedData)`（寫入 `periods` 與 `tables` 的 8 張表） |
| 刪除期間 | `deletePeriod(periodNo)` 轉呼叫 db.deletePeriod |

- **TABLE_KEYS**：與 `types.TableName` 一致，決定 `saveUpload` 會寫入哪些表。
- **修改注意**：新增表需同時更新 TABLE_KEYS、types、parseExcel、normalize。**高風險**。

### 4.6 `src/parseExcel.ts`

| 職責 | 主要內容 |
|------|----------|
| Excel 解析 | `parseExcelFile(file)`：xlsx 讀 workbook，依 `workbook.SheetNames` 取各 sheet，`sheet_to_json` 得 raw rows |
| Sheet 過濾 | 跳過 `Sheet2`、`Sheet3`；其餘有資料的 sheet 以「原始 sheet 名稱」當 key 存入 `parsed` |
| 必填驗證 | `REQUIRED_SHEETS`, `REQUIRED_COLUMNS` 決定每張表是否 valid；`sheetStatus[sheet]` 為 boolean |
| 期間萃取 | `extractPeriodNo(parsed)`：從各表第一列取 PeriodNo 或 Year/Month |
| 輸出 | `ParseResult`: `periodNo`, `sheetStatus`, `normalizedData`（經 `normalizeAll`） |

- **Excel 表名對應**：Excel 內 sheet 名稱必須與 `TableName` 完全一致（如 `CustomerProfitResult`、`ActivityCenter+ActivityModel`），否則不會進入對應表。
- **修改注意**：新增表需加 REQUIRED_SHEETS、REQUIRED_COLUMNS 與 normalize 對應。**高風險**。

### 4.7 `src/normalize.ts`

| 職責 | 主要函式 |
|------|----------|
| 數值 | `toNumber`, `toNumberOrNull` |
| 識別碼萃取 | `extractId`, `extractCode`, `extractBuCode`, `normalizeActivityCenter` |
| 單表正規化 | `normalizeSheet(rows, tableName, fallbackYearMonth)`：補 `NormalizedFields`、數值欄位正規化 |
| 全量正規化 | `normalizeAll(parsed)`：對 8 張表依序呼叫 `normalizeSheet`，IncomeStatment 提供 fallback Year/Month |

- **表別邏輯**：`getCompany`, `getPeriodNo`, `getBuCode`, `getCustomerId`, `getActivityCenterKey`, `getActivityCodeKey` 依 `tableName` 取不同欄位；`normalizeAmounts` 統一處理金額/比率欄位。
- **修改注意**：新增表或新欄位需在 `normalizeAmounts` 與各 get* 中對應。**高風險**。

### 4.8 `src/contexts/RefreshContext.tsx`

| 職責 | 內容 |
|------|------|
| 全域刷新 | `refreshToken`（number）、`triggerRefresh()` 遞增 token |
| 使用 | 各 Page 的 `useEffect(..., [refreshToken])` 在 token 變時重新拉資料；Header 上傳後呼叫 `triggerRefresh()` |

- **修改風險**：低。僅影響「何時重新 fetch」。

### 4.9 `src/components/` 元件

| 檔案 | 職責 | 主要 props/行為 | 依賴 | 修改風險 |
|------|------|------------------|------|----------|
| `Header.tsx` | 頂部：標題、期間選單、Refresh、Delete、上傳、sheet 狀態 | PeriodSelector、UploadExcelButton、getPeriodInfo、deletePeriod、triggerRefresh | dataApi, RefreshContext, PeriodSelector, UploadExcelButton | 中 |
| `PeriodSelector.tsx` | 期間下拉選單 | URL `periodNo` 與 `periods` 同步；onPeriodChange | dataApi.getAllPeriods, useSearchParams | 低 |
| `UploadExcelButton.tsx` | 檔案選擇與上傳流程 | 多檔 .xlsx、parseExcelFile、saveUpload、onUploaded | parseExcel, dataApi | 中（與解析/寫入流程綁定） |
| `DataTable.tsx` | 通用表格 | @tanstack/react-table：排序、全域篩選、分頁；columns 由呼叫端傳入 | 無動態欄位 | 低 |
| `SimpleChart.tsx` | 單一 bar/line 圖 | SVG rect/polyline；可選 onBarClick | 無 | 低 |
| `GroupedBarRows.tsx` | 多期間並排 bar（一列一組） | 支援 monthTotals、onBarClick（Drill-down 2） | 無 | 低 |
| `Breadcrumb.tsx` | 麵包屑導航 | items: { label, path }[] | 無 | 低 |

### 4.10 `src/pages/` 頁面

| 檔案 | 職責 | 資料來源與導航 | 修改風險 |
|------|------|----------------|----------|
| `Page0.tsx` | 儀表板 + 下鑽 + 顧客表 | listPeriods, getTable(CustomerProfitResult, ProductProfitResult, CustomerProductProfit)；點 bar 設 selectedPeriodNo/selectedPeriods；顧客表點列 → page1 | 高（狀態多、下鑽邏輯集中） |
| `Page1.tsx` | 顧客產品利潤明細 | getTableData(CustomerProductProfit)，filter by periodNo+customerId；→ page2 | 中 |
| `Page2.tsx` | 服務成本（依 Activity Center 彙總） | getTableData(CustomerServiceCost)，filter + group by activityCenterKey；onRowClick → page3 | 中 |
| `Page3.tsx` | 作業動因明細 | getTableData(ActivityDriver)，filter by periodNo+customerId+activityCenterKey；→ page4 | 中 |
| `Page4.tsx` | 作業中心成本率 | getTableData(ActivityCenter+ActivityModel)，filter by periodNo+activityCenterKey+activityCodeKey；→ page5 | 中 |
| `Page5.tsx` | 資源明細 | getTableData(Resource)，filter by periodNo+activityCenterKey | 中 |

### 4.11 `src/utils/format.ts`

- `formatCurrency(value)`：千分位 + 兩位小數（zh-TW）。
- `formatPercent(value)`：百分比或 `'-'`。
- **修改風險**：低。

---

## 5. Tab & Sheet Configuration System

### 5.1 本專案沒有「多 sheet 切換」的 Excel 式分頁

- 沒有「Model Data / Period Data」這種**多 sheet 切換**的 UI。
- 「表」是**固定的 8 張**，由 Excel **sheet 名稱**對應（見下）。
- **Tab** 在專案中指的是：
  - **Page0 下鑽面板內的 4 個 tab**：By Product、By Sales Activity Center、Ranked List、Distribution。
  - 以及**路由** Page0–Page5（每頁對應不同檢視，非 sheet 切換）。

### 5.2 8 張表（Sheet）的定義與來源

- **定義處**：`src/types.ts` 的 `TableName` 與對應 `*Row`。
- **Excel 對應**：`src/parseExcel.ts` 的 `REQUIRED_SHEETS` 與 `REQUIRED_COLUMNS`。
- **寫入時表名**：`src/dataApi.ts` 的 `TABLE_KEYS`（與 TableName 一致）。

| 表名（TableName） | 用途 | 必填欄位（REQUIRED_COLUMNS） |
|-------------------|------|-----------------------------|
| Resource | 資源明細 | Activity Center, PeriodNo, Amount |
| ActivityCenter+ActivityModel | 作業中心＋作業模型 | Activity Center- Level 2, PeriodNo, Amount |
| ActivityDriver | 作業動因 | Activity Center, PeriodNo, ValueObject, ActCost |
| CustomerServiceCost | 顧客服務成本 | Customer, PeriodNo, Activity Center, Amount |
| IncomeStatment | 損益 | Year, Month, Customer |
| CustomerProfitResult | 顧客獲利結果 | CustomerID, PeriodNo, CustomerProfit |
| ProductProfitResult | 產品獲利結果 | ProductID, PeriodNo |
| CustomerProductProfit | 顧客產品獲利（含 SalesActivityCenter） | Customer, PeriodNo, NetProfit |

- Excel 檔案內的 **sheet 名稱必須與上表完全一致**（含 `ActivityCenter+ActivityModel` 的 `+`），否則該 sheet 不會對應到正確表。

### 5.3 下鑽 Tab 的啟用條件

- **By Product**：該期存在 `ProductProfitResult` 且至少一筆；否則 tab disabled。
- **By Sales Activity Center**：該期存在 `CustomerProductProfit` 且至少一筆含非空 `SalesActivityCenter`；否則 tab disabled，並顯示「Sales Activity Center data is not available...」。
- **Ranked List / Distribution**：始終可選，僅依 `CustomerProfitResult`。

### 5.4 若要新增或移除「表」

1. 在 `types.ts` 更新 `TableName` 與對應 Row 型別。
2. 在 `parseExcel.ts` 更新 `REQUIRED_SHEETS`、`REQUIRED_COLUMNS`（若為新表）。
3. 在 `dataApi.ts` 更新 `TABLE_KEYS`。
4. 在 `normalize.ts` 的 `normalizeAll` 表列表與各 get* 中支援新表欄位（若需正規化）。
5. 在 `db.ts` 若需新 store 再改 schema；目前 8 張表皆存在 `tables` store，key `${periodNo}:${tableName}`。

---

## 6. Table / Grid Engine Behavior

### 6.1 實作位置

- **元件**：`src/components/DataTable.tsx`
- **函式庫**：`@tanstack/react-table`（getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel）。

### 6.2 行為說明

- **欄位**：由呼叫端傳入 `columns: ColumnDef<T, unknown>[]`，每頁各自定義，**無動態新增/刪除欄位**。
- **儲存格**：依 column 的 `accessorKey` 與可選 `cell` 渲染；金額類多透過 `formatCurrency` 等。
- **排序**：表頭可點擊切換排序（asc/desc）。
- **篩選**：`searchable` 為 true 時顯示全域搜尋框，`globalFilter` 套用至所有欄。
- **分頁**：`pageSize` 預設 20，可傳入；上一頁/下一頁與頁碼顯示。
- **列點擊**：可選 `onRowClick(row)`，用於下鑽（如 Page0 → Page1）。

### 6.3 無下列行為

- 無複製/貼上、無儲存格編輯、無新增/刪除列、無欄位驗證邏輯（驗證僅在上傳時於 parseExcel/normalize 端）。

---

## 7. Dynamic Column System

### 7.1 現狀：無動態欄位系統

- 本專案**沒有**「使用者新增/刪除/重新命名欄位」的功能。
- 所有表格欄位皆在**各 Page 的程式碼中寫死**（例如 Page0 的 `columns`、Page1 的 `columns`）。
- 因此：
  - **沒有** default columns vs user-added columns 的區分。
  - **沒有** 欄位中繼資料儲存、沒有欄位管理 UI。
  - 若要改欄位：直接改對應 Page 的 `ColumnDef` 陣列即可（或抽成共用的 column 定義檔）。

### 7.2 若未來要加動態欄位

- 需自行設計：欄位定義存於何處（例如 per-period 或 global 的 config）、Header 上的「新增/刪除/重新命名」按鈕、與 DataTable 的 columns 如何從該 config 生成。目前程式碼中**沒有**預留 extension point。

---

## 8. Upload / Import Logic

### 8.1 流程

1. **觸發**：`UploadExcelButton` 的 `<input type="file" accept=".xlsx" multiple>`；使用者選一或多個 .xlsx。
2. **解析**：`parseExcelFile(file)`（`src/parseExcel.ts`）：
   - `file.arrayBuffer()` → `XLSX.read(buffer, { type: 'array' })`；
   - 遍歷 `workbook.SheetNames`，跳過 Sheet2/Sheet3，其餘 `sheet_to_json` → `trimKeys` 得到每 sheet 的 `Record<string, unknown>[]`；
   - 以**原始 sheet 名稱**為 key 存入 `parsed`。
3. **驗證**：對 `REQUIRED_SHEETS` 每張表呼叫 `isSheetValid(sheetName, parsed[sheet])`，檢查第一列是否包含 `REQUIRED_COLUMNS[sheetName]` 的所有欄位；結果寫入 `sheetStatus`。
4. **正規化**：`normalizeAll(parsed)`（`src/normalize.ts`）為每張表補上 `NormalizedFields` 並正規化數值欄位。
5. **期間**：`extractPeriodNo(parsed)` 從各表第一列取 PeriodNo 或 Year/Month，得到單一 `periodNo`。
6. **寫入**：`saveUpload(periodNo, sheetStatus, normalizedData)`（`src/dataApi.ts`）：
   - 寫入 `periods`：`{ periodNo, uploadedAt, sheetStatus }`；
   - 對 `TABLE_KEYS` 每張表寫入 `tables`，key = `${periodNo}:${tableName}`，**整表覆寫**。

### 8.2 規則摘要

- **欄位對應**：Excel 欄位名需與程式預期一致（含前後空白會先 trim）；必填欄位見 `REQUIRED_COLUMNS`。
- **欄位不足**：若某 sheet 缺必填欄位，該 sheet 的 `sheetStatus[sheet]` 為 false，但**不阻止寫入**；其他 valid 的 sheet 仍會寫入。Header 顯示「x/8 OK」。
- **覆寫**：同一 `periodNo` 再次上傳會**完整覆寫**該期 8 張表，無 merge。
- **多檔**：多檔依序解析與寫入，最後一筆成功的 `periodNo` 可透過 `onUploaded(latestPeriodNo)` 回傳，Header 用來導向並選取該期間。

### 8.3 修改入口

- 新增/修改表：`parseExcel.ts`（REQUIRED_SHEETS, REQUIRED_COLUMNS）、`normalize.ts`、`dataApi.ts` TABLE_KEYS。
- 欄位名稱或必填條件：`parseExcel.ts` 的 `REQUIRED_COLUMNS`。
- 覆寫 vs 合併：目前僅覆寫；若要做 merge，需在 `dataApi.saveUpload` 或 db 層改為「讀出再合併再寫入」。

---

## 9. Download / Export Logic

### 9.1 現狀

- **沒有** Excel 匯出或任何下載功能。
- 程式碼中**沒有** `XLSX.write`、`writeFile`、或「Export / Download」按鈕。

### 9.2 若未來要加匯出

- 需新增：例如「Export current table to .xlsx」按鈕、從 `getTableData(periodNo, tableName)` 取資料、用 xlsx 的 `utils.json_to_sheet` + `book_new` + `writeFile` 產生檔案；檔名與時間戳可自訂。目前無預留 API。

---

## 10. Data Storage & Scoping

### 10.1 儲存體

- **IndexedDB**（idb），DB 名稱：`abc-bi-db`，版本 2。
- **未使用** localStorage 存表資料；僅 IndexedDB。

### 10.2 命名與 Key 慣例

- **periods**：key = `periodNo`（number）；value = `{ periodNo, uploadedAt, sheetStatus }`。
- **tables**：key = `"${periodNo}:${tableName}"`（string）；value = 該表之列陣列（含 NormalizedFields）。
- **upload_sessions**：key = `sessionId`；含 periodNo、fileName、sheetStatus、rowCounts 等（目前上傳流程未使用寫入 session，但 schema 存在）。
- **dim_customers / dim_products / fact_customer_product**：key 為複合字串（如 `${periodNo}:${customerId}`）；目前主流程未寫入，為預留。

### 10.3 範圍（Scoping）

- **Period 範圍**：所有查詢皆依 `periodNo`；一個 period 一組 8 張表。
- **Company / BU**：資料列內有 `company`、`buCode`（來自 NormalizedFields），但**沒有**「依公司篩選」的 UI 或 store 隔離；篩選僅在 Page 內用 `filter(r => r.periodNo === … && r.customerId === …)` 等完成。
- **快取載入順序**：無額外快取層；各 Page 的 useEffect 依 `periodNo` + `refreshToken` 直接呼叫 `getTable`/`getTableData`。

### 10.4 刪除期間（Reset）

- Header「Delete」：`deletePeriod(periodNo)`（`db.ts`）會刪除該 period 在 `periods`、`tables`、`upload_sessions`、`dim_customers`、`dim_products`、`fact_customer_product` 的所有相關 key，並導向首頁或下一期。

---

## 11. Authentication / Cloud Features

- **無**。無 Supabase、無登入、無 presence、無雲端同步、無權限控管。資料僅存於本機 IndexedDB。

---

## 12. UI Behavior Mapping Guide

| 功能 | UI 位置 | 邏輯/資料來源 | 設定/型別來源 |
|------|----------|----------------|----------------|
| Tab（下鑽模式） | Page0 下鑽面板內 4 個按鈕 | Page0 state：drilldownMode | — |
| 路由（頁籤） | 無頂層 tab；URL /page0–page5 | App.tsx Routes | — |
| 表格渲染 | 各 Page 內 `<DataTable data={…} columns={…} />` | Page 的 useEffect + getTableData/getTable | 各 Page 的 columns 陣列 |
| 欄位定義 | 無獨立欄位管理 UI | 各 Page 的 ColumnDef[] | types.*Row |
| Upload 按鈕 | Header 右側「Upload Excel」 | UploadExcelButton → parseExcelFile → saveUpload | parseExcel REQUIRED_* |
| Download 按鈕 | 無 | — | — |
| 期間選擇 | Header「Period:」下拉 | PeriodSelector；URL ?periodNo= | dataApi.getAllPeriods, listPeriods |
| 公司選擇 | 無獨立選單 | 僅在 URL 與列資料中有 company/buCode | — |
| 儀表板圖表 | Page0 上方 4 個 SimpleChart | listPeriods + computeDashboardAggregate(CustomerProfitResult, IncomeStatment) | types, dataApi |
| 下鑽圖表 | Page0 下鑽內 GroupedBarRows / SimpleChart | getTable(ProductProfitResult / CustomerProductProfit)，依 selectedPeriods 彙總 | Page0 state |
| Breadcrumb | 各 Page 上方 | 各 Page 自建 items 陣列 | — |
| Refresh | Header「Refresh」按鈕 | triggerRefresh() | RefreshContext |
| Delete 期間 | Header「Delete」按鈕 | deletePeriod(periodNo), triggerRefresh, navigate | dataApi, db |

---

## 13. Known Extension Points

- **新增一張「表」**：見 §5.4、§8.3；需動 types、parseExcel、normalize、dataApi（TABLE_KEYS），必要時 db。
- **新增下鑽模式**：在 Page0 增加 `drilldownMode` 選項與對應 UI/資料載入（仿 product / salesActivityCenter）。
- **新增儀表板圖表**：在 Page0 的 `computeDashboardAggregate` 或另寫彙總，再加一組 `<SimpleChart>`。
- **新增一頁（路由）**：在 App.tsx 加 Route，新增 PageX.tsx，必要時在 Header 或 Breadcrumb 加連結。
- **圖表互動**：SimpleChart 已有 `onBarClick`；GroupedBarRows 已有 `onBarClick`，用於 Drill-down 2。
- **表格欄位/格式**：直接改各 Page 的 `columns` 或 `utils/format.ts`。
- **驗證規則**：上傳驗證在 `parseExcel.ts` 的 `REQUIRED_COLUMNS` 與 `isSheetValid`；若要更嚴格可改為在上傳前阻斷並提示。
- **匯出 Excel**：目前無；需新增按鈕與 xlsx 寫出邏輯（見 §9）。

---

## 14. Risk / Sensitive Areas

| 區域 | 原因 |
|------|------|
| **types.ts** | TableName、*Row、NormalizedFields 被 parseExcel、normalize、dataApi、所有 Page 依賴；改動易造成型別與執行期不一致。 |
| **parseExcel.ts** | Sheet 名稱與 REQUIRED_COLUMNS 直接決定上傳是否成功與寫入哪張表；改表名或必填欄位會影響既有 Excel 範本。 |
| **normalize.ts** | get* 與 normalizeAmounts 依 tableName 與欄位名；新增表或改欄位名需同步修改，否則正規化錯誤。 |
| **dataApi.ts TABLE_KEYS / saveUpload** | 與 types.TableName、db key 慣例一致；漏列或多列會導致資料漏寫或 key 錯誤。 |
| **db.ts schema 與 key** | 改 key 格式或 store 結構需 migration（DB_VERSION、upgrade）；否則舊資料無法讀取或會錯存。 |
| **Page0.tsx** | 狀態多（selectedPeriodNo、selectedPeriods、drilldownMode、多組 grouped rows、drilldown2）；改狀態結構或 effect 依賴易影響下鑽與 Drill-down 2。 |
| **Upload 流程** | UploadExcelButton → parseExcel → normalize → saveUpload 任一環節改錯都會影響上傳結果或 period 資料完整性。 |

---

## 15. Current Feature Status Snapshot

- **已實作**
  - Excel 上傳（多檔、多 sheet）、必填欄位驗證、正規化、依 periodNo 覆寫寫入 IndexedDB。
  - 期間列表、期間選擇（URL + 下拉）、刪除期間、Refresh。
  - Page0：儀表板（Total Profitability / Revenue / Service Cost / Customer Count）、點 bar 開下鑽、4 種下鑽模式（By Product、By Sales Activity Center、Ranked List、Distribution）、Drill-down 2（By Sales Activity Center 點 bar → 該中心 By Product）。
  - Page1–Page5：顧客→產品→服務成本→作業動因→作業中心成本→資源明細，Breadcrumb、列點擊導航。
  - DataTable 排序、篩選、分頁；SimpleChart bar/line、onBarClick；GroupedBarRows 多期間並排、onBarClick、monthTotals。
- **部分實作**
  - Header 顯示「x/8 OK」sheet 狀態；上傳失敗時 alert，但同一 period 仍會覆寫（不阻斷）。
  - dim_customers、dim_products、fact_customer_product、upload_sessions 在 db 存在，主流程未使用。
- **未實作**
  - Excel 匯出 / 下載。
  - 動態欄位（新增/刪除/重新命名欄位）。
  - 公司/ BU 篩選 UI。
  - 後端、登入、雲端同步。

---

## 16. Suggested Safe Modification Workflow

1. **定位功能**：用 §12 對照「要改的 UI 行為」→ 找到對應的邏輯檔案與 Page。
2. **改型別/表結構時**：先改 `types.ts`，再依序改 parseExcel（REQUIRED_*）、normalize（tables 列表與 get*）、dataApi（TABLE_KEYS）；若有新 store 再動 db 並升版。
3. **本機測試**：`npm run dev`，用含 8 張 sheet 的 .xlsx 上傳，切換期間、下鑽、Page1–Page5 走一輪；改上傳/正規化後再測一次上傳與儀表板。
4. **避免影響其他表**：改某張表時，確保 REQUIRED_COLUMNS、normalize 的該表、TABLE_KEYS 只動該表，不誤改其他表名或 key。
5. **提交**：建議小步 commit（例如：types + parseExcel 一 commit，normalize + dataApi 一 commit，UI 一 commit），方便回滾。

---

## 17. Glossary of Internal Terms

| 術語 | 說明 |
|------|------|
| **Model Data / Period Data** | 本專案中**未使用**此分法；若文件他處提到，可能指「依 period 儲存的表資料」與「模型定義」的區分，目前僅有 period 維度的 8 張表。 |
| **Period Data** | 指某個 `periodNo`（YYYYMM）下的 8 張表資料；存於 IndexedDB `tables`，key `${periodNo}:${tableName}`。 |
| **Sheet** | Excel 內的一個工作表；在本專案中與「表」（TableName）一對一對應，以 sheet 名稱對應表名。 |
| **Table / 表** | 指 8 張固定表之一（Resource、ActivityCenter+ActivityModel、…、CustomerProductProfit），對應 types.TableName 與 IndexedDB `tables` 的一筆 key。 |
| **Dynamic Column** | 本專案**無**；若未來實作，指使用者可新增/刪除/重新命名的欄位。 |
| **Default Column** | 本專案未區分；所有欄位皆在程式碼中寫死。 |
| **Company Scope** | 資料列有 `company`（與 buCode）欄位，但**沒有**以公司為範圍的儲存或篩選 UI；目前僅 period 為主要範圍。 |
| **Period Scope** | 所有查詢與儲存皆以 `periodNo` 為範圍；一個 period 一組 8 張表。 |
| **NormalizedFields** | 每列共有的標準欄位：periodNo, company, buCode, customerId, activityCenterKey, activityCodeKey；由 normalize 層寫入。 |
| **Drill-down** | Page0 點 Total Profitability 的 bar 後出現的面板，可切換 By Product / By Sales Activity Center / Ranked List / Distribution。 |
| **Drill-down 2** | 在 By Sales Activity Center 視圖中點某一列的某期 bar，再展開的「該 Sales Activity Center → By Product」子面板。 |
| **refreshToken** | RefreshContext 中的數字，`triggerRefresh()` 會遞增；各 Page 以之為 useEffect 依賴以重新拉資料。 |

---

*文件結束。最後更新：2026-02-07。*
