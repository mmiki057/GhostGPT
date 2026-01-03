#!/bin/bash

echo "Starting GhostGPT with Tauri + Python Backend"
echo ""

# Check OPENAI_API_KEY
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY not set"
    echo "Set it with: export OPENAI_API_KEY='your-key'"
    exit 1
fi

# Start Python backend
echo "Starting Python backend on http://localhost:5001..."
source venv/bin/activate
python3 backend/server.py &
BACKEND_PID=$!

# Wait for backend
sleep 2

# Start Tauri app
echo "Starting Tauri window..."
npm run tauri:dev &
TAURI_PID=$!

echo ""
echo "GhostGPT is starting!"
echo "   Backend: http://localhost:5001"
echo "   Window: Tauri (invisible in recordings)"
echo ""
echo "   Hotkeys:"
echo "   - Cmd+Shift+Space: Show/Hide window"
echo "   - Cmd+Enter: Toggle voice recording"
echo "   - Enter: Send text message"
echo ""
echo "Press Ctrl+C to stop"

# Trap Ctrl+C
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID $TAURI_PID 2>/dev/null; exit 0" INT
wait
