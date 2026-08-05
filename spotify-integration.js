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
  const CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID"; // <-- fill in from the dashboard
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

    localStorage.setItem(STORAGE_KEYS.verifier, verifier);
    if (resumeGenre) {
      localStorage.setItem(STORAGE_KEYS.pendingExportGenre, resumeGenre);
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

    const verifier = localStorage.getItem(STORAGE_KEYS.verifier);
    if (!verifier) {
      console.error("Missing PKCE verifier — auth flow was not initiated correctly.");
      return { success: false };
    }
    localStorage.removeItem(STORAGE_KEYS.verifier);

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

    const resumeGenre = localStorage.getItem(STORAGE_KEYS.pendingExportGenre);
    localStorage.removeItem(STORAGE_KEYS.pendingExportGenre);
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

    if (token && Date.now() <= expiresAt - 60000) return token;

    // Access token missing or expired — try to refresh as long as we still
    // have a refresh token. Previously this bailed out to null whenever the
    // access token specifically was absent, even with a perfectly good
    // refresh token sitting right there.
    if (localStorage.getItem(STORAGE_KEYS.refreshToken)) return await refreshAccessToken();

    return null;
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

  // Adaptive throttle: shared across all requests in this session. Grows
  // when we hit 429s, eases back down gradually when requests succeed —
  // rather than guessing a single fixed delay that's either too slow when
  // it doesn't need to be, or (as observed) too fast to stay under the limit.
  // Starting point and ceiling raised significantly after seeing 429s persist
  // even at the previous 4s ceiling — this app's current quota is tighter
  // than a typical Development Mode app, so we favor reliability over speed.
  let throttleMs = 800;
  const THROTTLE_MIN = 800;
  const THROTTLE_MAX = 15000;

  async function findTrackUri(accessToken, artist, album, title, retryCount = 0) {
    // Records with collaborations are sometimes stored as "Artist A, Artist B"
    // or "Artist A & Artist B" — Spotify's artist: filter expects one name,
    // so search on just the first one rather than the whole joined string.
    const primaryArtist = artist.split(/,|&| feat\.?| with /i)[0].trim();
    const query = `track:${title} artist:${primaryArtist}`;
    const url = `${API}/search?${new URLSearchParams({ q: query, type: "track", limit: "5" })}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (res.status === 429) {
      throttleMs = Math.min(throttleMs * 2, THROTTLE_MAX);
      if (retryCount >= 7) {
        console.warn(`Rate limited repeatedly on "${title}" by ${artist} — skipping it.`);
        return null;
      }
      // Retry-After is often not readable from a cross-origin fetch() response
      // unless the API explicitly exposes it via CORS — don't rely on it.
      // Back off with increasing delay instead, capped so a bad stretch can't
      // stall the whole export indefinitely.
      const backoffMs = Math.min(3000 * Math.pow(2, retryCount), 30000);
      await new Promise((r) => setTimeout(r, backoffMs));
      return findTrackUri(accessToken, artist, album, title, retryCount + 1);
    }

    // Ease the throttle back down slowly on a clean response, so a rough
    // patch doesn't permanently slow down the rest of a long export.
    throttleMs = Math.max(THROTTLE_MIN, throttleMs * 0.95);

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

  // Spotify's pagination shape is consistent across list endpoints — items[]
  // plus a `next` field that's already a full URL, or null on the last page.
  async function fetchAllPages(accessToken, initialUrl) {
    let url = initialUrl;
    const allItems = [];
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) break;
      const data = await res.json();
      allItems.push(...(data.items || []));
      url = data.next;
    }
    return allItems;
  }

  // Look for a playlist we already created for this stack, so re-running an
  // export doesn't spawn a duplicate playlist every time.
  async function findExistingPlaylist(accessToken, name) {
    const playlists = await fetchAllPages(accessToken, `${API}/me/playlists?limit=50`);
    return playlists.find((p) => p.name === name) || null;
  }

  // Also renamed in the Feb 2026 migration: /playlists/{id}/tracks → /playlists/{id}/items
  async function getPlaylistTrackUris(accessToken, playlistId) {
    const items = await fetchAllPages(
      accessToken,
      `${API}/playlists/${playlistId}/items?fields=items(track(uri)),next&limit=100`
    );
    return new Set(items.map((it) => it.track?.uri).filter(Boolean));
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

  // ---- Local "already synced" cache ----
  // Captures both which records are in a stack and their tracklist content,
  // so adding/removing a record or editing a tracklist invalidates the cache,
  // but re-playing an untouched stack doesn't.
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  }

  function computeStackFingerprint(records) {
    const parts = records
      .map((r) => `${r.id}:${simpleHash(r.tracklist || "")}`)
      .sort();
    return simpleHash(parts.join("|"));
  }

  function syncCacheKey(stackName) {
    return `stacks_spotify_synced:${stackName}`;
  }

  function readSyncCache(stackName) {
    try {
      return JSON.parse(localStorage.getItem(syncCacheKey(stackName)) || "null");
    } catch (e) {
      return null;
    }
  }

  function writeSyncCache(stackName, fingerprint, playlistUrl, trackCount) {
    try {
      localStorage.setItem(
        syncCacheKey(stackName),
        JSON.stringify({ fingerprint, playlistUrl, trackCount, syncedAt: Date.now() })
      );
    } catch (e) {
      /* storage full or unavailable — non-fatal, just means no fast-path next time */
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

    const fingerprint = computeStackFingerprint(records);
    const cached = readSyncCache(stackName);

    if (cached && cached.fingerprint === fingerprint) {
      // Nothing about this stack has changed since the last time we fully
      // synced it — skip the playlist lookup, the existing-tracks fetch, and
      // the whole search loop entirely.
      onProgress?.({
        albumsDone: records.length,
        albumsTotal: records.length,
        tracksAdded: 0,
        currentAlbum: null,
      });
      return {
        playlistUrl: cached.playlistUrl,
        tracksAdded: 0,
        alreadyPresent: cached.trackCount || 0,
        wasExisting: true,
        unmatched: [],
      };
    }

    const existingPlaylist = await findExistingPlaylist(accessToken, stackName);
    const wasExisting = Boolean(existingPlaylist);
    const playlist = existingPlaylist || await createPlaylist(
      accessToken,
      stackName,
      "Built from The Stacks — your personal record ledger."
    );
    const existingUris = wasExisting ? await getPlaylistTrackUris(accessToken, playlist.id) : new Set();

    const newUris = [];
    const unmatched = [];
    let albumsDone = 0;
    let alreadyPresent = 0;

    for (const record of records) {
      const tracks = parseTracklist(record.tracklist);
      for (const title of tracks) {
        const uri = await findTrackUri(accessToken, record.artist, record.album, title);
        if (!uri) {
          unmatched.push({ artist: record.artist, album: record.album, title });
        } else if (existingUris.has(uri)) {
          alreadyPresent++;
        } else {
          newUris.push(uri);
          existingUris.add(uri); // covers the same track appearing on more than one record
        }
        // Adaptive throttle — starts fast, automatically slows down if the
        // API starts pushing back, eases up again once things are clean.
        await new Promise((r) => setTimeout(r, throttleMs));
      }
      albumsDone++;
      onProgress?.({
        albumsDone,
        albumsTotal: records.length,
        tracksAdded: newUris.length,
        currentAlbum: `${record.artist} – ${record.album}`,
      });
    }

    if (newUris.length > 0) await addTracksToPlaylist(accessToken, playlist.id, newUris);

    // Only cache as "fully synced" when nothing was left unmatched — an
    // incomplete run (e.g. some tracks failed to resolve) should keep
    // re-checking next time rather than permanently giving up on them.
    if (unmatched.length === 0) {
      writeSyncCache(stackName, fingerprint, playlist.external_urls.spotify, newUris.length + alreadyPresent);
    }

    return {
      playlistUrl: playlist.external_urls.spotify,
      tracksAdded: newUris.length,
      alreadyPresent,
      wasExisting,
      unmatched,
    };
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
