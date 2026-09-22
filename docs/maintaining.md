# Maintaining a release

This repository is the source of truth for code and public documentation. Keep production configuration, profiles and account evidence outside Git. Maintenance is best-effort; Dependabot opens proposals rather than installing updates on anyone's server.

## Changes

1. Create a focused branch and pull request. Explain the observable problem, changed behavior and validation.
2. Run `npm ci`, `npm run check`, `npm run format:check`, `npm test` and `npm run check:public`. Both Node 22 and 24 CI jobs must pass.
3. Review dependency and browser changes carefully. Use an authorized account for read-only smoke checks when relevant; test cart changes only with explicit permission and verify their resulting state.
4. Keep fixtures synthetic. Review the actual staged diff for credentials, account identifiers and deployment details even when automated checks pass.
5. Update the changelog and affected guides. Preserve unknown values and explain data-contract changes to downstream consumers.

## Releases

Keep `package.json`, `package-lock.json` and the server's MCP version in `src/server.js` consistent. During 0.x development, announce incompatible behavior explicitly and use a minor-version change. Patch releases should preserve documented behavior.

Create a version tag and GitHub release only for a reviewed commit with passing checks. Release notes should describe changes, upgrade steps, checks performed and known limitations. Do not include real account data or imply that offline CI proves a live purchase or bank settlement.

Deployments are manual. Follow [the deployment guide](deployment.md), including stopped-profile backups and post-update session checks. Keep a matching code, dependency and browser-profile backup for rollback. Never deploy a dependency update solely because Dependabot opened it.

## Security and compatibility reports

Use [private vulnerability reporting](../SECURITY.md) for credentials, access-control failures or other sensitive issues. Ordinary reports should include versions, sanitized reproduction steps and the failing tool/state. A website change may need fresh authorized inspection; stop affected operations until their identity and financial fields can be verified again.
