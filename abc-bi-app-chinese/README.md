# ABC Costing BI Web App

以 React + Vite + TypeScript 建立的 Web BI App，用於追溯顧客獲利的根因分析（作業、員工、費率）。

## 執行步驟

```bash
cd abc-bi-app
npm install
npm run dev
```

瀏覽器開啟 http://localhost:5173 即可使用。

## 功能摘要

- **上傳 Excel**：每個 period 上傳一個 .xlsx，內含 8 張有效 sheets（Resource、ActivityCenter+ActivityModel、ActivityDriver、CustomerServiceCost、IncomeStatment、CustomerProfitResult、ProductProfitResult、CustomerProductProfit）。
- **Period 切換**：Header 下拉選單切換期間。
- **Drill-through**：從顧客利潤總覽 (Page0) → 顧客產品明細 (Page1) → 服務成本分析 (Page2) → 作業動因明細 (Page3) → 作業中心成本率 (Page4) → 資源明細 (Page5)。
- **表格**：排序、搜尋、分頁（TanStack Table）。
- **資料儲存**：IndexedDB（idb），離線可用。

## 技術棧

- React 18、Vite 5、TypeScript
- react-router-dom、@tanstack/react-table、xlsx、idb
