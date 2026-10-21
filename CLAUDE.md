# tide (fork)

This repository is a fork of Convex-Works/tide. Where this file or
`docs/FORK.md` disagrees with `AGENTS.md` or `docs/ARCHITECTURE.md`, this file
and `FORK.md` win. Read `AGENTS.md` for everything they do not change.

Rules that differ from upstream:

- Design contract: `docs/FORK.md` ("Design language") replaces
  ARCHITECTURE.md §10. Light and dark themes on one layout (follows the system,
  header toggle; the recorder page is always dark). Use the semantic tokens in
  `web/src/app.css` (`--bg`, `--surface`, `--ink`, `--accent`, `--rec`,
  `--r-*`...), never hex values. Space Grotesk + JetBrains Mono (self-hosted),
  phosphor-svelte 16px regular icons. Motion: transform/opacity only, nothing
  loops unless live state drives it, reduced motion honoured.
- `npm run check` fails on an undefined `var(--x)` (no fallback, no
  definition). Define the token in `app.css` instead of working around it.
- Frozen-feature exceptions, beyond transcripts: an installable PWA, a
  screen-share popout, minimal chat markdown (no `[text](url)` links, no raw
  HTML), and images in chat behind `TIDE_CHAT_IMAGES` (off by default, browser
  memory only, images only). General file transfer stays out.
- Brand: the logo lives only in `web/src/lib/ui/BrandMark.svelte` and
  `web/static/brand/app-icon.svg`. To swap it, edit those two files and run
  `npm run icons` (regenerates the PNG icons from the SVG).
- Media tests: the media test stack serves `http://tide:8080`, which is not a
  secure context, so there is no screen-share button there. Tests wait for the
  "Meeting controls" capsule instead.

## Upstream workflow

- `main` mirrors `upstream/main`. `redesigned` is `main` plus the fork.
- A fresh clone needs the remote and rerere once:
  `git remote add upstream https://github.com/Convex-Works/tide.git`,
  `git remote set-url --push upstream DISABLED`,
  `git config rerere.enabled true`.
- To take updates: `git fetch upstream`, fast-forward `main` to `upstream/main`,
  then `git merge main` into `redesigned`. Merge, never rebase.
- Keep fork changes in new files. Keep edits to upstream files (`AGENTS.md`,
  `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`) to the one pointer line each
  already carries; put fork documentation in `docs/FORK.md`.
- Fork-only deployment (Dokploy) and settings (`TIDE_CHAT_IMAGES`) are
  documented in `docs/FORK.md`, not DEPLOYMENT.md.
- `make check` must pass before any commit that touches code.
