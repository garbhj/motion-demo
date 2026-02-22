#!/usr/bin/env bash
set -euo pipefail

NGROK_ADDR="http://127.0.0.1:4040"
SERVER_PORT="${SERVER_PORT:-8080}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok not found in PATH"
  exit 1
fi

if ! curl -s "$NGROK_ADDR/api/tunnels" >/dev/null 2>&1; then
  echo "ngrok api not reachable at $NGROK_ADDR, starting ngrok..."
  ngrok http "$SERVER_PORT" >/tmp/ngrok.log 2>&1 &
  for _ in $(seq 1 20); do
    if curl -s "$NGROK_ADDR/api/tunnels" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
fi

if ! curl -s "$NGROK_ADDR/api/tunnels" >/dev/null 2>&1; then
  echo "ngrok api still not reachable at $NGROK_ADDR"
  exit 1
fi

PUBLIC_URL=""
for _ in $(seq 1 20); do
  BODY="$(curl -s "$NGROK_ADDR/api/tunnels" || true)"
  if [ -z "$BODY" ]; then
    sleep 0.2
    continue
  fi
  PUBLIC_URL="$(printf "%s" "$BODY" | python3 - <<'PY'
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    sys.exit(0)
for t in data.get("tunnels", []):
    url = t.get("public_url", "")
    if url.startswith("https://"):
        print(url)
        sys.exit(0)
print("")
PY
)"
  if [ -n "$PUBLIC_URL" ]; then
    break
  fi
  sleep 0.2
done

if [ -z "$PUBLIC_URL" ]; then
  echo "failed to find https public_url from ngrok api"
  echo "is ngrok authenticated and running? try: ngrok http $SERVER_PORT"
  exit 1
fi

WS_URL="${PUBLIC_URL/https:/wss:}/ws"

cat > client/.env <<EOF
VITE_WS_URL=$WS_URL
EOF

cat > server/.env <<EOF
NETWORK_ADDR=:$SERVER_PORT
PUBLIC_WS_URL=$WS_URL
EOF

echo "Wrote client/.env and server/.env"
echo "VITE_WS_URL=$WS_URL"
