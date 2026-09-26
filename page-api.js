(function () {
  "use strict";

  const COMMAND_SOURCE = "gmail-mail-json-exporter-page";

  function send(command, payload) {
    window.postMessage(
      {
        source: COMMAND_SOURCE,
        command,
        payload: payload || null
      },
      window.location.origin
    );
  }

  window.gmailMailLogger = {
    scan() {
      send("scan");
      return "Unread scan requested. Check console lines starting with [Gmail Mail Logger].";
    },
    scanVisible() {
      send("scanVisible");
      return "Visible inbox scan requested. This captures read and unread visible rows.";
    },
    reset() {
      send("reset");
      return "Processed cache and captured JSON messages cleared.";
    },
    processed() {
      send("processed");
      return "Processed message list requested. Check console lines starting with [Gmail Mail Logger].";
    },
    messages() {
      send("messages");
      return "Captured messages requested. Check console lines starting with [Gmail Mail Logger].";
    },
    configureOllama(config) {
      send("configureOllama", config || {});
      return "Ollama config update requested. Check console lines starting with [Gmail Mail Logger].";
    },
    ollamaConfig() {
      send("ollamaConfig");
      return "Ollama config requested. Check console lines starting with [Gmail Mail Logger].";
    },
    analyzeStored() {
      send("analyzeStored");
      return "Stored-message analysis requested. Check console lines starting with [Gmail Mail Logger].";
    },
    configureTrackleaf(config) {
      send("configureTrackleaf", config || {});
      return "Trackleaf config update requested. Check console lines starting with [Gmail Mail Logger].";
    },
    trackleafConfig() {
      send("trackleafConfig");
      return "Trackleaf config requested. Check console lines starting with [Gmail Mail Logger].";
    },
    createTrackleafForStored() {
      send("createTrackleafForStored");
      return "Trackleaf ticket creation requested. Check console lines starting with [Gmail Mail Logger].";
    },
    exportJson() {
      send("exportJson");
      return "JSON export requested.";
    }
  };
})();
