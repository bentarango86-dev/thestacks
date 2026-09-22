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
    throttleMs: "stacks_spotify_throttle_ms", // last-known-good pacing, carried across page loads
    trackCache: "stacks_spotify_track_cache", // artist/album/title -> resolved uri (or confirmed miss)
    playlistIds: "stacks_spotify_playlist_ids", // stackName -> playlist id, skips the full-scan lookup
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
  const THROTTLE_MIN = 800;
  const THROTTLE_MAX = 15000;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // Picks up where the last session left off, so a tight-quota period isn't
  // silently re-discovered from scratch on every fresh page load. Writes are
  // debounced (see persistThrottleIfChanged) so this doesn't cost a
  // localStorage write per track.
  let throttleMs = clamp(Number(localStorage.getItem(STORAGE_KEYS.throttleMs)) || THROTTLE_MIN, THROTTLE_MIN, THROTTLE_MAX);
  let lastPersistedThrottle = throttleMs;

  function persistThrottleIfChanged() {
    const rounded = Math.round(throttleMs / 50) * 50;
    if (rounded === lastPersistedThrottle) return;
    lastPersistedThrottle = rounded;
    try {
      localStorage.setItem(STORAGE_KEYS.throttleMs, String(rounded));
    } catch (e) {
      /* non-fatal — worst case we re-discover the right pace next session */
    }
  }

  // ---- Simple bounded-concurrency runner ----
  // Runs `fn` over `items` with at most `limit` in flight at once, rather
  // than one item fully finishing before the next starts. The adaptive
  // throttle above is shared across every worker, so a 429 seen by any one
  // of them slows all of them down together on their very next request.
  async function mapWithConcurrency(items, limit, fn) {
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < items.length) {
        const i = nextIndex++;
        await fn(items[i], i);
      }
    }
    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  async function findTrackUri(accessToken, artist, album, title, retryCount = 0) {
    // Records with collaborations are sometimes stored as "Artist A, Artist B"
    // or "Artist A & Artist B" — Spotify's artist: filter expects one name,
    // so search on just the first one rather than the whole joined string.
    const primaryArtist = artist.split(/,|&| feat\.?| with /i)[0].trim();
    const query = `track:${title} artist:${primaryArtist}`;
    const url = `${API}/search?${new URLSearchParams({ q: query, type: "track", limit: "5" })}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (res.status === 429) {
      throttleMs = clamp(throttleMs * 2, THROTTLE_MIN, THROTTLE_MAX);
      persistThrottleIfChanged();
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
    throttleMs = clamp(throttleMs * 0.95, THROTTLE_MIN, THROTTLE_MAX);
    persistThrottleIfChanged();

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

  // ---- Persistent track cache (artist/album/title -> uri) ----
  // Search results are effectively immutable (a track that matched last month
  // still matches today), so once we've resolved — or confirmed we *can't*
  // resolve — a given track, later runs across any stack can skip the API
  // call entirely. Misses get a much shorter TTL than hits, since a track
  // that's genuinely missing today might get added to Spotify later.
  const TRACK_CACHE_TTL_HIT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const TRACK_CACHE_TTL_MISS_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  const TRACK_CACHE_MAX_ENTRIES = 5000;

  function trackCacheKey(artist, album, title) {
    return normalize(`${artist}|${album}|${title}`);
  }

  function readTrackCache() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.trackCache) || "{}");
    } catch (e) {
      return {};
    }
  }

  function writeTrackCache(cache) {
    try {
      localStorage.setItem(STORAGE_KEYS.trackCache, JSON.stringify(cache));
    } catch (e) {
      // Likely quota exceeded — drop the oldest half and try once more.
      // Losing old entries just means a few extra searches next time, not a
      // broken export, so this is worth a retry but not worth surfacing.
      try {
        const trimmed = Object.fromEntries(
          Object.entries(cache)
            .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
            .slice(Math.floor(Object.keys(cache).length / 2))
        );
        localStorage.setItem(STORAGE_KEYS.trackCache, JSON.stringify(trimmed));
      } catch (e2) {
        /* give up — non-fatal, just means no cache benefit until it clears up */
      }
    }
  }

  function getCachedTrackUri(cache, key) {
    const entry = cache[key];
    if (!entry) return undefined; // no opinion — caller should search
    const ttl = entry.uri ? TRACK_CACHE_TTL_HIT_MS : TRACK_CACHE_TTL_MISS_MS;
    if (Date.now() - entry.cachedAt > ttl) return undefined; // stale, re-check
    return entry.uri; // a uri string, or null for a confirmed miss
  }

  function setCachedTrackUri(cache, key, uri) {
    cache[key] = { uri, cachedAt: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > TRACK_CACHE_MAX_ENTRIES) {
      const toRemove = Math.floor(keys.length * 0.1);
      Object.entries(cache)
        .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
        .slice(0, toRemove)
        .forEach(([k]) => delete cache[k]);
    }
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

  // Retries a mutating request (POST) on 429, honoring Retry-After when the
  // browser can actually read it and falling back to exponential backoff
  // otherwise. Used for playlist creation and track additions, which
  // previously threw immediately on any rate limit — just as likely to
  // happen adding 100 tracks at once as it is searching for them one at a time.
  async function fetchWithBackoff(url, options, maxRetries = 5) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, options);
      if (res.status !== 429 || attempt >= maxRetries) return res;
      const retryAfterSec = Number(res.headers.get("Retry-After"));
      const backoffMs = retryAfterSec > 0 ? retryAfterSec * 1000 : Math.min(1000 * Math.pow(2, attempt), 20000);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  // Look for a playlist we already created for this stack, so re-running an
  // export doesn't spawn a duplicate playlist every time. This is the slow
  // path (paginates every playlist the user has) — findOrCreatePlaylist below
  // tries a cached id first and only falls back to this.
  async function findExistingPlaylist(accessToken, name) {
    const playlists = await fetchAllPages(accessToken, `${API}/me/playlists?limit=50`);
    return playlists.find((p) => p.name === name) || null;
  }

  async function getPlaylistById(accessToken, playlistId) {
    const res = await fetch(`${API}/playlists/${playlistId}?fields=id,name,external_urls`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      // e.g. 404 — deleted or no longer accessible. Logged (rather than
      // silently swallowed) since findOrCreatePlaylist's cache-repair path
      // depends on this actually being a 404 and not, say, a 429 or an
      // expired-token 401 masquerading as "just make a new playlist."
      console.warn(`Cached playlist id ${playlistId} no longer resolves (${res.status}) — will repair the cache and fall back to a name-based lookup.`);
      return null;
    }
    return await res.json();
  }

  function readPlaylistIdCache() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.playlistIds) || "{}");
    } catch (e) {
      return {};
    }
  }

  function writePlaylistIdCache(cache) {
    try {
      localStorage.setItem(STORAGE_KEYS.playlistIds, JSON.stringify(cache));
    } catch (e) {
      /* non-fatal — worst case we fall back to the full scan next time */
    }
  }

  // Spotify's error responses include a real reason (invalid scope, bad
  // playlist id, rate limit, etc.) in the body — throwing it alongside the
  // status turns "Failed to add tracks to playlist" into something you can
  // actually act on instead of guessing.
  async function throwApiError(res, action) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch (e) {
      try {
        detail = await res.text();
      } catch (e2) {
        /* body already consumed or unreadable — status code is still useful on its own */
      }
    }
    throw new Error(`${action} (${res.status}${res.statusText ? " " + res.statusText : ""})${detail ? ": " + detail : ""}`);
  }

  // Spotify's February 2026 Dev Mode migration removed POST /users/{id}/playlists
  // in favor of POST /me/playlists — no user ID needed at all anymore.
  async function createPlaylist(accessToken, name, description) {
    const res = await fetchWithBackoff(`${API}/me/playlists`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, public: false }),
    });
    if (!res.ok) await throwApiError(res, "Failed to create playlist");
    return await res.json();
  }

  // Finds the playlist for a stack in (usually) one request instead of a
  // full paginated scan, by remembering the id from the last time we built
  // this stack. Falls back to the scan (and repairs the cache) if the
  // remembered id no longer resolves — e.g. the user deleted it manually.
  async function findOrCreatePlaylist(accessToken, stackName) {
    const idCache = readPlaylistIdCache();
    const cachedId = idCache[stackName];

    if (cachedId) {
      const playlist = await getPlaylistById(accessToken, cachedId);
      if (playlist) return { ...playlist, wasExisting: true };
      delete idCache[stackName];
      writePlaylistIdCache(idCache);
    }

    const existingPlaylist = await findExistingPlaylist(accessToken, stackName);
    const playlist = existingPlaylist || await createPlaylist(
      accessToken,
      stackName,
      "Built from The Stacks — your personal record ledger."
    );
    idCache[stackName] = playlist.id;
    writePlaylistIdCache(idCache);
    return { ...playlist, wasExisting: Boolean(existingPlaylist) };
  }

  // Also renamed in the Feb 2026 migration: /playlists/{id}/tracks → /playlists/{id}/items
  async function getPlaylistTrackUris(accessToken, playlistId) {
    // The Feb 2026 migration didn't just rename the endpoint — each entry's
    // track object was also renamed from `track` to `item` (per Spotify's
    // migration guide: items.items.track -> items.items.item). Filtering on
    // (and reading) the old `track` field here silently returned nothing,
    // so this always came back empty — every track looked "new" and got
    // re-added on every single build, even for a playlist that already had
    // them all.
    const items = await fetchAllPages(
      accessToken,
      `${API}/playlists/${playlistId}/items?fields=items(item(uri)),next&limit=100`
    );
    return new Set(items.map((it) => it.item?.uri).filter(Boolean));
  }

  // Also renamed in the Feb 2026 migration: /playlists/{id}/tracks → /playlists/{id}/items
  async function addTracksToPlaylist(accessToken, playlistId, uris) {
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      const res = await fetchWithBackoff(`${API}/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: batch }),
      });
      if (!res.ok) await throwApiError(res, "Failed to add tracks to playlist");
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
   * @param {number} [options.concurrency] - how many track searches to run in parallel (default 3)
   */
  async function buildPlaylist({ stackName, records, onProgress, concurrency = 3 }) {
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

    const playlist = await findOrCreatePlaylist(accessToken, stackName);
    const wasExisting = playlist.wasExisting;
    const existingUris = wasExisting ? await getPlaylistTrackUris(accessToken, playlist.id) : new Set();

    // Flatten every record's tracks into one job list so searches for
    // different albums can run concurrently instead of one album (and one
    // track within it) fully finishing before the next starts.
    const jobs = [];
    const totalByRecord = new Array(records.length).fill(0);
    records.forEach((record, recordIndex) => {
      const tracks = parseTracklist(record.tracklist);
      totalByRecord[recordIndex] = tracks.length;
      tracks.forEach((title) => jobs.push({ recordIndex, record, title }));
    });

    const trackCache = readTrackCache();
    const runSeen = new Map(); // in-run dedup: the same track (e.g. shared across two records) is searched once
    let trackCacheDirty = false;

    const newUris = [];
    const unmatched = [];
    let tracksAdded = 0;
    let alreadyPresent = 0;
    const doneByRecord = new Array(records.length).fill(0);
    // Records with no parseable tracks never get a job, so they're trivially
    // "done" from the start — otherwise albumsDone would never reach
    // albumsTotal if any record in the stack has an empty tracklist.
    let recordsFullyDone = totalByRecord.filter((t) => t === 0).length;

    async function runJob(job) {
      const { record, title, recordIndex } = job;
      const key = trackCacheKey(record.artist, record.album, title);

      let uri;
      if (runSeen.has(key)) {
        uri = runSeen.get(key);
      } else {
        const persisted = getCachedTrackUri(trackCache, key);
        if (persisted !== undefined) {
          uri = persisted;
        } else {
          uri = await findTrackUri(accessToken, record.artist, record.album, title);
          setCachedTrackUri(trackCache, key, uri);
          trackCacheDirty = true;
          await new Promise((r) => setTimeout(r, throttleMs));
        }
        runSeen.set(key, uri);
      }

      if (!uri) {
        unmatched.push({ artist: record.artist, album: record.album, title });
      } else if (existingUris.has(uri)) {
        alreadyPresent++;
      } else {
        newUris.push(uri);
        existingUris.add(uri); // covers the same track appearing on more than one record
        tracksAdded++;
      }

      doneByRecord[recordIndex]++;
      if (doneByRecord[recordIndex] === totalByRecord[recordIndex]) {
        recordsFullyDone++;
        onProgress?.({
          albumsDone: recordsFullyDone,
          albumsTotal: records.length,
          tracksAdded,
          currentAlbum: `${record.artist} – ${record.album}`,
        });
      }
    }

    await mapWithConcurrency(jobs, concurrency, runJob);

    if (trackCacheDirty) writeTrackCache(trackCache);
    if (newUris.length > 0) await addTracksToPlaylist(accessToken, playlist.id, newUris);

    // Only cache as "fully synced" when nothing was left unmatched — an
    // incomplete run (e.g. some tracks failed to resolve) should keep
    // re-checking next time rather than permanently giving up on them.
    if (unmatched.length === 0) {
      writeSyncCache(stackName, fingerprint, playlist.external_urls.spotify, tracksAdded + alreadyPresent);
    }

    return {
      playlistUrl: playlist.external_urls.spotify,
      tracksAdded,
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
