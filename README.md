# Etsy Listings Exporter

Small React + Tailwind tool to pull listing data from Etsy official API and paste it into Google Sheets or Excel.

## What it does

- Fetches all pages of listings for your shop state from Etsy API v3.
- Flattens all allowed listing fields from the response into table columns.
- Adds dedicated current and original price columns:
  - __current_price
  - __original_price
  - __currency
- Lets you adjust visible columns.
- Lets you sort by any column.
- One-click copy of all loaded rows as tab-separated text.
- Built-in OAuth (keystring + shared secret) to generate access and refresh tokens in the app.

## Requirements

- Node.js 20+
- Etsy app API key (keystring)
- Etsy app shared secret
- Etsy shop id
- Redirect URI configured in your Etsy app (for local use, usually http://localhost:5173/)

## Run locally

1. Install dependencies

	npm install

2. Start development server

	npm run dev

3. Open the local URL shown in terminal.

## OAuth in the app

1. Fill API Key (keystring), Shared Secret, Redirect URI, and scopes.
2. Click Start OAuth Login and authorize in Etsy.
3. Return to the app URL after Etsy authorization.
4. If your API key + shared secret are already filled, code exchange runs automatically.
5. If needed, click Exchange Code manually.
6. Click Find My Shop ID to auto-fill your shop_id from Etsy.
7. Use Refresh Token when needed.

The local Vite dev server exposes OAuth helper routes:

- POST /api/etsy/oauth/token
- POST /api/etsy/oauth/refresh

These routes are only for local dev when running npm run dev.

## Build

npm run build

## Notes

- Keep API key, shared secret, and tokens private.
- The copy action places tab-separated values on your clipboard, ready to paste directly into Sheets or Excel.
