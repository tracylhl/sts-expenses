# STS Expenses — iPhone receipt app

Take a photo of a receipt. The app reads it and adds the expense straight into the STS Books on OneDrive.

## What it does

- Reads the receipt on the phone (free OCR). The "Fix with AI" button uses Google Gemini (free).
- Uses Singapore and SGD by default. You can pick another country and currency. It converts to SGD with the rate for the receipt date (ECB rates via Frankfurter; ExchangeRate-API for other currencies).
- Adds **one new row** to the `Expenses` sheet of the newest `*_STS_Books_v*.xlsx` in `operations/accounting/`. It never changes or deletes existing rows.
- **One new version each month.** Your first save in a new month copies `vN` to `yymmdd_STS_Books_vN+1.xlsx` and moves `vN` to `archive/`.
- Saves the receipt photo to `operations/accounting/Invoices and expenses/receipts/YYYY-MM/<client>/`. Expenses with no client go to `STS general/`.
- If OneDrive is offline or the file is locked, the expense waits on the phone and syncs later.
- Each saved row has the tag `[app:<id>]` in Notes, so a retry never adds the same expense twice.

## One-time setup (about 30 minutes)

### 1. Put the app online (free)

The iPhone camera and the Microsoft sign-in need a secure (https) web address.

**GitHub Pages**
1. Make a free account at github.com.
2. Make a new **private** repository called `sts-expenses`. (Pages for private repos needs GitHub Pro. If you have no Pro, use a public repository. It holds only app code, never your data or keys.)
3. Upload every file in this folder.
4. Go to Settings → Pages. Set Source = `main` branch, folder `/ (root)`. Save.
5. Your address is `https://<your-username>.github.io/sts-expenses/`. Write it down.

### 2. Allow the app to use OneDrive (Microsoft Entra)

1. Go to entra.microsoft.com. Sign in with your Shoot the Stars admin account.
2. Go to **Applications → App registrations → New registration**.
   - Name: `STS Expenses`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: platform **Single-page application (SPA)**. Value: your address from step 1, e.g. `https://<your-username>.github.io/sts-expenses/`
3. Click **Register**. Copy the **Application (client) ID** and the **Directory (tenant) ID**.
4. Go to **API permissions → Add a permission → Microsoft Graph → Delegated**. Add `Files.ReadWrite` and `User.Read`. Click **Grant admin consent**.

### 3. Get a free Gemini key (for "Fix with AI")

1. Go to aistudio.google.com. Sign in with a Google account.
2. Click **Get API key → Create API key**. Copy it.
3. Note: on the free plan, Google can use what you send to improve its models. Send receipts only.

### 4. Install on your iPhone

1. Open your address from step 1 in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open the app from the Home Screen. Tap **Settings**:
   - App (client) ID and Tenant ID from step 2
   - Folder in OneDrive: `ClaudeOS STS` (the folder that holds `operations/`)
   - Gemini API key from step 3
4. Tap **Save settings**, then **Sign in to Microsoft**.

## Daily use

1. Tap **Take photo**.
2. Check the fields. Tap **Fix with AI** if something is wrong.
3. Pick the **P&L line**, the **client** and **Paid by**.
4. Sharing the bill? Set **Split the bill between** to the number of people, including you. Only your share goes into the books. The Notes column records the split and the receipt total.
5. Tap **Save to books**.

To correct a saved expense, edit the row in Excel by hand. The app never edits saved rows.

## Notes

- **P&L line** fills column O of the Expenses sheet. The P&L, Balance Sheet, Forecast and Loans Register add up by this column.
- **Prepaid** items also need a line on the Prepayments sheet. Ask Claude to "update the books".
- **Categories** (column D): only "Expense - Professional Fees" is confirmed from Incorpor8's file. The others are suggestions until Incorpor8 sends the full list. You can type any category.
- **GST:** STS is not GST-registered, so GST cannot be claimed back. The whole receipt total is the cost. The app puts the full total in Amount and 0 in the GST column. If STS registers for GST later, ask Claude to change this.
- **Foreign receipts:** the original amount and rate go in Notes.
- **After you change app files:** change `VERSION` in `sw.js`, so phones load the new files.

## Files

| File | Job |
|---|---|
| `index.html`, `styles.css` | Screens (STS colours and font) |
| `app.js` | Form, list, sync queue |
| `config.js` | Workbook layout, P&L lines, categories, countries |
| `ocr.js` | Free OCR + receipt rules |
| `ai.js` | Gemini "Fix with AI" (swap here for another free AI) |
| `fx.js` | Exchange rates |
| `graph.js` | Microsoft sign-in, monthly version, add row, upload receipt |
| `db.js` | On-phone storage |
| `sw.js`, `manifest.json`, icons | Home Screen app + offline |
