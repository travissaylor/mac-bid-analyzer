import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const FIREBASE_SIGN_IN_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
const FIREBASE_REFRESH_URL =
  "https://securetoken.googleapis.com/v1/token";
const FIREBASE_API_KEY = "AIzaSyBvYDaFP5dSbAMBIaC7aECnpVCuyo3bZDg";

const TOKEN_FILE = ".firebase-token";

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function log(message: string): void {
  console.log(`${timestamp()} ${message}`);
}

export interface FirebaseTokens {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface SignInResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

interface RefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
}

interface ErrorResponse {
  error?: { message?: string };
}

function getTokenPath(projectRoot?: string): string {
  return join(projectRoot ?? process.cwd(), TOKEN_FILE);
}

function loadCachedTokens(projectRoot?: string): FirebaseTokens | null {
  const tokenPath = getTokenPath(projectRoot);
  if (!existsSync(tokenPath)) {
    return null;
  }

  try {
    const raw = readFileSync(tokenPath, "utf-8");
    const parsed = JSON.parse(raw) as FirebaseTokens;
    if (!parsed.refreshToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedTokens(
  tokens: FirebaseTokens,
  projectRoot?: string
): void {
  const tokenPath = getTokenPath(projectRoot);
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), "utf-8");
}

export function clearCachedTokens(projectRoot?: string): void {
  const tokenPath = getTokenPath(projectRoot);
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath);
  }
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<FirebaseTokens> {
  const url = `${FIREBASE_SIGN_IN_URL}?key=${FIREBASE_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  if (!response.ok) {
    const data = (await response.json()) as ErrorResponse;
    const message = data.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Firebase sign-in failed: ${message}`);
  }

  const data = (await response.json()) as SignInResponse;

  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + parseInt(data.expiresIn, 10) * 1000,
  };
}

export async function refreshIdToken(
  refreshToken: string
): Promise<FirebaseTokens> {
  const url = `${FIREBASE_REFRESH_URL}?key=${FIREBASE_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });

  if (!response.ok) {
    const data = (await response.json()) as ErrorResponse;
    const message = data.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Firebase token refresh failed: ${message}`);
  }

  const data = (await response.json()) as RefreshResponse;

  return {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + parseInt(data.expires_in, 10) * 1000,
  };
}

export async function getFirebaseIdToken(
  email: string,
  password: string,
  projectRoot?: string
): Promise<string> {
  // Try cached tokens first
  const cached = loadCachedTokens(projectRoot);

  if (cached) {
    // If ID token is still valid (with 60s buffer), use it directly
    if (Date.now() < cached.expiresAt - 60_000) {
      log("Using cached Firebase ID token.");
      return cached.idToken;
    }

    // ID token expired — try refreshing
    log("Firebase ID token expired. Refreshing...");
    try {
      const refreshed = await refreshIdToken(cached.refreshToken);
      saveCachedTokens(refreshed, projectRoot);
      log("Firebase token refreshed successfully.");
      return refreshed.idToken;
    } catch (err) {
      log(
        `Refresh token failed: ${(err as Error).message}. Falling back to email/password sign-in.`
      );
    }
  }

  // No cached tokens or refresh failed — full sign-in
  if (!email || !password) {
    throw new Error(
      "MACBID_EMAIL and MACBID_PASSWORD must be set in .env for Firebase authentication"
    );
  }

  log("Signing in to mac.bid via Firebase...");
  const tokens = await signInWithEmail(email, password);
  saveCachedTokens(tokens, projectRoot);
  log("Firebase sign-in successful. Token cached.");
  return tokens.idToken;
}
