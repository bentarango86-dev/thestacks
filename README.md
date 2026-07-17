# The Stacks

A personal vinyl record collection tracker. Installable PWA, MusicBrainz-powered lookup (name search + barcode scanning), Supabase backend for accounts and cross-device sync.

For how to *use* the app, see [USER_GUIDE.md](./USER_GUIDE.md). This file is for maintaining/redeploying it.

## Stack

- **Frontend:** single-file vanilla HTML/CSS/JS (`index.html`) — no build step, no framework
- **Backend:** [Supabase](https://supabase.com) — Postgres database + Auth (email/password + TOTP MFA), Row Level Security scopes each user to their own records
- **Lookups:** [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) (name + barcode search, release/tracklist/label data), [Cover Art Archive](https://coverartarchive.org/) (cover images)
- **Barcode scanning:** [QuaggaJS](https://serratus.github.io/quaggaJS/) (camera-based UPC/EAN decoding)
- **Hosting:** [Netlify](https://netlify.com) (static hosting, drag-and-drop deploy)

## Files

```
index.html         The entire app — markup, styles, and JS in one file
manifest.json       PWA manifest (name, icons, theme color, display mode)
service-worker.js   Offline caching for the app shell
setup.sql           Database schema + Row Level Security policies
logo.png            App logo, used in the header
icon-192.png        PWA icon (small)
icon-512.png        PWA icon (large)
USER_GUIDE.md        End-user instructions
```

## Redeploying after a change

1. Unzip the updated project folder.
2. Go to your Netlify site's dashboard → drag the folder onto the deploy area (or use `netlify deploy` CLI if you've set that up).
3. If the change touched `index.html`, `manifest.json`, or the icons, **bump `CACHE_NAME` in `service-worker.js`** (e.g. `the-stacks-v9`) — otherwise returning users' browsers may keep serving a stale cached version. This has bitten us before; don't skip it.
4. On your own phone, fully close the installed app and reopen it (not just a refresh) to confirm the update actually landed.

## Supabase project

- **Project ref:** `jqtibmsqlzcagydnnwpg`
- **Region:** Canada Central
- The live `SUPABASE_URL` and publishable key are already hard-coded near the top of `index.html`'s `<script>` block. If you ever rotate keys or spin up a fresh project, that's the only place they need updating.
- `setup.sql` is the source of truth for schema — if you rebuild the project from scratch, run it in the SQL Editor. It's kept in sync with the live schema, but if you ever apply a migration directly (via SQL Editor or the MCP connector) without updating this file, they'll drift — worth doing both at once.

### Schema (`records` table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | primary key |
| `user_id` | uuid | FK to `auth.users`, enforced by RLS |
| `album`, `artist` | text | required |
| `year`, `genre`, `format`, `condition` | text | |
| `price` | numeric | |
| `purchase_date` | date | |
| `notes` | text | |
| `cover_url` | text | image URL, either from Cover Art Archive or pasted manually |
| `label`, `catalog_number`, `country`, `release_type` | text | from MusicBrainz release-level data |
| `tracklist` | text | newline-separated, human-readable |
| `is_face` | boolean | marks which record is the visual "cover" of its genre's stack — only one `true` per genre per user, enforced in app logic, not a DB constraint |
| `added_at` | bigint | epoch ms, drives "recently added" sort |
| `created_at` | timestamptz | row insert time |

### Auth / URL configuration

If the app's domain ever changes (new Netlify site, custom domain, etc.), update **Authentication → URL Configuration** in the Supabase dashboard — both **Site URL** and **Redirect URLs**. This is what confirmation emails and auth redirects point to; forgetting this step is why sign-up confirmation links have broken before.

## Known limitations / things to keep in mind

- **MFA has no recovery codes.** Supabase's TOTP implementation doesn't generate backup codes — losing the authenticator app means losing access to that account.
- **MusicBrainz/Cover Art Archive coverage is inconsistent**, especially for obscure or older pressings. Manual entry is always the fallback.
- **Stack "layers" are capped at 3** regardless of how many records are in a genre — a badge shows the real count once a genre passes 9 records.
- **Signup is currently open** — anyone with the link can create an account. Fine for a small friends-and-family scale; if that changes, disable public sign-ups in Supabase Auth settings and invite people manually instead.
- **Supabase free tier** comfortably covers personal/small-group use (500MB database). Worth revisiting if this ever grows beyond a handful of users.
