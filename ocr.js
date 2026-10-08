// Free on-phone OCR (Tesseract.js) plus simple rules for Singapore-style receipts.

async function runOCR(blob, onProgress) {
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress && onProgress(m.progress),
  });
  try {
    const { data } = await worker.recognize(blob);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const AMOUNT_RE = /(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\d)/g;
// Currencies that are normally printed without decimals, e.g. ¥1,280.
const WHOLE_RE = /(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(?![\d.,%])/g;
const NO_DECIMALS = ['JPY', 'KRW', 'VND', 'IDR', 'TWD'];
let wholeAmounts = false;

function amountsIn(line) {
  const re = wholeAmounts ? WHOLE_RE : AMOUNT_RE;
  return [...line.matchAll(re)].map((m) => parseFloat(m[1].replace(/,/g, '')));
}

function isoDate(y, m, d) {
  y = +y; m = +m; d = +d;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function findDate(text) {
  let m;
  if ((m = text.match(/(20\d{2})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/))) {
    const r = isoDate(m[1], m[2], m[3]); if (r) return r;
  }
  // Day-first (Singapore): 05/10/2026, 5-10-26, 05.10.2026
  if ((m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) {
    const r = isoDate(m[3], m[2], m[1]); if (r) return r;
  }
  if ((m = text.match(/\b(\d{1,2})[\s\-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,'\-]*(\d{2,4})\b/i))) {
    const r = isoDate(m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, m[1]); if (r) return r;
  }
  if ((m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i))) {
    const r = isoDate(m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, m[2]); if (r) return r;
  }
  return null;
}

function findCurrency(text) {
  const t = text.toUpperCase();
  const rules = [
    [/\bSGD\b|S\$/, 'SGD'], [/\bRM\s?\d|\bMYR\b/, 'MYR'], [/\bJPY\b|¥|円/, 'JPY'], [/€|\bEUR\b/, 'EUR'],
    [/£|\bGBP\b/, 'GBP'], [/US\$|\bUSD\b/, 'USD'], [/HK\$|\bHKD\b/, 'HKD'], [/A\$|\bAUD\b/, 'AUD'],
    [/\bTHB\b|฿/, 'THB'], [/\bIDR\b|\bRP\s?\d/, 'IDR'], [/\bVND\b|₫/, 'VND'], [/\bPHP\b|₱/, 'PHP'],
    [/\bINR\b|₹/, 'INR'], [/\bCNY\b|\bRMB\b/, 'CNY'], [/\bKRW\b|₩/, 'KRW'],
  ];
  for (const [re, cur] of rules) if (re.test(t)) return cur;
  return null;
}

function parseReceipt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { merchant: '', date: findDate(text), total: null, gst: null, currency: findCurrency(text) };
  wholeAmounts = NO_DECIMALS.includes(out.currency) && !AMOUNT_RE.test(text);
  AMOUNT_RE.lastIndex = 0;

  out.merchant = (lines.find((l) => /[A-Za-z]{3,}/.test(l) &&
    !/receipt|tax invoice|invoice|welcome|thank/i.test(l)) || '').replace(/[^\w&'.,\- ]/g, '').trim();

  // Total: prefer "grand total", then other total-like lines, searching from the bottom.
  const totalRes = [/grand\s*total/i, /(total\s*(amount|due|payable|sgd)?|amount\s*due|net+\s*total|balance\s*due|to\s*pay)/i];
  for (const re of totalRes) {
    for (let i = lines.length - 1; i >= 0 && out.total == null; i--) {
      if (re.test(lines[i]) && !/sub\s*-?\s*total/i.test(lines[i])) {
        const a = amountsIn(lines[i]);
        if (a.length) out.total = a[a.length - 1];
      }
    }
    if (out.total != null) break;
  }
  if (out.total == null) {
    const all = lines.flatMap(amountsIn);
    if (all.length) out.total = Math.max(...all);
  }

  // GST: an amount on a GST/VAT line that is smaller than the total.
  for (const l of lines) {
    if (/\b(gst|vat)\b/i.test(l)) {
      const a = amountsIn(l).filter((x) => out.total == null || x < out.total);
      if (a.length) { out.gst = a[a.length - 1]; break; }
    }
  }
  return out;
}
