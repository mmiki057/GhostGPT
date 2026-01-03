# GhostGPT - Быстрый старт

## Для разработки

```bash
./run-ghostgpt.sh
```

## Сборка приложения

```bash
npm run tauri:build
```

Приложение будет находиться в: `src-tauri/target/release/bundle/macos/GhostGPT.app`

## Запуск собранного приложения

```bash
./start-production.sh
```

## Остановка приложения

```bash
./stop-production.sh
```

## Первый запуск

1. **Установите зависимости**:
```bash
npm install
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
```

2. **Настройте API ключ**:
```bash
echo "OPENAI_API_KEY=ваш-ключ" > .env
```

3. **Запустите в режиме разработки**:
```bash
./run-ghostgpt.sh
```

## Горячие клавиши

- **Cmd+Shift+Space** - показать/скрыть окно
- **Cmd+Enter** - начать/остановить запись голоса (toggle)
- **Enter** - отправить текстовое сообщение
- **Кнопка Stop** - остановить генерацию ответа

## Как работает голосовая запись

1. Первое нажатие **Cmd+Enter** → начинается запись (Recording...)
2. Говорите в микрофон
3. Второе нажатие **Cmd+Enter** → запись останавливается и отправляется

## Новые возможности

- Текст разделяется на абзацы
- Возможность остановить генерацию (кнопка Stop)
- Свободная прокрутка чата во время генерации
- Отображение скриншотов в чате
- Toggle режим записи голоса

Подробные инструкции смотрите в [README_RU.md](README_RU.md)
