#!/bin/bash

echo "Stopping GhostGPT..."

# Останавливаем backend по сохраненному PID
if [ -f "/tmp/ghostgpt-backend.pid" ]; then
    BACKEND_PID=$(cat /tmp/ghostgpt-backend.pid)
    if ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo "Stopping backend (PID: $BACKEND_PID)..."
        kill $BACKEND_PID
        rm /tmp/ghostgpt-backend.pid
    else
        echo "Backend already stopped"
        rm /tmp/ghostgpt-backend.pid
    fi
else
    # Если PID файла нет, пытаемся остановить по порту
    if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null ; then
        echo "Stopping backend on port 5001..."
        kill -9 $(lsof -t -i:5001) 2>/dev/null
    fi
fi

# Закрываем приложение
echo "Closing GhostGPT application..."
pkill -f "GhostGPT.app" 2>/dev/null

echo "GhostGPT stopped"
