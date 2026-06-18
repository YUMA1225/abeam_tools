# aio-checker

Next.js で作る AIO / SEO チェックツールです。

## Development

```bash
npm run dev
```

Open http://localhost:3000.

## Access allowlist

The tools index page can bypass password entry for trusted IPs.
Set the production value in Cloudflare Workers Variables or Secrets. `wrangler.jsonc`
uses `keep_vars: true` so deploys do not delete dashboard-managed values.

```bash
TOOLS_ALLOWLIST_IPS="203.0.113.10,2001:db8::10"
```

For local Wrangler development, put the same key in `.dev.vars`:

```bash
TOOLS_ALLOWLIST_IPS=203.0.113.10,2001:db8::10
```

## Checks

```bash
npm run lint
npm run build
npm audit
```
# abeam_tools
