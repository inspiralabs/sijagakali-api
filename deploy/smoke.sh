#!/usr/bin/env bash
# Smoke test setelah deploy (dijalankan deploy.sh di host VPS). Exit 0 = lulus.
set -euo pipefail
curl -fsS --max-time 10 -H "Host: api-sijagakali.inspiralabs.id" http://127.0.0.1/api/health >/dev/null
