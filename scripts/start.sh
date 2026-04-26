#!/bin/bash
echo ""
echo "  Sawdust Studio — Crew App"
echo "  ─────────────────────────"
echo ""
echo "  Starting keep-alive..."
bash "$(dirname "$0")/keepalive.sh" &

echo "  Launching Expo tunnel..."
echo "  Scan the QR code below to open on your phone."
echo ""
npm start
