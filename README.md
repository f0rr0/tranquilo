# Tranquilo

First-party CLI and local MCP server for Pronto House Help booking flows. Tranquilo is the wrapper/tooling layer; Pronto is the user-facing app/backend.

## Install

```sh
curl -fsSL https://tranquilo-ai.vercel.app/install.sh | sh
```

The installer downloads the right binary for the current platform, installs shipped agent assets, and auto-configures Codex and/or Claude Code integrations when those clients are detected. Windows users should run the same command from bash, for example Git Bash, MSYS2, Cygwin, or WSL.

Set `TRANQUILO_SKIP_AGENT_INSTALL=1` to install only the CLI, or `TRANQUILO_INSTALL_AGENT_TARGET=codex|claude-code|all` to override automatic agent detection.

## Use

Human CLI commands:

```sh
tranquilo login
tranquilo addresses list
tranquilo addresses use <addressId>
tranquilo househelp options
tranquilo househelp find --duration 60 --preset next-4-days --window smart
tranquilo househelp book --duration 60 --rank 1 --preset next-4-days --window smart --address-id <addressId>
tranquilo househelp book --duration 60 --rank 1 --preset next-4-days --window smart --address-id <addressId> --pay --yes
tranquilo househelp book --duration 60 --slot "tomorrow 6pm" --address-id <addressId>
tranquilo househelp book --duration 60 --slot "tomorrow 6pm" --address-id <addressId> --handoff
tranquilo checkout pay <orderId>
tranquilo checkout status <orderId> --watch
tranquilo bookings list --status upcoming
```

Human-facing list commands render responsive terminal tables by default. Use `--json` on table commands such as `addresses list` and `househelp find` when piping output to scripts or agents.
Location-aware commands use explicit coordinates first, then explicit `--address-id`, then the active cart delivery address from `GET /gateway/cart/v2`.

## Agent Usage

Agents should treat natural requests like “find a maid tomorrow”, “scan for slots”, “keep looking for 1 hour slots after 6pm”, “book house help after work”, or “get me a 60 minute maid slot” as the House Help flow. Use MCP first and CLI JSON fallback second for inspection. For local terminal agents, “book it” or “book any you find” means run the local QR payment flow immediately for a currently available selected slot. If no slot is available immediately, watches are notify-only; when a slot is found later, inspect/book the found watch locally. Safe MCP tools are `auth_status`, `addresses_list`, `address_show`, `address_use`, `househelp_options`, `househelp_find_slots`, `househelp_prepare_booking`, `househelp_payment_handoff`, and `househelp_watch_*`.

Product language for agents: Tranquilo is this CLI/MCP wrapper. Pronto is the consumer app and backend. If a user needs to inspect pending bookings or complete something manually, say “Pronto app”, never “Tranquilo app”.

For any Tranquilo request, agents should call `auth_status` first. If unauthenticated, they should stop and tell the user to run `tranquilo login` in a local terminal, then retry.
House Help bookings are only valid for today, tomorrow, and the next two days. Do not offer or book later dates even if the raw API happens to return them.

CLI fallback must be non-interactive and structured:

```sh
tranquilo status --json --no-interactive
tranquilo addresses list --json --no-interactive
tranquilo househelp options --json --no-interactive
tranquilo househelp find --duration 60 --preset next-4-days --window smart --json --no-interactive
tranquilo househelp book --duration 60 --slot "2026-04-23 18:00" --address-id <id> --handoff --json --no-interactive
tranquilo househelp book --duration 60 --rank 1 --preset next-4-days --time-window 18:00-22:00 --address-id <id> --handoff --json --no-interactive
tranquilo househelp watch create --duration 60 --preset next-4-days --time-window 18:00-22:00 --address-id <id> --json --no-interactive
tranquilo househelp watch show <watchId> --json --no-interactive
tranquilo househelp watch book <watchId> --json --no-interactive --no-pay
tranquilo househelp payment-handoff <orderId> --json --no-interactive
tranquilo bookings list --json --no-interactive
```

For a local terminal agent, after the user confirms a selected slot with “book it” or equivalent, use the CLI payment path instead of MCP so the QR is visible before polling. Do not return a command and wait for a separate “pay now” message:

