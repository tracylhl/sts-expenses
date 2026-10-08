// "Fix with AI": sends the receipt photo to Google Gemini (free tier) and gets clean fields back.
// To swap to another free provider later, replace aiExtract() only; the app uses its return shape.

const AI_PROMPT = `You read a single receipt photo for a Singapore company's expense records.
Return JSON only, with these keys:
merchant (string, the shop or supplier name exactly as printed or shown as the logo at the top of THIS receipt, in Title Case, without "Pte Ltd", addresses or codes. Never guess a name that is not on the receipt, and never use a website or review-site name; use null if unreadable),
description (string, under 10 words, what was bought, e.g. "Team lunch" or "Taxi to client workshop"),
date (YYYY-MM-DD; receipts are usually day-first, e.g. 05/10/2026 is 5 Oct 2026),
currency (ISO 4217 code, e.g. SGD),
country (where the purchase happened; exactly one of: ${CONFIG.countries.map(([c]) => c).join('; ')}),
total (number, the final amount paid as printed on the receipt, including all tax and service charge; never a subtotal),
pl_line (the best match, exactly one of: ${CONFIG.plLines.join('; ')}. Food and drink = "OpEx - Meals & Entertainment". Taxi, ride-hailing, flights, hotels, parking, fuel = "OpEx - Travel & Transport". Assessment or psychometric tests = "COGS - Assessment Tools").
Use null for anything you cannot read.`;

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

async function aiExtract(blob, settings) {
  if (!settings.geminiKey) throw new Error('Add your free Gemini key in Settings first.');
  const body = {
    contents: [{ parts: [
      { text: AI_PROMPT },
      { inline_data: { mime_type: blob.type || 'image/jpeg', data: await blobToBase64(blob) } },
    ] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini error ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
  const d = JSON.parse(text.replace(/^```(?:json)?|```$/g, '').trim());
  d.merchant = cleanMerchant(d.merchant);
  d.description = sentenceCase(d.description);
  if (!CONFIG.plLines.includes(d.pl_line)) d.pl_line = classifyPL(d.merchant, d.description);
  return d;
}
