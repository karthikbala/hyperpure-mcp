# Security policy

The latest published 0.x release receives best-effort security fixes. There is no guaranteed response or patch SLA; older versions should be upgraded.

Report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/karthikbala/hyperpure-mcp/security/advisories/new). Do not open a public issue containing an exploit against a live deployment, credentials or account data. Include the affected version, a sanitized reproduction, impact and suggested mitigation if known. If the private form is unavailable, ask for a private reporting channel without disclosing exploit details in a public issue.

## Security model

This is a single-account service with a persistent authenticated browser. The MCP bearer token grants account reads and cart preparation; a separate owner key controls OTP entry and checkout-review approval. Final payment is manual. HTTPS, exact outlet verification, origin/host checks, CSRF protection on owner writes, limited OTP attempts and Chromium's sandbox are part of the design.

There is no OAuth provider, tenant boundary, credential vault, external secrets manager or independent security certification. Filesystem permissions protect local secrets; disk encryption and encrypted backups are operator responsibilities. Account cookies, private API headers, phone numbers, signed document URLs and invoices must never be published.

Please report token disclosure, authentication bypass, cross-account access, unintended browser-command execution, SSRF, unsafe write replay or payment-boundary bypass privately. Routine UI selector drift can be reported publicly with sanitized logs.
