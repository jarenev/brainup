# BrainrotUp — Апгрейдер брейнротов

Тестовый сайт в стиле [upgrader.vip](https://upgrader.vip) для игры **Steal a Brainrot**.

- **Депозит** — отправляешь брейнрот боту через трейд в игре
- **Апгрейд** — рискуешь предметом ради более редкого
- **Вывод** — бот отправляет трейд обратно в игру

## Быстрый старт (локально)

Открой `index.html` в браузере или запусти локальный сервер:

```bash
npx serve .
```

Войди под любым ником Roblox. В тестовом режиме всё работает через `localStorage` — кнопка **«Симулировать получение»** на странице депозита зачисляет предмет без бота.

## Деплой на GitHub Pages

### 1. Создай репозиторий на GitHub

```bash
git init
git add .
git commit -m "BrainrotUp test site"
git branch -M main
git remote add origin https://github.com/ТВОЙ_НИК/brainrotup.git
git push -u origin main
```

### 2. Включи GitHub Pages

1. Открой репозиторий на GitHub → **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main` → папка `/ (root)`
4. Сохрани — сайт будет на `https://ТВОЙ_НИК.github.io/brainrotup/`

### 3. Обновления

```bash
git add .
git commit -m "update"
git push
```

Сайт обновится через 1–2 минуты.

## Парсер брейнротов

Актуальный каталог (501 шт.) парсится с Fandom Wiki:

```bash
cd parser
node parse-brainrots.js
```

Подробнее: [parser/README.md](parser/README.md)

## Структура проекта

```
autoaccepter/
├── index.html          # Главная страница
├── css/style.css       # Стили
├── parser/
│   ├── parse-brainrots.js  # Парсер Fandom Wiki
│   ├── brainrots.json      # JSON-каталог (501 шт.)
│   └── README.md
├── js/
│   ├── brainrots.js    # Каталог (автогенерация из парсера)
│   ├── api.js          # API (депозит, апгрейд, админ)
│   ├── app.js          # Логика UI
│   ├── firebase-db.js  # Realtime Database (инвентарь, очередь)
│   └── firebase-config.example.js
├── docs/FIREBASE.md    # Инструкция подключения Firebase
├── bot/
│   ├── webhook-server.js   # Node.js сервер для бота
│   ├── trade_listener.lua  # In-game скрипт (шаблон)
│   ├── INSTRUCTION.md      # Подробная инструкция по боту
│   └── package.json
└── README.md
```

## Firebase (подкрутка + общая очередь)

1. Создай проект в [Firebase Console](https://console.firebase.google.com)
2. Включи **Realtime Database** (test mode) и скопируй `databaseURL`
3. Скопируй конфиг:
   ```bash
   copy js\firebase-config.example.js js\firebase-config.js
   ```
4. Вставь ключи из Firebase → Project Settings → Your apps → Web
5. Подробнее: **[docs/FIREBASE.md](docs/FIREBASE.md)**

**Админ** (`BrainrotUp!`) → вкладка **Админ** → раздел **Прокрутка**:
- Введи ник игрока → **Включить подкрутку**
- При апгрейде у игрока рулетка стартует с задержкой (~5 сек), админ выбирает **Заход** или **Незаход**

`firebase-config.js` в `.gitignore` — на GitHub Pages залей файл вручную или через Secrets.

## Бот

Бот **не работает на GitHub** — GitHub Pages отдаёт только статику. Бот запускается отдельно на твоём ПК или VPS.

Полная инструкция: **[bot/INSTRUCTION.md](bot/INSTRUCTION.md)**

Кратко:
1. Создай аккаунт Roblox для бота
2. Запусти `bot/webhook-server.js` (`npm install && npm start`)
3. Запусти `bot/trade_listener.lua` на аккаунте бота в игре
4. Настрой `webhookUrl` в `js/api.js` (отключи `demoMode`)

## Важно

- Инвентарь и история синхронизируются через Realtime Database (`users`); `localStorage` — локальный кэш
- Это **тестовая версия** — для продакшена ужесточи правила Realtime Database и добавь auth
- Использование ботов/executor'ов может нарушать ToS Roblox
- Не храни пароли и cookies бота в публичном репозитории