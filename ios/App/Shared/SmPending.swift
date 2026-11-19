import AppIntents
import Foundation

/// Очередь действий для приложения (та же, что у виджетов: App Group, ключ "widget-pending") — общая для приложения
/// (Siri, Spotlight) и расширения виджетов (кнопки Пункта управления). JS применяет её в applyPending
/// (src/native/widget.ts). Если приложение запущено, оно узнаёт о новом действии сразу — через уведомление changed
/// (его слушает SmSystemPlugin и передаёт в JS событие 'pending').
enum SmPending {
    static let group = "group.app.twomind.mindmap"
    static let key = "widget-pending"
    static let dataKey = "widget-json"
    static let changed = Notification.Name("SmPendingChanged")

    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

    static func push(_ action: [String: Any]) {
        guard let d = defaults else { return }
        var list = (try? JSONSerialization.jsonObject(with: Data((d.string(forKey: key) ?? "[]").utf8))) as? [Any] ?? []
        list.append(action)
        if list.count > 200 { list.removeFirst(list.count - 200) }
        if let data = try? JSONSerialization.data(withJSONObject: list), let s = String(data: data, encoding: .utf8) {
            d.set(s, forKey: key)
        }
        DispatchQueue.main.async { NotificationCenter.default.post(name: changed, object: nil) }
    }

    /// Данные, которые приложение отдаёт виджетам (задачи, привычки, язык)
    static func data() -> [String: Any]? {
        guard let raw = defaults?.string(forKey: dataKey) else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any]
    }

    /// Язык приложения ("ru" | "en" | "kk"); до первого запуска — язык системы
    static func lang() -> String {
        if let l = data()?["lang"] as? String, ["ru", "en", "kk"].contains(l) { return l }
        let ruLike: Set<String> = ["ru", "uk", "be", "uz", "ky", "tg", "hy", "az", "ka", "tk", "mn"]
        for p in Locale.preferredLanguages {
            let c = String(p.prefix(2)).lowercased()
            if c == "kk" { return "kk" }
            if ruLike.contains(c) { return "ru" }
        }
        return "en"
    }

    /// Подпись на языке приложения
    static func tr(_ ru: String, _ en: String, _ kk: String) -> String {
        switch lang() {
        case "en": return en
        case "kk": return kk
        default: return ru
        }
    }

    /// Действие кнопки (Пункт управления, кнопка «Действие», Siri) → элемент очереди
    static func action(for name: String) -> [String: Any] {
        switch name {
        case "voice": return ["type": "voice"]
        case "focus": return ["type": "open_view", "view": "focus"]
        case "focus_start": return ["type": "focus", "action": "start", "at": Date().timeIntervalSince1970 * 1000]
        case "today": return ["type": "open_view", "view": "today"]
        case "new_note": return ["type": "new_note"]
        default: return ["type": "quick_add"]
        }
    }
}

/// Открыть приложение и выполнить в нём действие (кнопки Пункта управления и экрана блокировки, Siri).
/// Файл общий для приложения и виджетов: с openAppWhenRun система выполняет намерение в приложении.
struct SmOpenAppIntent: AppIntent {
    static var title: LocalizedStringResource = "Open SuperMind"
    static var isDiscoverable: Bool = false
    static var openAppWhenRun: Bool = true
    @Parameter(title: "Action") var action: String

    init() {}
    init(action: String) { self.action = action }

    func perform() async throws -> some IntentResult {
        SmPending.push(SmPending.action(for: action))
        return .result()
    }
}
