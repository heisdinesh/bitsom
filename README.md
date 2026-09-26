# Gmail and Meet Action Logger

Unpacked Chrome extension for turning Gmail messages and Google Meet captions into structured action data.

## What It Does

- Watches Gmail inbox pages for unread mail.
- Opens new mail, extracts sender, received time, subject, snippet, and body.
- Stores captured mail locally as JSON.
- Sends email content to local Ollama to extract summaries, action items, tasks, calendar candidates, and Jira-style issues.
- Creates Trackleaf tickets from extracted action items.
- Uses Trackleaf `BUG` type when an email looks like a user bug report.
- Watches Google Meet pages for visible captions when captions/transcript are enabled.
- Saves Meet captions locally every 10 seconds.
- Detects the same-page Meet end screen, saves the meeting transcript, and runs Ollama analysis.
- Creates Trackleaf tickets from Google Meet action items.
- Exports captured Gmail and Meet data as JSON files.

## Quick Start

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

```text
gmail-mail-console-extension
```

5. Start Ollama:

```sh
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

6. Ensure the model exists:

```sh
ollama pull llama3.2
```

## Gmail Usage

Open Gmail, then run commands in the Gmail DevTools console:

```js
gmailMailLogger.scan()
gmailMailLogger.exportJson()
```

Useful commands:

```js
gmailMailLogger.scanVisible()
gmailMailLogger.messages()
gmailMailLogger.analyzeStored()
gmailMailLogger.createTrackleafForStored()
gmailMailLogger.reset()
```

## Google Meet Usage

Open Google Meet with captions enabled, then run commands in the Meet DevTools console:

```js
gmeetCaptionLogger.status()
gmeetCaptionLogger.save()
gmeetCaptionLogger.exportJson()
```

Useful commands:

```js
gmeetCaptionLogger.analyzeStored()
gmeetCaptionLogger.createTrackleafForStored()
gmeetCaptionLogger.sessions()
gmeetCaptionLogger.reset()
```

## Storage

- Gmail captures are stored in Gmail page `localStorage`.
- Meet sessions are stored in Meet page `localStorage`.
- Export commands download JSON files to the browser downloads folder.

## Developer Docs

Detailed setup, JSON shapes, console commands, integration notes, and troubleshooting are in:

```text
docs/DEVELOPER.md
```

## Security Note

The current local build includes a hardcoded Trackleaf bearer token for testing. Rotate it before production use or before sharing this extension.
