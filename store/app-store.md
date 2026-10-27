# App Store — тексты и ответы для App Store Connect

Bundle ID: `app.twomind.mindmap` · SKU: `supermind` · Основной язык: **русский**
Категория: **Продуктивность**, дополнительная — **Бизнес** · Цена: **бесплатно** · Устройства: iPhone и iPad

Ссылки (supermind.kz и jarvissoft.kz — на GitHub Pages, домены ТОО на hoster.kz):
- Политика конфиденциальности (Privacy Policy URL): https://supermind.kz/privacy.html
- Поддержка (Support URL): https://supermind.kz/support.html
- Маркетинговый сайт: https://supermind.kz
- Сайт компании (для регистрации ТОО в Apple Developer): https://jarvissoft.kz

> Правило Apple 2.3.10: в текстах и на скриншотах для App Store не упоминайте Android, APK и Google Play. Тексты ниже уже без этого.

---

## Страница в магазине (русский)

**Название** (до 30):
```
SuperMind: карты и задачи
```

**Подзаголовок** (до 30):
```
Заметки, привычки и финансы
```

**Рекламный текст** (до 170, можно менять без проверки):
```
Интеллект-карты, задачи, заметки, ежедневник и финансы — в одном приложении, офлайн и без рекламы. Данные хранятся на вашем устройстве.
```

**Ключевые слова** (до 100, через запятую без пробелов, слова из названия не повторять):
```
интеллект-карта,mind map,xmind,планер,ежедневник,заметки,календарь,привычки,помодоро,бюджет
```

**Описание** (до 4000):
```
SuperMind — интеллект-карты, задачи, заметки и личный планер в одном приложении. Работает без интернета, без рекламы и без подписок.

ИНТЕЛЛЕКТ-КАРТЫ
• 8 структур: интеллект-карта, логическая схема, орг-структура, дерево, таймлайн, «рыбья кость», скобки
• Темы оформления, цвета ветвей, связи, границы, итоги, маркеры, картинки и заметки в темах
• Режимы «Структура» и «Гант», презентация, защита карты паролем
• Импорт Xmind, Markdown, OPML; экспорт в PNG, PDF, Word, Excel, PowerPoint, Xmind

ЗАДАЧИ И КАЛЕНДАРЬ
• Умный ввод: «позвонить маме завтра в 18:30 каждый понедельник» — дата, время и повтор распознаются сами
• Списки, теги, приоритеты, подзадачи, повторы любой сложности
• Напоминания с кнопками «Выполнено» и «Отложить»
• Канбан, матрица Эйзенхауэра, календарь на месяц, неделю и день, экспорт в Календарь
• Помодоро и секундомер, статистика фокуса

ЗАМЕТКИ — ВТОРОЙ МОЗГ
• Связи между заметками и граф, ежедневная заметка, шаблоны
• Карточки для повторения, вопрос дня, статьи по ссылке
• Диктовка голосом

ЕЖЕДНЕВНИК, ПРИВЫЧКИ, ЦЕЛИ
• Трекер привычек со стриками, настроение, дневник, цели с шагами

ЛИЧНЫЕ ФИНАНСЫ
• Счета, траты и доходы, бюджеты, долги, подписки, аналитика, курсы валют

ИИ-ПОМОЩНИК (ПО ЖЕЛАНИЮ)
• Карта по идее, разбивка задачи на шаги, ответы по вашим заметкам, голосовые команды
• Бесплатный встроенный ИИ или свой ключ Claude. Перед первой отправкой данных приложение спросит разрешение

ВАШИ ДАННЫЕ — ВАШИ
• Всё хранится на устройстве и доступно без интернета
• Синхронизация между iPhone, iPad, компьютером и браузером — по желанию, через аккаунт
• Блокировка приложения кодом
• Никакой рекламы и трекеров
```

**Английская локализация** (по желанию): название `SuperMind: Mind Maps & Tasks`, подзаголовок `Notes, habits and finance`.

**Скриншоты** (папка `store/appstore/`):
- iPhone 6,9" — 1320×2868: `iphone-*.png` (обязательно, от 1 до 10)
- iPad 13" — 2064×2752: `ipad-*.png` (обязательно, раз приложение работает на iPad)

---

## Конфиденциальность приложения (App Privacy → «этикетки»)

Do you or your third-party partners collect data from this app? — **Yes**

| Категория → тип | Связано с пользователем | Для отслеживания | Цель |
|---|---|---|---|
| Contact Info → Email Address | да | нет | App Functionality |
| Contact Info → Name | да | нет | App Functionality |
| User Content → Other User Content (карты, задачи, заметки, дневник) | да | нет | App Functionality |
| User Content → Photos or Videos (картинки в картах и заметках) | да | нет | App Functionality |
| User Content → Customer Support | да | нет | App Functionality |
| Financial Info → Other Financial Info (записи о тратах при синхронизации) | да | нет | App Functionality |
| Diagnostics → Crash Data | **нет** | нет | App Functionality |

Tracking — **No**. На iPhone аккаунт не обязателен («Продолжить без аккаунта» на первом экране): без него собираются только анонимные отчёты об ошибках, и их можно выключить.
Файл `ios/App/App/PrivacyInfo.xcprivacy` в сборке говорит то же самое.

## Возрастной рейтинг

На все вопросы о насилии, сексуальном контенте, нецензурной лексике, азартных играх, алкоголе и наркотиках, медицинской информации — **None / No**.
- Unrestricted Web Access — **No** (статья по ссылке сохраняет только текст страницы, браузера в приложении нет)
- User-Generated Content / общение пользователей — **No**
- Если анкета спросит про ИИ-ассистента или чат-бот — **Yes**: ответы генерирует ИИ, пользователь может пожаловаться кнопкой «Пожаловаться» рядом с ответом (жалоба уходит в Поддержку)

Ожидаемый рейтинг: 4+ (или 9+/13+, если анкета поднимет его из-за ИИ — это нормально).

## Шифрование (Export Compliance)

В Info.plist уже стоит `ITSAppUsesNonExemptEncryption = NO`: приложение использует только HTTPS и шифрование системы (WebCrypto для карт с паролем). Документы загружать не нужно.

## Заметки для проверки (App Review Information → Notes)

```
SuperMind works fully offline without an account: tap "Продолжить без аккаунта" (Continue without an account) on the first screen. Mind maps, tasks, notes, journal, habits and finance are then stored on the device only.
An account is optional and only used to sync between the user's devices (Settings → Sync).
The built-in AI assistant (Assistant tab, ✨ button in a map) requires signing in; demo account below. Before the first AI request the app asks the user's permission to send data to the AI provider (Google Gemini / Groq, or Anthropic with the user's own Claude key). This can be changed in Settings → Artificial Intelligence.
Account deletion: Settings → Sync → Delete account.
Microphone and speech recognition are used only for dictation and voice commands.
```

Sign-in required: можно ответить **No** (есть «Продолжить без аккаунта»), но всё равно впишите демо-аккаунт (email и пароль) — им проверят синхронизацию и ИИ. Создайте отдельный аккаунт и впишите сюда.
Контакт для проверки: ваше имя, телефон, email.
