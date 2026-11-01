/**
 * Russian/English copy for the admin dashboard. Russian stays the canonical
 * source text: every key below is the exact Russian string used in the
 * templates, so the Russian page renders byte-for-byte as before.
 */
export type AdminLanguage = 'ru' | 'en';

export const ADMIN_LANGUAGE_COOKIE = 'admin_lang';

const RUSSIAN_LANGUAGE_TAGS = new Set(['ru', 'uk', 'be', 'kk']);

/**
 * English copy keyed by the Russian original. A "context|text" key
 * disambiguates the same Russian word used with different meanings, and
 * "form1|form2|form5" keys hold Russian plural forms ("one|many" in English).
 */
const ADMIN_EN: Record<string, string> = {
  // Shell, navigation and sign-in
  'История чатов · админка': 'Chat History · dashboard',
  'И': 'H',
  'История чатов': 'Chat History',
  'Чат': 'Chat',
  'Загрузка чатов...': 'Loading chats...',
  'Разделы': 'Sections',
  'Обзор': 'Overview',
  'Люди': 'People',
  'Голос': 'Voice',
  'Мат': 'Profanity',
  'УК РФ': 'Criminal Code',
  'Настройки чата': 'Chat settings',
  'Настройки': 'Settings',
  'Все чаты': 'All chats',
  'Модули': 'Modules',
  'Уведомления': 'Notifications',
  'Модели': 'Models',
  'Настройки всего экземпляра бота, доступные владельцу': 'Instance-wide bot settings available to the owner',
  'Настройки бота': 'Bot settings',
  'Тема': 'Theme',
  'Тема оформления': 'Color theme',
  'Система': 'System',
  'theme|День': 'Light',
  'theme|Ночь': 'Dark',
  'Язык': 'Language',
  'Язык интерфейса': 'Interface language',
  'Выйти': 'Sign out',
  'Вход через Telegram': 'Sign in with Telegram',
  'После входа будут показаны только чаты, где ваш Telegram-пользователь состоит участником.':
    'After signing in you will only see chats your Telegram account is a member of.',
  'Войти через Telegram': 'Sign in with Telegram',
  'Не авторизован': 'Not signed in',
  'Подготовка входа через Telegram...': 'Preparing Telegram sign-in...',
  'Не удалось инициализировать Telegram Login. Обновите страницу.':
    'Could not initialize Telegram Login. Please reload the page.',
  'Не удалось загрузить Telegram Login. Попробуйте обновить страницу.':
    'Could not load Telegram Login. Try reloading the page.',
  'Вход не завершён. Можно попробовать ещё раз.': 'Sign-in was not completed. You can try again.',
  'Не удалось обновить вход. Перезагрузите страницу.': 'Could not refresh sign-in. Please reload the page.',
  'Проверяем вход...': 'Verifying sign-in...',
  'Не удалось подтвердить вход. Попробуйте ещё раз.': 'Could not verify sign-in. Please try again.',
  'Telegram Login недоступен. Проверьте настройку бота и обновите страницу.':
    'Telegram Login is unavailable. Check the bot configuration and reload the page.',
  'Вошли как ': 'Signed in as ',

  // Period controls and stats errors
  'Период': 'Period',
  'Сегодня · live': 'Today · live',
  'Сегодня': 'Today',
  'Неделя · 7 дней, включая сегодня': 'Week · 7 days including today',
  '7 дней': '7 days',
  'Месяц · 30 дней, включая сегодня': 'Month · 30 days including today',
  '30 дней': '30 days',
  'Период…': 'Custom…',
  'С': 'From',
  'по': 'to',
  'Показать': 'Show',
  'Показать неделю, включая сегодня': 'Show the week including today',
  'Повторить': 'Retry',
  'Выберите даты начала и конца периода': 'Choose the start and end dates',
  'Дата начала должна быть раньше или равна дате конца': 'The start date must be on or before the end date',
  'Анализ текущего дня не завершён': 'Today’s analysis is not finished',
  'Анализ сообщений за текущий день (UTC) пока не завершился. ':
    'Message analysis for the current day (UTC) has not finished yet. ',
  'Данные появятся после завершения анализа.': 'Data will appear once the analysis is complete.',
  'Данные за сегодня пока недоступны': 'Today’s data is not available yet',
  'Прогресс обработки текущего дня (UTC) пока неизвестен. Попробуйте позже.':
    'Processing progress for the current day (UTC) is unknown. Please try again later.',
  'Данные пока не готовы': 'Data is not ready yet',
  'Статистика за выбранный период пока не готова. Попробуйте позже.':
    'Statistics for the selected period are not ready yet. Please try again later.',
  'Сервис временно недоступен': 'Service temporarily unavailable',
  'Статистика временно недоступна. Попробуйте позже.':
    'Statistics are temporarily unavailable. Please try again later.',
  'Не удалось загрузить статистику': 'Could not load statistics',
  'Произошла ошибка при загрузке статистики. Попробуйте ещё раз.':
    'Something went wrong while loading statistics. Please try again.',
  'Статистика за период с ': 'Statistics for ',
  ' по ': ' – ',
  ' пока не готова. Попробуйте позже.': ' are not ready yet. Please try again later.',
  'включая сегодня · live': 'including today · live',
  'анализ продолжается (': 'analysis in progress (',
  'Статистика загружена · ': 'Statistics loaded · ',
  'Обновлено · период ': 'Updated · period ',
  '. Настройки уведомлений временно недоступны.': '. Notification settings are temporarily unavailable.',
  'Загрузка...': 'Loading...',
  'Не удалось загрузить список чатов. Попробуйте обновить страницу.':
    'Could not load the chat list. Try reloading the page.',
  'Чаты появятся после новых сообщений или после обнаружения старых счетчиков.':
    'Chats will appear after new messages arrive or older counters are discovered.',
  'Настройки чата временно недоступны.': 'Chat settings are temporarily unavailable.',

  // Overview
  'Сообщения по дням': 'Messages per day',
  'Нет данных': 'No data',
  'нет данных': 'no data',
  'Когда пишут': 'When people write',
  'Зона': 'Zone',
  'Средняя активность по часам': 'Average activity by hour',
  'Средняя активность по часам, ': 'Average activity by hour, ',
  ' · пик в ': ' · peak at ',
  'Лидеры': 'Leaders',
  'Метрика': 'Metric',
  'Сообщения': 'Messages',
  'Слова': 'Words',
  'Голосовые, мин': 'Voice, min',
  'Кружочки, мин': 'Video notes, min',
  'Все участники и ритм по дням →': 'All members and daily rhythm →',
  'подробнее': 'details',
  'раньше не было': 'new this period',
  'без изменений': 'no change',
  'как в прошлом периоде': 'same as last period',
  '% к прошлому периоду': '% vs last period',
  ' слов · ': ' words · ',
  ' на сообщение': ' per message',
  'Активные участники': 'Active members',
  'в среднем ': 'avg ',
  ' в день': ' per day',
  ' мин': ' min',
  ' в день · ': ' per day · ',
  ' в час': ' per hour',
  'Голосовые': 'Voice messages',
  'Кружочки': 'Video notes',
  'Нарушений нет': 'No violations',
  ' нар.': ' viol.',
  ' всех слов': ' of all words',
  'Чисто': 'Clean',
  'Чаще всех: ': 'Top: ',
  ' слов': ' words',

  // People
  'Все участники': 'All members',
  'Нажмите на заголовок столбца, чтобы отсортировать': 'Click a column header to sort',
  'Сортировка': 'Sort',
  'Сортировка участников': 'Sort members',
  'Участники': 'Members',
  'Участник': 'Member',
  'Ритм участников': 'Member rhythm',
  'В каждом дне четыре клетки: ночь, утро, день, вечер. Время — UTC.':
    'Each day has four cells: night, morning, afternoon, evening. Times are UTC.',
  'Обозначения активности': 'Activity legend',
  'Нет активности': 'No activity',
  'Активен': 'Active',
  'Активно общается': 'Very talkative',
  'Слов/сообщ.': 'Words/msg',
  'Голос, мин': 'Voice, min',
  'Кружки, мин': 'Video, min',
  'Доля мата': 'Profanity rate',
  'Ритм по дням недели': 'Rhythm by weekday',
  'Ночь · 22–05': 'Night · 22–05',
  'Утро · 05–12': 'Morning · 05–12',
  'День · 12–17': 'Afternoon · 12–17',
  'Вечер · 17–22': 'Evening · 17–22',
  'Пн': 'Mon',
  'Вт': 'Tue',
  'Ср': 'Wed',
  'Чт': 'Thu',
  'Пт': 'Fri',
  'Сб': 'Sat',
  'Вс': 'Sun',
  'Нет данных об активности за выбранный период': 'No activity data for the selected period',
  'Нет данных об активности по времени суток за выбранный период':
    'No time-of-day activity data for the selected period',
  'Активность участников по дням и времени суток': 'Member activity by day and time of day',
  'Открыть карточку участника': 'Open member card',

  // Voice and video notes
  'Минуты по дням': 'Minutes per day',
  'голосовые': 'voice',
  'кружочки': 'video notes',
  'Минуты голосовых и кружочков по дням': 'Voice and video note minutes per day',
  'кто больше наговорил': 'who talked the most',
  'кто больше снял': 'who recorded the most',
  ' мин за период': ' min this period',
  'Средняя длина голосового': 'Average voice message',
  'самое длинное ': 'longest ',
  'самое длинное пока не известно': 'longest not known yet',
  'Средняя длина кружочка': 'Average video note',
  'самый длинный ': 'longest ',
  'самый длинный пока не известен': 'longest not known yet',
  'Минуты': 'Minutes',
  'Мин': 'Min',
  'Штук': 'Count',
  'Средн.': 'Avg',
  'Макс.': 'Max',

  // Profanity
  'Кто ругается': 'Who swears',
  'Доля': 'Rate',
  'Количество': 'Count',
  'Мат по участникам': 'Profanity by member',
  'Доля считается для тех, кто написал хотя бы 100 слов за период.':
    'The rate is shown for members who wrote at least 100 words in the period.',
  'Популярные слова': 'Top words',
  'Матерных слов': 'Swear words',
  'Доля мата в чате': 'Chat profanity rate',
  'примерно каждое {n}-е слово': 'about 1 in {n} words',
  'Самое частое слово': 'Most frequent word',
  ' раз': ' times',
  ', чаще всех ': ', most often by ',
  'другие': 'others',

  // Criminal Code
  'Рейтинг': 'Ranking',
  'Выберите участника': 'Choose a member',
  'Закрыть': 'Close',
  'Уверенность модели — это confidence конкретного анализа, а не измеренная точность классификатора.':
    'Model confidence is the confidence of a single analysis, not the measured accuracy of the classifier.',
  'пожизненно': 'life',
  'год|года|лет': 'year|years',
  'Ст. ': 'Art. ',
  ' УК РФ': ' of the RF Criminal Code',
  'До': 'Before',
  'После': 'After',
  'Контекст переписки': 'Conversation context',
  'Исходный контекст недоступен. История сообщений хранится до 7 дней.':
    'The original context is unavailable. Message history is kept for up to 7 days.',
  'Контекст, который учла модель': 'Context the model considered',
  'Нарушения: ': 'Violations: ',
  'Детали нарушений за этот период не найдены.': 'No violation details found for this period.',
  'Серьёзность ': 'Severity ',
  'Уверенность модели ': 'Model confidence ',
  'Confidence анализа, а не измеренная точность классификатора':
    'Confidence of the analysis, not the measured accuracy of the classifier',
  'Сообщение-триггер': 'Trigger message',
  'Сохранённый фрагмент сообщения': 'Saved message excerpt',
  'Фрагмент, который выделила модель': 'Excerpt highlighted by the model',
  'Текст недоступен': 'Text unavailable',
  'Возможное наказание': 'Possible punishment',
  'Модель не указала наказание': 'The model did not specify a punishment',
  'Максимум лишения свободы по тексту наказания': 'Maximum prison term according to the punishment text',
  'Почему модель сочла это нарушением': 'Why the model considers this a violation',
  'Показаны последние 50 нарушений за выбранный период.': 'Showing the latest 50 violations for the selected period.',
  'Загрузка деталей...': 'Loading details...',
  'Не удалось загрузить детали нарушений. Попробуйте ещё раз.':
    'Could not load violation details. Please try again.',
  'нарушение|нарушения|нарушений': 'violation|violations',
  'человек|человека|человек': 'person|people',
  'Нарушений за период нет': 'No violations in this period',
  'Показать нарушения УК': 'Show Criminal Code violations',
  'Показать нарушения УК (': 'Show Criminal Code violations (',

  // Chats, modules and notifications
  'Чаты, где вы состоите. Цифры за последние 7 дней, включая сегодня.':
    'Chats you are a member of. Numbers cover the last 7 days including today.',
  'Что бот делает в этом чате.': 'What the bot does in this chat.',
  'Анализ мата': 'Profanity analysis',
  'Считать мат и любимые слова участников': 'Count profanity and members’ favorite words',
  'Искать в сообщениях «статьи» и считать сроки': 'Look for “criminal articles” in messages and tally sentences',
  'Ночная AI-сводка': 'Nightly AI summary',
  'Каждую ночь бот пишет в чат, что обсуждали за день': 'Every night the bot posts what the chat discussed that day',
  'Кто видит дашборд': 'Who can see the dashboard',
  'Участники без доступа не увидят этот чат в списке': 'Members without access will not see this chat in the list',
  'Только админы': 'Admins only',
  'Сохранить': 'Save',
  'Что бот сам присылает в этот чат.': 'What the bot posts to this chat on its own.',
  'Настройки еще не сохранялись': 'Settings have not been saved yet',
  'Настройки еще не сохранялись. Редактировать может только администратор чата.':
    'Settings have not been saved yet. Only a chat admin can edit them.',
  'неизвестный пользователь': 'unknown user',
  '. Редактировать может только администратор чата.': '. Only a chat admin can edit them.',
  'Последнее изменение: ': 'Last changed by ',
  'Есть несохранённые изменения': 'You have unsaved changes',
  'Уведомления в этом чате': 'Notifications in this chat',
  'Общий выключатель для всех сводок и отчётов': 'Master switch for all summaries and reports',
  'Голос и кружки': 'Voice and video notes',
  'Автоуведомления': 'Automatic notifications',
  'Модули чата': 'Chat modules',
  'Лаборатория моделей': 'Model lab',
  'Активность': 'Activity',
  'Дневная сводка': 'Daily summary',
  'Недельная сводка': 'Weekly summary',
  'Месячная сводка': 'Monthly summary',
  'Сводки': 'Summaries',
  'Отчёты': 'Reports',
  'Итоги дня': 'Recap of the day',
  'Итоги недели': 'Recap of the week',
  'Итоги месяца': 'Recap of the month',
  'Найденные «нарушения» и сроки': 'Detected “violations” and sentences',
  'Кто сколько ругался': 'Who swore how much',
  'Сводка активности участников': 'Member activity summary',
  'Другое': 'Other',
  'Нет доступных уведомлений': 'No notifications available',
  'не было': 'never',
  'сегодня': 'today',
  'вчера': 'yesterday',
  'день|дня|дней': 'day|days',
  ' назад': ' ago',
  'Выключено владельцем бота': 'Disabled by the bot owner',
  'Выключено владельцем бота для всех чатов': 'Disabled by the bot owner for all chats',
  'Чаты пока не найдены': 'No chats found yet',
  'админ': 'admin',
  'участник': 'member',
  'сообщение|сообщения|сообщений': 'message|messages',
  'активных': 'active',
  'последняя активность': 'last active',
  'Активность временно недоступна': 'Activity is temporarily unavailable',
  'мат': 'profanity',
  'сводка': 'summary',
  'дашборд только админам': 'dashboard for admins only',
  'Открыть': 'Open',
  'Сохранение...': 'Saving...',
  'Не удалось сохранить модули. Попробуйте ещё раз.': 'Could not save modules. Please try again.',
  'Сохранено': 'Saved',
  'Не удалось сохранить настройки. Попробуйте ещё раз.': 'Could not save settings. Please try again.',

  // Model lab
  'OpenAI и Qwen получают один и тот же вход. Совпадение не означает правильность.':
    'OpenAI and Qwen receive the same input. Agreement does not mean correctness.',
  'Окно': 'Window',
  '24 часа': '24 hours',
  '3 дня': '3 days',
  'Обновить': 'Refresh',
  'Сравнения': 'Comparisons',
  'Фильтр': 'Filter',
  'Только расхождения': 'Disagreements only',
  'Все': 'All',
  'words|нет': 'none',
  'Результат ещё не сохранён': 'Result not saved yet',
  'Ошибка: ': 'Error: ',
  'неизвестная ошибка': 'unknown error',
  'УК: ': 'Criminal: ',
  'анализ': 'analyze',
  'пропуск': 'skip',
  ' · уверенность ': ' · confidence ',
  'Мат: ': 'Profanity: ',
  'есть': 'yes',
  'нет': 'no',
  'Задержка: ': 'Latency: ',
  ' мс': ' ms',
  ': нет пары': ': no pair',
  'Полных пар': 'Complete pairs',
  'УК: анализировать или нет': 'Criminal: analyze or not',
  'УК: причина': 'Criminal: reason',
  'Мат: есть или нет': 'Profanity: present or not',
  'Мат: какие слова': 'Profanity: which words',
  'Задержка OpenAI / Qwen': 'OpenAI / Qwen latency',
  'Расхождений за выбранное окно нет.': 'No disagreements in the selected window.',
  'Shadow-данных за выбранное окно пока нет.': 'No shadow data for the selected window yet.',
  'решение': 'decision',
  'причина': 'reason',
  'слова': 'words',
  'Загрузка A/B результатов...': 'Loading A/B results...',
  'Не удалось загрузить A/B результаты.': 'Could not load A/B results.',

  // Member card
  'Сообщения участника по дням': 'Member messages per day',
  'Когда пишет': 'When they write',
  'доля сообщений, UTC': 'share of messages, UTC',
  'Любимые слова': 'Favorite words',
  'как в среднем по чату': 'same as the chat average',
  'в {n} раза больше {unit}': '{n}× more {unit}',
  'в {n} раза меньше {unit}': '{n}× less {unit}',
  '{rank}-е место из {total} по сообщениям': '#{rank} of {total} by messages',
  'в чате с ': 'in the chat since ',
  'последнее сообщение ': 'last message ',
  '% всех сообщений чата': '% of all chat messages',
  'Слов на сообщение': 'Words per message',
  'чем в среднем': 'than average',
  'Активных дней': 'Active days',
  ' из ': ' of ',
  ' мин голосовых · ': ' min of voice · ',
  ' мин кружков': ' min of video notes',
  'слово|слова|слов': 'word|words',
  ', слишком мало текста для доли': ', too little text for a rate',
  'чем по чату': 'than the chat',
  ' в активный день': ' per active day',
  'Нет сообщений за период': 'No messages in this period',
  '% сообщений участника, ': '% of member messages, ',
  '% по чату': '% chat-wide',
  'весь чат': 'whole chat',
  ' за период': ' this period',
  'Без мата за этот период': 'No profanity in this period',
  'Не удалось загрузить карточку участника. Попробуйте ещё раз.': 'Could not load the member card. Please try again.',

  // Bot setup page (/admin/setup)
  'Настройка Telegram History Bot': 'Telegram History Bot setup',
  '← Админка': '← Dashboard',
  'Настройка бота': 'Bot setup',
  'Доступ владельца': 'Owner access',
  'Войди в': 'Sign in to the',
  'админку через Telegram': 'dashboard with Telegram',
  '. Если аккаунт уже привязан к боту, настройки откроются автоматически.':
    '. If your account is already linked to the bot, settings will open automatically.',
  'Для первой привязки этого Telegram-аккаунта к боту один раз подтверди владение BotFather-токеном. Повторно вводить его не придётся.':
    'To link this Telegram account to the bot for the first time, confirm ownership with the BotFather token once. You will not need to enter it again.',
  'Привязать Telegram-аккаунт': 'Link Telegram account',
  'Первоначальная самостоятельная установка без Telegram Login': 'Initial self-hosted setup without Telegram Login',
  'Можно войти по BotFather-токену. Он не хранится в браузере или D1; сессия действует два часа.':
    'You can sign in with the BotFather token. It is not stored in the browser or D1; the session lasts two hours.',
  'Войти': 'Sign in',
  '1. Как хранить сообщения?': '1. How should messages be stored?',
  'Выбери, какие данные бот может сохранять. Решение можно изменить позже.':
    'Choose what data the bot may store. You can change this later.',
  'Только статистика': 'Statistics only',
  '— исходные сообщения не записываются в KV/DO-хранилище истории. Бот считает сообщения, слова и активность участников.':
    '— original messages are not written to the KV/DO history storage. The bot counts messages, words and member activity.',
  'История сообщений + статистика': 'Message history + statistics',
  '— исходные сообщения временно хранятся в твоих Cloudflare KV/DO; доступны сводки и контекстный анализ.':
    '— original messages are kept temporarily in your Cloudflare KV/DO; summaries and context analysis are available.',
  'В обоих вариантах хранятся счётчики, ID пользователей и метаданные чатов. Смена режима не удаляет уже сохранённую историю; она истекает по сроку хранения. Telegram, Cloudflare и возможные логи платформы остаются отдельными от истории бота.':
    'Both modes store counters, user IDs and chat metadata. Switching modes does not delete history that is already stored; it expires with the retention period. Telegram, Cloudflare and any platform logs remain separate from the bot history.',
  '2. Включить функции': '2. Enable features',
  'Статистика активности и топы участников': 'Activity statistics and member leaderboards',
  'Анализ мата при получении сообщений': 'Profanity analysis on incoming messages',
  'Для анализа мата текст может отправляться AI-провайдеру, даже в режиме без хранения. Провайдер определяется PROFANITY_PROVIDER, а без него — провайдером сводок. Результаты анализа (например, найденные слова) могут храниться отдельно.':
    'For profanity analysis, text may be sent to an AI provider even without history storage. The provider is set by PROFANITY_PROVIDER, otherwise the summary provider is used. Analysis results (such as detected words) may be stored separately.',
  'Контекстный анализ уголовных нарушений (требует истории)': 'Context analysis of criminal violations (requires history)',
  'AI-сводки (требуют истории)': 'AI summaries (require history)',
  'AI-провайдер для сводок': 'AI provider for summaries',
  'Модель': 'Model',
  'OpenAI/OpenRouter API-ключи добавляй как Cloudflare Secrets, не через эту страницу.':
    'Add OpenAI/OpenRouter API keys as Cloudflare Secrets, not through this page.',
  'Сохранить настройки': 'Save settings',
  'Подключай бот только после того, как сохранишь выбранный режим хранения.':
    'Connect the bot only after you have saved the storage mode.',
  'Подключить webhook': 'Connect webhook',
  'Статус': 'Status',
  'Выйти из настройки': 'Sign out of setup',
  'Сырой текст будет сохраняться на выбранный срок. Внешние AI-провайдеры получают данные только при включении соответствующих функций.':
    'Raw text will be stored for the selected period. External AI providers receive data only when the related features are enabled.',
  'Без истории AI-сводки, контекстный уголовный анализ и backfill недоступны.':
    'Without history, AI summaries, criminal context analysis and backfill are unavailable.',
  ' Подключён': ' Connected',
  ' Не подключён': ' Not connected',
  'Сначала выбери режим хранения и нажми «Сохранить настройки».':
    'First choose a storage mode and click “Save settings”.',
  'D1 не инициализирована. Проверь, что команда npm run deploy завершила все миграции.':
    'D1 is not initialized. Check that npm run deploy applied all migrations.',
  'Ты вошёл через Telegram. Подтверди владение ботом один раз.':
    'You are signed in with Telegram. Confirm bot ownership once.',
  'Этот Telegram-аккаунт не назначен владельцем бота.': 'This Telegram account is not the bot owner.',
  'Сначала войди в админку через Telegram.': 'Sign in to the dashboard with Telegram first.',
  'Выбери режим хранения сообщений.': 'Choose a message storage mode.',

  'Это настройки провайдера только для AI-сводок. Мат и уголовный анализ могут использовать другие модели.':
    'These provider settings apply to AI summaries only. Profanity and criminal analysis may use other models.',
  'Текущая конфигурация (только чтение)': 'Current configuration (read-only)',
  'Это информационный обзор. Настройки провайдеров мата, уголовного анализа и их дополнительных этапов по-прежнему задаются переменными Cloudflare.':
    'This is an overview only. Providers for profanity, criminal analysis and their extra stages are still set by Cloudflare variables.',
  'Сохранить изменения': 'Save changes',
  'Есть несохранённые изменения. Сохранение создаст переопределение в D1, которое будет иметь приоритет над переменными Cloudflare.':
    'You have unsaved changes. Saving creates a D1 override that takes precedence over Cloudflare variables.',
  'Нет несохранённых изменений.': 'No unsaved changes.',
  'Настройки функций переопределены в D1. Изменения Cloudflare могут не влиять на эти переключатели.':
    'Feature settings are overridden in D1. Cloudflare changes may not affect these toggles.',
  'Настройки функций получены из текущих переменных Cloudflare. В D1 нет глобального переопределения.':
    'Feature settings come from the current Cloudflare variables. There is no global override in D1.',
  'Не удалось достоверно определить источник настроек. Не сохраняй изменения, пока D1 недоступна.':
    'Could not reliably determine where settings come from. Do not save changes while D1 is unavailable.',
  'по настройкам провайдера': 'provider default',
  'выключен': 'off',
  'включён': 'on',
  'включены': 'on',
  'выключены': 'off',
  'AI-сводки: ': 'AI summaries: ',
  '; провайдер: ': '; provider: ',
  '; модель: ': '; model: ',
  'Анализ мата: ': 'Profanity analysis: ',
  'включён, считается внутри уголовного prefilter (локальный словарь и подсказки prefilter), отдельных AI-запросов нет':
    'on, counted inside the criminal prefilter (local dictionary and prefilter hints), no separate AI requests',
  'включён, отдельный AI-запрос на сообщение; провайдер: ': 'on, a separate AI request per message; provider: ',
  'Уголовный анализ: ': 'Criminal analysis: ',
  '; основной провайдер: ': '; main provider: ',
  'embedding-модель: ': 'embedding model: ',
  'модель: ': 'model: ',
  'D1 недоступна. Настройки не сохранены.': 'D1 is unavailable. Settings were not saved.',
  'Сохранить изменения глобальных настроек? Это запишет их в D1 и переопределит текущие переменные Cloudflare для функций бота.':
    'Save changes to global settings? They will be written to D1 and override the current Cloudflare variables for bot features.',

  // Time-of-day labels sent by the stats API
  'Утро': 'Morning',
  'День': 'Afternoon',
  'Вечер': 'Evening',
  'Ночь': 'Night',
};

