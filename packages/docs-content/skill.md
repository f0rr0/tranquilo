---
name: tranquilo
description: "Use when a user asks for a maid, house help, home cleaning help, domestic help, hourly cleaner, Tranquilo booking, saved address, slot search, payment handoff, full local QR payment, booking history, or a watch for future maid/househelp slots. Do not use for coupons, cancellation, rescheduling, or payment app opening."
---

# Tranquilo

Tranquilo is the local CLI/MCP wrapper around Pronto. There is no user-facing Tranquilo app; say Pronto app when referring to the mobile app.

Use the installed `tranquilo` MCP server first for auth, address, options, and slot inspection. For a local terminal user who says "book it" or confirms a booking, run the local CLI QR payment flow immediately because MCP tool results are not a good place to block before the QR is visible.

## Agent Rules

- Natural user phrases like "find a maid tomorrow", "book house help after work", "scan for slots", "keep looking for 1 hour slots", "need cleaning help this weekend", or "get me a 60 min maid slot" mean the House Help booking flow.
- Interpret terse booking language aggressively: "1 hour" means 60-minute House Help duration unless the user says "for the next hour"; "upcoming days" or "next few days" means `preset=next-4-days`; "after 6pm" means `--time-window 18:00-22:00`; "any you find" means the earliest ranked acceptable slot.
- Product language: Tranquilo is the local CLI/MCP wrapper around Pronto. There is no user-facing Tranquilo app; say Pronto app when referring to the mobile app.
- For any Tranquilo request, call `auth_status` first. If credentials are missing, stop and tell the user exactly: `Run tranquilo login in a local terminal, then retry.` Do not continue to address/slot tools until authenticated.
- Never ask users to paste OTPs, access tokens, refresh tokens, UPI details, or payment data into chat.
- Treat user phrases like "book it", "book this", "yes book", or "book the 60 min one" as approval to create checkout and show the local QR payment flow for the selected slot. Do not ask a second "pay now?" question in local terminal agents.
- Before running a local QR payment flow, ask which UPI app to use if the user has not already said and no local preference exists. Allowed values are `phonepe`, `googlepay`, and `paytm`. Pass that value as `--upi-app`; the CLI remembers it for later payments.
- Treat "book any you find" or "book the first one" as approval to book the earliest matching slot only if it is available in the current interactive session. If no slot is available now and a background watch is needed, create a notify-only watch. When a notification arrives later, inspect the watch and book it locally after the user confirms.
- Treat follow-up corrections as authoritative. If the user says "check any day for 30 mins" after a 60-minute search, discard the old duration/date filters and run a fresh 30-minute search.
- Only run QR/payment polling commands in a local terminal agent after the user has selected or confirmed the exact slot/duration/address.
- Do not call OTP login, terminal confirmation, or OS-open flows from the agent session.
- Treat `address_use` as selecting the active delivery/cart address, not a profile-level default.
- Use House Help tools for the booking journey; generic cart, slot, and service-catalog tools are not exposed.
- Payment can be either a handoff or a full local terminal flow. Local terminal agents should use the full QR flow after booking approval; hosted/web chat agents should use handoff only.

## MCP Tools

Use these tools directly:

- `auth_status`
- `addresses_list`
- `address_show`
- `address_use`
- `househelp_options`
- `househelp_find_slots`
- `househelp_prepare_booking`
- `househelp_payment_handoff`
- `bookings_list`
- `househelp_watch_create`
- `househelp_watch_list`
- `househelp_watch_show`
- `househelp_watch_pause`
- `househelp_watch_resume`
- `househelp_watch_delete`
- `househelp_watch_run_now`

Read-only tools are safe for inspection. Mutating tools such as `address_use`, `househelp_prepare_booking`, and watch create/pause/resume/delete/run-now need explicit user intent and structured arguments. Tool input schemas are generated in `references/mcp-tools.json`.

## CLI Fallback

Only use CLI fallback when MCP is not connected, and always request structured output:

```sh
tranquilo status --json --no-interactive
tranquilo addresses list --json --no-interactive
tranquilo househelp options --json --no-interactive
tranquilo househelp find --duration 60 --preset next-4-days --window smart --json --no-interactive
tranquilo househelp book --duration 60 --slot "2026-04-23 18:00" --address-id <id> --handoff --json --no-interactive
tranquilo househelp payment-handoff <orderId> --json --no-interactive
tranquilo bookings list --json --no-interactive
tranquilo househelp watch create --duration 60 --preset next-4-days --time-window 18:00-22:00 --address-id <id> --json --no-interactive
tranquilo househelp watch list --json --no-interactive
tranquilo househelp watch show <watchId> --json --no-interactive
tranquilo househelp watch book <watchId> --json --no-interactive --no-pay
```

