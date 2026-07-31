/**
 * spotifyExport.js
 * Turns a "Stack" (array of records from Supabase) into a Spotify playlist.
 * Depends on spotifyAuth.js for the access token.
 */

import { getValidAccessToken } from "./spotifyAuth.js";

const API = "https://api.spotify.com/v1";

// ---- Tracklist parsing (same approach we used for the CSV export) ----

/**
 * Parses a raw tracklist string (from records.tracklist) into clean track titles.
 * Handles formats like "A1. Track Name (3:42)" or "1. Track Name".
 */
export function parseTracklist(rawText) {
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

// ---- Spotify search + matching ----

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Scores how well a Spotify track result matches what we're looking for.
 * Simple token-overlap heuristic — good enough for artist/album/title matching
 * without pulling in a fuzzy-matching library.
 */
function scoreMatch(target, candidate) {
  const targetTokens = new Set(normalize(target).split(" "));
  const candidateTokens = new Set(normalize(candidate).split(" "));
  let overlap = 0;
  for (const t of targetTokens) {
    if (candidateTokens.has(t)) overlap++;
  }
  return overlap / Math.max(targetTokens.size, 1);
}

/**
 * Searches Spotify for a track and returns the best-matching URI, or null.
 */
async function findTrackUri(accessToken, artist, album, title) {
  const query = `track:${title} artist:${artist}`;
  const url = `${API}/search?${new URLSearchParams({
    q: query,
    type: "track",
    limit: "5",
  })}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    // Rate limited — respect Retry-After and try once more
    const retryAfter = Number(res.headers.get("Retry-After") || 1);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return findTrackUri(accessToken, artist, album, title);
  }

  if (!res.ok) return null;

  const data = await res.json();
  const items = data?.tracks?.items || [];
  if (items.length === 0) return null;

  // Prefer a result whose album name also matches, to avoid grabbing a
  // different recording (e.g. a live version or a different self-titled album)
  let best = null;
  let bestScore = -1;
  for (const item of items) {
    const titleScore = scoreMatch(title, item.name);
    const albumScore = scoreMatch(album, item.album?.name || "");
    const combined = titleScore * 0.7 + albumScore * 0.3;
    if (combined > bestScore) {
      bestScore = combined;
      best = item;
    }
  }

  // Require a reasonable minimum match on title to avoid wildly wrong picks
  if (bestScore < 0.4) return null;

  return best.uri;
}

async function getCurrentUserId(accessToken) {
  const res = await fetch(`${API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch current Spotify user");
  const data = await res.json();
  return data.id;
}

async function createPlaylist(accessToken, userId, name, description) {
  const res = await fetch(`${API}/users/${userId}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      description,
      public: false,
    }),
  });
  if (!res.ok) throw new Error("Failed to create playlist");
  return await res.json();
}

async function addTracksToPlaylist(accessToken, playlistId, uris) {
  // Spotify caps at 100 URIs per request
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const res = await fetch(`${API}/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: batch }),
    });
    if (!res.ok) throw new Error("Failed to add tracks to playlist");
  }
}

/**
 * Main entry point: builds a Spotify playlist from a stack of records.
 *
 * @param {Object} options
 * @param {string} options.stackName - e.g. "Grunge Stack"
 * @param {Array}  options.records - array of { artist, album, tracklist }
 * @param {Function} [options.onProgress] - called with { albumsDone, albumsTotal, tracksAdded, currentAlbum }
 * @returns {Promise<{playlistUrl: string, tracksAdded: number, unmatched: Array}>}
 */
export async function buildSpotifyPlaylist({ stackName, records, onProgress }) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("Not logged in to Spotify — call redirectToSpotifyAuth() first.");
  }

  const userId = await getCurrentUserId(accessToken);
  const playlist = await createPlaylist(
    accessToken,
    userId,
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
      if (uri) {
        allUris.push(uri);
      } else {
        unmatched.push({ artist: record.artist, album: record.album, title });
      }
    }

    albumsDone++;
    onProgress?.({
      albumsDone,
      albumsTotal: records.length,
      tracksAdded: allUris.length,
      currentAlbum: `${record.artist} – ${record.album}`,
    });
  }

  if (allUris.length > 0) {
    await addTracksToPlaylist(accessToken, playlist.id, allUris);
  }

  return {
    playlistUrl: playlist.external_urls.spotify,
    tracksAdded: allUris.length,
    unmatched,
  };
}
