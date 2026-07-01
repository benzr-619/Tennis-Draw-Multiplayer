#!/bin/bash
# Mobile testing launcher for Slam Bracket Multiplayer
# Starts the Vite dev server on your local network and tells you the URL to
# type into your phone's browser.

# Always run from this script's own folder, no matter how it was launched
cd "$(dirname "$0")" || exit 1

# Find this Mac's local Wi-Fi IP address
IP=$(ipconfig getifaddr en0)

if [ -z "$IP" ]; then
  echo "Could not detect a Wi-Fi IP on en0. Trying en1..."
  IP=$(ipconfig getifaddr en1)
fi

if [ -z "$IP" ]; then
  echo "No local IP found. Make sure you're connected to Wi-Fi, then re-run this script."
  exit 1
fi

echo ""
echo "=================================================="
echo " Starting dev server for mobile testing"
echo "=================================================="
echo ""
echo " On your PHONE (same Wi-Fi network as this Mac):"
echo ""
echo "   http://$IP:5173"
echo ""
echo " Type that into Safari/Chrome on your phone."
echo " Leave this terminal window open while testing."
echo " Press Ctrl+C here to stop the server when done."
echo ""
echo "=================================================="
echo ""

npm run dev -- --host
