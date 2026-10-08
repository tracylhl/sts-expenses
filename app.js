// Screens, form logic and the sync queue.
const $ = (s) => document.querySelector(s);
const form = $('#form');
let settings = loadSettings();
let current = null;      // expense being edited
let sgdManual = false;   // true once the user types the SGD total by hand
let syncing = false;

// ---------- settings ----------
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('settings') || '{}') }; }
  catch (e) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) {
  settings = s;
  try { localStorage.setItem('settings', JSON.stringify(s)); } catch (e) { toast('Could not save settings on this phone.'); }
}
const clients = () => settings.clients.split(',').map((c) => c.trim()).filter(Boolean);

// ---------- helpers ----------
const sgd = (n) => 'S$' + (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
function show(view) {
  for (const v of ['list', 'edit', 'settings']) $('#view-' + v).hidden = v !== view;
  $('#capture-bar').hidden = view !== 'list';
  window.scrollTo(0, 0);
}
function options(sel, items, blank) {
  sel.innerHTML = (blank ? `<option value="">${blank}</option>` : '') +
    items.map((i) => `<option>${i}</option>`).join('');
}

// Resize to max 1600px JPEG so uploads are small and OCR is fast.
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  } finally { URL.revokeObjectURL(url); }
}

// ---------- list ----------
async function renderList() {
  const month = todaySGT().slice(0, 7);
  const all = (await DB.all()).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const mine = all.filter((e) => e.date.startsWith(month) || e.status !== 'synced');
  $('#month-label').textContent = new Date(month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  $('#month-total').textContent = sgd(mine.filter((e) => e.date.startsWith(month)).reduce((s, e) => s + e.sgdAmount + e.sgdGst, 0));
  const waiting = all.filter((e) => e.status !== 'synced').length;
  $('#sync-status').textContent = waiting ? `${waiting} waiting to sync` : (all.length ? 'All saved to books' : '');
  $('#empty').hidden = mine.length > 0;
  $('#list').innerHTML = '';
  for (const e of mine) {
    const li = document.createElement('li');
    const label = { synced: `In books, row ${e.row}`, queued: 'Waiting to sync', error: 'Not saved' }[e.status];
    li.innerHTML = `<span class="m"></span><span class="a">${sgd(e.sgdAmount + e.sgdGst)}</span>
      <span class="s"></span><span class="st ${e.status}">${label}</span>`;
    li.querySelector('.m').textContent = e.merchant;
    li.querySelector('.s').textContent = [e.date.split('-').reverse().join('/'), e.client || 'STS general',
      e.currency !== 'SGD' ? `${e.currency} ${e.total.toFixed(2)}` : ''].filter(Boolean).join(' · ');
    if (e.status === 'error') {
      const p = document.createElement('span'); p.className = 's'; p.style.gridColumn = '1 / -1';
      p.textContent = e.error; li.append(p);
      const b = document.createElement('button'); b.className = 'secondary'; b.textContent = 'Try again';
      b.onclick = async () => { e.status = 'queued'; await DB.put(e); sync(); };
      li.append(b);
    }
    $('#list').append(li);
  }
}

// ---------- capture + edit ----------
async function onPhoto(file) {
  if (!file) return;
  const photo = await compress(file);
  current = { id: crypto.randomUUID(), photo, createdAt: new Date().toISOString() };
  sgdManual = false;
  form.reset();
  const f = form.elements;
  f.date.value = todaySGT();
  f.country.value = 'Singapore'; f.currency.value = 'SGD';
  f.paidBy.value = settings.paidBy;
  f.plLine.value = 'OpEx - General & Admin'; onPlLine();
  options(f.client, clients(), 'STS general (no client)');
  $('#photo').src = URL.createObjectURL(photo);
  show('edit');
  updateFx();

  $('#ocr-status').textContent = 'Reading receipt…';
  try {
    const text = await runOCR(photo, (p) => ($('#ocr-status').textContent = `Reading receipt… ${Math.round(p * 100)}%`));
    const r = parseReceipt(text);
    fill({ merchant: r.merchant, date: r.date, total: r.total, currency: r.currency, pl_line: r.pl_line });
    $('#ocr-status').textContent = 'Check the details. Tap "Fix with AI" if something is wrong.';
  } catch (e) {
    $('#ocr-status').textContent = 'Could not read the receipt. Type the details or tap "Fix with AI".';
  }
}

function fill(d) {
  const f = form.elements;
  if (d.merchant) f.merchant.value = d.merchant;
  if (d.description) f.description.value = d.description;
  if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) f.date.value = d.date;
  if (d.country && CONFIG.countries.some(([c]) => c === d.country)) f.country.value = d.country;
  if (d.currency && CONFIG.currencies.includes(d.currency)) f.currency.value = d.currency;
  if (d.total != null && !isNaN(d.total)) f.total.value = r2(d.total).toFixed(2);
  if (d.pl_line && CONFIG.plLines.includes(d.pl_line)) { f.plLine.value = d.pl_line; onPlLine(); }
  updateFx();
}

