/** 金額：千分位 + 2 位小數 */
export const formatCurrency = (value: number): string => {
  return value.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** 百分比 */
export const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  return (value * 100).toFixed(2) + '%';
};
