// Fixed settings that mirror the STS Books workbook layout.
// If the Expenses sheet columns ever change, change them here.
const CONFIG = {
  bookFolder: 'operations/accounting',
  archiveFolder: 'operations/accounting/archive',
  receiptsFolder: 'operations/accounting/Invoices and expenses/receipts',
  bookPattern: /^(\d{6})_STS_Books_v(\d+)\.xlsx$/,
  sheet: 'Expenses',
  firstRow: 5,
  lastRow: 2000,
  moneyFormat: '\\$#,##0.00;"($"#,##0.00\\);\\-',
  dateFormat: 'dd mmm yyyy',
  timeZone: 'Asia/Singapore',

  // Column O on the Expenses sheet. Must match the data-validation list in the workbook.
  plLines: [
    'COGS - Assessment Tools',
    'COGS - Senior Advisor Fees',
    'COGS - Other Direct Costs',
    'OpEx - Incorporation',
    'OpEx - Travel & Transport',
    'OpEx - Meals & Entertainment',
    'OpEx - Software & Subscriptions',
    'OpEx - General & Admin',
    'Prepaid - Amortised',
  ],

  // Column D (Incorpor8's category). Only "Expense - Professional Fees" is confirmed from his file;
  // the rest are suggestions until Incorpor8 sends the full dropdown list. Free text is allowed.
  categories: [
    'Expense - Professional Fees',
    'Expense - Transport',
    'Expense - Travel',
    'Expense - Meals & Entertainment',
    'Expense - Software & Subscriptions',
    'Expense - Office Supplies',
    'Expense - Telephone & Internet',
    'Expense - Bank Charges',
    'Expense - Training & Development',
    'Expense - Marketing & Advertising',
  ],

  // Default category for each P&L line.
  categoryFor: {
    'COGS - Assessment Tools': 'Expense - Professional Fees',
    'COGS - Senior Advisor Fees': 'Expense - Professional Fees',
    'COGS - Other Direct Costs': 'Expense - Professional Fees',
    'OpEx - Incorporation': 'Expense - Professional Fees',
    'OpEx - Travel & Transport': 'Expense - Transport',
    'OpEx - Meals & Entertainment': 'Expense - Meals & Entertainment',
    'OpEx - Software & Subscriptions': 'Expense - Software & Subscriptions',
    'OpEx - General & Admin': 'Expense - Office Supplies',
    'Prepaid - Amortised': 'Expense - Professional Fees',
  },

  countries: [
    ['Singapore', 'SGD'], ['Malaysia', 'MYR'], ['Indonesia', 'IDR'], ['Thailand', 'THB'],
    ['Vietnam', 'VND'], ['Philippines', 'PHP'], ['Hong Kong', 'HKD'], ['China', 'CNY'],
    ['Japan', 'JPY'], ['South Korea', 'KRW'], ['Taiwan', 'TWD'], ['India', 'INR'],
    ['Australia', 'AUD'], ['New Zealand', 'NZD'], ['United Kingdom', 'GBP'], ['France', 'EUR'],
    ['Germany', 'EUR'], ['Italy', 'EUR'], ['Spain', 'EUR'], ['Netherlands', 'EUR'],
    ['Switzerland', 'CHF'], ['United States', 'USD'], ['Canada', 'CAD'], ['UAE', 'AED'],
    ['Other', ''],
  ],
  currencies: ['SGD', 'AED', 'AUD', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'HKD', 'IDR', 'INR', 'JPY',
    'KRW', 'MYR', 'NZD', 'PHP', 'THB', 'TWD', 'USD', 'VND'],
  sgGstRate: 0.09,
};

const DEFAULT_SETTINGS = {
  clientId: '',
  tenant: 'organizations',
  basePath: 'ClaudeOS STS',
  geminiKey: '',
  geminiModel: 'gemini-flash-latest',
  clients: '000 esg, 001 Udders, 002 TFS',
  paidBy: 'Company',
};