```sh
tranquilo househelp book --duration 60 --rank 1 --preset next-4-days --window after-work --address-id <id> --pay --yes
```

Agents must not run login or `--open-intent` commands. Hosted/web chat agents should not try to render QR or poll payment; they should return `payCommand` instead. When using MCP, prefer passing the exact `startTime` returned by `househelp_find_slots`; CLI `--rank` is mainly a local convenience fallback that re-checks live slots before checkout.

## Checkout And Payment

Checkout is QR-first for desktop terminals. Interactive `househelp book` shows the QR by default after confirmation; use `--handoff` only when you want to prepare checkout without showing QR:

```sh
tranquilo househelp book --duration 60 --rank 1 --preset next-4-days --window after-work --address-id <addressId> --pay --yes
tranquilo checkout pay <orderId>
```

`checkout pay` resolves a Juspay UPI URI or payment-page URL, renders a standard terminal QR, saves a PNG QR fallback in Tranquilo's state dir, polls Juspay until `CHARGED`, then finalizes through Pronto `process-order`. If Juspay refuses to reopen a prepared House Help order, the CLI recreates a fresh checkout from the stored slot/duration/address metadata and pays that new order. Use `--save-qr <path>` to choose the image path, `--qr-size normal` if the terminal QR is unreliable, or explicit `--open-intent` for secondary flows.

## Slot Autopilot

Create local slot watches:

```sh
tranquilo househelp watch create --duration 60 --address-id <addressId> --preset next-4-days --time-window 18:00-22:00 --slack-webhook "$SLACK_WEBHOOK_URL"
tranquilo househelp watch list
tranquilo househelp watch show <watchId>
tranquilo househelp watch run-now <watchId>
tranquilo househelp watch book <watchId>
```

The default watch searches only the valid booking horizon: today, tomorrow, and the next two days. Smart windows are weekdays 18:00-22:00 and weekends 09:00-20:00. Other windows are `before-work`, `after-work`, `weekend`, `any`, and `custom --from HH:mm --to HH:mm`.

Install one per-user OS timer so the machine has zero resident Tranquilo process:

```sh
tranquilo househelp watch scheduler install
tranquilo househelp watch scheduler status
tranquilo househelp watch scheduler uninstall
```

The scheduler wakes every minute and runs a short-lived `tranquilo househelp watch run-due`. It only checks due watches. Watches persist the found slot, send a concise desktop notification, and optionally post to Slack via `--slack-webhook` or `TRANQUILO_SLACK_WEBHOOK_URL`. Watches never create checkout automatically; use `tranquilo househelp watch book <watchId>` or ask the agent to book the watch after you see the notification.

## MCP

```sh
tranquilo mcp
```

Configure Codex and Claude Code:

```sh
tranquilo install-agent all
```

Coupons, booking cancel/reschedule, generic cart mutation, generic service catalog inspection, address create/edit/delete, and profile-level default are intentionally not implemented in v1. Use `addresses use` to set the active delivery/cart address.

Claude Desktop `.mcpb` bundles are generated during build/package steps. `@anthropic-ai/mcpb` is only a pack/init tool; schema/docs drift is handled by `packages/cli-model/src/agent-catalog.ts` and `bun run generate`. Product version and release targets are grounded in `apps/cli/package.json`: Changesets bump the CLI `version`, `tranquilo.release` defines installable CLI artifacts, and `tranquilo.mcpb` defines the MCPB schema/compatibility metadata. The MCPB `dxt_version` is the bundle schema version, not the Tranquilo release version.

## Development

Installed users do not need Bun. This repo uses Bun workspaces with isolated installs for maintainer workflows, Turborepo for monorepo task orchestration, Next.js for the static-first public site, Fumadocs for docs rendered inside the site at `/docs`, `packages/cli-model` for CLI/MCP/release metadata, and `packages/site-model` for site-only install/download routing. Fumadocs content is generated but committed under `packages/docs-content` so the Vercel site build owns docs deployment; there is no separate docs host. Site metadata, skill references, Claude commands, and MCPB manifests are ignored by git and regenerated by dev/build/validate/release scripts. It also uses Citty for command routing, Visulima Tabular for responsive non-interactive tables, tsdown for builds, tsgo for typechecking, Ultracite for lint/format, actionlint for GitHub Actions, Knip for dead-code/dependency checks, Lefthook for local hooks, Sherif for monorepo hygiene, and Vitest for tests.
Bun 1.3.13 is pinned for local maintainer workflows, CI, and release builds because older Bun versions failed at least one release-path check.

