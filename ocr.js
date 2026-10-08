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

// ---------- formatting ----------
const COMPANY_WORDS = /\b(pte\.?|ltd\.?|private|limited|sdn\.?|bhd\.?|inc\.?|llp|co\.?)\b/gi;
const NOT_A_NAME = /receipt|tax invoice|invoice|welcome|thank|\btel\b|phone|\bgst\b|\breg\b|cashier|\border\b|\btable\b|\bdate\b|\btime\b|www\.|\.com/i;
const KNOWN_ACRONYMS = ['NTUC', 'DBS', 'UOB', 'OCBC', 'SMRT', 'SBS', 'IKEA', 'NUS', 'NTU', 'CDG', 'ERP', 'MRT', 'DHL', 'UPS'];

function titleCase(s) {
  return s.split(' ').map((w) => {
    if (/^[A-Z]{2,5}$/.test(w) && (!/[AEIOU]/.test(w) || KNOWN_ACRONYMS.includes(w))) return w;   // KFC, NTUC, DBS stay
    if (/^&$/.test(w)) return w;
    return w.toLowerCase().replace(/(^|[-(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join(' ');
}

// Turns messy OCR text such as "|§ KOPITIAM caFE 7 PTE LTD" into "Kopitiam Cafe".
function cleanMerchant(raw) {
  let s = String(raw || '').replace(COMPANY_WORDS, ' ');
  s = s.replace(/[^\p{L}\p{N}&'\-. ]/gu, ' ').replace(/(?<=\p{L})0(?=\p{L})/gu, 'o');   // OCR reads the letter o as zero
  const words = s.split(/\s+/).map((w) => w.replace(/^[-'.]+|[-'.]+$/g, '')).filter((w) => {
    if (w === '&') return true;
    const letters = (w.match(/\p{L}/gu) || []).length;
    return letters >= 2 && letters / w.length >= 0.7;           // drops stray symbols, digits and mixed junk
  });
  return titleCase(words.join(' ')).slice(0, 60).trim();
}

function pickMerchant(lines) {
  for (const l of lines.slice(0, 8)) {
    if (NOT_A_NAME.test(l)) continue;
    const c = cleanMerchant(l);
    if ((c.match(/\p{L}/gu) || []).length >= 3) return c;
  }
  return '';
}

function sentenceCase(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ---------- P&L line from the words on the receipt ----------
const PL_RULES = [
  ['COGS - Assessment Tools', /\b(rheti|enneagram|assessment|psychometric|hogan|mbti|talentsmart|strengthsfinder|disc profile)\b/i],
  ['OpEx - Software & Subscriptions', /\b(subscription|software|saas|cloud|hosting|domain|zoom|microsoft|office 365|google workspace|adobe|canva|openai|anthropic|github|dropbox|notion|slack|itunes|app store|linkedin|squarespace|godaddy|namecheap)\b/i],
  ['OpEx - Travel & Transport', /\b(grab|gojek|taxi|cab|comfortdelgro|cdg|tada|ryde|uber|mrt|smrt|sbs transit|ez-?link|transitlink|petrol|shell|esso|caltex|spc|parking|erp|airline|airlines|airways|scoot|jetstar|airasia|flight|boarding|hotel|resort|airbnb|booking\.com|agoda|hostel|train|ferry|toll|car rental|hertz|bus|metro|subway ticket)\b/i],
  ['OpEx - Meals & Entertainment', /\b(restaurant|cafe|café|coffee|kopi|kopitiam|bistro|bar|pub|grill|kitchen|diner|eatery|food|bakery|bread|toast|laksa|noodles?|rice|chicken|pizza|burger|sushi|ramen|starbucks|mcdonald'?s|kfc|ya kun|dining|catering|lunch|dinner|breakfast|tea|bubble tea|gong cha|liho|koi|deli|buffet|meal|beverage|drinks?|dessert|ice cream|hawker|izakaya|brunch)\b/i],
  ['OpEx - General & Admin', /\b(stationery|office|printer|ink|toner|paper|popular|daiso|ikea|courier|postage|singpost|lalamove|print|photocopy|bank charge|bank fee)\b/i],
];

function classifyPL(merchant, text) {
  for (const [line, re] of PL_RULES) if (re.test(merchant || '')) return line;   // the shop name is the strongest hint
  let best = null, bestHits = 0;
  for (const [line, re] of PL_RULES) {
    const hits = (String(text || '').match(new RegExp(re.source, 'gi')) || []).length;
    if (hits > bestHits) { best = line; bestHits = hits; }
  }
  return best || 'OpEx - General & Admin';
}

function parseReceipt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { merchant: '', date: findDate(text), total: null, gst: null, currency: findCurrency(text) };
  wholeAmounts = NO_DECIMALS.includes(out.currency) && !AMOUNT_RE.test(text);
  AMOUNT_RE.lastIndex = 0;

  out.merchant = pickMerchant(lines);

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

  out.pl_line = classifyPL(out.merchant, text);
  return out;
}
