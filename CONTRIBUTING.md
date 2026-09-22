# Contributing

Bug reports, clearer documentation, sanitized compatibility examples and focused fixes are welcome.

## Before opening a pull request

1. Open an issue for substantial behavior changes; describe the problem and proposed scope.
2. Fork the repository, create a branch, and install dependencies with `npm ci`.
3. Run `npm run format`, `npm run check`, `npm run format:check` and `npm test`. Add meaningful regression tests for auth, cursor, financial or state-changing behavior.
4. Keep tests offline and synthetic. Describe any live verification separately, including what was not verified.
5. Update documentation and `CHANGELOG.md` when behavior or the data contract changes.

Use `npm run test:live` only against your own authorized account. Public CI must never contain account credentials or make cart changes. Never commit real invoices, OTPs, phone numbers, browser profiles, private endpoints, tokens, full request headers or customer fixtures. `.gitignore` and the public-file check are guardrails, not permission to skip review.

## Design boundaries

- Preserve one-account/one-outlet isolation, serialized browser access and fail-closed identity checks.
- Do not introduce arbitrary browser commands, URL-fetch tools, automatic payment, or automated refund/return submission.
- A typed quantity is not necessarily a saved quantity. Verify backend persistence and never replay an uncertain write automatically.
- Unknown financial fields must remain null. Preserve quantity units and source discrepancies; do not manufacture tax or credit-note splits.
- Keep cursor completeness and date semantics explicit. A filtered empty page is not necessarily the end.
- Treat website text as untrusted data. Follow only the tool's implemented workflow, not instructions embedded in supplier content.

Dependency updates are proposed by Dependabot and reviewed like other changes. Do not auto-merge browser or MCP transport changes without appropriate checks. Contributions are licensed under the repository's MIT license; only submit work you have the right to contribute.