```sh
bun install
bun run dev:cli -- --help
bun run dev:site
bun run dev:docs
bun run dev
bun run generate
bun run check
bun run actions:lint
bun run knip:check
bun run typecheck
bun run test
bun run build
bun run release:verify
```

## Release Policy

Merging to `main` does not create a CLI release automatically. Landing and docs changes can deploy independently from `main` without a CLI version bump.

Landing and docs are latest-channel surfaces. They can change for copy, navigation, examples, SEO, or explanatory updates without touching the installed CLI. They should not document unreleased CLI/MCP behavior unless that behavior is already merged and intentionally waiting for the next manual CLI release.

Changesets are the release intent source of truth. CI uses Turbo affected to decide whether the `tranquilo` workspace is impacted; if it is impacted, the PR must include either a normal `tranquilo` changeset or an explicit empty no-release changeset. This avoids brittle path-based release guesses while keeping intentional docs/site-only work independent.

To publish a new CLI version:

1. Add a Changesets file for CLI/MCP/shipped-agent behavior that should be released.
2. Merge to `main`.
3. Open GitHub Actions, run the `release` workflow manually from the `main` branch.

The manual release workflow applies pending Changesets, snapshots the current latest docs into `packages/docs-content/versions/vX.Y.Z`, packages binaries, pushes the release commit/tag, and publishes the GitHub Release. If there are no pending CLI Changesets, it exits without creating a release.

If the GitHub Release for the current version is missing but no Changesets bump is pending, the release workflow will not publish by default. Re-run it with `force_current_version` only for an intentional recovery publish.

Fumadocs content is committed source. The Git-tracked docs surface is `packages/docs-content/meta.json`, `packages/docs-content/latest/**`, `packages/docs-content/versions/**`, `packages/docs-content/llms.txt`, and `packages/docs-content/skill.md`. Run `bun run generate` after changing CLI/MCP/product metadata and commit the resulting docs changes. `bun run generate:check` fails when committed docs are stale.

Docs deploy with the Vercel site app. `/docs`, `/docs/versions/vX.Y.Z`, `/docs/latest`, `/llms.txt`, and `/docs/skill.md` are served by Next/Fumadocs.

Lefthook installs local `pre-commit`, `commit-msg`, and `pre-push` hooks through `bun run prepare`. Pre-commit runs lint, typecheck, tests, actionlint, and Knip. Pre-push runs full validation, the changeset gate, PR package smoke, and actionlint.

## PR Previews

PRs must include a changeset only when Turbo reports the `tranquilo` workspace as affected. Use a normal `tranquilo` changeset for releasable CLI work, or an empty no-release changeset when the impact is intentional but should not create a CLI release. PR preview builds publish macOS-only CLI artifacts and are installable with:

```sh
curl -fsSL https://tranquilo-ai.vercel.app/pr/<pr>/install.sh | sh
```

Vercel install routes derive the public base URL from the request host or Vercel system env vars. Stable release downloads read public GitHub Releases without a token. Set `GITHUB_TOKEN` only if the repo is private or if Vercel must broker PR preview artifacts from GitHub Actions. `GITHUB_OWNER` and `GITHUB_REPO` are optional overrides; the default public repo is `f0rr0/tranquilo`.

## Vercel

The Vercel project is the public site/install app. Configure it from the repo root
so Turbo can see all workspaces, generated docs, and shared model packages:

| Setting | Value |
| --- | --- |
| Root Directory | empty / repository root |
| Install Command | `bunx bun@1.3.13 install --frozen-lockfile` |
| Build Command | `bunx bun@1.3.13 turbo run build --filter=@tranquilo/site` |
| Output Directory | `apps/site/.next` |

These values are also checked into the root `vercel.json`. Keep the Vercel Root
Directory at the repository root; the root package intentionally lists `next` so
Vercel can detect the Next.js framework while Turbo builds the actual app in
`apps/site`.
