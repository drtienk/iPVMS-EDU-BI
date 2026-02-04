# Project Status – ABC BI App

本文件記錄專案狀態，供後續開發（如 Drill-down、圖表互動）參考。

---

## Dashboard Audit – Customer Overview (2026-02-04)

### A. Chart Library

- **套件**：other（自製 SVG，未使用 recharts / chart.js / echarts）
- **元件**：`SimpleChart`，以 SVG `<rect>` 繪製 bar、`<polyline>` 繪製 line
- **版本**：N/A（專案內建元件，無獨立版本號）

### B. Files Involved

與 Customer Overview Dashboard 最相關的檔案（相對於 `abc-bi-app/`）：

| 角色 | 相對路徑 |
|------|----------|
| Dashboard 主頁面 | `src/pages/Page0.tsx` |
| Profitability 圖表元件 | `src/components/SimpleChart.tsx` |
| 型別／介面定義 | `src/types.ts`（`CustomerProfitResultRow`、`NormalizedFields`、`PeriodInfo`、`TableName`） |
| 彙總型別（圖表用） | `src/pages/Page0.tsx` 內 `DashboardAggregate` |
| 圖表資料型別 | `src/components/SimpleChart.tsx` 內 `SimpleChartDatum`、`SimpleChartProps` |
| 資料取得 | `src/dataApi.ts`（`listPeriods`、`getTable`、`getTableData`） |
| 資料儲存 | `src/db.ts`（IndexedDB schema、`getDb`） |
| 數值轉換 | `src/normalize.ts`（`toNumber`） |
| 上傳與解析 | `src/components/UploadExcelButton.tsx`、`src/parseExcel.ts` |
| 寫入儲存 | `src/dataApi.ts`（`saveUpload`） |

### C. Profitability Chart Data Mapping

- **資料變數**：`aggregates`（型別：`DashboardAggregate[]`）
- **傳入圖表的陣列**：`aggregates.map((a) => ({ x: a.periodNo, y: a.totalProfitability }))`，型別為 `SimpleChartDatum[]`
- **X 軸（Period）**：`d.x`，來源欄位 `periodNo`（number），顯示經 `formatX={(x) => String(x)}` 轉成字串（例如 `"202401"`）
- **Y 軸（Profitability）**：`d.y`，來源欄位 `totalProfitability`（number）

**一筆範例資料（傳給 SimpleChart 的單一筆）**：

```json
{ "x": 202401, "y": 123456.78 }
```

**對應的 aggregate 範例**：

```json
{
  "periodNo": 202401,
  "totalProfitability": 123456.78,
  "totalRevenue": 500000,
  "totalServiceCost": 80000,
  "customerCount": 25
}
```

### D. Existing Interactions

- **onClick / onSelect / hover**：目前 **無**。`SimpleChart` 未提供 `onBarClick`、`onClick` 或 hover 行為，內部 `<rect>` 也未綁定事件。
- **建議加入位置**：
  1. **元件**：`src/components/SimpleChart.tsx`
  2. **程式區塊**：在 `SimpleChartProps` 新增選用 `onBarClick?: (datum: SimpleChartDatum) => void`；在 `type === 'bar'` 的 `data.map` 中，為每個 `<rect>` 加上 `onClick`，並傳入對應的 `d`（或 `d.x` 作為 periodNo）。
  3. **呼叫端**：在 `src/pages/Page0.tsx` 渲染「Total profitability」的 `<SimpleChart>` 上傳入上述 `onBarClick`，依 `d.x`（periodNo）執行導向或下鑽。

### E. Data Source Flow

- **來源方式**：**上傳 Excel（.xlsx）後解析並寫入 IndexedDB**；無後端 API、無 mock。
- **Pipeline**：
  1. **Upload**：使用者透過 `src/components/UploadExcelButton.tsx` 選擇 .xlsx 檔案。
  2. **Parse**：`src/parseExcel.ts` 的 `parseExcelFile(file)` 以 xlsx 讀取 workbook，依 sheet 產出 raw rows，並依 `REQUIRED_COLUMNS` 驗證（例如 CustomerProfitResult 需含 CustomerID、PeriodNo、CustomerProfit 等）。
  3. **Transform**：`src/normalize.ts` 的 `normalizeSheet` / `normalizeAll` 為每張表加上 `NormalizedFields`（periodNo、company、buCode、customerId 等）並正規化數值欄位。
  4. **Store**：`src/dataApi.ts` 的 `saveUpload(periodNo, sheetStatus, normalizedData)` 寫入 `src/db.ts` 的 IndexedDB：`periods` 存 period 資訊，`tables` 以 key `"${periodNo}:${tableName}"` 存各表資料（含 `CustomerProfitResult`）。
  5. **Render**：`src/pages/Page0.tsx` 的 `useEffect` 依 `refreshToken` 呼叫 `listPeriods()`，對每個 `periodNo` 以 `getTable(periodNo, 'CustomerProfitResult')` 讀取，經 `computeDashboardAggregate(periodNo)` 計算 `totalProfitability`（sum of `CustomerProfit`）等，結果存入 `aggregates`，再以 `aggregates.map(...)` 傳給 `<SimpleChart>` 繪製 Total profitability 圖表。

