# VideoPilot

Локальный видеоредактор для macOS на Electron + React + TypeScript. Всё
считается на вашем компьютере: видео никуда не загружается.

![macOS](https://img.shields.io/badge/macOS-Intel%20%2B%20Apple%20Silicon-000000?logo=apple&logoColor=white)
![Electron 32](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Статус](https://img.shields.io/badge/статус-ранняя%20разработка-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

> **Статус: ранняя разработка.** Готовы библиотека проектов, импорт файлов и
> превью. Таймлайн, звук, субтитры, TTS, цветокоррекция и экспорт — впереди
> (см. [дорожную карту](#дорожная-карта)).

## Что уже есть

- **Экран проектов** — галерея: создать, открыть, переименовать, дублировать, удалить.
- **Автосохранение** проекта (с дебаунсом), ручное `⌘S` и сохранение при выходе.
- **Импорт видео** в медиа-бин, метаданные и миниатюры через ffmpeg / ffprobe.
- **Превью** в плеере.
- **Пропавшие файлы** помечаются в бине и перепривязываются через диалог.

## Стек

- **Electron 32** + **electron-vite** — main / preload / renderer
- **React 18** + **TypeScript** + **Tailwind CSS** + **Zustand**
- **ffmpeg / ffprobe** через npm-пакеты (`ffmpeg-static`, `ffprobe-static`)
- **sherpa-onnx-node** — распознавание речи (модель Parakeet) — запланировано
- **Piper** — синтез речи — запланировано

## Быстрый старт

Нужны macOS и Node.js 18 или новее.

```bash
git clone https://github.com/garik-sukhanov/VideoPilot.git
cd VideoPilot
npm install
npm run dev
```

`npm run dev` поднимает Vite для renderer (`http://localhost:5173`), собирает
`electron/` в `out/` и запускает Electron с DevTools. Renderer обновляется по
HMR, main и preload перезапускаются сами. Если не подхватилось — `⌘R` в окне
приложения.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | Dev + HMR + DevTools |
| `npm run build` | Бандлы в `out/` |
| `npx electron .` | Прогон production-бандла без упаковки (smoke-test) |
| `npm run dist` | Universal `.app` + `.dmg` (Intel + Apple Silicon) |
| `npm run dist:arm64` | Только Apple Silicon (быстрее) |
| `npm run dist:x64` | Только Intel |
| `npm run prepare:ffmpeg` | Готовит universal ffmpeg + ffprobe в `build/vendor/` (`--force` — пересобрать) |
| `npm run prepare:icon` | Перегенерирует `build/icon.icns` |
| `npm run typecheck` | TS-проверка node + web |

## Сборка `.app` / `.dmg`

```bash
npm run dist
open dist/mac-universal/VideoPilot.app
```

Что происходит:

1. `prepare:ffmpeg` скачивает обе macOS-версии ffmpeg (arm64 + x64) того же
   релиза, что и `ffmpeg-static`, и склеивает их через `lipo` в один universal
   бинарь в `build/vendor/ffmpeg/`. Повторно не качает.
2. electron-vite собирает `out/`.
3. electron-builder собирает universal `dist/mac-universal/VideoPilot.app`
   и `dist/VideoPilot-0.1.0-universal.dmg` (около 230 МБ).

Первая сборка качает Electron для обеих архитектур — займёт пару минут.
Если Intel не нужен, `npm run dist:arm64` быстрее и легче.

**Архитектуры.** `.app` и `ffmpeg` — universal, `ffprobe` — x86_64 (на Apple
Silicon работает через Rosetta). Нужный бинарь выбирается в рантайме по
`process.arch` (`electron/ipc/ffmpeg.ts`).

**Подпись.** Сборка пока **не подписана** (`mac.identity: null`), поэтому
macOS вешает карантин. Снять локально:

```bash
xattr -dr com.apple.quarantine dist/mac-universal/VideoPilot.app
```

или ПКМ по приложению → «Открыть» при первом запуске. Конфиг для подписи уже
готов (`hardenedRuntime`, `build/entitlements.mac.plist`): с Apple Developer ID
нужно убрать `"identity": null`, добавить нотаризацию (например,
`@electron/notarize` и `afterSign`-хук) и снова запустить `npm run dist`.

**Лицензии бинарников.** В собранное приложение попадает ffmpeg из
`ffmpeg-static` — его лицензия (GPL) распространяется на готовые сборки; при
раздаче `.dmg` учитывайте это.

## Проекты на диске

Проекты — управляемая библиотека в папке приложения:

```
~/Library/Application Support/videopilot/Projects/<id>/
├── project.json   # полный документ (versioned, schemaVersion)
└── meta.json      # лёгкая мета для списка (имя, даты, постер, счётчики)
```

Документ (`ProjectDocument` в `src/types.ts`) хранит имя, настройки экспорта,
импортированные файлы, дорожки и клипы (ядро таймлайна), цветокор, субтитры
и мелкое UI-состояние (зум, playhead). В нём есть `SCHEMA_VERSION` и точка
для миграций, чтобы формат пережил добавление субтитров и TTS.

Не сохраняются: волновые формы (пересоздаются из файлов), история undo/redo,
выделение, флаги модальных окон.

Слои: `electron/ipc/projects.ts` (CRUD на диске) ↔ `window.vp.projects.*`
(preload) ↔ `src/projectIO.ts` (автосейв, сборка и загрузка документа) +
`src/appStore.ts` (экран, текущий проект, dirty).

## Структура

```
VideoPilot/
├── electron/
│   ├── main.ts              # main-процесс, окно, IPC, диалоги
│   ├── preload.ts           # contextBridge → window.vp
│   └── ipc/                 # ffmpeg (probe, миниатюры), проекты
├── src/
│   ├── App.tsx              # layout: медиа-бин / превью / таймлайн
│   ├── store.ts             # Zustand
│   ├── types.ts
│   └── components/          # TitleBar, MediaBin, Preview, Timeline…
├── scripts/                 # подготовка ffmpeg и иконки
├── build/                   # иконка, entitlements
├── electron.vite.config.ts
└── tailwind.config.js
```

## Дорожная карта

| # | Этап | Статус |
|---|---|---|
| 0 | Проекты (библиотека, автосейв, экран) | ✅ |
| 1 | Фундамент (импорт + превью) | ✅ |
| 2 | Таймлайн (drag-and-drop + trim) | ⏳ |
| 3 | Аудио (музыка, микс громкостей) | — |
| 4 | Субтитры (Parakeet) | — |
| 5 | TTS (Piper) | — |
| 6 | Цветокор (WebGL) | — |
| 7 | Экспорт (ffmpeg `filter_complex`) | — |

## Лицензия

[MIT](LICENSE)
