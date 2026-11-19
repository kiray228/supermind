import Foundation
import WidgetKit

// Состояние таймера фокуса для виджета «Фокус» на экране «Домой»: то же, что у Live Activity.
// Пишут приложение (FocusLivePlugin — при каждом изменении таймера) и кнопки «Пауза/Продолжить/Стоп»
// (FocusControlIntent), читает виджет (SuperMindWidget/FocusWidget.swift). Файл входит в приложение и в расширение.

enum FocusWidgetState {
    static let key = "focus-live"
    static let kind = "SuperMindFocus"

    static func load() -> FocusAttributes.ContentState? {
        guard let raw = UserDefaults(suiteName: FocusQueue.group)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(FocusAttributes.ContentState.self, from: raw)
    }

    static func save(_ s: FocusAttributes.ContentState) {
        guard let d = UserDefaults(suiteName: FocusQueue.group), let data = try? JSONEncoder().encode(s) else { return }
        d.set(data, forKey: key)
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
    }

    static func clear() {
        UserDefaults(suiteName: FocusQueue.group)?.removeObject(forKey: key)
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
    }

    /// Кнопка на экране блокировки или в виджете: то же изменение, что у Live Activity
    static func apply(_ action: String, at now: Date) {
        if action == "stop" {
            clear()
        } else if let s = load() {
            save(FocusQueue.apply(action, to: s, at: now))
        }
    }
}
