// Options page script
// Persists backend URL and API token to chrome.storage.sync

const form = document.getElementById("settings-form");
const backendUrlInput = document.getElementById("backend-url");
const apiTokenInput = document.getElementById("api-token");
const statusEl = document.getElementById("status");

const DEFAULTS = {
  backendUrl: "http://localhost:3000",
  apiToken: "",
};

/**
 * Load saved settings into the form fields.
 */
async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(["backendUrl", "apiToken"]);
    backendUrlInput.value = stored.backendUrl || DEFAULTS.backendUrl;
    apiTokenInput.value = stored.apiToken || DEFAULTS.apiToken;
  } catch {
    backendUrlInput.value = DEFAULTS.backendUrl;
    apiTokenInput.value = DEFAULTS.apiToken;
  }
}

/**
 * Show a status message (success or error).
 */
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type;
  if (type === "success") {
    setTimeout(() => {
      statusEl.className = "";
      statusEl.style.display = "none";
    }, 3000);
  }
}

/**
 * Validate and save settings.
 */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const backendUrl = backendUrlInput.value.trim();
  const apiToken = apiTokenInput.value.trim();

  // Validate non-empty (FR-10)
  if (!backendUrl) {
    showStatus("Backend URL is required.", "error");
    backendUrlInput.focus();
    return;
  }
  if (!apiToken) {
    showStatus("API Token is required.", "error");
    apiTokenInput.focus();
    return;
  }

  try {
    await chrome.storage.sync.set({ backendUrl, apiToken });
    showStatus("Settings saved.", "success");
  } catch (err) {
    showStatus("Failed to save settings: " + err.message, "error");
  }
});

// Load settings on page open
document.addEventListener("DOMContentLoaded", loadSettings);
