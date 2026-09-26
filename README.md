# Gmail Mail JSON Exporter

Unpacked Chrome extension that watches Gmail inbox pages, captures unread/new message details, stores them as JSON in browser storage, and exports them to a `.json` file.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `gmail-mail-console-extension`.
5. Open Gmail at `https://mail.google.com/mail/u/0/#inbox`.
6. Open DevTools on the Gmail tab and use the console commands below.

## JSON Shape

The exported file has this top-level shape:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-09-26T00:00:00.000Z",
  "source": {
    "app": "gmail",
    "url": "https://mail.google.com/mail/u/0/#inbox"
  },
  "nextStep": {
    "intendedUse": "Send emails to an LLM to extract action items, tasks, Jira tickets, and calendar events.",
    "suggestedOutputFields": ["actionItems", "tasks", "jiraIssues", "calendarEvents"]
  },
  "emails": []
}
```

Other Gmail console warnings, such as `migrate_from`, `Deprecated API`, `attribution-reporting`, `403`, and `Permissions policy violation`, are emitted by Gmail or Chrome internals.

## Console commands

Run these in the normal Gmail DevTools console:

```js
gmailMailLogger.scan()
gmailMailLogger.exportJson()
gmailMailLogger.messages()
gmailMailLogger.reset()
gmailMailLogger.processed()
```

- `scan()`: finds unread inbox mail, opens it, captures it as JSON, and returns to the inbox.
- `exportJson()`: downloads the captured messages as a JSON file.
- `messages()`: prints captured JSON messages to the console for inspection.
- `reset()`: clears processed ids and captured messages.
- `processed()`: prints processed message ids.

After changing the extension files, reload the extension from `chrome://extensions` and refresh Gmail.

## Notes

- The script runs only on `https://mail.google.com/mail/u/*`.
- To read the body, it opens unread messages in the current Gmail tab, scrapes the visible message, stores JSON, then navigates back to the inbox.
- Gmail does not provide a stable public DOM contract, so selectors may need updates if Gmail changes its markup.
- Processed message ids and captured messages are cached in `localStorage`.
