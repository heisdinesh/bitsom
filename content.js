(function () {
  "use strict";

  const LOG_PREFIX = "[Gmail Mail Logger]";
  const PROCESSED_KEY = "gmailMailLoggerProcessed";
  const MAIL_EXPORT_KEY = "gmailMailLoggerMessages";
  const SCAN_INTERVAL_MS = 3000;
  const OPEN_DELAY_MS = 1800;
  const RETURN_DELAY_MS = 900;
  const DEBUG_INTERVAL_MS = 10000;

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

  function clearMessages() {
    localStorage.removeItem(MAIL_EXPORT_KEY);
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
        suggestedOutputFields: ["actionItems", "tasks", "jiraIssues", "calendarEvents"]
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

  function start() {
    loadProcessedIds();

    window.gmailMailLogger = {
      scan() {
        processNewMail("manual");
        return "Unread scan requested. Check console lines starting with [Gmail Mail Logger].";
      },
      scanVisible() {
        processVisibleMail("manual");
        return "Visible inbox scan requested. This captures read and unread visible rows.";
      },
      reset() {
        processedIds.clear();
        saveProcessedIds();
        clearMessages();
        log("Processed message cache and captured JSON messages cleared.");
        return "Processed cache and captured JSON messages cleared.";
      },
      processed() {
        log("Processed message ids", Array.from(processedIds));
        return Array.from(processedIds);
      },
      messages() {
        const messages = loadMessages();
        log("Captured JSON messages", loadMessages());
        return messages;
      },
      exportJson() {
        downloadJson();
        return "JSON export requested.";
      }
    };

    log("Started. Watching Gmail inbox for unread mail. Ignore console lines that do not start with this prefix.");
    log(
      "Console commands ready: gmailMailLogger.scan(), gmailMailLogger.scanVisible(), gmailMailLogger.exportJson(), gmailMailLogger.messages(), gmailMailLogger.reset()."
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
