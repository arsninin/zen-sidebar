# Zen Sidebar

🌐 **Language / Язык:** [English](#english) | [Русский](#русский)

---

<a name="english"></a>
## 🇬🇧 English

An independent project trying to recreate the sleek sidebar interface of **Zen Browser** for Chromium-based browsers. It provides a minimalist custom side panel with Drag-and-Drop (DnD) support, drop recovery mechanisms, and built-in diagnostic logging.

### ✨ Features
* **Zen Browser Style:** Bringing the clean, modern sidebar experience over to Chromium.
* **Dedicated Side Panel:** Distraction-free interface built for quick access and smooth workflows.
* **Drag-and-Drop & Recovery:** Reorder and organize items effortlessly with built-in fallback/recovery handling for interrupted drops.
* **Built-in Diagnostics:** Integrated logging system with a dedicated UI viewer for debugging state and events.
* **Lightweight & Native:** Built with vanilla JavaScript, HTML, and CSS with zero external dependencies.

### 📂 Project Structure

| File | Size | Description |
| :--- | :--- | :--- |
| `manifest.json` | 813 B | Extension configuration, permissions, and side panel entry points. |
| `background.js` | 4.4 KB | Service worker handling background events and browser lifecycle hooks. |
| `sidepanel.html` | 1.7 KB | Core markup structure for the sidebar interface. |
| `sidepanel.css` | 7.6 KB | Styling, layout rules, and visual states for drag-and-drop interactions. |
| `sidepanel.js` | 29.0 KB | Main application logic, UI state management, and DnD recovery routines. |
| `log.js` | 6.4 KB | Core logging utility for capturing events, errors, and state transitions. |
| `logui.js` | 5.6 KB | UI component for rendering and inspecting logs directly inside the extension. |

### 🚀 Installation (Developer Mode)
1. Download or extract the extension archive into a local folder.
2. Open your Chromium-based browser and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the extracted project folder.

---

## Disclaimer

This project is mostly AI-generated code.

Built with AI assistance, primarily for personal use.
The code may be messy, inconsistent, overengineered, or
held together by duct tape and questionable decisions.

It works for me. That's good enough.

---

<a name="русский"></a>
## 🇷🇺 Русский

Попытка воссоздать интерфейс боковой панели из **Zen Browser** для браузеров на базе Chromium. Расширение добавляет минималистичную боковую панель (Side Panel) с поддержкой Drag-and-Drop (перетаскивания), защитой от сбоев при перетаскивании (drop recovery) и встроенной системой логирования.

### ✨ Основные возможности
* **В стиле Zen Browser:** Перенос концепции удобной и стильной боковой панели в экосистему Chromium.
* **Удобная боковая панель:** Лаконичный интерфейс для быстрой работы без лишнего визуального шума.
* **Drag-and-Drop с восстановлением:** Удобная сортировка и организация элементов с защитой от сбоев при прерывании перетаскивания.
* **Встроенная диагностика:** Система сбора логов с отдельным визуальным интерфейсом для отладки событий.
* **Лёгкость и автономность:** Написано на чистом JavaScript, HTML и CSS без сторонних библиотек и фреймворков.

### 📂 Структура проекта

| Файл | Описание |
| :--- | :--- |
| `manifest.json` | Конфигурация расширения, разрешения и точки входа для боковой панели. |
| `background.js` | Фоновый скрипт (Service Worker) для обработки событий браузера. |
| `sidepanel.html` | Базовая HTML-разметка интерфейса боковой панели. |
| `sidepanel.css` | Стили оформления и визуальные состояния элементов при перетаскивании. |
| `sidepanel.js` | Основная логика приложения, управление состоянием и механизмы DnD recovery. |
| `log.js` | Модуль логирования для записи событий, ошибок и изменений состояния. |
| `logui.js` | Графический интерфейс для просмотра и анализа логов прямо внутри расширения. |

### 🚀 Установка (Режим разработчика)
1. Скачайте и распакуйте архив с расширением в удобную папку.
2. Откройте браузер на базе Chromium и перейдите на страницу `chrome://extensions/`.
3. Включите **Режим разработчика** (Developer mode) в правом верхнем углу.
4. Нажмите **Загрузить распакованное расширение** (Load unpacked) и выберите папку с проектом.

---

## Отказ от ответственности (Disclaimer)

Этот проект в основном написан с помощью ИИ.

Создано при поддержке нейросетей, в первую очередь для личного использования.
Код может быть неаккуратным, непоследовательным, переусложнённым или 
держаться на «синей изоленте» и сомнительных архитектурных решениях.

У меня работает -- и этого достаточно.
