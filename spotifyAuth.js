/**
 * spotifyAuth.js
 * PKCE OAuth flow for Spotify — no backend/client secret required.
 * Works from a static site (GitHub Pages).
 *
 * Setup (one-time):
 * 1. Go to https://developer.spotify.com/dashboard, create an app.
 * 2. In app settings, add a Redirect URI matching REDIRECT_URI below
 *    (e.g. https://yourusername.github.io/the-stacks/spotify-callback.html
 *    for prod, or http://127.0.0.1:5173/spotify-callback.html for local dev —
 *    Spotify no longer allows plain "localhost", use 127.0.0.1 instead).
 * 3. Copy the Client ID into CLIENT_ID below (safe to expose client-side; PKCE
 *    doesn't use a client secret).
 */

const CLIENT_ID = "456e40d0e6df45faac3eec20ce6ea1e9"; // <-- fill in from the dashboard
const REDIRECT_URI = window.location.origin + "/spotify-callback.html";
const SCOPES = ["playlist-modify-private", "playlist-modify-public"];

const STORAGE_KEYS = {
  verifier: "stacks_spotify_pkce_verifier",
  accessToken: "stacks_spotify_access_token",
  refreshToken: "stacks_spotify_refresh_token",
  expiresAt: "stacks_spotify_expires_at",
};

// ---- PKCE helpers ----

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateRandomString(length) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

// ---- Public API ----

/**
 * Kick off login: redirects the browser to Spotify's authorize page.
 * Call this from your "Spotify" button in the Play This Stack modal.
 */
export async function redirectToSpotifyAuth() {
  const verifier = generateRandomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));

  sessionStorage.setItem(STORAGE_KEYS.verifier, verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/**
 * Call this on your redirect page (spotify-callback.html) on load.
 * Exchanges the auth code for tokens and stores them, then you can
 * redirect the user back into the app.
 * @returns {Promise<boolean>} true if auth succeeded
 */
export async function handleSpotifyRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");

  if (error) {
    console.error("Spotify auth error:", error);
    return false;
  }
  if (!code) return false;

  const verifier = sessionStorage.getItem(STORAGE_KEYS.verifier);
  if (!verifier) {
    console.error("Missing PKCE verifier — auth flow was not initiated correctly.");
    return false;
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    console.error("Token exchange failed:", await res.text());
    return false;
  }

  const data = await res.json();
  storeTokens(data);
  return true;
}

function storeTokens(data) {
  localStorage.setItem(STORAGE_KEYS.accessToken, data.access_token);
  if (data.refresh_token) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, data.refresh_token);
  }
  const expiresAt = Date.now() + data.expires_in * 1000;
  localStorage.setItem(STORAGE_KEYS.expiresAt, String(expiresAt));
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) return null;

  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

/**
 * Returns a valid access token, refreshing it if expired.
 * Returns null if the user needs to log in (call redirectToSpotifyAuth).
 */
export async function getValidAccessToken() {
  const token = localStorage.getItem(STORAGE_KEYS.accessToken);
  const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || 0);

  if (!token) return null;

  // Refresh if expired or expiring within 60s
  if (Date.now() > expiresAt - 60000) {
    return await refreshAccessToken();
  }

  return token;
}

export function isLoggedInToSpotify() {
  return Boolean(localStorage.getItem(STORAGE_KEYS.refreshToken));
}

export function logoutSpotify() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
}
