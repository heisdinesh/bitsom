(function () {
  "use strict";

  const LOG_PREFIX = "[Gmail Mail Logger]";
  const PROCESSED_KEY = "gmailMailLoggerProcessed";
  const SCAN_INTERVAL_MS = 3000;
  const OPEN_DELAY_MS = 1800;
  const RETURN_DELAY_MS = 900;
  const DEBUG_INTERVAL_MS = 10000;

  let isProcessing = false;
  let processedIds = new Set();
  let lastDebugAt = 0;

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const hrefId = href.match(/#(?:inbox|all)\/([^/?]+)/);
    const threadId = row.getAttribute("data-legacy-thread-id") || row.getAttribute("data-thread-id");
    const messageId = row.querySelector("[data-legacy-message-id]")?.getAttribute("data-legacy-message-id");
    return hrefId ? hrefId[1] : threadId || messageId || href || row.innerText.slice(0, 120);
  }

  function getSubjectFromRow(row) {
    const subjectNode = row.querySelector(".bog span, .bog, [data-thread-id]");
    return subjectNode ? subjectNode.textContent.trim() : "";
  }

  function getSnippetFromRow(row) {
    const snippetNode = row.querySelector(".y2, .y6");
    return snippetNode ? snippetNode.textContent.replace(/\s+/g, " ").trim() : "";
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

  function debugScan(reason) {
    const now = Date.now();
    if (reason !== "manual" && now - lastDebugAt < DEBUG_INTERVAL_MS) return;

    lastDebugAt = now;

    const inboxRows = getInboxRows();
    const unreadRows = getUnreadRows();

    log("Scan status", {
      reason,
      hash: window.location.hash,
      inboxView: isInboxView(),
      inboxRows: inboxRows.length,
      unreadUnprocessedRows: unreadRows.length,
      processedCount: processedIds.size
    });
  }

  function getMessageSubject() {
    const subjectNode = document.querySelector("h2.hP, [data-legacy-message-id] h2");
    return subjectNode ? subjectNode.textContent.trim() : "";
  }

  function getMessageBody() {
    const bodyNodes = Array.from(document.querySelectorAll(".a3s.aiL, .a3s"));
    return bodyNodes
      .map((node) => node.innerText.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim())
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

  async function processNewMail(reason = "auto") {
    if (isProcessing || !isInboxView()) return;

    debugScan(reason);

    const rows = getUnreadRows();
    if (!rows.length) return;

    isProcessing = true;

    try {
      for (const row of rows) {
        const id = getMessageIdFromRow(row);
        const listSubject = getSubjectFromRow(row);
        const snippet = getSnippetFromRow(row);

        if (!id || processedIds.has(id)) continue;

        log("New mail detected", {
          id,
          subject: listSubject,
          snippet
        });

        openRow(row);
        await sleep(OPEN_DELAY_MS);

        const subject = getMessageSubject() || listSubject;
        const body = getMessageBody();

        log("New mail details", {
          id,
          subject,
          body: body || "(Body not found in current Gmail DOM.)"
        });

        processedIds.add(id);
        saveProcessedIds();

        history.back();
        await sleep(RETURN_DELAY_MS);
      }
    } catch (error) {
      console.error(LOG_PREFIX, "Failed while processing new mail.", error);
    } finally {
      isProcessing = false;
    }
  }

  function start() {
    loadProcessedIds();
    log("Started. Watching Gmail inbox for unread mail.");

    window.gmailMailLogger = {
      scan() {
        debugScan("manual");
        return processNewMail("manual");
      },
      reset() {
        processedIds.clear();
        saveProcessedIds();
        log("Processed message cache cleared.");
      },
      processed() {
        return Array.from(processedIds);
      }
    };

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
