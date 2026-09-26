# Gmail Mail JSON Exporter

Unpacked Chrome extension that watches Gmail inbox pages, captures unread/new message details, stores them as JSON in browser storage, sends each captured email to local Ollama for action-item extraction, and exports everything to a `.json` file.

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
gmailMailLogger.ollamaConfig()
gmailMailLogger.configureOllama({ model: "llama3.2" })
gmailMailLogger.analyzeStored()
gmailMailLogger.configureTrackleaf({ enabled: true, token: "YOUR_TRACKLEAF_TOKEN" })
gmailMailLogger.trackleafConfig()
gmailMailLogger.createTrackleafForStored()
gmailMailLogger.reset()
gmailMailLogger.processed()
```

- `scan()`: finds unread inbox mail, opens it, captures it as JSON, and returns to the inbox.
- `scanVisible()`: captures visible inbox rows, including read mail.
- `exportJson()`: downloads the captured messages as a JSON file.
- `messages()`: prints captured JSON messages to the console for inspection.
- `ollamaConfig()`: prints the current local Ollama settings.
- `configureOllama(...)`: updates the local Ollama settings.
- `analyzeStored()`: runs Ollama analysis for stored messages that are not already done.
- `configureTrackleaf(...)`: enables/configures Trackleaf ticket creation.
- `trackleafConfig()`: prints Trackleaf settings with the token masked.
- `createTrackleafForStored()`: creates Trackleaf tickets for already analyzed stored messages.
- `reset()`: clears processed ids and captured messages.
- `processed()`: prints processed message ids.

After changing the extension files, reload the extension from `chrome://extensions` and refresh Gmail.

## Ollama Setup

Start Ollama locally before scanning mail. Because this extension calls Ollama from a Chrome extension origin, allow that origin when starting Ollama:

```sh
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

For quick local testing, this also works:

```sh
OLLAMA_ORIGINS="*" ollama serve
```

If the Ollama desktop app is already running on macOS, quit it first or stop the existing Ollama server before running one of the commands above.

Make sure the configured model is installed:

```sh
ollama pull llama3.2
```

The default config is:

```json
{
  "enabled": true,
  "url": "http://localhost:11434/api/chat",
  "model": "llama3.2",
  "temperature": 0
}
```

To use another model:

```js
gmailMailLogger.configureOllama({ model: "mistral" })
```

If Ollama is not running or the browser blocks the local request, the email is still captured and the `llm` field is stored with `status: "error"`.

## Trackleaf Setup

Trackleaf ticket creation is disabled until you configure a bearer token locally in the Gmail console. Do not commit tokens into this repository.

```js
gmailMailLogger.configureTrackleaf({
  enabled: true,
  token: "YOUR_TRACKLEAF_TOKEN"
})
```

The default Trackleaf config uses:

```json
{
  "url": "https://api.trackleaf.in/api/v1/ticket/create-ticket",
  "orgId": "org-01m2jbddgt7agp9j4yngcwwjxk",
  "projectId": "prj-01m3e7dk2ttp0z7k4cryj07ba4",
  "assigneeId": "usr-01kncv99nsmjxb10rnn1397xy2",
  "sprintId": null
}
```

After Ollama finishes, the extension creates one Trackleaf `TASK` ticket for each extracted action item/task. To create tickets for already analyzed stored messages:

```js
gmailMailLogger.createTrackleafForStored()
```

Ticket API responses are stored back into each email under `trackleaf.tickets`.

## Notes

- The script runs only on `https://mail.google.com/mail/u/*`.
- To read the body, it opens unread messages in the current Gmail tab, scrapes the visible message, stores JSON, asks Ollama for action items, creates Trackleaf tickets when enabled, then navigates back to the inbox.
- Gmail does not provide a stable public DOM contract, so selectors may need updates if Gmail changes its markup.
- Processed message ids and captured messages are cached in `localStorage`.
