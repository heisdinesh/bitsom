(function () {
  "use strict";

  const LOG_PREFIX = "[GMeet Caption Logger]";
  const COMMAND_SOURCE = "gmeet-caption-json-exporter-page";
  const STORAGE_KEY = "gmeetCaptionLoggerSessions";
  const SCAN_DEBOUNCE_MS = 250;
  const AUTO_SAVE_INTERVAL_MS = 10000;
  const MIN_TEXT_LENGTH = 3;
  const MAX_TEXT_LENGTH = 700;
  const RELATED_WORD_OVERLAP = 0.62;
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
  const UI_TEXT_PATTERNS = [
    /language\s+english/gi,
    /format_size\s+font size/gi,
    /circle\s+font color/gi,
    /settings\s+open caption settings/gi,
    /arrow_downward\s*jump to bottom/gi,
    /jump to bottom/gi
  ];

  let scanTimer = null;
  let hasSavedOnUnload = false;
  let hasAnalyzedAfterMeetingEnd = false;
  let lastScanStats = {
    checked: 0,
    candidates: 0,
    kept: 0
  };

  const session = {
    id: createSessionId(),
    meetingCode: getMeetingCode(),
    meetingUrl: location.href,
    startedAt: new Date().toISOString(),
    endedAt: null,
    captions: []
  };

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function createSessionId() {
    return `meet:${getMeetingCode()}:${new Date().toISOString()}`;
  }

  function getMeetingCode() {
    const match = location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    return match ? match[1] : location.pathname.replace(/^\//, "") || "unknown";
  }

  function loadSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.warn(LOG_PREFIX, "Could not read Meet caption sessions.", error);
      return [];
    }
  }

  function saveSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(-50)));
  }

  function updateStoredSession(id, updater) {
    const sessions = loadSessions();
    const index = sessions.findIndex((item) => item.id === id);
    if (index === -1) return null;

    sessions[index] = updater(sessions[index]);
    saveSessions(sessions);
    return sessions[index];
  }

  function compactCaptions(captions) {
    const compacted = [];

    for (const caption of captions) {
      const text = normalizeText(caption.text);
      if (!text) continue;

      const relatedIndex = compacted.findIndex((item) => areRelatedCaptions(item, caption));

      if (relatedIndex !== -1) {
        const existing = compacted[relatedIndex];
        const existingText = normalizeText(existing.text);
        const shouldReplace = text.length >= existingText.length || caption.speaker;

        if (shouldReplace) {
          compacted[relatedIndex] = {
            ...existing,
            speaker: caption.speaker || existing.speaker,
            text,
            updatedAt: caption.updatedAt || caption.capturedAt
          };
        } else if (!existing.speaker && caption.speaker) {
          compacted[relatedIndex] = {
            ...existing,
            speaker: caption.speaker,
            updatedAt: caption.updatedAt || caption.capturedAt
          };
        }
        continue;
      }

      compacted.push({
        ...caption,
        text
      });
    }

    return compacted;
  }

  function compactSession(value) {
    return {
      ...value,
      captions: compactCaptions(value.captions || [])
    };
  }

  function saveSession() {
    if (!session.captions.length) {
      log("No captions captured yet; session not saved.");
      return null;
    }

    session.endedAt = new Date().toISOString();
    session.captions = compactCaptions(session.captions);

    const sessions = loadSessions()
      .filter((item) => item.id !== session.id)
      .map(compactSession);
    sessions.push(compactSession(session));
    saveSessions(sessions);

    log("Meet caption session saved", {
      id: session.id,
      meetingCode: session.meetingCode,
      captions: session.captions.length
    });

    return session;
  }

  function resetSessions() {
    localStorage.removeItem(STORAGE_KEY);
    session.captions = [];
    log("Meet caption sessions cleared.");
  }

  function exportJson() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      source: {
        app: "google-meet",
        url: location.href
      },
      sessions: loadSessions().map(compactSession)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = `gmeet-captions-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    log(`Exported ${payload.sessions.length} Meet caption sessions to JSON.`);
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

  function sendOllamaRequest(payload) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        reject(new Error("Chrome extension runtime is unavailable."));
        return;
      }

      globalThis.chrome.runtime.sendMessage(
        {
          type: "OLLAMA_CHAT",
          url: DEFAULT_OLLAMA_CONFIG.url,
          payload
        },
        (response) => {
          if (globalThis.chrome.runtime.lastError) {
            reject(new Error(globalThis.chrome.runtime.lastError.message));
            return;
          }

          if (!response?.ok) {
            reject(
              new Error(
                response?.error ||
                  `Ollama request failed: ${response?.status || "unknown"} ${response?.statusText || ""}`.trim()
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
        reject(new Error("Chrome extension runtime is unavailable."));
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
                `Request failed: ${response?.status || "unknown"} ${response?.statusText || ""} ${response?.body || ""}`.trim()
            )
          );
          return;
        }

        resolve(response.data);
      });
    });
  }

  function getTrackleafCandidates(value) {
    const actionItems = Array.isArray(value.llm?.actionItems) ? value.llm.actionItems : [];

    return actionItems
      .map((item, index) => ({
        key: `${value.id}:${index}:${item.title || ""}`,
        title: item.title || "Meeting action item",
        description:
          item.description ||
          item.sourceReason ||
          value.llm?.summary ||
          captionsToTranscript(value) ||
          "Action item from Google Meet transcript.",
        priority: item.priority || null,
        dueDate: item.dueDate || null,
        sourceReason: item.sourceReason || null
      }))
      .filter((item) => item.title);
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

  function buildTrackleafPayload(candidate) {
    return {
      title: candidate.title,
      description: buildTrackleafDescription(candidate.description),
      type: "TASK",
      projectId: DEFAULT_TRACKLEAF_CONFIG.projectId,
      sprintId: DEFAULT_TRACKLEAF_CONFIG.sprintId,
      assigneeId: DEFAULT_TRACKLEAF_CONFIG.assigneeId,
      customFields: {
        ...DEFAULT_TRACKLEAF_CONFIG.customFields
      }
    };
  }

  async function createTrackleafTicketsForSession(value) {
    if (!DEFAULT_TRACKLEAF_CONFIG.enabled) return value;
    if (!DEFAULT_TRACKLEAF_CONFIG.token) {
      throw new Error("Trackleaf is enabled, but no bearer token is configured.");
    }

    const candidates = getTrackleafCandidates(value);
    const existingTickets = value.trackleaf?.tickets || [];
    const alreadyCreated = new Set(existingTickets.map((ticket) => ticket.candidateKey));
    const tickets = [...existingTickets];

    for (const candidate of candidates) {
      if (alreadyCreated.has(candidate.key)) continue;

      const payload = buildTrackleafPayload(candidate);
      const data = await sendBackgroundRequest({
        type: "TRACKLEAF_CREATE_TICKET",
        url: DEFAULT_TRACKLEAF_CONFIG.url,
        headers: {
          Authorization: `Bearer ${DEFAULT_TRACKLEAF_CONFIG.token}`,
          "Content-Type": "application/json",
          "x-org-id": DEFAULT_TRACKLEAF_CONFIG.orgId,
          "x-project-id": DEFAULT_TRACKLEAF_CONFIG.projectId
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

    return updateStoredSession(value.id, (storedSession) => ({
      ...storedSession,
      trackleaf: {
        status: "done",
        completedAt: new Date().toISOString(),
        tickets
      }
    }));
  }

  async function createAndStoreTrackleafTickets(value) {
    try {
      const updatedSession = await createTrackleafTicketsForSession(value);
      if (!updatedSession) return null;

      log("Meet Trackleaf ticket creation finished", {
        id: value.id,
        tickets: updatedSession.trackleaf?.tickets?.length || 0
      });

      return updatedSession;
    } catch (error) {
      updateStoredSession(value.id, (storedSession) => ({
        ...storedSession,
        trackleaf: {
          ...(storedSession.trackleaf || {}),
          status: "error",
          completedAt: new Date().toISOString(),
          error: error.message
        }
      }));
      console.error(LOG_PREFIX, "Meet Trackleaf ticket creation failed.", error);
      return null;
    }
  }

  function errorDetails(error) {
    return {
      name: error?.name || "Error",
      message: error?.message || String(error),
      stack: error?.stack || null
    };
  }

  function captionsToTranscript(value) {
    return (value.captions || [])
      .map((caption) => {
        const speaker = caption.speaker || "Unknown";
        return `${speaker}: ${caption.text}`;
      })
      .join("\n");
  }

  function buildMeetingPrompt(value) {
    return `You summarize Google Meet transcripts and extract action items.

