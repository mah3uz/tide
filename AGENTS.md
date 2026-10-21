# tide

Lean self-hosted video meetings: single Go binary (embedded SvelteKit SPA) +
LiveKit + Redis + Egress + S3. **docs/ARCHITECTURE.md is the contract** — read
it before building anything; it defines the system shape, API surface, design
language (§10), type-sync rules (§11), and the phased build plan (§16).

Rules that bite:

- Wire types are defined ONCE in `server/internal/api` (Go). Never hand-write a
  request/response type in `web/`. Run `make gen` after changing them; CI fails
  on drift.
- All capability checks live server-side (room ownership, host role). Never
  trust a client-asserted role; capabilities travel only in LiveKit token
  grants minted by the server.
- Feature list is frozen (see ARCHITECTURE.md §1). Do not add features
  (polls, whiteboard, server-side AI, RTMP, file transfer…) — this restraint is
  the product. Exceptions: transcripts, only because they run on the room
  owner's own machine through moil (§8.1); nothing model-shaped runs on the
  server. This fork also has an installable PWA, a screen-share popout, minimal
  chat markdown (no `[text](url)` links, no raw HTML), and images in chat
  behind `TIDE_CHAT_IMAGES` (off by default, browser memory only, images only;
  other file transfer stays out).
- `server/third_party/moil` is a vendored copy of the moil Go SDK. Never edit
  it in place: fix moil upstream, then refresh with `scripts/vendor-moil.sh`.
- The transcribe bundle's hash is pinned by a test. Changing any byte of
  `job.py`, `job.py.lock` or `manifest.json` in
  `server/internal/transcripts/bundle/` makes every machine owner review and
  approve it again, so do it only on purpose.
- Design: light and dark themes on one layout (follows the system, header
  toggle; the recorder page is always dark). Use the semantic tokens in
  `web/src/app.css` (`--bg`, `--surface`, `--ink`, `--accent`, `--rec`, `--r-*`…),
  never hex values; `npm run check` fails on an undefined `var(--x)`. Space
  Grotesk + JetBrains Mono (self-hosted), phosphor-svelte 16px regular icons.
  Motion: transform/opacity only, nothing loops unless live state drives it,
  reduced motion honoured. The logo lives only in `lib/ui/BrandMark.svelte` and
  `web/static/brand/app-icon.svg` (`npm run icons`). Details: ARCHITECTURE.md §10.
- `make check` must pass before any commit.
