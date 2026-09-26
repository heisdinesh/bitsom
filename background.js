"use strict";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OLLAMA_CHAT" && message?.type !== "TRACKLEAF_CREATE_TICKET") {
    return false;
  }

  const headers = message.headers || {
    "Content-Type": "application/json"
  };

  fetch(message.url, {
    method: "POST",
    headers,
    body: JSON.stringify(message.payload)
  })
    .then(async (response) => {
      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch (_error) {
        data = { rawText: text };
      }

      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
        body: text
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message
      });
    });

  return true;
});
