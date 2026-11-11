# Pinterest automation

- `userscript/x.user.js` - Tampermonkey script, adds ➕ / ⬇ / @ save buttons on x.com images.
  URL and token are asked on first run and stored in Tampermonkey (not in the file).
- `apps-script/` - Google Apps Script project (push with `clasp push`).
  Secrets live in `apps-script/config.js` (gitignored). See `config.example.txt`.

## Buttons
- ➕ saves as `@handle_id_n.jpg` with the tweet link in the file description (Source URL)
- ⬇ saves as `id_n.jpg`, no credit, no link
- @ saves as `~ handle in x.com.jpg`, so the scanner puts "handle in x.com" in the pin Description

## Deploy
1. `cd apps-script && clasp push`
2. Apps Script editor: Deploy > Manage deployments > edit > New version
