# Gmail New Mail Console Logger

Unpacked Chrome extension that watches Gmail inbox pages and logs unread/new message details to the page console.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `gmail-mail-console-extension`.
5. Open Gmail at `https://mail.google.com/mail/u/0/#inbox`.
6. Open DevTools on the Gmail tab and check the Console.

## What it logs

The content script logs:

- `New mail detected`: message id, subject, and inbox snippet.
- `New mail details`: message id, subject, and body text scraped from the opened email.

## Notes

- The script runs only on `https://mail.google.com/mail/u/*`.
- To read the body, it opens unread messages in the current Gmail tab, scrapes the visible message, then navigates back to the inbox.
- Gmail does not provide a stable public DOM contract, so selectors may need updates if Gmail changes its markup.
- Processed message ids are cached in `localStorage` to avoid logging the same message repeatedly.
