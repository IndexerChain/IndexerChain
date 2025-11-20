#!/usr/bin/env bash
set -euo pipefail

echo "🏗  Building frontend..."
npm run build

echo "🚀 Deploying to Cloudflare Pages (project: indexerchain, branch: production)..."
npx wrangler pages deploy dist --project-name indexerchain --branch production --commit-dirty=true

echo "✅ Done. Check Wrangler output above for the production URL."


