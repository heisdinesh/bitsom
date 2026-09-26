(function () {
  "use strict";

  const LOG_PREFIX = "[Gmail Mail Logger]";
  const PROCESSED_KEY = "gmailMailLoggerProcessed";
  const MAIL_EXPORT_KEY = "gmailMailLoggerMessages";
  const OLLAMA_CONFIG_KEY = "gmailMailLoggerOllamaConfig";
  const TRACKLEAF_CONFIG_KEY = "gmailMailLoggerTrackleafConfig";
  const SCAN_INTERVAL_MS = 3000;
  const OPEN_DELAY_MS = 1800;
  const RETURN_DELAY_MS = 900;
  const DEBUG_INTERVAL_MS = 10000;
  const COMMAND_SOURCE = "gmail-mail-json-exporter-page";
  const DEFAULT_OLLAMA_CONFIG = {
    enabled: true,
    url: "http://localhost:11434/api/chat",
    model: "llama3.2",
    temperature: 0
  };
  const DEFAULT_TRACKLEAF_CONFIG = {
    enabled: true,
    url: "https://api.trackleaf.in/api/v1/ticket/create-ticket",
    orgId: "org-01m2jbddgt7agp9j4yngcwwjxk",
    projectId: "prj-01m3e7dk2ttp0z7k4cryj07ba4",
    assigneeId: "usr-01kncv99nsmjxb10rnn1397xy2",
    sprintId: null,
    token:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InVzci0wMWtuY3Y5OW5zbWp4YjEwcm5uMTM5N3h5MiIsImVtYWlsIjoiZGluZXNoMzUzODJAZ21haWwuY29tIiwiaWF0IjoxNzkwNDA1MTQ4LCJleHAiOjE3OTE3MDExNDh9.-IK9RDvZfIWOEGhfA9ZODZr73GzW0bk2bB6A8K1fnWk",
    customFields: {
      default_field_103: 0,
      default_field_104: "BUG",
      default_field_105: "tks-01m3e7dk5w5y76yggzmeznwfzw",
      default_field_106: "pri-01kncs2n72ws974zg963y31k25",
      default_field_107: "usr-01kncv99nsmjxb10rnn1397xy2",
      default_field_109: "usr-01kncv99nsmjxb10rnn1397xy2"
    }
  };

  let isProcessing = false;
  let processedIds = new Set();
  let lastDebugAt = 0;
  let lastStatusSignature = "";
  let quietStatusUntil = 0;

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function decodeText(text) {
    const namedEntities = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " "
    };

    return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
      if (entity[0] === "#") {
        const isHex = entity[1]?.toLowerCase() === "x";
        const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }

      return Object.prototype.hasOwnProperty.call(namedEntities, entity) ? namedEntities[entity] : match;
    });
  }

  function cleanText(text) {
    return decodeText(text)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeText(text) {
    return cleanText(text).toLowerCase();
  }

  function loadProcessedIds() {
    try {
      const raw = localStorage.getItem(PROCESSED_KEY);
      processedIds = new Set(raw ? JSON.parse(raw) : []);
    } catch (error) {
      processedIds = new Set();
      console.warn(LOG_PREFIX, "Could not read processed message cache.", error);
    }
  }

  function saveProcessedIds() {
    const ids = Array.from(processedIds).slice(-500);
    localStorage.setItem(PROCESSED_KEY, JSON.stringify(ids));
  }

  function loadMessages() {
    try {
      const raw = localStorage.getItem(MAIL_EXPORT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.warn(LOG_PREFIX, "Could not read captured message JSON.", error);
      return [];
    }
  }

  function saveMessage(message) {
    const messages = loadMessages().filter((item) => item.id !== message.id);
    messages.push(message);
    localStorage.setItem(MAIL_EXPORT_KEY, JSON.stringify(messages.slice(-500)));
    return messages.length;
  }

  function updateStoredMessage(id, updater) {
    const messages = loadMessages();
    const index = messages.findIndex((message) => message.id === id);
    if (index === -1) return null;

    messages[index] = updater(messages[index]);
    localStorage.setItem(MAIL_EXPORT_KEY, JSON.stringify(messages.slice(-500)));
    return messages[index];
  }

  function clearMessages() {
    localStorage.removeItem(MAIL_EXPORT_KEY);
  }

  function loadOllamaConfig() {
    try {
      const raw = localStorage.getItem(OLLAMA_CONFIG_KEY);
      return {
        ...DEFAULT_OLLAMA_CONFIG,
        ...(raw ? JSON.parse(raw) : {})
      };
    } catch (error) {
      console.warn(LOG_PREFIX, "Could not read Ollama config.", error);
      return { ...DEFAULT_OLLAMA_CONFIG };
    }
  }

  function saveOllamaConfig(config) {
    const nextConfig = {
      ...loadOllamaConfig(),
      ...config
    };
    localStorage.setItem(OLLAMA_CONFIG_KEY, JSON.stringify(nextConfig));
    return nextConfig;
  }

  function loadTrackleafConfig() {
    try {
      const raw = localStorage.getItem(TRACKLEAF_CONFIG_KEY);
      const savedConfig = raw ? JSON.parse(raw) : {};
      return {
        ...DEFAULT_TRACKLEAF_CONFIG,
        ...savedConfig,
        customFields: {
          ...DEFAULT_TRACKLEAF_CONFIG.customFields,
          ...(savedConfig.customFields || {})
        }
      };
    } catch (error) {
      console.warn(LOG_PREFIX, "Could not read Trackleaf config.", error);
      return { ...DEFAULT_TRACKLEAF_CONFIG };
    }
  }

  function saveTrackleafConfig(config) {
    const currentConfig = loadTrackleafConfig();
    const nextConfig = {
      ...currentConfig,
      ...config,
      customFields: {
        ...currentConfig.customFields,
        ...(config?.customFields || {})
      }
    };
    localStorage.setItem(TRACKLEAF_CONFIG_KEY, JSON.stringify(nextConfig));
    return nextConfig;
  }

  function safeConfig(config) {
    return {
      ...config,
      token: config.token ? "[configured]" : ""
    };
  }

  function downloadJson() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      source: {
        app: "gmail",
        url: location.href
      },
      nextStep: {
        intendedUse: "Send emails to an LLM to extract action items, tasks, Jira tickets, and calendar events.",
        suggestedOutputFields: ["actionItems", "tasks", "risks", "jiraIssues", "calendarEvents"]
      },
      emails: loadMessages()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = `gmail-emails-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    log(`Exported ${payload.emails.length} messages to JSON.`);
  }

  function extractJsonObject(text) {
    const trimmed = String(text || "").trim();

    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");

      if (start === -1 || end === -1 || end <= start) {
        throw new Error("Ollama response did not contain a JSON object.");
      }

      return JSON.parse(trimmed.slice(start, end + 1));
    }
  }

  function buildActionItemPrompt(message) {
    const now = new Date().toISOString();

    return `You extract action items from emails.

Return only valid JSON. Do not include markdown fences or explanatory text.

Use this exact JSON shape:
{
  "status": "done",
  "summary": "one sentence summary",
  "actionItems": [
    {
      "title": "short action title",
      "description": "what needs to be done",
      "owner": "person or team responsible, or null",
      "dueDate": "YYYY-MM-DD or null",
      "priority": "low | medium | high | urgent",
      "sourceReason": "why this is an action item"
    }
  ],
  "tasks": [
    {
      "title": "task title",
      "description": "task details",
      "dueDate": "YYYY-MM-DD or null",
      "priority": "low | medium | high | urgent"
    }
  ],
  "risks": [
    {
      "title": "short risk title",
      "description": "what could go wrong and why it matters",
      "impact": "business impact",
      "severity": "low | medium | high | urgent",
      "mitigation": "recommended mitigation or null"
    }
  ],
  "jiraIssues": [
    {
      "summary": "Jira issue summary",
      "description": "Jira-ready description",
      "issueType": "Task | Bug | Story",
      "priority": "Low | Medium | High | Highest"
    }
  ],
  "calendarEvents": [
    {
      "title": "event title",
      "description": "event details",
      "start": "ISO datetime or null",
      "end": "ISO datetime or null"
    }
  ]
}

Rules:
- If there are no real action items, return empty arrays.
- Treat requests, reminders, appointments, deadlines, meetings, bookings, renewals, payments, filings, failed deployments, and verification warnings as potential action items.
- Treat user reports of broken behavior, errors, crashes, failures, regressions, incorrect output, or "not working" as bugs. Add a jiraIssues entry with issueType "Bug".
- Extract business risks when the email mentions a deadline miss, renewal delay, revenue/customer impact, compliance exposure, production failure, blocked work, or late surfacing issue.
- Preserve important business context in descriptions: customer or account name, deadline, owner/team, blocker, impacted system, risk, and requested follow-up.
- For bugs, include observed behavior, affected system/service, severity, blocker status, customer impact, and any requested fix/review in the jiraIssues description when available.
- If the email says to do something, create at least one actionItems entry and one tasks entry.
- If the email describes a meeting, appointment, visit, event, or deadline with enough date/time information, create a calendarEvents entry.
- Prefer explicit deadlines from the email. Do not invent dates or owners.
- Convert dates to YYYY-MM-DD when possible. Use the email received date and current date only to infer the year for explicit dates like "24th September".
- If a field is unknown, use JSON null, not the string "null".
- Priority guidance: urgent for overdue/compliance/account-risk/deployment-failure items, high for explicit near-term deadlines, medium for normal tasks, low for informational items.

Current timestamp: ${now}

Email JSON:
${JSON.stringify(
  {
    from: message.from,
    receivedAt: message.receivedAt,
    subject: message.subject,
    snippet: message.snippet,
    body: message.body
  },
  null,
  2
)}`;
  }

  function normalizeNullable(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return value;

    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "unknown") {
      return null;
    }

    return trimmed;
  }

  function normalizeItem(item) {
    if (!item || typeof item !== "object") return item;

    return Object.fromEntries(
      Object.entries(item).map(([key, value]) => [key, normalizeNullable(value)])
    );
  }

  function normalizeLlmResult(parsed) {
    return {
      summary: normalizeNullable(parsed.summary) || "",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(normalizeItem) : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeItem) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(normalizeItem) : [],
      jiraIssues: Array.isArray(parsed.jiraIssues) ? parsed.jiraIssues.map(normalizeItem) : [],
      calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents.map(normalizeItem) : []
    };
  }

  function sendOllamaRequest(config, payload) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        reject(
          new Error(
            "Chrome extension runtime is unavailable. Reload the extension, then hard-refresh Gmail so content.js runs in the ISOLATED extension world."
          )
        );
        return;
      }

      globalThis.chrome.runtime.sendMessage(
        {
          type: "OLLAMA_CHAT",
          url: config.url,
          payload
        },
        (response) => {
          if (globalThis.chrome.runtime.lastError) {
            reject(new Error(globalThis.chrome.runtime.lastError.message));
            return;
          }

          if (!response?.ok) {
            const errorPrefix =
              response?.status === 403
                ? "Ollama rejected the extension origin. Restart Ollama with OLLAMA_ORIGINS='chrome-extension://*' or OLLAMA_ORIGINS='*'. "
                : "";

            reject(
              new Error(
                errorPrefix +
                  (response?.error ||
                    `Ollama request failed: ${response?.status || "unknown"} ${response?.statusText || ""}`.trim())
              )
            );
            return;
          }

          resolve(response.data);
        }
      );
    });
  }

  function sendBackgroundRequest(message) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        reject(
          new Error(
            "Chrome extension runtime is unavailable. Reload the extension, then hard-refresh Gmail so content.js runs in the ISOLATED extension world."
          )
        );
        return;
      }

      globalThis.chrome.runtime.sendMessage(message, (response) => {
        if (globalThis.chrome.runtime.lastError) {
          reject(new Error(globalThis.chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(
            new Error(
              response?.error ||
                `Request failed: ${response?.status || "unknown"} ${response?.statusText || ""}`.trim()
            )
          );
          return;
        }

        resolve(response.data);
      });
    });
  }

  function getTrackleafCandidates(message) {
    const llm = message.llm || {};
    const actionItems = Array.isArray(llm.actionItems) ? llm.actionItems : [];
    const risks = Array.isArray(llm.risks) ? llm.risks : [];
    const bugIssues = (Array.isArray(llm.jiraIssues) ? llm.jiraIssues : []).filter((issue) =>
      String(issue.issueType || "").toLowerCase().includes("bug")
    );

    const candidates = actionItems.map((item, index) => ({
        key: `${message.id}:${index}:${item.title || item.summary || ""}`,
        title: item.title || item.summary || message.subject || "Email action item",
        description: buildEmailTicketDescription({
          item,
          message,
          risks,
          bugIssues,
          summary: llm.summary
        }),
        priority: item.priority || null,
        dueDate: item.dueDate || null,
        sourceReason: item.sourceReason || null,
        ticketType: inferTrackleafTicketType(item, message, bugIssues)
      }));

    for (const issue of bugIssues) {
      const alreadyRepresented = candidates.some((candidate) =>
        normalizeText(`${candidate.title} ${candidate.description}`).includes(
          normalizeText(issue.summary || issue.description || "")
        )
      );

      if (!alreadyRepresented) {
        candidates.push({
          key: `${message.id}:bug:${issue.summary || issue.description || ""}`,
          title: issue.summary || message.subject || "Bug report from email",
          description: buildEmailTicketDescription({
            item: {
              title: issue.summary,
              description: issue.description,
              priority: issue.priority,
              sourceReason: "Bug report detected from email"
            },
            message,
            risks,
            bugIssues: [issue],
            summary: llm.summary
          }),
          priority: issue.priority || "High",
          dueDate: null,
          sourceReason: "Bug report detected from email",
          ticketType: "BUG"
        });
      }
    }

    return candidates.filter((item) => item.title);
  }

  function formatLines(lines) {
    return lines
      .filter((line) => line !== undefined && line !== null && String(line).trim())
      .map((line) => String(line).trim())
      .join("\n");
  }

  function formatRisk(risk) {
    return formatLines([
      risk.title ? `- ${risk.title}` : null,
      risk.description ? `  Context: ${risk.description}` : null,
      risk.impact ? `  Impact: ${risk.impact}` : null,
      risk.severity ? `  Severity: ${risk.severity}` : null,
      risk.mitigation ? `  Mitigation: ${risk.mitigation}` : null
    ]);
  }

  function buildEmailTicketDescription({ item, message, risks, bugIssues, summary }) {
    const riskText = risks.map(formatRisk).filter(Boolean).join("\n");
    const bugText = bugIssues
      .map((issue) =>
        formatLines([
          issue.summary ? `- ${issue.summary}` : null,
          issue.description ? `  Details: ${issue.description}` : null,
          issue.priority ? `  Priority: ${issue.priority}` : null
        ])
      )
      .filter(Boolean)
      .join("\n");

    return formatLines([
      item.description || item.sourceReason || summary || message.body || message.snippet || "",
      "",
      item.dueDate ? `Due date: ${item.dueDate}` : null,
      item.priority ? `Priority: ${item.priority}` : null,
      item.owner ? `Owner: ${item.owner}` : null,
      item.sourceReason ? `Why this matters: ${item.sourceReason}` : null,
      "",
      summary ? `Email summary: ${summary}` : null,
      message.from?.name || message.from?.email
        ? `From: ${[message.from?.name, message.from?.email].filter(Boolean).join(" <")}${
            message.from?.name && message.from?.email ? ">" : ""
          }`
        : null,
      message.receivedAt ? `Received: ${message.receivedAt}` : null,
      message.subject ? `Subject: ${message.subject}` : null,
      "",
      riskText ? `Risks:\n${riskText}` : null,
      bugText ? `Bug context:\n${bugText}` : null,
      message.body ? `Original email:\n${message.body}` : null
    ]);
  }

  function inferTrackleafTicketType(item, message, bugIssues) {
    const haystack = normalizeText(
      [
        item.title,
        item.description,
        item.sourceReason,
        message.subject,
        message.snippet,
        message.body
      ]
        .filter(Boolean)
        .join(" ")
    );
    const bugWords = [
      "bug",
      "broken",
      "crash",
      "error",
      "exception",
      "failed",
      "failure",
      "not working",
      "incorrect",
      "regression",
      "issue"
    ];

    if (bugIssues.length) return "BUG";
    return bugWords.some((word) => haystack.includes(word)) ? "BUG" : "TASK";
  }

  function buildTrackleafDescription(text) {
    return JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            textAlign: null
          },
          content: [
            {
              type: "text",
              text: text || ""
            }
          ]
        }
      ]
    });
  }

  function buildTrackleafPayload(candidate, config) {
    return {
      title: candidate.title,
      description: buildTrackleafDescription(candidate.description),
      type: candidate.ticketType || "TASK",
      projectId: config.projectId,
      sprintId: config.sprintId,
      assigneeId: config.assigneeId,
      customFields: {
        ...config.customFields,
        default_field_104: candidate.ticketType || config.customFields.default_field_104
      }
    };
  }

  async function createTrackleafTicketsForMessage(message) {
    const config = loadTrackleafConfig();
    if (!config.enabled) return message;
    if (!config.token) {
      throw new Error("Trackleaf is enabled, but no bearer token is configured.");
    }

    const candidates = getTrackleafCandidates(message);
    const alreadyCreated = new Set(
      (message.trackleaf?.tickets || []).map((ticket) => ticket.candidateKey)
    );
    const tickets = [...(message.trackleaf?.tickets || [])];

    for (const candidate of candidates) {
      if (alreadyCreated.has(candidate.key)) continue;

      const payload = buildTrackleafPayload(candidate, config);
      const data = await sendBackgroundRequest({
        type: "TRACKLEAF_CREATE_TICKET",
        url: config.url,
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "x-org-id": config.orgId,
          "x-project-id": config.projectId
        },
        payload
      });

      tickets.push({
        candidateKey: candidate.key,
        createdAt: new Date().toISOString(),
        title: candidate.title,
        payload,
        response: data
      });
    }

    return updateStoredMessage(message.id, (storedMessage) => ({
      ...storedMessage,
      trackleaf: {
        status: "done",
        completedAt: new Date().toISOString(),
        tickets
      }
    }));
  }

  async function createAndStoreTrackleafTickets(message) {
    try {
      const updatedMessage = await createTrackleafTicketsForMessage(message);
      if (!updatedMessage) return null;

      if (loadTrackleafConfig().enabled) {
        log("Trackleaf ticket creation finished", {
          id: message.id,
          subject: message.subject,
          tickets: updatedMessage.trackleaf?.tickets?.length || 0
        });
      }

      return updatedMessage;
    } catch (error) {
      updateStoredMessage(message.id, (storedMessage) => ({
        ...storedMessage,
        trackleaf: {
          ...(storedMessage.trackleaf || {}),
          status: "error",
          completedAt: new Date().toISOString(),
          error: error.message
        }
      }));
      console.error(LOG_PREFIX, "Trackleaf ticket creation failed.", error);
      return null;
    }
  }

  async function analyzeMessageWithOllama(message) {
    const config = loadOllamaConfig();
    if (!config.enabled) return null;

    updateStoredMessage(message.id, (storedMessage) => ({
      ...storedMessage,
      llm: {
        ...storedMessage.llm,
        status: "processing",
        provider: "ollama",
        model: config.model,
        startedAt: new Date().toISOString()
      }
    }));

    const data = await sendOllamaRequest(config, {
      model: config.model,
      stream: false,
      options: {
        temperature: config.temperature
      },
      messages: [
        {
          role: "system",
          content:
            "You are an assistant that extracts precise, conservative action items from email. Return only valid JSON."
        },
        {
          role: "user",
          content: buildActionItemPrompt(message)
        }
      ]
    });
    const content = data.message?.content || data.response || "";
    const parsed = extractJsonObject(content);
    const normalized = normalizeLlmResult(parsed);
    const completedAt = new Date().toISOString();

    return updateStoredMessage(message.id, (storedMessage) => ({
      ...storedMessage,
      llm: {
        status: "done",
        provider: "ollama",
        model: config.model,
        startedAt: storedMessage.llm?.startedAt || null,
        completedAt,
        summary: normalized.summary,
        actionItems: normalized.actionItems,
        tasks: normalized.tasks,
        risks: normalized.risks,
        jiraIssues: normalized.jiraIssues,
        calendarEvents: normalized.calendarEvents,
        raw: parsed
      }
    }));
  }

  async function analyzeAndStoreMessage(message) {
    try {
      const analyzedMessage = await analyzeMessageWithOllama(message);
      if (!analyzedMessage) {
        log("Ollama analysis skipped because it is disabled.", { id: message.id });
        return;
      }

      log("Ollama action-item analysis stored", {
        id: message.id,
        subject: message.subject,
        actionItems: analyzedMessage.llm.actionItems.length,
        tasks: analyzedMessage.llm.tasks.length,
        risks: analyzedMessage.llm.risks.length,
        jiraIssues: analyzedMessage.llm.jiraIssues.length,
        calendarEvents: analyzedMessage.llm.calendarEvents.length
      });

      await createAndStoreTrackleafTickets(analyzedMessage);
    } catch (error) {
      updateStoredMessage(message.id, (storedMessage) => ({
        ...storedMessage,
        llm: {
          ...storedMessage.llm,
          status: "error",
          provider: "ollama",
          completedAt: new Date().toISOString(),
          error: error.message
        }
      }));
      console.error(LOG_PREFIX, "Ollama action-item analysis failed.", error);
    }
  }

  function isInboxView() {
    return window.location.hash === "#inbox" || window.location.hash.startsWith("#inbox/");
  }

  function getInboxRows() {
    const candidates = Array.from(document.querySelectorAll("tr.zA, tr[role='row']"));

    return candidates.filter((row) => {
      const subject = row.querySelector(".bog, [data-thread-id], [data-legacy-thread-id]");
      const isConversationRow =
        row.matches(".zA") ||
        row.hasAttribute("data-legacy-thread-id") ||
        row.querySelector("a[href*='#inbox/'], a[href*='#all/'], .bog");

      return subject && isConversationRow;
    });
  }

  function getMessageIdFromRow(row) {
    const link = row.querySelector("a[href*='#inbox/'], a[href*='#all/']");
    const href = link ? link.getAttribute("href") || "" : "";
    const hrefId = href.match(/#(?:inbox|all|search\/[^/]+)\/([^/?]+)/);
    const threadId = row.getAttribute("data-legacy-thread-id") || row.getAttribute("data-thread-id");
    const messageId = row.querySelector("[data-legacy-message-id]")?.getAttribute("data-legacy-message-id");
    const dataId = row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id");
    const stableId = hrefId ? hrefId[1] : threadId || dataId || messageId || href;

    return stableId || `row:${getSubjectFromRow(row)}:${getSnippetFromRow(row)}`.slice(0, 180);
  }

  function getSubjectFromRow(row) {
    const subjectNode = row.querySelector(".bog span, .bog, [data-thread-id]");
    return subjectNode ? subjectNode.textContent.trim() : "";
  }

  function getSnippetFromRow(row) {
    const snippetNode = row.querySelector(".y2, .y6");
    return snippetNode ? cleanText(snippetNode.textContent).replace(/\s+/g, " ") : "";
  }

  function getUnreadRows() {
    return getInboxRows().filter((row) => {
      const id = getMessageIdFromRow(row);
      const isUnread =
        row.classList.contains("zE") ||
        row.getAttribute("aria-label")?.toLowerCase().includes("unread") ||
        row.querySelector("[aria-label*='Unread'], [aria-label*='unread']");

      return id && isUnread && !processedIds.has(id);
    });
  }

  function getVisibleRows() {
    return getInboxRows().filter((row) => {
      const id = getMessageIdFromRow(row);
      return id && !processedIds.has(id);
    });
  }

  function debugScan(reason) {
    if (reason !== "manual" && Date.now() < quietStatusUntil) return;

    const now = Date.now();
    if (reason !== "manual" && now - lastDebugAt < DEBUG_INTERVAL_MS) return;

    lastDebugAt = now;

    const inboxRows = getInboxRows();
    const unreadRows = getUnreadRows();

    const status = {
      reason,
      hash: window.location.hash,
      inboxView: isInboxView(),
      inboxRows: inboxRows.length,
      unreadUnprocessedRows: unreadRows.length,
      processedCount: processedIds.size
    };
    const signature = JSON.stringify({
      hash: status.hash,
      inboxRows: status.inboxRows,
      unreadUnprocessedRows: status.unreadUnprocessedRows,
      processedCount: status.processedCount
    });

    if (reason === "manual" || signature !== lastStatusSignature) {
      lastStatusSignature = signature;
      log("Scan status", status);
    }
  }

  function getMessageSubject() {
    const subjectNode = document.querySelector("h2.hP, [data-legacy-message-id] h2");
    return subjectNode ? subjectNode.textContent.trim() : "";
  }

  function getOpenMessageContainer() {
    const bodyNode = document.querySelector(".a3s.aiL, .a3s");
    return bodyNode?.closest(".adn, .gs, [role='listitem']") || document;
  }

  function getSender() {
    const container = getOpenMessageContainer();
    const senderNode =
      container.querySelector(".gD[email], .go[email], span[email][name]") ||
      document.querySelector(".adn .gD[email], .adn .go[email], .adn span[email][name]");

    if (!senderNode) return null;

    return {
      name: cleanText(senderNode.getAttribute("name") || senderNode.textContent || ""),
      email:
        senderNode.getAttribute("email") ||
        senderNode.getAttribute("data-hovercard-id") ||
        null
    };
  }

  function getReceivedAt() {
    const container = getOpenMessageContainer();
    const timeNode =
      container.querySelector("span.g3[title], .gH .g3[title], [data-tooltip][alt]") ||
      document.querySelector(".adn span.g3[title], .adn .gH .g3[title]");

    return timeNode?.getAttribute("title") || timeNode?.getAttribute("data-tooltip") || null;
  }

  function getMessageBody() {
    const bodyNodes = Array.from(document.querySelectorAll(".a3s.aiL, .a3s"));
    return bodyNodes
      .map((node) => cleanText(node.innerText))
      .filter(Boolean)
      .join("\n\n--- quoted/expanded part ---\n\n");
  }

  function openRow(row) {
    const link = row.querySelector("a[href*='#inbox/'], a[href*='#all/'], .bog a");
    if (link) {
      link.click();
      return true;
    }

    const target = row.querySelector(".bog, .y6, [role='link']") || row;
    target.click();
    return true;
  }

  async function processRows(reason = "auto", mode = "unread") {
    if (isProcessing || !isInboxView()) return;

    debugScan(reason);

    const rows = mode === "visible" ? getVisibleRows() : getUnreadRows();
    if (!rows.length) return;

    isProcessing = true;

    try {
      for (const row of rows) {
        const id = getMessageIdFromRow(row);
        const listSubject = getSubjectFromRow(row);
        const snippet = getSnippetFromRow(row);

        if (!id || processedIds.has(id)) continue;

        log("Mail detected", {
          id,
          subject: listSubject,
          snippet,
          mode
        });

        openRow(row);
        await sleep(OPEN_DELAY_MS);

        const subject = getMessageSubject() || listSubject;
        const body = getMessageBody();
        const message = {
          id,
          capturedAt: new Date().toISOString(),
          source: {
            app: "gmail",
            url: location.href,
            inboxHash: "#inbox"
          },
          from: getSender(),
          receivedAt: getReceivedAt(),
          subject,
          snippet,
          body: body || "",
          llm: {
            status: "pending",
            actionItems: [],
            tasks: [],
            risks: [],
            jiraIssues: [],
            calendarEvents: []
          }
        };

        const messageCount = saveMessage(message);

        log("Captured mail as JSON", {
          id,
          subject,
          storedMessages: messageCount
        });

        processedIds.add(id);
        saveProcessedIds();
        quietStatusUntil = Date.now() + 15000;

        history.back();
        await sleep(RETURN_DELAY_MS);

        await analyzeAndStoreMessage(message);
      }
    } catch (error) {
      console.error(LOG_PREFIX, "Failed while processing new mail.", error);
    } finally {
      isProcessing = false;
    }
  }

  function processNewMail(reason = "auto") {
    return processRows(reason, "unread");
  }

  function processVisibleMail(reason = "manual") {
    return processRows(reason, "visible");
  }

  async function handlePageCommand(command, payload) {
    if (command === "scan") {
      processNewMail("manual");
    }

    if (command === "scanVisible") {
      processVisibleMail("manual");
    }

    if (command === "reset") {
      processedIds.clear();
      saveProcessedIds();
      clearMessages();
      log("Processed message cache and captured JSON messages cleared.");
    }

    if (command === "processed") {
      log("Processed message ids", Array.from(processedIds));
    }

    if (command === "messages") {
      log("Captured JSON messages", loadMessages());
    }

    if (command === "configureOllama") {
      const nextConfig = saveOllamaConfig(payload || {});
      log("Ollama config saved", nextConfig);
    }

    if (command === "ollamaConfig") {
      log("Ollama config", loadOllamaConfig());
    }

    if (command === "configureTrackleaf") {
      const nextConfig = saveTrackleafConfig(payload || {});
      log("Trackleaf config saved", safeConfig(nextConfig));
    }

    if (command === "trackleafConfig") {
      log("Trackleaf config", safeConfig(loadTrackleafConfig()));
    }

    if (command === "analyzeStored") {
      const messages = loadMessages();
      for (const message of messages) {
        if (message.llm?.status !== "done") {
          await analyzeAndStoreMessage(message);
        }
      }
      log("Stored-message analysis finished.", loadMessages());
    }

    if (command === "createTrackleafForStored") {
      const messages = loadMessages();
      for (const message of messages) {
        if (message.llm?.status === "done") {
          await createAndStoreTrackleafTickets(message);
        }
      }
      log("Trackleaf creation for stored messages finished.", loadMessages());
    }

    if (command === "exportJson") {
      downloadJson();
    }
  }

  function start() {
    loadProcessedIds();

    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== COMMAND_SOURCE) return;
      handlePageCommand(event.data.command, event.data.payload);
    });

    log("Started. Watching Gmail inbox for unread mail. Ignore console lines that do not start with this prefix.");
    log(
      "Console commands ready: gmailMailLogger.scan(), gmailMailLogger.scanVisible(), gmailMailLogger.exportJson(), gmailMailLogger.messages(), gmailMailLogger.configureOllama(), gmailMailLogger.configureTrackleaf(), gmailMailLogger.reset()."
    );

    const observer = new MutationObserver(() => {
      window.clearTimeout(start.scanTimer);
      start.scanTimer = window.setTimeout(() => processNewMail("dom-change"), 500);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.setInterval(() => processNewMail("interval"), SCAN_INTERVAL_MS);
    processNewMail("startup");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