---

## Drill-down (WIP) – 2026-02-04

### 事件與入口

- **圖表事件**：`SimpleChart` 已新增選用 prop `onBarClick?: (datum: SimpleChartDatum) => void`；僅在 `type === 'bar'` 時，每個 `<rect>` 綁定 `onClick` 並設定 `cursor: pointer`。未傳 `onBarClick` 時行為與原本相同。
- **觸發位置**：`src/pages/Page0.tsx` 中「Total profitability」的 `<SimpleChart>` 傳入 `onBarClick={(d) => setSelectedPeriodNo(Number(d.x))}`，點擊 bar 後以 `d.x`（periodNo）展開下鑽。

### Page0 狀態

- `selectedPeriodNo: number | null`：點選的期間，非 null 時顯示 Drilldown Panel。
- `drilldownMode: 'ranked' | 'hist' | 'product' | 'salesActivityCenter'`：預設 `'ranked'`（排序清單）。
- `topN: number`：預設 20；排序清單的 Top N。
- `showAllRanked: boolean`：是否顯示全部（或僅 Top N）。
- `drilldownRows: CustomerProfitResultRow[]`：該期顧客獲利列，已依 `CustomerProfit` 降序。
- `histBins: HistBin[]`：區間分布用的 10 個 bin（label, count, sumProfit）。
- `productRows`、`productDataAvailable`：依 `ProductProfitResult` 彙總；有資料時才啟用「按產品」tab。
- `loadingDrilldown`、`errorDrilldown`：載入中／錯誤訊息。

### Drilldown 目前支援

- **Mode 1 – 排序清單（預設）**：顧客獲利清單依 `CustomerProfit` 高→低；欄位：Rank、CustomerID、Customer、CustomerProfit、Revenue (Price)、ServiceCost；摘要：顧客數、總獲利、平均獲利、中位數；Top N（10/20/50）與「顯示全部」切換。
- **Mode 2 – 區間分布**：以 `CustomerProfit` 等寬 10 bins，用 `SimpleChart` 畫 bar（x=區間標籤，y=count）。
- **Mode 3 – 按產品**：資料來源 `getTable(periodNo, 'ProductProfitResult')`；彙總 `Product` / `ProductProfit`，Top 10 + Others，以 `GroupedBarRows` 多期間並排。若該期無 ProductProfitResult 或無資料，tab 為 disabled。
- **Mode 4 – By Sales Activity Center**：資料來源 `getTable(periodNo, 'CustomerProductProfit')`；彙總 `SalesActivityCenter` / `NetProfit`，Top 10 + Others，以 `GroupedBarRows` 多期間並排。若無 SalesActivityCenter 資料，tab 為 disabled，並顯示 "Sales Activity Center data is not available in the current dataset."

### Product mode 條件

- 需上傳之 Excel 含有 **ProductProfitResult** sheet，且該期有資料；欄位依 `types.ts` 之 `ProductProfitResultRow`（含 `Product`、`ProductProfit` 等）。若未上傳或表為空，按產品 tab 會 disabled，並顯示說明文字。

---

## Drill-down Extension – Sales Activity Center (2026-02-04)

### Grouping dimension: SalesActivityCenter

- Drill-down tabs include: **By Product**, **By Sales Activity Center**, Ranked List, Distribution.
- **By Sales Activity Center** groups customer profitability by **SalesActivityCenter** (same pattern as By Product; only the grouping key changes).

### Data source tables used

| 項目 | 實際採用 |
|------|----------|
| 表名 | `CustomerProductProfit`（`getTable(periodNo, 'CustomerProductProfit')`） |
| 維度欄位 | `SalesActivityCenter`（`CustomerProductProfitRow.SalesActivityCenter`） |
| 彙總數值 | `NetProfit`（sum per SalesActivityCenter per period） |

- **CustomerProfitResult** does not contain SalesActivityCenter in the project types; **CustomerProductProfit** contains both `SalesActivityCenter` and `NetProfit` (and is linked to customer via `customerId`). Aggregation: **Sum(NetProfit) per SalesActivityCenter per period**.

### Profit aggregation logic

- For each period in `selectedPeriods`, load `CustomerProductProfit` rows.
- Group by `SalesActivityCenter` (empty → "(Unknown)").
- Value per period = sum of `NetProfit` for that group. Missing period → 0.

### Multi-period comparison logic

- `selectedPeriods` (max 3 periods, e.g. 202401–202403). For each Sales Activity Center: 3 parallel bars. Sort by sum of **ABS(profit)** across periods; **Top 10** + **"Others"**.

### Fallback behavior

- If no row has non-empty `SalesActivityCenter` (or table empty): tab **disabled**, message: *"Sales Activity Center data is not available in the current dataset."*

### Component reuse

- Same **GroupedBarRows** as By Product. Color: Profit ≥ 0 → #2E7D32; Profit < 0 → #C62828. Month label MMYYYY below each bar; value above bar.

---

*文件結束*
