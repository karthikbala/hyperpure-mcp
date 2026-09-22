# Deploy on Linux

This guide targets a fresh Ubuntu 22.04/24.04 x86-64 server with systemd and Nginx. Review the templates before applying them to a shared server. DNS for your domain must point to the host; ports 80 and 443 must be reachable. Port 9310 and browser debugging must remain private.

## Install the application

Install Git, curl, xz-utils, Nginx and Certbot using your OS package manager. Clone the repository into `/opt/hyperpure-mcp` as an administrator, then:

```sh
cd /opt/hyperpure-mcp
sudo bash deploy/bootstrap.sh
export PATH="/opt/hyperpure-mcp/runtime/bin:$PATH"
sudo env PATH="$PATH" npm ci
sudo env PATH="$PATH" npx playwright install-deps chromium
sudo -u hyperpure-mcp env PLAYWRIGHT_BROWSERS_PATH=/var/lib/hyperpure-mcp/browsers \
  /opt/hyperpure-mcp/runtime/bin/node node_modules/playwright/cli.js install chromium
sudo env PATH="$PATH" npm run configure
```

When prompted for the data directory, enter `/var/lib/hyperpure-mcp`. Enter the exact outlet name/address from your own account. The helper creates a dedicated service user and downloads a checksum-verified, pinned Node 24 runtime without changing global Node. It is x86-64 only; other architectures require an appropriate Node runtime and an edited `ExecStart` path.

The helper installs Node only when `runtime/bin/node` is absent. It does not upgrade an existing runtime. Review Node security releases and update the private runtime during a planned service stop; retain the previous runtime for rollback.

```sh
sudo chown -R hyperpure-mcp:hyperpure-mcp /var/lib/hyperpure-mcp
sudo chmod 700 /var/lib/hyperpure-mcp
sudo install -m 600 .env /etc/hyperpure-mcp/service.env
sudo install -m 644 deploy/hyperpure-mcp.service /etc/systemd/system/hyperpure-mcp.service
sudo systemctl daemon-reload
sudo systemctl enable --now hyperpure-mcp
curl --fail http://127.0.0.1:9310/healthz
```

Startup opens the browser before listening, so allow it to finish before checking health. Keep the generated `.secrets/` files somewhere only the operator can read. Do not put the whole application directory behind a static web server. Root-readable configuration is supplied to the service by systemd; Chromium itself runs as the unprivileged service user.

## HTTPS

Replace `hyperpure.example.com` with your domain in **both** Nginx templates, including certificate paths. The HTTP template initially exposes only ACME challenges and an HTTPS redirect.

```sh
sudo install -d /var/www/hyperpure-acme
sudo install -m 644 deploy/nginx-http.conf /etc/nginx/sites-available/hyperpure-mcp
sudo ln -s /etc/nginx/sites-available/hyperpure-mcp /etc/nginx/sites-enabled/hyperpure-mcp
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/hyperpure-acme -d YOUR_DOMAIN
sudo install -m 644 deploy/nginx-https.conf /etc/nginx/sites-available/hyperpure-mcp
sudo nginx -t
sudo systemctl reload nginx
```

If the site already exists, review it rather than replacing unrelated configuration or symlinks. Configure Certbot's deploy hook to reload Nginx after successful renewals, confirm the OS renewal timer is enabled, and check renewal with `sudo certbot renew --dry-run`.

Open `https://YOUR_DOMAIN/owner`, unlock it, request an OTP and log in. A successful `/healthz` alone does not prove account access: use `session_status` and verify `READY`.

## Service isolation

The unit uses a dedicated user, a private temporary directory, read-only system files, a writable data directory, a bounded process count, and memory/CPU limits. Browser requests are serialized. The browser sandbox stays enabled; do not solve sandbox failures by running the service as root or adding `--no-sandbox`. Check the host's unprivileged user-namespace policy instead.

The proxy uses request limits, a small request-body limit, no response buffering and a 180-second timeout. Access logs are disabled for this virtual host. Other proxies must preserve the original Host header, forward to loopback, support long MCP requests and expose the site at the origin root, not a URL subpath.

## Updates and rollback

1. Read the release notes and back up your current code, configuration and private data separately.
2. Stop the service, check out a reviewed release tag, run `npm ci`, then install the matching Playwright browser as the service user if Playwright changed.
3. Run the offline checks and start the service. Verify `session_status`, order reads and the actual cart.
4. To roll back, restore the previous code/dependency lockfile. Browser profile formats can change between versions: do not open a newer profile with an older Chromium; restore a compatible stopped-profile backup if necessary.

Never overwrite `.env`, the server environment file, `.secrets/`, or the browser profile during a code update. No CI job deploys to your server automatically.
