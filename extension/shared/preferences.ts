// Persisted user preferences for the analyzer overlay.
//
// Backed by chrome.storage.sync so the choice follows the user across
// machines signed into the same browser profile. Falls back to in-memory
// defaults if chrome.storage is unavailable (e.g. during tests).

export type CardDefaultState = "expanded" | "minimized" | "hidden";

export const CARD_DEFAULT_STATE_KEY = "cardDefaultState";
export const DEFAULT_CARD_STATE: CardDefaultState = "expanded";

const VALID_STATES: ReadonlySet<CardDefaultState> = new Set([
  "expanded",
  "minimized",
  "hidden",
]);

function coerce(value: unknown): CardDefaultState {
  if (typeof value === "string" && VALID_STATES.has(value as CardDefaultState)) {
    return value as CardDefaultState;
  }
  return DEFAULT_CARD_STATE;
}

function syncStorage(): chrome.storage.StorageArea | null {
  if (typeof chrome === "undefined" || !chrome.storage?.sync) return null;
  return chrome.storage.sync;
}

export async function getCardDefaultState(): Promise<CardDefaultState> {
  const storage = syncStorage();
  if (!storage) return DEFAULT_CARD_STATE;
  const result = await storage.get(CARD_DEFAULT_STATE_KEY);
  return coerce(result[CARD_DEFAULT_STATE_KEY]);
}

export async function setCardDefaultState(
  state: CardDefaultState
): Promise<void> {
  const storage = syncStorage();
  if (!storage) return;
  await storage.set({ [CARD_DEFAULT_STATE_KEY]: state });
}

export function subscribeCardDefaultState(
  listener: (state: CardDefaultState) => void
): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
    return () => {};
  }
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ): void => {
    if (areaName !== "sync") return;
    const change = changes[CARD_DEFAULT_STATE_KEY];
    if (!change) return;
    listener(coerce(change.newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
