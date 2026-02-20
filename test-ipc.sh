#!/bin/bash

# Start the dev server in background
pnpm dev:cdp 2>&1 &
PID=$!

# Wait for the server to start and capture output
sleep 10

# Kill the server
kill $PID 2>/dev/null

# Wait for it to die
wait $PID 2>/dev/null

echo "Server stopped"
