# Spotify Export MVP — Integration Guide

Three files:
- `spotifyAuth.js` — PKCE login flow, token storage/refresh
- `spotifyExport.js` — tracklist parsing, search matching, playlist creation
- `spotify-callback.html` — the redirect target after Spotify login

## 1. Register your app with Spotify

1. Go to https://developer.spotify.com/dashboard → **Create app**.
2. App name/description: anything (e.g. "The Stacks").
3. Redirect URI: add both, so it works locally and in prod:
   - `http://127.0.0.1:5173/spotify-callback.html` (adjust port to your dev server)
   - `https://<yourusername>.github.io/<repo>/spotify-callback.html`
4. Check the box for **Web API**.
5. Save, then copy the **Client ID** shown on the app's settings page.
6. Paste it into `CLIENT_ID` at the top of `spotifyAuth.js`.

No client secret is needed — PKCE is designed so the Client ID is safe to
ship in your static frontend.

## 2. Drop the files in

Copy `spotifyAuth.js`, `spotifyExport.js`, and `spotify-callback.html` into
your project (e.g. `/src/lib/spotify/` and `spotify-callback.html` at your
site root, or wherever your router can serve it as a real page).

## 3. Wire up the "Play This Stack" modal

```js
import { redirectToSpotifyAuth, isLoggedInToSpotify } from "./spotifyAuth.js";
import { buildSpotifyPlaylist } from "./spotifyExport.js";

// Step 1: "Spotify" button in your modal
function onClickSpotify() {
  if (!isLoggedInToSpotify()) {
    redirectToSpotifyAuth(); // leaves the page, comes back via spotify-callback.html
    return;
  }
  runExport();
}

// Step 2: after login (or immediately, if already logged in)
async function runExport() {
  const records = getCurrentStackRecords(); // however you already fetch a stack's records

  const result = await buildSpotifyPlaylist({
    stackName: `${currentStackName} Stack`,
    records, // needs { artist, album, tracklist } per record
    onProgress: ({ albumsDone, albumsTotal, tracksAdded, currentAlbum }) => {
      // update your "Adding X albums • Y tracks" progress UI here
      setProgress({ albumsDone, albumsTotal, tracksAdded, currentAlbum });
    },
  });

  // Step 3: show the "Open in Spotify" / "View in Spotify" buttons
  setPlaylistUrl(result.playlistUrl);

  if (result.unmatched.length > 0) {
    console.warn("Tracks Spotify couldn't match:", result.unmatched);
    // Consider surfacing this in the UI, e.g. "138 of 143 tracks added — 5 couldn't be found"
  }
}
```

## Notes / known limitations for this MVP

- **Matching quality depends on `tracklist` data being present and clean.**
  Records with no tracklist are silently skipped (no tracks to search for).
  Worth surfacing "N albums had no tracklist" in the UI, same as we found
  with the rock CSV export (6 albums had none).
- **Self-titled / live / deluxe albums** are the most likely source of bad
  matches. The scoring in `findTrackUri` weights album-name match to reduce
  this, but it's not bulletproof — the `unmatched` + a low-confidence list
  would be a good v2 addition (e.g. flag matches under some score threshold
  for manual review instead of auto-including them).
- **Rate limits**: Search runs one request per track, sequentially. For a
  143-track stack that's 143 requests — fine for an MVP, but for very large
  stacks (your "whole collection" case) consider adding a small delay or
  parallelizing in controlled batches (e.g. 5 concurrent) to speed it up
  without tripping Spotify's rate limiter.
- **Token storage** uses `localStorage` for simplicity. Fine for a personal
  single-user PWA like this; if "The Stacks" ever becomes multi-user in a way
  where the browser is shared, revisit this.

## Suggested v2 ideas (not built here)

- Surface unmatched/low-confidence tracks in the UI so you can fix `tracklist`
  data or manually search in Spotify.
- Cache search results by `artist+title` in Supabase so re-exporting the same
  stack doesn't re-search tracks you've already matched.
- "Export Stack" (CSV) button can stay as the Apple Music / YouTube Music
  fallback path until those integrations exist.
