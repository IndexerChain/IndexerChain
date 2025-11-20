## Cloudflare Pages Deployment Guide (IndexerChain Frontend)

This guide shows how to deploy the built frontend to Cloudflare Pages and verify routes. It assumes the signaling server (Durable Object Worker) is already deployed and reachable at `signal.indexerchain.com`.

### Prerequisites
- Node 18+
- Cloudflare Wrangler CLI logged in:
  - `npm i -g wrangler` (or `pnpm add -g wrangler`)
  - `wrangler login`
- Cloudflare account with Pages enabled

### 1) Prepare production env
- Ensure `./.env.production` exists with:
  ```
  VITE_NETWORK_ID=IXC_MAINNET_V2
  VITE_SIGNALING_WS=wss://signal.indexerchain.com
  VITE_SIGNALING_HTTP=https://signal.indexerchain.com
  VITE_POOLED_REWARDS_ENABLED=true
  VITE_SLOT_TIME_MS=50
  VITE_EPOCH_MS=1000
  ```
- Build:
  ```
  npm run build
  ```
  Output is generated at `./dist`.

### 2) Deploy to Cloudflare Pages
- One-off deploy (create or update project named `indexerchain`):
  ```
  npx wrangler pages deploy dist --project-name indexerchain --branch production --commit-dirty=true
  ```
  Notes:
  - `--branch production` creates a production deployment
  - If the project does not exist, Wrangler will prompt or auto-create it

### 3) (Optional) Create project explicitly
If needed, run:
```
wrangler pages project create indexerchain --production-branch production
```
Then deploy as above.

### 4) Custom domain (optional)
- Add domain:
  ```
  wrangler pages domain add indexerchain yourdomain.com
  ```
- List domains:
  ```
  wrangler pages domain list indexerchain
  ```
- Remove domain:
  ```
  wrangler pages domain remove indexerchain yourdomain.com
  ```

### 5) Route and runtime checks
After deployment, open the production URL shown in Wrangler output. Verify:
- HTML loads (`/`)
- Assets load (`/assets/*`)
- App config reflects the production build (open DevTools console and verify `import.meta.env.*` are baked, e.g., `VITE_NETWORK_ID === "IXC_MAINNET_V2"`)
- The frontend points to the correct signaling server:
  - WS: `wss://signal.indexerchain.com`
  - HTTP: `https://signal.indexerchain.com`
- Backend quick checks:
  - `GET https://signal.indexerchain.com/bootstrap-blocks?from=1&to=1` returns JSON (either blocks or a `NO_BOOTSTRAP_BLOCKS` marker)
  - Admin endpoints should NOT be publicly exposed in production. If enabled, ensure they are protected.

### 6) Troubleshooting
- White screen: clear browser cache and reload
- Wrong network ID: confirm `.env.production` existed BEFORE building
- Mixed content: always use `wss://` and `https://`
- CORS errors to signaling server: ensure Worker CORS allows necessary headers and origins

### 7) CI suggestion (optional)
Use GitHub Actions with Wrangler Pages for automatic deploys on push to `production` branch.


