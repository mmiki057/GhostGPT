#!/bin/bash

echo "Starting Phantom Production"
echo ""

# Определяем директорию скрипта
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Проверяем наличие .env файла
if [ ! -f ".env" ]; then
    echo "Error: File .env not found"
    echo "Create .env file with:"
    echo "OPENAI_API_KEY=your-openai-key"
    exit 1
fi

# Загружаем переменные окружения
export $(cat .env | grep -v '^#' | xargs)

# Проверяем наличие API ключа
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY not set in .env file"
    exit 1
fi

# Проверяем наличие виртуального окружения
if [ ! -d "venv" ]; then
    echo "Error: Virtual environment not found"
    echo "Create it with: python3 -m venv venv"
    echo "Install dependencies: pip install -r backend/requirements.txt"
    exit 1
fi

# Проверяем, не запущен ли уже backend
if lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null ; then
    echo "Port 5001 already in use. Stopping process..."
    kill -9 $(lsof -t -i:5001) 2>/dev/null
    sleep 1
fi

# Активируем виртуальное окружение и запускаем backend
echo "Starting Python backend on http://localhost:5001..."
source venv/bin/activate
python3 backend/server.py > /tmp/phantom-backend.log 2>&1 &
BACKEND_PID=$!

# Сохраняем PID для последующей остановки
echo $BACKEND_PID > /tmp/phantom-backend.pid

# Ждем запуска backend
sleep 3

# Проверяем, что backend запустился
if ! lsof -Pi :5001 -sTCP:LISTEN -t >/dev/null ; then
    echo "Error: Backend did not start"
    echo "Check logs: cat /tmp/phantom-backend.log"
    exit 1
fi

echo "Backend started (PID: $BACKEND_PID)"

# Проверяем наличие собранного приложения
APP_PATH="src-tauri/target/release/bundle/macos/Phantom.app"
if [ ! -d "$APP_PATH" ]; then
    echo "Error: Application not found at $APP_PATH"
    echo "Build first: npm run tauri:build"
    kill $BACKEND_PID
    exit 1
fi

# Запускаем приложение
echo "Starting Phantom..."
open "$APP_PATH"

echo ""
echo "Phantom started!"
echo ""
echo "   Backend: http://localhost:5001 (PID: $BACKEND_PID)"
echo "   Backend logs: /tmp/phantom-backend.log"
echo ""
echo "   Hotkeys:"
echo "   - Cmd+Shift+Space: Show/Hide window"
echo "   - Cmd+Enter: Toggle voice recording"
echo "   - Enter: Send text message"
echo ""
echo "To stop backend:"
echo "   kill $BACKEND_PID"
echo "   or use: ./stop-production.sh"
echo ""
