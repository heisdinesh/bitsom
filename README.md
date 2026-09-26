# Enterprise Action Intelligence Extension

## Enterprise Information Is Everywhere. Execution Is Not.

Every day, critical business information is scattered across emails, meetings, reports, and documents.

That creates an execution gap:

- Decisions get lost.
- Actions are missed.
- Risks surface late.
- Follow-ups require manual coordination.

**The cost:** leaders spend valuable time connecting the dots instead of acting on them.

## Our Solution

An agentic system that turns fragmented organizational information into structured execution data:

- Clear action items
- Decisions
- Risks
- Follow-up workflows
- Tickets and task handoffs

This Chrome extension is the first local-first prototype. It captures work context directly from Gmail and Google Meet, analyzes it with local AI, stores structured outputs, and can create Trackleaf tickets from extracted action items.

Additionally, inside the Trackleaf platform, teams can ask AI to prioritize work based on a stated goal, using the captured actions, risks, blockers, and deadlines as context.

## Why This Approach

**Local-first AI:** keeps sensitive enterprise data local and enables low-cost AI processing.

**Browser extension:** captures business context where employees already work, without manual uploads.

**Structured outputs:** converts messy communication into JSON that downstream systems can use.

**Enterprise API integrations:** turns extracted actions into execution workflows such as tickets, tasks, and follow-ups.

## Technical Principle

**Local AI + structured outputs + existing enterprise APIs = a fast, privacy-conscious execution layer.**

## Current Prototype Functionality

- Watches Gmail inbox pages for unread mail.
- Extracts sender, received time, subject, snippet, and body.
- Stores captured mail locally as JSON.
- Uses local Ollama to extract summaries, action items, calendar candidates, and Jira-style issues.
- Creates Trackleaf tickets from extracted action items.
- Uses Trackleaf `BUG` type when an email looks like a user bug report.
- Captures Google Meet captions when captions/transcript are enabled.
- Saves Meet captions locally every 10 seconds.
- Detects when a Meet call ends on the same page.
- Summarizes Meet sessions and extracts action items using local Ollama.
- Creates Trackleaf tickets from Meet action items.
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

## Developer Docs

Detailed setup, console commands, JSON shapes, integration notes, and troubleshooting are in:

```text
docs/DEVELOPER.md
```

## Security Note

The current local build includes a hardcoded Trackleaf bearer token for testing. Rotate it before production use or before sharing this extension.