function onPlLine() {
  const f = form.elements;
  f.category.value = CONFIG.categoryFor[f.plLine.value] || f.category.value;
  $('#prepaid-warn').hidden = f.plLine.value !== 'Prepaid - Amortised';
}

let fxSeq = 0;
async function updateFx() {
  const f = form.elements;
  const cur = f.currency.value, total = +f.total.value || 0;
  const foreign = cur && cur !== 'SGD';
  $('#fx-box').hidden = !foreign;
  if (!foreign) { current.fx = { rate: 1, source: '', date: f.date.value }; return updateSgdLine(); }
  const seq = ++fxSeq;
  $('#fx-rate').textContent = 'Getting exchange rate…';
  try {
    const fx = await getRateToSGD(cur, f.date.value || todaySGT());
    if (seq !== fxSeq) return;
    current.fx = fx;
    $('#fx-rate').textContent = `1 ${cur} = ${fx.rate} SGD (${fx.source}, ${fx.date})`;
    if (!sgdManual) f.sgdTotal.value = r2(total * fx.rate).toFixed(2);
  } catch (e) {
    current.fx = null;
    $('#fx-rate').textContent = 'No rate found. Type the SGD total from your card statement.';
  }
  updateSgdLine();
}

function updateSgdLine() {
  const v = values();
  $('#sgd-line').textContent = v.sgdAmount > 0 ? `Goes into books: ${sgd(v.sgdAmount)}` +
    (v.currency === 'SGD' ? ' (same as the receipt total)' : ` (${v.currency} ${v.total.toFixed(2)} converted)`) : '';
}

// Turns the form into the expense record. SGD amounts are what goes into the books.
function values() {
  const f = form.elements;
  // STS is not GST-registered, so GST cannot be claimed back: the whole receipt total is the cost.
  // The books get exactly the receipt total (Amount = total, GST column = 0).
  const total = r2(f.total.value);
  const foreign = f.currency.value !== 'SGD';
  const sgdTotal = foreign ? r2(f.sgdTotal.value) : total;
  return {
    date: f.date.value, merchant: cleanMerchant(f.merchant.value) || f.merchant.value.trim(),
    description: sentenceCase(f.description.value),
    country: f.country.value, currency: f.currency.value || 'SGD', total,
    sgdAmount: sgdTotal, sgdGst: 0, sgdManual: foreign && sgdManual,
    rate: current?.fx?.rate || null, rateSource: current?.fx?.source || 'typed by hand', rateDate: current?.fx?.date || '',
    plLine: f.plLine.value, category: f.category.value.trim(), client: f.client.value,
    paidBy: f.paidBy.value, note: f.note.value.trim(),
  };
}

async function onSave(ev) {
  ev.preventDefault();
  const v = values();
  if (v.currency !== 'SGD' && !(v.sgdAmount > 0)) return toast('Type the SGD total first.');
  if (!(v.sgdAmount > 0)) return toast('The amount must be more than 0.');
  await DB.put({ ...current, ...v, status: 'queued' });
  current = null;
  show('list');
  await renderList();
  sync();
}

