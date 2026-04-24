/** 統一標準化欄位（每張表都會有） */
export interface NormalizedFields {
  periodNo: number;
  company: string;
  buCode: string;
  customerId: string;
  activityCenterKey: string;
  activityCodeKey: string;
}

export type TableName =
  | 'Resource'
  | 'ActivityCenter+ActivityModel'
  | 'ActivityDriver'
  | 'CustomerServiceCost'
  | 'IncomeStatment'
  | 'CustomerProfitResult'
  | 'ProductProfitResult'
  | 'CustomerProductProfit';

export interface ResourceRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  Company?: string;
  ' Business Unit'?: string;
  ' Activity Center'?: string;
  ' Activity Center- Level 1'?: string;
  ' Activity Center- Level 2'?: string;
  Control?: string;
  CostType?: string;
  IsStop?: string;
  ' Resource Code'?: string;
  ' Resource - Level 1'?: string;
  ' Resource - Level 2'?: string;
  Amount?: number;
  ' Resource Driver'?: string;
  DriverDesc?: string;
  ResourceDriverValue?: number;
  FromAc?: string;
  ResourceDriverRate?: number;
}

export interface ActivityCenterModelRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  Company?: string;
  ' Business Unit'?: string;
  ' Activity Center- Level 1'?: string;
  ' Activity Center- Level 2'?: string;
  CostType?: string;
  Amount?: number;
  ActivityCenterDriverRate?: number;
  ActivityCenterDriverValue?: number;
  ' Activity - Level 1'?: string;
  ' Activity - Level 2'?: string;
  ProductiviityAttribute?: string;
}

export interface ActivityDriverRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  Company?: string;
  ' Business Unit'?: string;
  ' Activity Center'?: string;
  ActCost?: number;
  StdCost?: number;
  ' Activity - Level 1'?: string;
  ' Activity - Level 2'?: string;
  ' Activity Driver'?: string;
  ActvivtyDriverValue?: number;
  ' Value Object Type'?: string;
  ValueObject?: string;
  ServiceProduct?: string;
}

export interface CustomerServiceCostRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  Company?: string;
  ' Business Unit'?: string;
  Customer?: string;
  ' Activity Center'?: string;
  ' Entity'?: string;
  Code?: string;
  Driver?: string;
  DriverValue?: number;
  Amount?: number;
  ' Service Driver'?: string;
  Ratio?: number;
  ServiceDriverValue?: number;
  ServiceAmount?: number;
  ServiceProduct?: string;
}

export interface IncomeStatmentRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  ' Company Code'?: string;
  ' Business Unit'?: string;
  ' Activity Center Code'?: string;
  SalesOrderNo?: string;
  Product?: string;
  Customer?: number | string;
  Quantity?: number;
  Amount?: number;
  VC_ServiceCost?: number;
  CustomersProfit?: number;
  ProductProfit?: number;
}

export interface CustomerProfitResultRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  Company?: string;
  ' Business Unit'?: string;
  CustomerID?: number | string;
  Customer?: string;
  Price?: number;
  ManufactureCost?: number;
  SalesProfit?: number;
  ManagementCost?: number;
  ServiceCost?: number;
  TotalCost?: number;
  CustomerProfit?: number;
  CustomerProfitRatio?: number | null;
}

export interface ProductProfitResultRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  Company?: string;
  perioddataid?: string;
  ' Business Unit'?: string;
  ProductID?: string | number;
  Product?: string;
  SalesVolume?: number;
  Price?: number;
  ManufactureCost?: number;
  UnitPrice?: number;
  SalesProfit?: number;
  ManagementCost?: number;
  ServiceCost?: number;
  TotalCost?: number;
  ProductUnitCost?: number;
  ProductProfit?: number;
  ProductProfitRatio?: number | null;
}

export interface CustomerProductProfitRow extends NormalizedFields {
  Year?: number;
  Month?: number;
  Company?: string;
  ' Business Unit Code'?: string;
  Customer?: string;
  SalesOrderNo?: string;
  SalesActivityCenter?: string;
  ShippingBusinessUnit?: string;
  Product?: string;
  Price?: number;
  ProductCost?: number;
  GrossMargin?: number;
  ManagementCost?: number;
  ServiceCost?: number;
  ProjectCost?: number;
  TotalCost?: number;
  NetIncome?: number;
  Quantity?: number;
  NetProfit?: number;
}

export interface PeriodInfo {
  periodNo: number;
  uploadedAt: number;
  sheetStatus: Record<string, boolean>;
}

export type NormalizedData = Record<TableName, unknown[]>;
