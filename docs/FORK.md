# Fork notes

This is a fork of [Convex-Works/tide](https://github.com/Convex-Works/tide).
Upstream's `AGENTS.md`, `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md` stay
almost identical to upstream so merges stay clean; each carries one pointer
line to this file. Where this file disagrees with them, this file wins.

## Design language

This replaces [ARCHITECTURE.md §10](ARCHITECTURE.md#10-design-language).

Calm, small, precise. Text is minimal: controls are icon-first
(phosphor-svelte) with tooltips; words appear where they carry information.

**Two themes, one layout.** Light and dark share every layout and component;
only token values differ. The theme follows the system
(`prefers-color-scheme`) and the toggle in the header overrides it. Picking
what the system already shows stores "system", so the app keeps following it.
An inline script in `app.html` applies the choice before first paint
(`<html data-theme>`), and `lib/ui/theme.svelte.ts` keeps it in step. The
recorder's page (`/egress-template`) is always dark. Dark is the default
before any signal.

**Tokens** are semantic CSS custom properties in `web/src/app.css`, defined per
theme (`:root, :root[data-theme='dark']` and `:root[data-theme='light']`) and
mapped onto Tailwind utilities in its `@theme` block. Components use the
semantic name, never a hex value:

- Ground and surfaces: `--bg`, `--bg-glow`, `--surface`, `--surface-2`,
  `--line`, `--line-strong`, `--scrim`, `--shadow-float`.
- Ink: `--ink`, `--ink-2`, `--ink-3` (primary, secondary, tertiary text).
- Accent: `--accent`, `--accent-hover`, `--on-accent` (primary actions, focus,
  one green accent); `--highlight`, `--on-highlight` (lime, for emphasis).
- Stage: `--speak-ring`, `--speak-glow`, `--lens-from`, `--lens-to`.
- State: `--rec`, `--rec-ink`, `--rec-soft`, `--danger`, `--on-danger`, `--ok`,
  `--warn`.
- Brand and avatars: `--mark-from`, `--mark-to`, and `--p1-bg`/`--p1-fg` to
  `--p5-bg`/`--p5-fg` for participant colours.

`npm run check` fails on any `var(--x)` with no fallback and no definition
(`web/scripts/check-css-vars.mjs`), because CSS drops an undefined variable
silently.

Typography: **Roboto** (variable) for all UI, base 14px/1.45, and
**JetBrains Mono** (variable) for anything machine-flavored: room slugs,
timers, participant counts, keyboard shortcuts. Both are self-hosted through
`@fontsource-variable` packages; nothing loads from a font CDN. Words people
read in the meeting (names, "(You)") stay in Roboto.

**Roles are words, not badges.** No pills or outlined chips for roles: the
local participant is "Name (You)" and the host carries a secondary line,
"Meeting host", in `--ink-3` (Meet's pattern). The pre-join account line
says "· Host" in secondary ink. The human room name is shown during join and
lobby transitions and in the stage's top-left cluster (ARCHITECTURE.md §9);
room slugs are kept out of the meeting UI except inside the meeting URL in its
details popover.

Geometry: 4px spacing base. Radii are a scale of tokens, `--r-sm` 12px,
`--r-md` 20px, `--r-lg` 28px, `--r-xl` 44px and `--r-pill`, used as
`rounded-sm` to `rounded-xl`; controls sit at the small end, the stage lens and
sheets at the large end. Elevation is one shadow, `--shadow-float`, for
menus, sheets and dialogs.

Icons: phosphor-svelte, 16px, regular weight everywhere (20px only on pre-join
device controls). No filled/duotone or bold variants.

**The brand mark** is isolated in `lib/ui/BrandMark.svelte` (the in-app logo)
and `web/static/brand/app-icon.svg` (the source of the PWA and favicon
images). Swapping the logo touches those two files; `npm run icons` regenerates
the PNG icons from the SVG.

**The Orbit stage.** The most recent remote speaker fills the **lens**; everyone
else, you included, is a **portal** around it. The **grid** view (the view
toggle) lays everyone out evenly instead. When someone shares their screen the
**share frame** takes the stage, with a **popout** that lifts the share into a
small window of its own. On a phone (<640px) the lens fills the width and the
portals scroll in a **strip** beneath it, with secondary controls in a
**More** sheet. Side panels (people, chat) are **sheets**: docked beside the
stage at 900px and wider, an overlay at 640 to 899px, a bottom sheet below
640px.

**Signature: the hairline.** A 2px line across the very top of the app chrome
that doubles as the status channel: the brand gradient (`--mark-from` to
`--mark-to`) when idle or connected, amber while reconnecting, grey when
offline, pulsing `--rec` red while the room is being recorded. State lives in
the chrome, not in a toast.

**Motion house rules.** Animate only `transform` and `opacity` (a `--dur-1`
colour fade on a hovered control is the one allowance); never transition
layout properties. Durations are `--dur-1` 120ms, `--dur-2` 200ms and
`--dur-3` 320ms, with `--ease-out` and `--ease-in-out`. Nothing loops unless
live state drives it (speaking, recording), and nothing animates while the
document is hidden. `prefers-reduced-motion` zeroes every transition and
animation (one rule in `app.css`); the recording hairline becomes a static red
line.

## Feature additions

Upstream freezes its feature list
([ARCHITECTURE.md §1](ARCHITECTURE.md#1-principles)). This fork adds the
following, each deliberately small. File transfer in general stays out.

- **Installable PWA.** A web manifest plus a service worker that caches the app
  shell and static assets only, never `/api`, `/rtc` or any media.
- **Screen share popout.** A share can be lifted out of the page into a small
  window, using Document Picture-in-Picture where the browser has it, the video
  alone in system picture-in-picture, or WebKit's presentation mode
  (`lib/rtc/sharePopout.ts`).
- **Minimal markdown in chat.** Chat text supports `**bold**`, `*italic*` or
  `_italic_`, `~~strike~~`, `` `inline code` ``, fenced code blocks, and bare
  http(s) links (which open with `noopener noreferrer nofollow`). Not supported,
  on purpose: `[text](url)` links, because with guests in the room a link must
  show where it goes; and headings, lists, quotes, tables, images and raw HTML.
  A message is parsed to data (`lib/chat/markdown.ts`) and rendered as Svelte
  elements, so no message can inject markup.
- **Images in chat**, off unless `TIDE_CHAT_IMAGES=true` (read from the room's
  public info, so guests get it too). PNG, JPEG, WebP and GIF only: the sender's
  browser re-encodes to at most 2048px on the long side and 2 MB, dropping
  metadata, and receivers check magic numbers and dimensions before showing
  anything. Images travel as LiveKit data messages (topic `chat-image`), are
  held in browser memory only, and vanish with the meeting; tide never receives
  or stores them. This is not a file-transfer feature and does not open one.

## Configuration

Added to [DEPLOYMENT.md's configuration reference](DEPLOYMENT.md#configuration)
and the variable list in ARCHITECTURE.md §12.

| Variable           | Default | Meaning                                                                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TIDE_CHAT_IMAGES` | `false` | Lets meeting chat carry images ([Chat images](#chat-images)). Any mode. Read with `strconv.ParseBool`; anything else means off. |

### Chat images

With `TIDE_CHAT_IMAGES=true`, people in a meeting can send images (PNG, JPEG,
WebP or GIF) in chat. The sender's browser re-encodes each one, which drops
its metadata such as GPS position, to at most 2048 pixels on the long side and
2 MB. Images go from browser to browser over the media server's data channel:
the media server holds them in memory only while it forwards them, and tide
never receives or stores them. They vanish when the meeting ends, like chat.

Browsers enforce the switch; tide only tells them, on the room's public info.
A modified client can still push bytes through the media server while it is
off, but compliant browsers neither send images then nor show what arrives.

## Deployment on Dokploy

`deploy/dokploy/compose.yaml` builds tide from this repository and runs it
behind Dokploy's Traefik, with Redis and the recorder under the `recording`
profile. Unlike the compose above, tide sits on a bridge network, because
Traefik reaches it over `dokploy-network`. Media still bypasses the proxy:
7882/udp and 7881/tcp are published on the host under the same port numbers,
and tide discovers the host's public address over STUN. Redis and the recorder
are placed as in the media gate: Redis by name on a private network, the
recorder in tide's network namespace.

1. Create a **Docker Compose** service (not Stack: it can't build), with this
   repository as its Git source and `./deploy/dokploy/compose.yaml` as the
   compose path.
2. In **Environment**, set the variables below. Dokploy writes them to `.env`
   beside the compose file, which tide reads whole.
3. In **Domains**, add the meeting host for service `tide`, container port
   `8080`, with HTTPS. Dokploy attaches tide to `dokploy-network` and adds the
   Traefik labels.
4. Open 7882/udp and 7881/tcp in the server's firewall. Docker's published
   ports bypass `ufw`, so a provider firewall is the one that counts.
5. Deploy, and check the mode line in tide's log.

```sh
TIDE_BASE_URL=https://meet.example.com
# Traefik's network: docker network inspect dokploy-network --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
TIDE_TRUSTED_PROXIES=10.0.1.0/24
# openssl rand -base64 48
TIDE_SESSION_SECRET=…
TIDE_OIDC_ISSUER=https://id.example.com
TIDE_OIDC_CLIENT_ID=tide
TIDE_OIDC_CLIENT_SECRET=…
# Recording, as in the compose above:
COMPOSE_PROFILES=recording
TIDE_S3_ENDPOINT=https://s3.example.com
TIDE_S3_BUCKET=tide-recordings
TIDE_S3_REGION=us-east-1
TIDE_S3_ACCESS_KEY=…
TIDE_S3_SECRET_KEY=…
# openssl rand -hex 8
TIDE_MEDIA_API_KEY=…
# openssl rand -hex 32, for this and the password
TIDE_MEDIA_API_SECRET=…
TIDE_RECORDER_REDIS_PASSWORD=…
```

The compose file sets `TIDE_ADDR`, `TIDE_DB_PATH`, `TIDE_RECORDER_REDIS_ADDR`
and `TIDE_RECORDER_TEMPLATE_URL` itself. Leave out the recording block for a
deployment without recording, and the OIDC and session lines too for an
anonymous one. tide's 8080 is not published, so trusting the whole
`dokploy-network` subnet admits only the proxies and containers on it. Leave
`TIDE_MEDIA_NODE_IP` unset unless the host's public address is not its own
([The media address](DEPLOYMENT.md#the-media-address)). The recorder joins tide's network
namespace when it starts, so a tide container that restarts on its own leaves
the recorder disconnected until it restarts too; redeploying restarts both.
SQLite lives in the `tide-data` volume: back it up as in [Back up
state](DEPLOYMENT.md#back-up-state), not by copying the volume while tide runs.

## Keeping up with upstream

`main` mirrors `upstream/main`; `redesigned` is `main` plus the fork. To take
updates:

```sh
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git checkout redesigned && git merge main
```

Merge, never rebase. `git rerere` is on, so a conflict is resolved once. Keep
fork changes in new files, and keep upstream files to a one-line pointer where
possible.
