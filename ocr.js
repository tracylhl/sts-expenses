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
    const lines = (data.lines || []).map((l) => ({
      text: l.text.trim(), x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1,
    }));
    return { text: data.text || '', lines };
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

// ---------- the total: label + print size + position + repeats ----------
const T_LABEL = /\b(?:grand\s*)?t[o0]ta[l1i|\]!]\s*(?:amount|due|payable|sgd)?|amount\s*due|net+\s*total|balance\s*due|to\s*pay\b/i;
const T_GRAND = /grand\s*t[o0]ta[l1i|\]!]/i;
const T_PAYMENT = /\b(visa|master\s*card|mastercard|amex|diners|nets|paynow|paylah|credit|debit|card)\b/i;
const T_BAD = /sub\s*-?\s*t[o0]ta|%|discount|disc\b|change|tender|cash\b|received|rcvd|rounding|service|svc|\btip\b/i;
const T_TAX = /\b(gst|vat|tax)\b/i;

// Every amount on the receipt gets points. The highest score is the total.
//   + the word "total" / a card payment on the same line     + big print (the total is usually the largest text)
//   + low on the page (after the items)                      + the same number appears twice (total and payment)
//   + it is one of the largest numbers                       - discount, tax, service, change, cash lines (subtotal: a little)
function findTotal(rows) {
  const heights = rows.map((r) => r.y1 - r.y0).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 1;
  const cands = [];
  rows.forEach((r) => {
    let a = amountsIn(r.text);
    if (!a.length && !T_BAD.test(r.text) && (T_LABEL.test(r.text) || T_PAYMENT.test(r.text) || (r.y1 - r.y0) / medH > 1.4)) {
      const m = r.text.match(/(\d{1,4})[\s.,:;'](\d{2})\s*$/);   // "12 00" or "12,00": the decimal point was read as another mark
      if (m) a = [parseFloat(m[1] + '.' + m[2])];
    }
    if (a.length && a[a.length - 1] > 0) cands.push({ r, value: a[a.length - 1], score: 0 });
  });
  if (!cands.length) return { value: null, guess: true };

  const y0 = Math.min(...cands.map((c) => c.r.y0)), y1 = Math.max(...cands.map((c) => c.r.y0));
  // "The total is one of the largest numbers": rank the amounts. Subtotal lines count (the total is never below
  // the subtotal); discount, service, tax, change and cash lines do not.
  const T_NOT_TOTAL = /%|discount|disc\b|change|tender|cash\b|received|rcvd|rounding|service|svc|\btip\b/i;
  const pool = [...new Set(cands
    .filter((c) => !T_NOT_TOTAL.test(c.r.text) && !(T_TAX.test(c.r.text) && !T_LABEL.test(c.r.text)))
    .map((c) => c.value))].sort((a, b) => b - a);

  for (const c of cands) {
    const t = c.r.text, label = T_LABEL.test(t) && !/sub\s*-?\s*t[o0]ta/i.test(t);
    if (T_GRAND.test(t)) c.score += 6;
    else if (label) c.score += 5;
    if (T_PAYMENT.test(t) && !/%|discount/i.test(t)) c.score += 3;
    if (/sub\s*-?\s*t[o0]ta/i.test(t)) c.score -= 3;          // a subtotal is a weak answer, but better than an item
    else if (T_BAD.test(t)) c.score -= 8;
    if (T_TAX.test(t) && !label) c.score -= 8;
    const ratio = (c.r.y1 - c.r.y0) / medH;                      // print size vs a typical line
    if (ratio > 1.15) c.score += Math.min(4, 4 * (ratio - 1));
    c.score += y1 > y0 ? 2 * ((c.r.y0 - y0) / (y1 - y0)) : 0;     // low on the page
    if (cands.some((o) => o !== c && Math.abs(o.value - c.value) < 0.005)) c.score += 3;   // repeated
    const rank = pool.indexOf(c.value);
    if (rank === 0) c.score += 3;                                  // the largest number on the page
    else if (rank === 1) c.score += 1.5;                           // the second largest
  }
  // Paid in cash: the total is the cash handed over minus the change (the cash number is bigger than the total).
  let derived = null;
  const CASH = /\b(cash|tendered?|received|rcvd)\b/i, CHANGE = /\bchange\b/i;
  for (const r of rows) {                                           // "Cash 50.00  Change 39.00" on one line
    const a = amountsIn(r.text);
    if (CASH.test(r.text) && CHANGE.test(r.text) && a.length >= 2) { derived = a[0] - a[a.length - 1]; break; }
  }
  if (derived == null) {                                            // or on two lines
    const cashRow = rows.find((r) => CASH.test(r.text) && !CHANGE.test(r.text) && amountsIn(r.text).length);
    const chgRow = rows.find((r) => CHANGE.test(r.text) && amountsIn(r.text).length);
    if (cashRow && chgRow) derived = amountsIn(cashRow.text).pop() - amountsIn(chgRow.text).pop();
  }
  if (derived != null && derived > 0.004) {
    derived = Math.round(derived * 100) / 100;
    const m = cands.find((c) => Math.abs(c.value - derived) < 0.005);
    if (m) m.score += 6;
    else cands.push({ r: { text: 'cash minus change' }, value: derived, score: 8 });
  }
  cands.sort((a, b) => b.score - a.score);
  return { value: cands[0].value, guess: cands[0].score < 4 || /sub\s*-?\s*t[o0]ta/i.test(cands[0].r.text) };   // a subtotal is never a sure answer
}

function parseReceipt(text, layout) {
  text = text.replace(/(?<=[一-鿿])[ 	]+(?=[一-鿿])/g, '');   // Chinese OCR puts spaces between characters
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { merchant: '', date: findDate(text), total: null, gst: null, currency: findCurrency(text) };
  wholeAmounts = NO_DECIMALS.includes(out.currency) && !AMOUNT_RE.test(text);
  AMOUNT_RE.lastIndex = 0;

  out.merchant = pickMerchant(lines);

  const rows = layout && layout.length ? layout.filter((r) => r.text) : lines.map((t, i) => ({ text: t, y0: i, y1: i + 1, x1: 0 }));
  const found = findTotal(rows);
  out.total = found.value;
  out.totalGuess = found.guess;

  out.pl_line = classifyPL(out.merchant, text, lines.slice(0, 3).join(' '));
  return out;
}