// ---------- sync queue ----------
async function sync() {
  if (syncing || !navigator.onLine) return;
  const queue = (await DB.all()).filter((e) => e.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!queue.length) return;
  if (!Graph.account()) { $('#sync-status').textContent = `${queue.length} waiting. Sign in to Microsoft in Settings.`; return; }
  syncing = true;
  try {
    const book = await Graph.bookForThisMonth();
    if (book.rolledOver) toast(`New month: created ${book.name}. ${book.rolledOver} moved to archive.`, 6000);
    for (const e of queue) {
      try {
        if (!e.receiptUrl) {
          const up = await Graph.uploadReceipt(e);
          e.receiptUrl = up.webUrl; e.receiptPath = up.path;
          await DB.put(e);
        }
        e.row = await Graph.appendExpense(book, e);
        e.book = book.name; e.status = 'synced'; e.photo = null; e.error = '';
        await DB.put(e);
      } catch (err) {
        // 423 = file locked (open somewhere); 429/5xx = busy. Keep queued and retry later.
        const retry = !err.status || err.status === 423 || err.status === 429 || err.status >= 500;
        e.status = retry ? 'queued' : 'error'; e.error = err.message;
        await DB.put(e);
        if (retry) break;
      }
      await renderList();
    }
  } catch (err) {
    $('#sync-status').textContent = `Waiting to sync: ${err.message}`;
    syncing = false;
    return;
  }
  syncing = false;
  await renderList();
}

// ---------- settings screen ----------
function renderSettings() {
  const s = $('#settings').elements;
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (s[k]) s[k].value = settings[k];
  const a = Graph.account();
  $('#ms-status').textContent = !settings.clientId ? 'Not set up yet. See README step 2.'
    : a ? `Signed in as ${a.username}` : 'Not signed in.';
  $('#btn-login').textContent = a ? 'Sign out' : 'Sign in to Microsoft';
}

// ---------- wire up ----------
async function start() {
  const f = form.elements;
  options(f.country, CONFIG.countries.map(([c]) => c));
  options(f.currency, CONFIG.currencies);
  options(f.plLine, CONFIG.plLines);
  $('#categories').innerHTML = CONFIG.categories.map((c) => `<option value="${c}">`).join('');

  f.country.onchange = () => {
    const cur = CONFIG.countries.find(([c]) => c === f.country.value)?.[1];
    if (cur) f.currency.value = cur;
    sgdManual = false; updateFx();
  };
  f.currency.onchange = () => { sgdManual = false; updateFx(); };
  f.date.onchange = updateFx;
  f.total.oninput = updateFx;
  f.sgdTotal.oninput = () => { sgdManual = true; updateSgdLine(); };
  f.plLine.onchange = onPlLine;
  form.onsubmit = onSave;

  $('#in-camera').onchange = (e) => { onPhoto(e.target.files[0]); e.target.value = ''; };
  $('#in-library').onchange = (e) => { onPhoto(e.target.files[0]); e.target.value = ''; };
  $('#btn-cancel').onclick = () => { current = null; show('list'); };
  $('#btn-ai').onclick = async () => {
    const b = $('#btn-ai'); b.disabled = true; b.textContent = 'Asking AI…';
    try { fill(await aiExtract(current.photo, settings)); toast('AI filled the form. Please check it.'); }
    catch (e) { toast(e.message, 6000); }
    finally { b.disabled = false; b.textContent = 'Fix with AI'; }
  };

  $('#nav-settings').onclick = () => { renderSettings(); show('settings'); };
  $('#btn-settings-back').onclick = () => show('list');
  $('#settings').onsubmit = async (ev) => {
    ev.preventDefault();
    const s = $('#settings').elements, next = { ...settings };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (s[k]) next[k] = s[k].value.trim();
    const msChanged = next.clientId !== settings.clientId || next.tenant !== settings.tenant;
    saveSettings(next);
    if (msChanged) await Graph.init(settings);
    toast('Settings saved.'); renderSettings();
  };
  $('#btn-login').onclick = () => {
    if (!Graph.msal) return toast('Add the App (client) ID and save settings first.');
    Graph.account() ? Graph.logout() : Graph.login();
  };

  try { await Graph.init(settings); } catch (e) { toast('Microsoft sign-in problem: ' + e.message, 6000); }
  await renderList();
  sync();
  addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
