# Changelog

## 0.4.0 — 2026-09-22

- History and details now share history-sourced delivery timestamps in UTC with millisecond precision. Differing upstream detail timestamps remain visible as diagnostics; missing history values remain null.
- Every authenticated tool result includes account/outlet identity, including PDFs, application errors and input-validation errors. Login expiry and outlet mismatch explicitly mark identity unverified.
- Stable installation-local account/outlet references survive restarts and access-token rotation. Verified API outlet IDs are persisted privately.
- Outlet IDs are persisted only after a successful, valid history response. Batch tool errors carry the same identity context as individual calls.
- Order schema is now 2.1. Existing 2.0 cursors expire on upgrade; rediscover older orders if their cached index lacks canonical delivery metadata.

## 0.3.0 — 2026-09-22

First public release under the MIT license.

- Interactive setup generates separate access keys and binds the expected outlet without overwriting an existing installation.
- Generic documentation, deployment templates, read-only live checks and an unbranded owner page replace private deployment material.
- CI, dependency-update configuration, contribution guidance and security-reporting instructions establish the public maintenance workflow.
- Includes persistent OTP sessions, catalogue/cart tools, date-filtered history, structured financial/adjustment records, and invoice/credit-note PDF retrieval.
- Payment remains manual. Multi-tenant operation, OAuth, automatic outlet switching, alerts and scheduled jobs are not included.

## 0.2.0 — 2026-09-21 (pre-public development)

Added date-filtered cursor pagination, structured order items and taxes, credit notes, returns, shortage tickets and combined credit-note PDFs. Cursor and account discovery state persist across restarts.

## 0.1.0 — 2026-09-21 (pre-public development)

Initial persistent-browser service, authenticated MCP transport, owner OTP/review controls, search, cart preparation and recent-order/invoice reads.
