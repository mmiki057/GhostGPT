#!/bin/bash

echo "Stopping Phantom..."

# Останавливаем backend по сохраненному PID
if [ -f "/tmp/phantom-backend.pid" ]; then
    BACKEND_PID=$(cat /tmp/phantom-backend.pid)
    if ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo "Stopping backend (PID: $BACKEND_PID)..."
        kill $BACKEND_PID
        rm /tmp/phantom-backend.pid
    else
        echo "Backend already stopped"
        rm /tmp/phantom-backend.pid
    fi
else
    # Если PID файла нет, пытаемся остановить по порту
    if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null ; then
        echo "Stopping backend on port 5001..."
        kill -9 $(lsof -t -i:5001) 2>/dev/null
    fi
fi

# Закрываем приложение
echo "Closing Phantom application..."
pkill -f "Phantom.app" 2>/dev/null

echo "Phantom stopped"
