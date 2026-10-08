// OneDrive + Excel via Microsoft Graph.
// Rules this file enforces:
//  - Only ever ADDS a row to the Expenses sheet. Never edits or deletes an existing row.
//  - One new STS Books version per month (first save of a new month copies vN -> vN+1, old file -> archive/).
//  - Receipts go to receipts/YYYY-MM/<client>/.

const SCOPES = ['Files.ReadWrite', 'User.Read'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

const Graph = {
  msal: null,
  settings: null,

  async init(settings) {
    this.settings = settings;
    if (!settings.clientId || typeof msal === 'undefined') return;
    this.msal = new msal.PublicClientApplication({
      auth: {
        clientId: settings.clientId,
        authority: `https://login.microsoftonline.com/${settings.tenant || 'organizations'}`,
        redirectUri: location.origin + location.pathname,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    await this.msal.initialize();
    const r = await this.msal.handleRedirectPromise();
    const acct = r?.account || this.msal.getAllAccounts()[0];
    if (acct) this.msal.setActiveAccount(acct);
  },

  account() { return this.msal?.getActiveAccount() || null; },
  login() { return this.msal.loginRedirect({ scopes: SCOPES }); },
  logout() { return this.msal.logoutRedirect(); },

  async token() {
    if (!this.msal) throw new Error('Set up Microsoft sign-in in Settings first.');
    if (!this.account()) throw new Error('Sign in to Microsoft in Settings first.');
    try {
      return (await this.msal.acquireTokenSilent({ scopes: SCOPES })).accessToken;
    } catch (e) {
      if (e instanceof msal.InteractionRequiredAuthError) await this.msal.acquireTokenRedirect({ scopes: SCOPES });
      throw e;
    }
  },

  async call(method, path, body, headers = {}) {
    const isRaw = body instanceof Blob;
    const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? (isRaw ? body : JSON.stringify(body)) : undefined,
    });
    if (res.status === 202) return { location: res.headers.get('Location') };
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error?.message || `OneDrive error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // Path relative to the OneDrive root, e.g. "ClaudeOS STS/operations/accounting".
  full(p) { return [this.settings.basePath, p].filter(Boolean).join('/'); },
  byPath(p) { return `/me/drive/root:/${this.full(p).split('/').map(encodeURIComponent).join('/')}:`; },

  async latestBook() {
    const folder = await this.call('GET', this.byPath(CONFIG.bookFolder) + '?$select=id,parentReference');
    const kids = await this.call('GET', `/me/drive/items/${folder.id}/children?$select=id,name&$top=500`);
    let best = null;
    for (const it of kids.value) {
      const m = it.name.match(CONFIG.bookPattern);
      if (m && (!best || +m[2] > best.version)) best = { ...it, stamp: m[1], version: +m[2] };
    }
    if (!best) throw new Error(`No *_STS_Books_v*.xlsx found in ${this.full(CONFIG.bookFolder)}`);
    best.folderId = folder.id;
    best.driveId = folder.parentReference.driveId;
    return best;
  },

  // First save in a new month: copy the latest book to the next version and archive the old one.
  async bookForThisMonth() {
    const latest = await this.latestBook();
    const today = todaySGT(); // YYYY-MM-DD
    const yymm = today.slice(2, 4) + today.slice(5, 7);
    if (latest.stamp.slice(0, 4) >= yymm) return latest;

    const newName = `${today.slice(2).replace(/-/g, '')}_STS_Books_v${latest.version + 1}.xlsx`;
    const job = await this.call('POST', `/me/drive/items/${latest.id}/copy?@microsoft.graph.conflictBehavior=fail`, {
      parentReference: { driveId: latest.driveId, id: latest.folderId }, name: newName,
    });
    let newId = null;
    for (let i = 0; i < 30 && !newId; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = await (await fetch(job.location)).json();
      if (st.status === 'completed') newId = st.resourceId;
      if (st.status === 'failed') throw new Error('Could not create the new monthly books version.');
    }
    if (!newId) throw new Error('Creating the new monthly books version timed out. It will retry.');
    const archive = await this.call('GET', this.byPath(CONFIG.archiveFolder) + '?$select=id');
    await this.call('PATCH', `/me/drive/items/${latest.id}`, { parentReference: { id: archive.id } });
    return { id: newId, name: newName, version: latest.version + 1, rolledOver: latest.name };
  },

  async uploadReceipt(exp) {
    const month = exp.date.slice(0, 7);
    const client = (exp.client || 'STS general').replace(/[\\/:*?"<>|]/g, '');
    const slug = (exp.merchant || 'receipt').replace(/[^\w\- ]/g, '').trim().slice(0, 40).replace(/\s+/g, '-');
    const name = `${exp.date}_${slug}_${exp.currency}${exp.total.toFixed(2)}.jpg`;
    const path = `${CONFIG.receiptsFolder}/${month}/${client}/${name}`;
    const item = await this.call('PUT', `${this.byPath(path)}/content?@microsoft.graph.conflictBehavior=rename`,
      exp.photo, { 'Content-Type': 'image/jpeg' });
    return { webUrl: item.webUrl, path: `${month}/${client}/${item.name}` };
  },

  // Adds one row to Expenses. Returns the row number. Never touches a non-empty row.
  async appendExpense(book, exp) {
    const base = `/me/drive/items/${book.id}/workbook`;
    const session = await this.call('POST', `${base}/createSession`, { persistChanges: true });
    const h = { 'workbook-session-id': session.id };
    const ws = `${base}/worksheets('${CONFIG.sheet}')`;
    try {
      const rng = (a) => this.call('GET', `${ws}/range(address='${a}')?$select=values`, null, h);
      const colB = (await rng(`B${CONFIG.firstRow}:B${CONFIG.lastRow}`)).values;
      const colN = (await rng(`N${CONFIG.firstRow}:N${CONFIG.lastRow}`)).values;

      // Already written on an earlier try (response was lost)? Then do nothing.
      const tag = `[app:${exp.id}]`;
      const done = colN.findIndex((v) => String(v[0]).includes(tag));
      if (done >= 0) return CONFIG.firstRow + done;

      const idx = colB.findIndex((v) => v[0] === '' || v[0] === null);
      if (idx < 0) throw new Error(`Expenses sheet is full (row ${CONFIG.lastRow}). Ask Claude to extend it.`);
      const r = CONFIG.firstRow + idx;
      const check = (await rng(`C${r}:O${r}`)).values[0];
      if (check.some((v) => v !== '' && v !== null)) throw new Error(`Row ${r} is not empty. Nothing was written.`);

      const row = buildRow(r, exp, tag);
      await this.call('PATCH', `${ws}/range(address='A${r}:O${r}')`, {
        formulas: [row.formulas], numberFormat: [row.formats],
      }, h);
      return r;
    } finally {
      this.call('POST', `${base}/closeSession`, {}, h).catch(() => {});
    }
  },
};

// Excel date serial (days since 30 Dec 1899).
function excelDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

// Row in the exact shape of the existing Expenses rows (columns A–O).
function buildRow(r, exp, tag) {
  const company = exp.paidBy === 'Company';
  const d = excelDate(exp.date);
  const notes = [
    exp.currency !== 'SGD'
      ? `Orig: ${exp.currency} ${exp.total.toLocaleString('en-SG', { minimumFractionDigits: 2 })} @ ${exp.rate} (${exp.rateSource}, ${exp.rateDate})` +
        (exp.sgdManual ? '; SGD typed by hand (card statement)' : '') + `, ${exp.country}`
      : '',
    exp.client ? `Client: ${exp.client}` : '',
    exp.note || '',
    exp.receiptUrl ? `Receipt: ${exp.receiptUrl}` : '',
    tag,
  ].filter(Boolean).join('. ');
  const M = CONFIG.moneyFormat, D = CONFIG.dateFormat, G = 'General';
  return {
    formulas: [
      `=IF(B${r}="","",ROW()-4)`,
      d,
      exp.description ? `${exp.description} — ${exp.merchant}` : exp.merchant,
      exp.category,
      exp.sgdAmount,
      exp.sgdGst,
      `=IF(E${r}="","",E${r}+IF(F${r}="",0,F${r}))`,
      exp.paidBy,
      company ? 'N/A' : 'No',
      company ? d : '',
      company ? +(exp.sgdAmount + exp.sgdGst).toFixed(2) : '',
      `=IF(G${r}="","",G${r}-IF(K${r}="",0,K${r}))`,
      `=IF(G${r}="","",IF(L${r}<=0,"Paid",IF(K${r}>0,"Partially Paid","Unpaid")))`,
      notes,
      exp.plLine,
    ],
    formats: [G, D, G, G, M, M, M, G, G, D, M, M, G, G, G],
  };
}
