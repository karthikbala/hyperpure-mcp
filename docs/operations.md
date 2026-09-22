# Operations and troubleshooting

## Login lifecycle

The entire Chromium profile is retained under `DATA_DIR/profile`. Hyperpure decides when the session expires. The app checks before operations and every 15 minutes when idle. It pauses account operations if identity cannot be verified.

On `AUTH_REQUIRED`, unlock `/owner`, request an OTP and enter it there. Requests have a 90-second cooldown and a limit of three per hour, persisted across restarts. A challenge lasts five minutes and allows three attempts. OTPs are kept in memory only; the mobile number is stored in your private runtime configuration. Refreshing the owner page requires unlocking it again and resumes an active challenge; a service restart requires a new challenge.

There is no automatic messaging integration. A future alert integration should notify once on transition to login-required, suppress repeats, and clear the alert only after verified recovery. It must not fetch or forward OTPs automatically.

## Common errors

| Error/state                                 | Operator action                                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OUTLET_MISMATCH`                           | Check the exact configured name/address and the account's selected outlet. Automatic outlet switching is unsupported. Never disable identity checks to continue. |
| `SETUP_REQUIRED`                            | Run setup before starting; a valid `binding.json` is required.                                                                                                   |
| `SITE_UNAVAILABLE`, `ORDER_SCHEMA_CHANGED`  | Check Hyperpure availability and whether the page/API changed. Do not treat the response as an empty result.                                                     |
| `HYPERPURE_RATE_LIMITED`                    | Pause; do not retry in a tight loop or change IPs to bypass limits.                                                                                              |
| `CART_UPDATE_NEEDS_REVIEW`                  | A write may have succeeded. Read the actual cart before deciding to retry.                                                                                       |
| `SEARCH_REQUIRED`                           | Search again; product selections expire after 15 minutes.                                                                                                        |
| `CURSOR_EXPIRED`, `HISTORY_CHANGED_RESTART` | Begin a new scan without the old cursor.                                                                                                                         |
| `ORDER_NOT_IN_DISCOVERED_HISTORY`           | Discover the order with `list_orders` and its continuation cursors first.                                                                                        |
| `APPROVAL_EXPIRED_OR_CART_CHANGED`          | Generate a fresh review and check the current checkout.                                                                                                          |

If the first login opens a different outlet, stop and select the intended default outlet through the account's normal controls or an operator-controlled browser session. Headless multi-outlet selection is not implemented. Changing a deployed outlet deliberately requires reviewing the binding and clearing its account-scoped caches while the service is stopped; do not repurpose one profile for multiple accounts.

## Health and recovery

```sh
systemctl status hyperpure-mcp
journalctl -u hyperpure-mcp --since '15 minutes ago'
systemctl restart hyperpure-mcp
```

`/healthz` only confirms that the process is serving requests. `session_status` checks live login and identity. Unexpected browser exit triggers service recovery; repeated failures hit the systemd start limit and require investigation. No in-flight cart operation is automatically replayed after a crash.

## Data and keys

- Treat the profile like an account password. Keep it under owner-only permissions and never mount it publicly or share it with another process while running.
- To back up, stop the service, copy its configuration and data to encrypted storage, then start it again. No off-server backup is included.
- Rotate `MCP_TOKEN` or `OWNER_KEY` in the private environment file, restart, and update the appropriate clients. Rotating the MCP token also invalidates signed pagination cursors. Do not rerun setup to rotate keys: it refuses overwrites.
- The MCP token permits cart changes and reading account data; the owner key additionally controls OTP login and review approval. Neither permits automated payment through the provided tools.
- Logs and error traces may contain product/page details. Redact them before filing an issue. Never attach environment files, profiles, full network headers, invoices or personal account fixtures.

## Purchase boundary

A review binds the full cart, fees, delivery information and payable amount for ten minutes. Owner approval re-reads checkout and rejects an expired, changed or reused review. The result is `AWAITING_MANUAL_PAYMENT`, not an order receipt. Complete payment yourself on Hyperpure; your personal browser may need its own login. Always verify the resulting order in Hyperpure before claiming purchase success.
