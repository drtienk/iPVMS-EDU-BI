/** 金額：千分位 + 2 位小數（保留舊 API，其他頁面沿用） */
export const formatCurrency = (value: number): string => {
  return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * 財務數字（Money）：$、千分位、不顯示小數；負數為 -$12,580
 * 適用：Revenue / Price、COGS、Service Cost、Customer Profit、Total / Cost 等
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (Number.isNaN(n)) return '-';
  const rounded = Math.round(n);
  const absStr = Math.abs(rounded).toLocaleString('en-US');
  return rounded < 0 ? `-$${absStr}` : `$${absStr}`;
}

/**
 * 非財務數字（Non-Money）：最多一位小數、不加 $；0 不補 .0
 * 適用：Hours、DriverValue、Quantity、Ratio 等
 */
export function formatNumber1(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (Number.isNaN(n)) return '-';
  const r = Math.round(n * 10) / 10;
  if (r % 1 === 0) return String(Math.round(r));
  return r.toFixed(1);
}

/** 百分比 */
export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return (value * 100).toFixed(2) + '%';
};