Return only valid JSON. Do not include markdown fences or explanatory text.

Use this exact JSON shape:
{
  "status": "done",
  "summary": "clear meeting summary",
  "decisions": ["decision made in the meeting"],
  "actionItems": [
    {
      "title": "short action title",
      "description": "what needs to be done",
      "owner": "person responsible, or null",
      "dueDate": "YYYY-MM-DD or null",
      "priority": "low | medium | high | urgent",
      "sourceReason": "why this is an action item"
    }
  ],
  "questions": ["open question"],
  "followUps": ["follow-up item"]
}

Rules:
- If there are no real action items, return an empty actionItems array.
- Do not invent dates or owners.
- Use JSON null, not the string "null".
- Ignore transcription glitches where possible.

Meeting metadata:
${JSON.stringify(
  {
    meetingCode: value.meetingCode,
    meetingUrl: value.meetingUrl,
    startedAt: value.startedAt,
    endedAt: value.endedAt
  },
  null,
  2
)}

Transcript:
${captionsToTranscript(value)}`;
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

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeObjectArray(value) {
    return normalizeArray(value).map((item) => {
      if (!item || typeof item !== "object") return item;
      return Object.fromEntries(
        Object.entries(item).map(([key, entryValue]) => [key, normalizeNullable(entryValue)])
      );
    });
  }

  async function analyzeMeetSession(value) {
    if (!DEFAULT_OLLAMA_CONFIG.enabled || !(value.captions || []).length) return null;

    updateStoredSession(value.id, (storedSession) => ({
      ...storedSession,
      llm: {
        ...(storedSession.llm || {}),
        status: "processing",
        provider: "ollama",
        model: DEFAULT_OLLAMA_CONFIG.model,
        startedAt: new Date().toISOString()
      }
    }));

    const data = await sendOllamaRequest({
      model: DEFAULT_OLLAMA_CONFIG.model,
      stream: false,
      options: {
        temperature: DEFAULT_OLLAMA_CONFIG.temperature
      },
      messages: [
        {
          role: "system",
          content:
            "You are an assistant that summarizes meeting transcripts and extracts conservative action items. Return only valid JSON."
        },
        {
          role: "user",
          content: buildMeetingPrompt(value)
        }
      ]
    });
    const content = data.message?.content || data.response || "";
    const parsed = extractJsonObject(content);
    const completedAt = new Date().toISOString();

    return updateStoredSession(value.id, (storedSession) => ({
      ...storedSession,
      llm: {
        status: "done",
        provider: "ollama",
        model: DEFAULT_OLLAMA_CONFIG.model,
        startedAt: storedSession.llm?.startedAt || null,
        completedAt,
        summary: normalizeNullable(parsed.summary) || "",
        decisions: normalizeArray(parsed.decisions).map(normalizeNullable).filter(Boolean),
        actionItems: normalizeObjectArray(parsed.actionItems),
        questions: normalizeArray(parsed.questions).map(normalizeNullable).filter(Boolean),
        followUps: normalizeArray(parsed.followUps).map(normalizeNullable).filter(Boolean),
        raw: parsed
      }
    }));
  }

  async function analyzeAndStoreSession(value) {
    try {
      const analyzedSession = await analyzeMeetSession(value);
      if (!analyzedSession) return null;

      log("Meet session analysis stored", {
        id: analyzedSession.id,
        actionItems: analyzedSession.llm.actionItems.length,
        decisions: analyzedSession.llm.decisions.length,
        questions: analyzedSession.llm.questions.length
      });

      await createAndStoreTrackleafTickets(analyzedSession);

      return analyzedSession;
    } catch (error) {
      const details = errorDetails(error);
      updateStoredSession(value.id, (storedSession) => ({
        ...storedSession,
        llm: {
          ...(storedSession.llm || {}),
          status: "error",
          provider: "ollama",
          completedAt: new Date().toISOString(),
          error: details.message,
          errorDetails: details
        }
      }));
      console.error(LOG_PREFIX, "Meet session analysis failed.", details);
      return null;
    }
  }

  async function analyzeStoredSessions() {
    const sessions = loadSessions().map(compactSession);
    for (const storedSession of sessions) {
      if (storedSession.captions?.length && storedSession.llm?.status !== "done") {
        await analyzeAndStoreSession(storedSession);
      }
    }

    log("Stored Meet session analysis finished.", loadSessions().map(compactSession));
  }

  async function createTrackleafForStoredSessions() {
    const sessions = loadSessions().map(compactSession);
    for (const storedSession of sessions) {
      if (storedSession.llm?.status === "done") {
        await createAndStoreTrackleafTickets(storedSession);
      }
    }

    log("Meet Trackleaf creation for stored sessions finished.", loadSessions().map(compactSession));
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function wordsForComparison(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1);
  }

  function wordOverlapRatio(a, b) {
    const aWords = wordsForComparison(a);
    const bWords = wordsForComparison(b);
    if (!aWords.length || !bWords.length) return 0;

    const shorter = aWords.length <= bWords.length ? aWords : bWords;
    const longerSet = new Set(aWords.length <= bWords.length ? bWords : aWords);
    const overlap = shorter.filter((word) => longerSet.has(word)).length;
    return overlap / shorter.length;
  }

  function areRelatedCaptions(a, b) {
    const aText = normalizeText(a.text);
    const bText = normalizeText(b.text);
    const sameOrUnknownSpeaker = !a.speaker || !b.speaker || a.speaker === b.speaker;

    if (!sameOrUnknownSpeaker) return false;
    if (aText === bText) return true;
    if (aText.startsWith(bText) || bText.startsWith(aText)) return true;
    if (wordOverlapRatio(aText, bText) >= RELATED_WORD_OVERLAP) return true;

    return false;
  }

  function stripUiText(text) {
    return UI_TEXT_PATTERNS.reduce((value, pattern) => value.replace(pattern, " "), text);
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isLikelyCaptionElement(element) {
    if (!isVisible(element)) return false;
    if (element.closest("button, input, textarea, select, [role='button'], [role='menu'], [role='toolbar']")) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const text = normalizeText(stripUiText(element.innerText || element.textContent));

    if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) return false;
    if (rect.width < 120 || rect.height < 8) return false;

    const isInCaptionZone = rect.top > window.innerHeight * 0.35;
    const hasCaptionSignal =
      element.matches("[aria-live], [role='log'], [data-message-text]") ||
      element.closest("[aria-live], [role='log'], [data-message-text]");

    if (!isInCaptionZone && !hasCaptionSignal) return false;
    return true;
  }

  function parseCaption(rawText) {
    const cleanedText = normalizeText(stripUiText(rawText));
    const lines = cleanedText
      .split(/\n+/)
      .map(normalizeText)
      .filter(Boolean);

    if (lines.length >= 2 && lines[0].length <= 80) {
      return {
        speaker: lines[0],
        text: lines.slice(1).join(" ")
      };
    }

    const speakerMatch = cleanedText.match(/^(You)\s+(.{2,})$/);
    if (speakerMatch && speakerMatch[2] && !isUiNoise(speakerMatch[1])) {
      return {
        speaker: speakerMatch[1],
        text: speakerMatch[2]
      };
    }

    return {
      speaker: null,
      text: cleanedText
    };
  }

  function isUiNoise(text) {
    const lower = text.toLowerCase();
    const blocked = [
      "turn on captions",
      "turn off captions",
      "more options",
      "leave call",
      "microphone",
      "camera",
      "present now",
      "meeting details",
      "people",
      "chat with everyone",
      "language english",
      "font size",
      "font color",
      "caption settings",
      "jump to bottom",
      "ready to join",
      "no one else is here",
      "this call is open to anyone"
    ];

    return blocked.some((item) => lower === item || lower.includes(item));
  }

  function isSpeechLike(text) {
    if (!text || isUiNoise(text)) return false;
    if (!/[a-zA-Z]/.test(text)) return false;
    if (/^(You|[A-Z][A-Za-z .'-]{1,60})$/.test(text)) return false;
    if (/^[\w-]+(?: [\w-]+){0,2}$/.test(text) && !/[.!?,]$/.test(text)) return false;
    return true;
  }

  function getCaptionCandidate(element) {
    const rawText = element.innerText || element.textContent;
    const parsed = parseCaption(rawText);
    const normalizedText = normalizeText(parsed.text);

    if (!isSpeechLike(normalizedText)) return null;

    return {
      speaker: parsed.speaker,
      text: normalizedText,
      rawText: normalizeText(stripUiText(rawText))
    };
  }

  function rememberCaptionCandidate(candidate) {
    const normalizedText = normalizeText(candidate.text);
    const relatedIndex = session.captions.findIndex((caption) =>
      areRelatedCaptions(caption, {
        ...candidate,
        text: normalizedText
      })
    );

    if (relatedIndex !== -1) {
      const existing = session.captions[relatedIndex];
      const existingText = normalizeText(existing.text);

      if (normalizedText.length >= existingText.length) {
        session.captions[relatedIndex] = {
          ...existing,
          speaker: candidate.speaker || existing.speaker,
          text: normalizedText,
          updatedAt: new Date().toISOString()
        };
      } else if (!existing.speaker && candidate.speaker) {
        session.captions[relatedIndex] = {
          ...existing,
          speaker: candidate.speaker,
          updatedAt: new Date().toISOString()
        };
      }
      return;
    }

    session.captions.push({
      capturedAt: new Date().toISOString(),
      speaker: candidate.speaker,
      text: normalizedText
    });

    log("Caption captured", {
      speaker: candidate.speaker,
      text: normalizedText
    });
  }

  function scanForCaptions() {
    const elements = Array.from(
      document.querySelectorAll("[aria-live], [role='log'], [data-message-text], [jsname], [data-self-name], div, span")
    );
    const candidates = [];
    const seenRaw = new Set();

    for (const element of elements) {
      if (!isLikelyCaptionElement(element)) continue;

      const candidate = getCaptionCandidate(element);
      if (!candidate || seenRaw.has(candidate.rawText)) continue;

      seenRaw.add(candidate.rawText);
      candidates.push(candidate);
    }

    const kept = [];
    const sortedCandidates = candidates.sort((a, b) => b.text.length - a.text.length);

    for (const candidate of sortedCandidates) {
      const isDuplicateFragment = kept.some((item) => {
        return areRelatedCaptions(item, candidate);
      });

      if (!isDuplicateFragment) {
        kept.push(candidate);
        continue;
      }

      const duplicateIndex = kept.findIndex((item) => areRelatedCaptions(item, candidate));
      if (duplicateIndex !== -1 && !kept[duplicateIndex].speaker && candidate.speaker) {
        kept[duplicateIndex] = {
          ...kept[duplicateIndex],
          speaker: candidate.speaker
        };
      }
    }

    lastScanStats = {
      checked: elements.length,
      candidates: candidates.length,
      kept: kept.length
    };

    kept
      .sort((a, b) => a.rawText.length - b.rawText.length)
      .forEach((candidate) => rememberCaptionCandidate(candidate));
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanForCaptions, SCAN_DEBOUNCE_MS);
  }

  function isMeetingEndedInSamePage() {
    const pageText = normalizeText(document.body?.innerText || "").toLowerCase();
    const endedSignals = [
      "you left the meeting",
      "return to home screen",
      "rejoin",
      "ready to join?",
      "no one else is here"
    ];

    return session.captions.length > 0 && endedSignals.some((signal) => pageText.includes(signal));
  }

  async function saveAndAnalyzeCurrentSession(reason) {
    const savedSession = saveSession();
    if (!savedSession) return;

    log("Running Meet session analysis", { reason, id: savedSession.id });
    await analyzeAndStoreSession(savedSession);
  }

  async function handleCommand(command) {
    if (command === "status") {
      log("Meet caption status", {
        currentSession: session,
        savedSessions: loadSessions().length,
        lastScanStats
      });
    }

    if (command === "save") {
      await saveAndAnalyzeCurrentSession("manual-save");
    }

    if (command === "sessions") {
      log("Meet caption sessions", loadSessions());
    }

    if (command === "analyzeStored") {
      await analyzeStoredSessions();
    }

    if (command === "createTrackleafForStored") {
      await createTrackleafForStoredSessions();
    }

    if (command === "exportJson") {
      await saveAndAnalyzeCurrentSession("manual-export");
      exportJson();
    }

    if (command === "reset") {
      resetSessions();
    }
  }

  function start() {
    log("Started. Capturing visible Google Meet captions when captions/transcript are enabled.");
    log("Console commands ready: gmeetCaptionLogger.status(), gmeetCaptionLogger.save(), gmeetCaptionLogger.analyzeStored(), gmeetCaptionLogger.createTrackleafForStored(), gmeetCaptionLogger.exportJson(), gmeetCaptionLogger.sessions(), gmeetCaptionLogger.reset().");

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== COMMAND_SOURCE) return;
      handleCommand(event.data.command);
    });

    window.addEventListener("pagehide", () => {
      saveAndAnalyzeCurrentSession("pagehide");
    });

    window.addEventListener("beforeunload", () => {
      if (hasSavedOnUnload) return;
      hasSavedOnUnload = true;
      saveAndAnalyzeCurrentSession("beforeunload");
    });

    window.setInterval(() => {
      if (session.captions.length) saveSession();

      if (!hasAnalyzedAfterMeetingEnd && isMeetingEndedInSamePage()) {
        hasAnalyzedAfterMeetingEnd = true;
        saveAndAnalyzeCurrentSession("meeting-ended-same-page");
      }
    }, AUTO_SAVE_INTERVAL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
