import AppIntents
import SwiftUI
import WidgetKit

// Кнопки Пункта управления, экрана блокировки и кнопки «Действие» (iOS 18): «Новая задача», «Голосом», «Фокус».
// Касание открывает приложение и кладёт в очередь то же действие, что быстрые действия значка
// (SmOpenAppIntent из Shared/SmPending.swift — намерение есть и в приложении, поэтому выполняется там).

@available(iOS 18.0, *)
struct SmNewTaskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "SuperMindControlNewTask") {
            ControlWidgetButton(action: SmOpenAppIntent(action: "quick_add")) {
                Label(SmPending.tr("Новая задача", "New task", "Жаңа тапсырма"), systemImage: "plus.circle")
            }
        }
        .displayName(LocalizedStringResource(stringLiteral: SmPending.tr("Новая задача", "New task", "Жаңа тапсырма")))
        .description(LocalizedStringResource(stringLiteral: SmPending.tr("Добавить задачу в SuperMind.", "Add a task in SuperMind.", "SuperMind-қа тапсырма қосу.")))
    }
}

@available(iOS 18.0, *)
struct SmVoiceControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "SuperMindControlVoice") {
            ControlWidgetButton(action: SmOpenAppIntent(action: "voice")) {
                Label(SmPending.tr("Голосом", "By voice", "Дауыспен"), systemImage: "mic.fill")
            }
        }
        .displayName(LocalizedStringResource(stringLiteral: SmPending.tr("Голосом", "By voice", "Дауыспен")))
        .description(LocalizedStringResource(stringLiteral: SmPending.tr("Голосовая команда: задача, трата, заметка.", "Voice command: a task, an expense or a note.", "Дауыстық команда: тапсырма, шығын, жазба.")))
    }
}

@available(iOS 18.0, *)
struct SmFocusControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "SuperMindControlFocus") {
            ControlWidgetButton(action: SmOpenAppIntent(action: "focus")) {
                Label(SmPending.tr("Фокус", "Focus", "Фокус"), systemImage: "timer")
            }
        }
        .displayName(LocalizedStringResource(stringLiteral: SmPending.tr("Фокус", "Focus", "Фокус")))
        .description(LocalizedStringResource(stringLiteral: SmPending.tr("Открыть таймер фокуса.", "Open the focus timer.", "Фокус таймерін ашу.")))
    }
}
