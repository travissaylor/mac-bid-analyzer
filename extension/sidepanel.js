// Side panel script
// Listens for lot detection messages to update the panel UI

const noLotMessage = document.getElementById("no-lot-message");
const lotInfoEl = document.getElementById("lot-info");

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "LOT_DETECTED") {
    noLotMessage.style.display = "none";
    lotInfoEl.style.display = "block";
    // US-004 will populate lot-info with details and analyze button
  } else if (message.action === "LOT_NOT_DETECTED") {
    noLotMessage.style.display = "block";
    lotInfoEl.style.display = "none";
  }
});
