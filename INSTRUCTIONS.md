# Spotify integration optimizations — how to apply

This zip has everything needed to apply the 8 optimizations discussed
(concurrency, dedup, persistent caches, retry/backoff, dead-code removal,
build queueing). Two ways to apply it — pick whichever is easier.

## Option A — just replace the files (simplest)

In your local clone of `bentarango86-dev/thestacks`:

1. **Replace** `spotify-integration.js` with the one in this zip.
2. **Replace** `index.html` with the one in this zip.
3. **Replace** `modals.js` with the one in this zip (adds the Mix Playlist modal markup).
4. **Replace** `shared.css` with the one in this zip (adds the `.chip-btn.selected` toggle state).
5. **Delete** `spotifyAuth.js` and `spotifyExport.js` — they're the older,
   superseded version of the Spotify integration (no throttle, no retry, no
   caching) and nothing else in the repo references them.

Then commit:

```bash
git add -A
git commit -m "Optimize Spotify export: concurrency, caching, retry/backoff, dead code removal"
git push
```

## Option B — apply as a patch

`changes.patch` is a standard `git diff` against your current `main`. From
the root of your local clone:

```bash
git apply /path/to/changes.patch
git rm spotifyAuth.js spotifyExport.js   # only needed if `git apply` doesn't pick up the deletions
git add -A
git commit -m "Optimize Spotify export: concurrency, caching, retry/backoff, dead code removal"
git push
```

If the patch fails to apply (e.g. you've edited these files since I cloned
the repo), fall back to Option A.

## What changed, and why

| # | Change | File(s) |
|---|--------|---------|
| 1 | Track searches now run 3 at a time (`mapWithConcurrency`) instead of one at a time, sharing the adaptive throttle so a 429 slows every worker together | `spotify-integration.js` |
| 2 | Same track appearing twice in one run (e.g. shared across two records) is searched once, not twice | `spotify-integration.js` |
| 3 | Resolved (and confirmed-missing) tracks are cached in `localStorage` across sessions — 30-day TTL on hits, 3-day on misses, capped at 5000 entries | `spotify-integration.js` |
| 4 | The adaptive throttle's last value persists across page loads instead of resetting to 800ms every time | `spotify-integration.js` |
| 5 | Playlist creation and track-add requests now retry on 429 with backoff instead of throwing immediately | `spotify-integration.js` |
| 6 | The playlist for a stack is looked up by a cached id (one request) instead of scanning every playlist the user has, every time | `spotify-integration.js` |
| 7 | Removed `spotifyAuth.js` / `spotifyExport.js` — an older, unused duplicate of this same integration | deleted |
| 8 | A click on a second "Play Stack" card while one's already building now queues ("Queued…") and auto-starts after, instead of being silently dropped | `index.html` |

## Bonus: Play Stack trigger redesign

Separate from the perf/reliability list above — the "Play Stack" button used
to be a floating white card that read as disconnected from the shelf. It's
now a small turntable icon sitting inline next to the record count, and
**both the count and the icon are hidden until you hover or click/tap the
shelf title.** Clicking the icon still expands into the same paper-jacket
popup as before to show build progress, the success checkmark, or an error —
that part is unchanged, just now anchored to a smaller resting element.

No new markup is required in your HTML templates — `appendPlayCardToTitle()`
finds the existing `.shelf-count` span itself and moves it into the new
wrapper, so this works automatically for every shelf (genre shelves,
Wishlist, New Arrivals) once you replace `index.html`.

## Bonus: Mix Playlist (combine multiple shelves into one playlist)

A new "Mix playlist" item in the profile menu (top right) opens a modal
where you:

1. Type a playlist name (whatever you type is used as-is for the Spotify
   playlist name — no automatic " Stack" suffix like the single-shelf
   button uses).
2. Tap to select any combination of shelves (genres, New Arrivals,
   Wishlist) as chips — only shelves with at least one exportable track
   are offered.
3. Tap "Build playlist" — it combines the selected shelves' records
   (de-duped by record id, in case a record could ever belong to more than
   one selected shelf) and runs through the exact same `buildPlaylist()`
   call the single-shelf button uses, so it gets the same dedup-against-
   existing-tracks behavior, retry/backoff, and track caching.

One caveat worth knowing: if you're not connected to Spotify yet, tapping
"Build playlist" sends you through the OAuth redirect same as usual — but
unlike the single-shelf button, there's no resume-after-auth for this ad
hoc case (your typed name and shelf selection don't survive the redirect
round trip). You'll need to reopen the picker and re-select once you're
back. Worth knowing about; not something I'd consider a blocker for
shipping this.

## Testing notes

- No new `localStorage` keys need manual setup — they're created on first use
  (`stacks_spotify_track_cache`, `stacks_spotify_playlist_ids`,
  `stacks_spotify_throttle_ms`).
- `buildPlaylist()`'s public shape is unchanged (`stackName`, `records`,
  `onProgress`) aside from an optional new `concurrency` param (defaults to
  `3`) — no caller changes needed beyond what's in this zip's `index.html`.
- If you want to sanity-check the cache logic quickly: build a small stack
  once, then build it again — the second run should log far fewer network
  requests (open the browser Network tab) since resolved tracks hit the
  cache instead of the Spotify search API.
- Existing users' saved auth tokens and existing "already synced" stack
  caches are untouched — nothing about token storage or the sync-fingerprint
  cache changed.

## Bug fix: duplicate tracks added on every rebuild

If you grabbed an earlier copy of this zip: `getPlaylistTrackUris` was
reading the pre-migration `track` field from `/playlists/{id}/items`
responses, but Spotify's Feb 2026 migration renamed that field to `item`
(`items.items.track` → `items.items.item`) alongside the endpoint rename.
That meant the "which tracks are already in the playlist" check always came
back empty, so every click re-added the *entire* tracklist even to a
playlist that already had it. Fixed by requesting/reading `item(uri)`
instead of `track(uri)`.
