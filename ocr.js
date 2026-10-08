// Free on-phone OCR (Tesseract.js) plus simple rules for Singapore-style receipts.

// Grey-scale + contrast stretch (and enlarge small photos). Reads prices, dates and addresses far better.
async function prepareForOCR(blob) {
  const img = await createImageBitmap(blob);
  const long = Math.max(img.width, img.height);
  const k = long < 1500 ? 1500 / long : long > 2200 ? 2200 / long : 1;   // 1500–2200 px on the long edge reads best
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  const g = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) g[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  const s = Uint8Array.from(g).sort();
  const lo = s[Math.floor(s.length * 0.02)], span = Math.max(1, s[Math.floor(s.length * 0.98)] - lo);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    p[i] = p[i + 1] = p[i + 2] = Math.max(0, Math.min(255, ((g[j] - lo) / span) * 255));
  }
  x.putImageData(d, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

async function runOCR(blob, onProgress) {
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress && onProgress(m.progress),
  });
  try {
    const { data } = await worker.recognize(await prepareForOCR(blob).catch(() => blob));
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
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function findDate(text) {
  let m;
  if ((m = text.match(/(20\d{2})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/))) {
    const r = isoDate(m[1], m[2], m[3]); if (r) return r;
  }
  // Day-first (Singapore): 05/10/2026, 5-10-26, 05.10.2026
  if ((m = text.match(/\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})\b/))) {
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
const KNOWN_ACRONYMS = ['NTUC', 'DBS', 'UOB', 'OCBC', 'SMRT', 'SBS', 'IKEA', 'NUS', 'NTU', 'CDG', 'ERP', 'MRT', 'DHL', 'UPS'];

function titleCase(s) {
  return s.split(' ').map((w) => {
    if (/^[A-Z]{2,5}$/.test(w) && (!/[AEIOU]/.test(w) || KNOWN_ACRONYMS.includes(w))) return w;   // KFC, NTUC, DBS stay
    if (/^&$/.test(w)) return w;
    return w.toLowerCase().replace(/(^|[-(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join(' ');
}

// Back to the original rule: the name is the first line with real words (no "receipt", "invoice", "welcome",
// "thank"). Only stray symbols are removed and Title Case is applied. No words are thrown away.
function cleanMerchant(raw) {
  const s = String(raw || '').replace(/[^\p{L}\p{N}&'.,\-() ]/gu, ' ').replace(/\s+/g, ' ').trim();
  return titleCase(s).slice(0, 60);
}

function pickMerchant(lines) {
  const l = lines.find((x) => /\p{L}{3,}/u.test(x) && !/receipt|tax invoice|invoice|welcome|thank/i.test(x));
  return l ? cleanMerchant(l) : '';
}

function sentenceCase(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// ---------- P&L line from the words on the receipt ----------
// Long, distinctive stems are matched anywhere in a word ("restaur" survives OCR typos).
// Short words need word edges. Chinese keywords are included for receipts read with Chinese OCR.
const PL_RULES = [
  ['COGS - Assessment Tools', /psychometric|enneagram|rheti|\b(assessment|hogan|mbti|talentsmart|strengthsfinder)\b|测评|測評|评估/i],
  ['OpEx - Software & Subscriptions', /subscript|software|hosting|workspace|openai|anthropic|github|dropbox|squarespace|godaddy|namecheap|\b(saas|cloud|domain|zoom|microsoft|adobe|canva|notion|slack|itunes|linkedin)\b|订阅|訂閱|软件|軟件/i],
  ['OpEx - Travel & Transport', /comfortdelgro|transitlink|airline|airways|airasia|jetstar|boarding|airbnb|booking\.com|rental|\b(grab|gojek|taxi|cab|cdg|tada|ryde|uber|mrt|smrt|ez-?link|petrol|shell|esso|caltex|spc|parking|erp|scoot|flight|hotel|resort|agoda|hostel|train|ferry|toll|hertz|bus|metro)\b|酒店|旅馆|旅館|机场|機場|航空|出租车|的士|停车|停車|火车|火車|地铁|地鐵|巴士|高铁|高鐵|车费|車費/i],
  ['OpEx - Meals & Entertainment', /restaur|kopitiam|coffee|bistro|bakery|noodle|sushi|ramen|izakaya|buffet|catering|hawker|dessert|breakfast|brunch|lunch|dinner|starbucks|mcdonald|burger|pizza|steakhouse|teahouse|mocha|latte|cappuccino|espresso|americano|frappe|smoothie|juice|pastry|cake|sandwich|salad|pasta|steak|fries|wings|beer|wine|cocktail|dim ?sum|takeaway|take-away|dine-?in|service charge|\d+ ?% ?(svc|service)|\btable\b|\bguests?\b|\bdiners\b|\b(cafe|café|kopi|bar|pub|grill|kitchen|diner|eatery|food|bread|toast|laksa|rice|chicken|dining|tea|deli|meal|drinks?|beverage|ya kun|kfc|koi|liho|gong cha)\b|餐厅|餐廳|餐馆|餐館|饭店|飯店|酒楼|酒樓|茶餐厅|小吃|美食|火锅|火鍋|烧烤|燒烤|点心|點心|面馆|麵館|粥|奶茶|咖啡|饮料|飲料|鸡|雞|鱼|魚|肉|汤|湯|饭|飯|面|麵|茶|菜/i],
  ['OpEx - General & Admin', /stationery|photocopy|postage|singpost|lalamove|toner|\b(office|printer|ink|paper|popular|daiso|ikea|courier|print|bank charge|bank fee)\b|文具|办公|辦公|打印|邮政|郵政|快递|快遞/i],
];

const countHits = (re, s) => (String(s || '').match(new RegExp(re.source, 'gi')) || []).length;

// 1st: the name of the establishment (the shop name, then the top 3 lines where it is printed).
// 2nd, only if the name is not clear: the items purchased (the whole text).
// The first place with a match decides. OCR turns unreadable lines (e.g. Chinese) into random
// English-looking junk that can match anything, so the items must never outvote the name.
// Returns null when nothing matches, so the form asks you instead of guessing.
function classifyPL(merchant, text, header) {
  for (const where of [merchant, header, text]) {
    let best = null, bestHits = 0;
    for (const [line, re] of PL_RULES) {
      const n = countHits(re, where);
      if (n > bestHits) { best = line; bestHits = n; }
    }
    if (best) return best;
  }
  return null;
}

function parseReceipt(text) {
  text = text.replace(/(?<=[一-鿿])[ 	]+(?=[一-鿿])/g, '');   // Chinese OCR puts spaces between characters
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { merchant: '', date: findDate(text), total: null, gst: null, currency: findCurrency(text) };
  wholeAmounts = NO_DECIMALS.includes(out.currency) && !AMOUNT_RE.test(text);
  AMOUNT_RE.lastIndex = 0;

  out.merchant = pickMerchant(lines);

  // Total, in order of trust: "grand total" -> a "total" line (OCR typos like "Tota]" allowed) ->
  // the card/payment line ("VISA 12.00") -> the biggest plain amount. Subtotal, discount and "%" lines are never used.
  const TOTAL = /\b(?:grand\s*)?t[o0]ta[l1i|\]!]\s*(?:amount|due|payable|sgd)?|amount\s*due|net+\s*total|balance\s*due|to\s*pay\b/i;
  const GRAND = /grand\s*t[o0]ta[l1i|\]!]/i;
  const PAYMENT = /\b(visa|master\s*card|mastercard|amex|diners|nets|paynow|paylah|credit|debit|card)\b/i;
  const SKIP = /sub\s*-?\s*t[o0]ta|%|discount|disc\b|change|tender|cash\b|rounding/i;
  const usable = (l) => !SKIP.test(l) && amountsIn(l).length;
  for (const re of [GRAND, TOTAL, PAYMENT]) {
    for (let i = lines.length - 1; i >= 0 && out.total == null; i--) {
      if (re.test(lines[i]) && (re !== PAYMENT || !/discount|%/i.test(lines[i])) && !/sub\s*-?\s*t[o0]ta/i.test(lines[i])) {
        const a = amountsIn(lines[i]);
        if (a.length) out.total = a[a.length - 1];
      }
    }
    if (out.total != null) break;
  }
  if (out.total == null) {
    const all = lines.filter(usable).flatMap(amountsIn);
    if (all.length) out.total = Math.max(...all);
  }

  out.pl_line = classifyPL(out.merchant, text, lines.slice(0, 3).join(' '));
  return out;
}
