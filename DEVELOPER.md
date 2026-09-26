# Developer Notes

This document contains setup, debugging, and command details for the unpacked Chrome extension.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `gmail-mail-console-extension`.
5. Open Gmail at `https://mail.google.com/mail/u/0/#inbox`.
6. Open DevTools on the Gmail tab and use the console commands below.

## Gmail Commands

Run these in the normal Gmail DevTools console:

```js
gmailMailLogger.scan()
gmailMailLogger.scanVisible()
gmailMailLogger.exportJson()
gmailMailLogger.messages()
gmailMailLogger.ollamaConfig()
gmailMailLogger.configureOllama({ model: "llama3.2" })
gmailMailLogger.analyzeStored()
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
- `createTrackleafForStored()`: creates Trackleaf tickets for already analyzed stored messages.
- `reset()`: clears processed ids and captured messages.
- `processed()`: prints processed message ids.

## Ollama Setup

Start Ollama locally before scanning mail or analyzing Meet sessions:

```sh
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

For quick local testing:

```sh
OLLAMA_ORIGINS="*" ollama serve
```

Make sure the configured model is installed:

```sh
ollama pull llama3.2
```

## Trackleaf Setup

The current local build has Trackleaf enabled by default and includes a bearer token in source for testing. Rotate that token before using it outside local development.

Trackleaf ticket creation uses:

```json
{
  "url": "https://api.trackleaf.in/api/v1/ticket/create-ticket",
  "orgId": "org-01m2jbddgt7agp9j4yngcwwjxk",
  "projectId": "prj-01m3e7dk2ttp0z7k4cryj07ba4",
  "assigneeId": "usr-01kncv99nsmjxb10rnn1397xy2",
  "sprintId": null
}
```

Descriptions are sent as stringified rich-text documents:

```json
"{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"attrs\":{\"textAlign\":null},\"content\":[{\"type\":\"text\",\"text\":\"Description text\"}]}]}"
```

## Google Meet Commands

Run these in the Google Meet DevTools console:

```js
gmeetCaptionLogger.status()
gmeetCaptionLogger.save()
gmeetCaptionLogger.analyzeStored()
gmeetCaptionLogger.createTrackleafForStored()
gmeetCaptionLogger.sessions()
gmeetCaptionLogger.exportJson()
gmeetCaptionLogger.reset()
```

- `status()`: prints the current in-memory session and saved-session count.
- `save()`: saves the current meeting captions and runs Ollama analysis.
- `analyzeStored()`: analyzes saved sessions that are not already done.
- `createTrackleafForStored()`: creates Trackleaf tickets from analyzed Meet action items.
- `sessions()`: prints saved Meet caption sessions.
- `exportJson()`: saves, analyzes, and downloads all saved sessions as JSON.
- `reset()`: clears saved Meet caption sessions.

The extension auto-saves Meet captions every 10 seconds when captions exist. It also detects the same-page Meet end screen, such as `You left the meeting`, and attempts Ollama analysis.

## Notes

- Gmail data is cached in Gmail page `localStorage`.
- Meet data is cached in Meet page `localStorage`.
- Gmail DOM and Meet DOM are private Google UIs and may change; selectors may need updates.
- If `Extension context invalidated` appears, reload the extension and hard-refresh the tab.
