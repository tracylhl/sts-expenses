// Exchange rates to SGD.
// 1st choice: Frankfurter (European Central Bank rates, by receipt date, free, no key).
// Fallback for currencies the ECB does not cover (e.g. VND, TWD): ExchangeRate-API latest rate.

async function getRateToSGD(currency, date) {
  if (!currency || currency === 'SGD') return { rate: 1, source: '', date };
  const key = `fx:${currency}:${date}`;
  try {
    const hit = localStorage.getItem(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* storage blocked: just fetch */ }

  let out = null;
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${date}?from=${currency}&to=SGD`);
    if (r.ok) {
      const j = await r.json();
      if (j.rates?.SGD) out = { rate: j.rates.SGD, source: 'ECB', date: j.date };
    }
  } catch (e) { /* try fallback */ }
  if (!out) {
    const r = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
    const j = await r.json();
    if (j.result !== 'success' || !j.rates?.SGD) throw new Error(`No exchange rate found for ${currency}`);
    out = { rate: j.rates.SGD, source: 'ExchangeRate-API, latest', date: todaySGT() };
  }
  try { localStorage.setItem(key, JSON.stringify(out)); } catch (e) { /* ignore */ }
  return out;
}

function todaySGT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timeZone }).format(new Date());
}
