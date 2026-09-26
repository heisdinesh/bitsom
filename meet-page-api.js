(function () {
  "use strict";

  const COMMAND_SOURCE = "gmeet-caption-json-exporter-page";

  function send(command) {
    window.postMessage(
      {
        source: COMMAND_SOURCE,
        command
      },
      window.location.origin
    );
  }

  window.gmeetCaptionLogger = {
    status() {
      send("status");
      return "Meet caption status requested. Check console lines starting with [GMeet Caption Logger].";
    },
    save() {
      send("save");
      return "Meet caption session save requested.";
    },
    sessions() {
      send("sessions");
      return "Meet caption sessions requested. Check console lines starting with [GMeet Caption Logger].";
    },
    analyzeStored() {
      send("analyzeStored");
      return "Meet caption session analysis requested. Check console lines starting with [GMeet Caption Logger].";
    },
    createTrackleafForStored() {
      send("createTrackleafForStored");
      return "Meet Trackleaf ticket creation requested. Check console lines starting with [GMeet Caption Logger].";
    },
    exportJson() {
      send("exportJson");
      return "Meet caption JSON export requested.";
    },
    reset() {
      send("reset");
      return "Meet caption sessions cleared.";
    }
  };
})();