/** Bucket labels that the stats API returns in Russian. */
const SERVER_LABEL_KEYS = ['Утро', 'День', 'Вечер', 'Ночь'];

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function quoteJs(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('<', '\\u003c')}'`;
}

/** Looks up English copy; Russian (and any missing key) falls back to the source text. */
export function translateAdmin(language: AdminLanguage, text: string, context?: string): string {
  if (language === 'ru') return text;
  return (context ? ADMIN_EN[`${context}|${text}`] : undefined) ?? ADMIN_EN[text] ?? text;
}

/**
 * Template helpers: `h` for HTML text/attributes, `js` for a quoted
 * single-quoted JS literal, and `forms` for a Russian-style plural array.
 */
export function createAdminTranslator(language: AdminLanguage) {
  const t = (text: string, context?: string) => translateAdmin(language, text, context);
  return {
    t,
    h: (text: string, context?: string) => escapeHtml(t(text, context)),
    js: (text: string, context?: string) => quoteJs(t(text, context)),
    forms: (key: string) => {
      const [one, few, many = few] = t(key).split('|');
      return `[${[one, few, many].map(quoteJs).join(', ')}]`;
    },
  };
}

/** Client-side constants and helpers injected into the dashboard script. */
export function adminClientI18n(language: AdminLanguage): string {
  const serverLabels = language === 'ru'
    ? {}
    : Object.fromEntries(SERVER_LABEL_KEYS.map((key) => [key, translateAdmin(language, key)]));
  const memberLabel = quoteJs(translateAdmin(language, 'Участник'));
  return `const LANGUAGE = ${quoteJs(language)};
    const LOCALE = ${quoteJs(language === 'ru' ? 'ru-RU' : 'en-US')};
    const SERVER_LABELS = ${JSON.stringify(serverLabels).replaceAll('<', '\\u003c')};
    function serverLabel(label) {
      if (typeof label !== 'string' || LANGUAGE === 'ru') return label;
      if (SERVER_LABELS[label]) return SERVER_LABELS[label];
      const numbered = /^Участник (\\d+)$/.exec(label);
      return numbered ? ${memberLabel} + ' ' + numbered[1] : label;
    }
    function fmt(template, values) {
      return template.replace(/\\{(\\w+)\\}/g, (_match, key) => String(values[key]));
    }
    function setLanguage(language) {
      if (language !== 'ru' && language !== 'en') return;
      document.cookie = '${ADMIN_LANGUAGE_COOKIE}=' + language + '; Path=/admin; Max-Age=31536000; SameSite=Lax';
      window.location.reload();
    }`;
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

/**
 * Picks the dashboard language: an explicit choice stored in a cookie wins,
 * then the browser's Accept-Language. Without any hint we keep Russian.
 */
export function resolveAdminLanguage(req: Request): AdminLanguage {
  const stored = readCookie(req.headers.get('Cookie'), ADMIN_LANGUAGE_COOKIE);
  if (stored === 'ru' || stored === 'en') return stored;

  const header = req.headers.get('Accept-Language');
  if (!header?.trim()) return 'ru';
  const preferences = header
    .split(',')
    .map((entry, index) => {
      const [tag, ...params] = entry.trim().toLowerCase().split(';');
      const quality = params.find((param) => param.trim().startsWith('q='));
      const q = quality ? Number(quality.trim().slice(2)) : 1;
      return { primary: tag.split('-')[0], q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.primary && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { primary } of preferences) {
    if (RUSSIAN_LANGUAGE_TAGS.has(primary)) return 'ru';
    if (primary === 'en') return 'en';
  }
  return 'en';
}
