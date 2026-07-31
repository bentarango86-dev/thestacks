/**
 * spotify-integration.js
 * PKCE OAuth + playlist export for The Stacks.
 * Plain script, no build step — matches app.js / modals.js style.
 * Load this with a normal <script src="spotify-integration.js"></script> tag,
 * AFTER shared.css/app.js aren't required, but it does expect nothing else
 * from app.js — it's self-contained. Exposes everything via the global
 * `SpotifyExport` object.
 */

const SpotifyExport = (() => {
  // ---- Config ----
  const CLIENT_ID = "456e40d0e6df45faac3eec20ce6ea1e9"; // <-- fill in from the dashboard
  const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "spotify-callback.html";
  const SCOPES = ["playlist-modify-private", "playlist-modify-public"];
  const API = "https://api.spotify.com/v1";

  const STORAGE_KEYS = {
    verifier: "stacks_spotify_pkce_verifier",
    accessToken: "stacks_spotify_access_token",
    refreshToken: "stacks_spotify_refresh_token",
    expiresAt: "stacks_spotify_expires_at",
    pendingExportGenre: "stacks_spotify_pending_genre", // so we can resume after redirect
  };

  // ---- PKCE helpers ----

  function base64UrlEncode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  function generateRandomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, (v) => chars[v % chars.length]).join("");
  }

  async function sha256(plain) {
    const encoder = new TextEncoder();
    return crypto.subtle.digest("SHA-256", encoder.encode(plain));
  }

  // ---- Auth ----

  async function redirectToAuth(resumeGenre) {
    const verifier = generateRandomString(64);
    const challenge = base64UrlEncode(await sha256(verifier));

    sessionStorage.setItem(STORAGE_KEYS.verifier, verifier);
    if (resumeGenre) {
      sessionStorage.setItem(STORAGE_KEYS.pendingExportGenre, resumeGenre);
    }

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

  async function handleRedirect() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      console.error("Spotify auth error:", error);
      return { success: false };
    }
    if (!code) return { success: false };

    const verifier = sessionStorage.getItem(STORAGE_KEYS.verifier);
    if (!verifier) {
      console.error("Missing PKCE verifier — auth flow was not initiated correctly.");
      return { success: false };
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
      return { success: false };
    }

    const data = await res.json();
    storeTokens(data);

    const resumeGenre = sessionStorage.getItem(STORAGE_KEYS.pendingExportGenre);
    sessionStorage.removeItem(STORAGE_KEYS.pendingExportGenre);
    return { success: true, resumeGenre };
  }

  function storeTokens(data) {
    localStorage.setItem(STORAGE_KEYS.accessToken, data.access_token);
    if (data.refresh_token) {
      localStorage.setItem(STORAGE_KEYS.refreshToken, data.refresh_token);
    }
    localStorage.setItem(STORAGE_KEYS.expiresAt, String(Date.now() + data.expires_in * 1000));
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

  async function getValidAccessToken() {
    const token = localStorage.getItem(STORAGE_KEYS.accessToken);
    const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || 0);
    if (!token) return null;
    if (Date.now() > expiresAt - 60000) return await refreshAccessToken();
    return token;
  }

  function isLoggedIn() {
    return Boolean(localStorage.getItem(STORAGE_KEYS.refreshToken));
  }

  function logout() {
    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  }

  // ---- Tracklist parsing ----

  function parseTracklist(rawText) {
    if (!rawText) return [];
    return rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const withoutNumber = line.replace(/^[A-Za-z]?\d+\.\s*/, "");
        return withoutNumber.replace(/\s*\(\d{1,2}:\d{2}\)\s*$/, "").trim();
      })
      .filter(Boolean);
  }

  // ---- Search + matching ----

  function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function scoreMatch(target, candidate) {
    const targetTokens = new Set(normalize(target).split(" "));
    const candidateTokens = new Set(normalize(candidate).split(" "));
    let overlap = 0;
    for (const t of targetTokens) if (candidateTokens.has(t)) overlap++;
    return overlap / Math.max(targetTokens.size, 1);
  }

  async function findTrackUri(accessToken, artist, album, title) {
    const query = `track:${title} artist:${artist}`;
    const url = `${API}/search?${new URLSearchParams({ q: query, type: "track", limit: "5" })}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") || 1);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return findTrackUri(accessToken, artist, album, title);
    }

    if (!res.ok) return null;

    const data = await res.json();
    const items = data?.tracks?.items || [];
    if (items.length === 0) return null;

    let best = null;
    let bestScore = -1;
    for (const item of items) {
      const combined = scoreMatch(title, item.name) * 0.7 + scoreMatch(album, item.album?.name || "") * 0.3;
      if (combined > bestScore) {
        bestScore = combined;
        best = item;
      }
    }

    return bestScore < 0.4 ? null : best.uri;
  }

  // Spotify's February 2026 Dev Mode migration removed POST /users/{id}/playlists
  // in favor of POST /me/playlists — no user ID needed at all anymore.
  async function createPlaylist(accessToken, name, description) {
    const res = await fetch(`${API}/me/playlists`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, public: false }),
    });
    if (!res.ok) throw new Error("Failed to create playlist");
    return await res.json();
  }

  // Also renamed in the Feb 2026 migration: /playlists/{id}/tracks → /playlists/{id}/items
  async function addTracksToPlaylist(accessToken, playlistId, uris) {
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      const res = await fetch(`${API}/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch }),
      });
      if (!res.ok) throw new Error("Failed to add tracks to playlist");
    }
  }

  /**
   * @param {Object} options
   * @param {string} options.stackName
   * @param {Array} options.records - array of { artist, album, tracklist }
   * @param {Function} [options.onProgress] - ({ albumsDone, albumsTotal, tracksAdded, currentAlbum })
   */
  async function buildPlaylist({ stackName, records, onProgress }) {
    const accessToken = await getValidAccessToken();
    if (!accessToken) throw new Error("Not logged in to Spotify.");

    const playlist = await createPlaylist(
      accessToken,
      stackName,
      "Built from The Stacks — your personal record ledger."
    );

    const allUris = [];
    const unmatched = [];
    let albumsDone = 0;

    for (const record of records) {
      const tracks = parseTracklist(record.tracklist);
      for (const title of tracks) {
        const uri = await findTrackUri(accessToken, record.artist, record.album, title);
        if (uri) allUris.push(uri);
        else unmatched.push({ artist: record.artist, album: record.album, title });
      }
      albumsDone++;
      onProgress?.({
        albumsDone,
        albumsTotal: records.length,
        tracksAdded: allUris.length,
        currentAlbum: `${record.artist} – ${record.album}`,
      });
    }

    if (allUris.length > 0) await addTracksToPlaylist(accessToken, playlist.id, allUris);

    return { playlistUrl: playlist.external_urls.spotify, tracksAdded: allUris.length, unmatched };
  }

  return {
    redirectToAuth,
    handleRedirect,
    isLoggedIn,
    logout,
    buildPlaylist,
    parseTracklist, // exposed in case you want it elsewhere (e.g. CSV export)
  };
})();