Prefer exact `startTime` values returned by `househelp_find_slots` when preparing a booking. CLI `--rank` is acceptable only as a fallback with explicit search filters because it re-checks live slots before checkout.

For full local booking after the user says "book it" or otherwise approves the selected slot, run the CLI in the local terminal so it prints QR immediately, waits for scan, polls payment, and finalizes. Do not return a payment command and wait for a second "pay now" message:

```sh
tranquilo househelp book --pay --yes --upi-app <phonepe|googlepay|paytm> --duration 60 --rank 1 --preset next-4-days --window after-work --address-id <id> --save-qr /tmp/tranquilo-payment.png
```

Do not use `tranquilo checkout pay <orderId>` as the normal local booking path after preparing checkout through MCP; Juspay may refuse to reopen old prepared orders. Use a fresh `tranquilo househelp book ... --pay --yes --upi-app <app>` command for local QR payment. The CLI prints a standard terminal QR and saves a PNG fallback; in Codex desktop, show the saved PNG path as a Markdown image if the terminal QR is hard to scan. Hosted/web chat agents should not run QR or polling flows; relay the returned payment command to the user instead. Never open a UPI app from the agent.

## Booking Flow

1. Interpret "maid", "cleaner", "house help", "domestic help", and "hourly cleaning" as Tranquilo House Help.
2. Check `auth_status`; if unauthenticated, stop and give the local login command.
3. Use `addresses_list` and prefer the active delivery/cart address. Ask only if there are multiple plausible addresses and the user did not imply one.
4. Use `househelp_options` to discover backend-supported durations and prices. Do not hardcode duration ids.
5. Convert normal date/time language into filters: "tomorrow" -> `preset=tomorrow`; "after work/evening" -> `window=after-work`; "before work/morning" -> `window=before-work`; "weekend" -> `preset=weekend` only if it falls inside the valid booking horizon; if duration is absent, show available options or use the best default only after user confirmation.
6. Use `househelp_find_slots` with the user's preferred duration, date flexibility, and window. Useful defaults are `preset=next-4-days` and `window=smart`. If fallback durations are returned, clearly label them as alternatives and do not book a fallback duration without explicit user confirmation.
7. For "scan", "keep looking", or "watch" requests, first do an immediate `househelp_find_slots` check. If a matching slot is available and the user said to book any/first match, book it locally with QR. If no slot is available, create `househelp_watch_create` as a notify-only watch. Watches must not prepare checkout automatically; when the watch later reports a found slot, inspect it and ask the user before running the local `tranquilo househelp watch book <watchId> --pay` flow.
8. Do not offer dates outside the valid booking horizon: today, tomorrow, and the next two days. If the user asks beyond that, explain that Tranquilo does not allow booking that date yet.
9. If an older checkout exists outside that horizon, or its amount/duration looks wrong, do not pay it. Restart slot search and create a fresh checkout inside the valid horizon.
10. If this is a local terminal agent and the user says to book the selected slot, run `tranquilo househelp book ... --pay --yes --upi-app <app>` with explicit `duration`, `slot` or `rank`, address context, and the user's selected or remembered UPI app. Tell the user to scan the QR and wait for confirmation.
11. If this is a hosted/web chat session, or the user explicitly asks only to prepare payment, call `househelp_prepare_booking` and return the `payCommand`, amount, selected slot, duration, and address/source.
12. If payment/confirmation fails and the user may need to inspect the mobile app, refer to the "Pronto app". Do not say "Tranquilo app".
13. Do not print a cryptic command as the primary response in local terminal sessions when the user asked to book; run the QR flow instead.

## Example Intents

- "Find a maid tomorrow" -> auth check, active address, options, `househelp_find_slots` with `preset=tomorrow` and `window=smart`.
- "Book a cleaner after work this week for 1 hour" -> duration 60, `preset=next-4-days`, `window=after-work`, ask before checkout/payment and ask for UPI app if no preference exists.
- "Scan for slots for 1 hour in upcoming days and book any you find after 6pm" -> duration 60, `preset=next-4-days`, `timeWindow=["18:00-22:00"]`, immediate search; if found now, ask for UPI app if needed and run fresh local `househelp book --pay --yes --upi-app <app>`; if not found now, create a notify-only watch and tell the user they can say `book watch <id>` when notified.
- "Need house help before 9am" -> use `window=before-work`.
- "Watch for a weekend maid slot" -> use `househelp_watch_create` with `preset=weekend` only if the weekend is within today plus 3 days.
