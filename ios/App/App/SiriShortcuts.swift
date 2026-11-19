import AppIntents
import Foundation

// Siri и «Быстрые команды»: добавить задачу или заметку, начать фокус, открыть «Сегодня», «что у меня сегодня».
// Добавление работает без открытия приложения: действие ложится в очередь виджетов (App Group) и выполняется,
// когда приложение откроется (или сразу, если оно уже открыто — событие 'pending'). «Что сегодня» читает данные,
// которые приложение отдаёт виджетам (widget-json), — WebView для ответа не нужен.
// Фразы — в AppShortcuts.strings (en/ru), названия — в Localizable.strings.

private func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

private func say(_ s: String) -> IntentDialog { IntentDialog(stringLiteral: s) }

struct SmAddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Task"
    static var description = IntentDescription("Adds a task to SuperMind.")

    @Parameter(title: "Task", requestValueDialog: IntentDialog("What's the task?"))
    var text: String

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let title = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw $text.needsValueError() }
        SmPending.push(["type": "add_task", "title": String(title.prefix(500)), "at": nowMs()])
        return .result(dialog: say(SmPending.tr("Добавил задачу «\(title)»", "Added the task “\(title)”", "«\(title)» тапсырмасы қосылды")))
    }
}

struct SmAddNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Note"
    static var description = IntentDescription("Saves a note to SuperMind.")

    @Parameter(title: "Note", requestValueDialog: IntentDialog("What should I write down?"))
    var text: String

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { throw $text.needsValueError() }
        SmPending.push(["type": "add_note", "text": String(body.prefix(20000)), "at": nowMs()])
        return .result(dialog: say(SmPending.tr("Записал в SuperMind", "Saved to SuperMind", "SuperMind-қа жазылды")))
    }
}

struct SmStartFocusIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Focus"
    static var description = IntentDescription("Opens SuperMind and starts the focus timer.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        SmPending.push(SmPending.action(for: "focus_start"))
        return .result()
    }
}

struct SmOpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Today"
    static var description = IntentDescription("Opens today's tasks and habits in SuperMind.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        SmPending.push(SmPending.action(for: "today"))
        return .result()
    }
}

struct SmAgendaIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's Agenda"
    static var description = IntentDescription("Tells you what's due today in SuperMind.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: say(SmAgenda.text(SmPending.data(), lang: SmPending.lang())))
    }
}

/// Ответ «что у меня сегодня»: задачи на сегодня и просроченные, привычки
enum SmAgenda {
    static func ymd(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// 1 задача / 2 задачи / 5 задач
    static func ruCount(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
        let a = n % 100, b = n % 10
        return "\(n) " + ((a > 10 && a < 20) ? many : b == 1 ? one : (b > 1 && b < 5) ? few : many)
    }

    static func text(_ data: [String: Any]?, lang: String, now: Date = Date()) -> String {
        func tr(_ ru: String, _ en: String, _ kk: String) -> String { lang == "en" ? en : lang == "kk" ? kk : ru }
        guard let data else {
            return tr("Откройте SuperMind один раз — и я смогу рассказать о ваших задачах.", "Open SuperMind once so I can tell you about your tasks.", "SuperMind-ты бір рет ашыңыз — сонда тапсырмаларыңызды айта аламын.")
        }
        let day = ymd(now)
        let tasks = ((data["tasks"] as? [[String: Any]]) ?? [])
            .filter { (($0["d"] as? String) ?? "9999") <= day }
        let overdue = tasks.filter { (($0["d"] as? String) ?? "") < day }.count
        let today = tasks.filter { (($0["d"] as? String) ?? "") == day }
            .sorted { (($0["tm"] as? String) ?? "99") < (($1["tm"] as? String) ?? "99") }

        var parts: [String] = []
        if today.isEmpty {
            parts.append(tr("На сегодня задач нет.", "Nothing is due today.", "Бүгінге тапсырма жоқ."))
        } else {
            let names = today.prefix(5).map { t -> String in
                let title = (t["t"] as? String) ?? ""
                if let tm = t["tm"] as? String { return tr("\(title) в \(tm)", "\(title) at \(tm)", "\(title), \(tm)") }
                return title
            }
            let more = today.count - names.count
            let count = tr(ruCount(today.count, "задача", "задачи", "задач"), "\(today.count) " + (today.count == 1 ? "task" : "tasks"), "\(today.count) тапсырма")
            var s = tr("Сегодня \(count): ", "Today you have \(count): ", "Бүгін \(count): ") + names.joined(separator: "; ")
            if more > 0 { s += tr(" и ещё \(more)", " and \(more) more", " және тағы \(more)") }
            parts.append(s + ".")
        }
        if overdue > 0 {
            parts.append(tr("Просрочено: \(overdue).", "Overdue: \(overdue).", "Мерзімі өткен: \(overdue)."))
        }
        if let h = (data["habits"] as? [String: Any])?[day] as? [Any], h.count >= 2,
           let done = (h[0] as? NSNumber)?.intValue, let total = (h[1] as? NSNumber)?.intValue, total > 0 {
            parts.append(done >= total
                ? tr("Все привычки выполнены.", "All habits are done.", "Барлық әдет орындалды.")
                : tr("Привычки: \(done) из \(total).", "Habits: \(done) of \(total) done.", "Әдеттер: \(total) ішінен \(done)."))
        }
        return parts.joined(separator: " ")
    }
}

struct SmShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SmAddTaskIntent(),
            phrases: [
                "Add a task in \(.applicationName)",
                "Add a task to \(.applicationName)",
                "New task in \(.applicationName)",
                "Create a task in \(.applicationName)",
            ],
            shortTitle: "Add Task",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: SmAgendaIntent(),
            phrases: [
                "What's on my agenda in \(.applicationName)",
                "What's my agenda in \(.applicationName)",
                "What do I have today in \(.applicationName)",
                "What are my tasks in \(.applicationName)",
            ],
            shortTitle: "Today's Agenda",
            systemImageName: "list.bullet"
        )
        AppShortcut(
            intent: SmStartFocusIntent(),
            phrases: [
                "Start focus in \(.applicationName)",
                "Start a focus session in \(.applicationName)",
                "Start a pomodoro in \(.applicationName)",
            ],
            shortTitle: "Start Focus",
            systemImageName: "timer"
        )
        AppShortcut(
            intent: SmOpenTodayIntent(),
            phrases: [
                "Open Today in \(.applicationName)",
                "Show my day in \(.applicationName)",
            ],
            shortTitle: "Open Today",
            systemImageName: "sun.max"
        )
        AppShortcut(
            intent: SmAddNoteIntent(),
            phrases: [
                "Add a note in \(.applicationName)",
                "New note in \(.applicationName)",
                "Take a note in \(.applicationName)",
            ],
            shortTitle: "Add Note",
            systemImageName: "note.text"
        )
    }
}
