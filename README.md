# Tranquilo

[![Release](https://img.shields.io/github/v/release/f0rr0/tranquilo?style=flat-square&label=release&color=00b564)](https://github.com/f0rr0/tranquilo/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/f0rr0/tranquilo/ci.yml?branch=main&style=flat-square&label=ci&color=00b564)](https://github.com/f0rr0/tranquilo/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-tranquilo--ai.vercel.app-00b564?style=flat-square)](https://tranquilo-ai.vercel.app/docs)

Tranquilo is a local command center for Pronto House Help: find maid slots, keep watching for better times, book the slot you want, and finish payment from your terminal with a QR.

It also installs AI-agent integrations, so Codex or Claude Code can understand requests like “find a maid tomorrow after 6” and drive the safe parts of the flow for you.

## Install

```sh
curl -fsSL https://tranquilo-ai.vercel.app/install.sh | sh
```

The installer picks the right binary for your platform and configures supported local AI tools when it finds them. Windows users can run the same command from bash through WSL, Git Bash, MSYS2, or Cygwin.

## What It Does

- Searches Pronto House Help slots for saved addresses.
- Prioritizes useful windows like after work, before work, weekends, or an exact time.
- Watches for scarce slots without leaving a resident daemon running.
- Books a selected slot and shows a local QR for UPI payment.
- Exposes MCP tools and agent docs for safe AI-assisted booking.

Tranquilo is the CLI/MCP wrapper. Pronto is the consumer app and backend.

## Docs

Start with the [Tranquilo docs](https://tranquilo-ai.vercel.app/docs) for setup, CLI commands, AI-agent usage, watches, payments, and release notes.

## Status

Tranquilo is built around the captured Pronto House Help flow. It does not implement coupons, cancellation, rescheduling, address creation/editing, or unattended payment.
