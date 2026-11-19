import ActivityKit
import AppIntents
import Foundation
import UserNotifications

// Таймер фокуса на экране блокировки и в Dynamic Island. Файл входит и в приложение, и в расширение виджетов:
// приложение запускает Live Activity (FocusLivePlugin), расширение её рисует, а кнопки (FocusControlIntent)
// выполняются в процессе приложения — сразу меняют Live Activity и оставляют действие в очереди App Group,
// которое приложение применит к своему таймеру (src/native/focusLive.ts → applyFocusAction).

struct FocusAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var running: Bool
        var stopwatch: Bool
        /// work / short / long
        var phase: String
        var title: String
        var task: String?
        /// помодоро идёт: конец фазы
        var endAt: Date?
        /// секундомер идёт: момент «нуля»
        var start: Date?
        /// на паузе: осталось (помодоро) / прошло (секундомер), секунды
        var left: Double?
        var elapsed: Double?
        /// длительность фазы помодоро, секунды (0 — секундомер)
        var total: Double
        var doneTitle: String
        var doneBody: String
    }

    var pauseLabel: String
    var resumeLabel: String
    var stopLabel: String
    var pausedLabel: String
}

enum FocusQueue {
    static let group = "group.app.twomind.mindmap"
    static let pendingKey = "widget-pending"
    /// тот же id, что у уведомления «Помодоро завершён» из приложения (src/tasks/focusTimer.ts)
    static let notificationId = "777001"

    static func push(_ action: String, at: Date) {
        guard let d = UserDefaults(suiteName: group) else { return }
        var list = (try? JSONSerialization.jsonObject(with: Data((d.string(forKey: pendingKey) ?? "[]").utf8))) as? [Any] ?? []
        list.append(["type": "focus", "action": action, "at": Int(at.timeIntervalSince1970 * 1000)])
        if list.count > 200 { list.removeFirst(list.count - 200) }
        if let data = try? JSONSerialization.data(withJSONObject: list), let s = String(data: data, encoding: .utf8) {
            d.set(s, forKey: pendingKey)
        }
    }

    /// Новое состояние после нажатия кнопки
    static func apply(_ action: String, to s: FocusAttributes.ContentState, at now: Date) -> FocusAttributes.ContentState {
        var n = s
        if action == "pause", s.running {
            n.running = false
            if s.stopwatch { n.elapsed = max(0, now.timeIntervalSince(s.start ?? now)); n.start = nil }
            else { n.left = max(0, (s.endAt ?? now).timeIntervalSince(now)); n.endAt = nil }
        } else if action == "resume", !s.running {
            n.running = true
            if s.stopwatch { n.start = now.addingTimeInterval(-(s.elapsed ?? 0)); n.elapsed = nil }
            else { n.endAt = now.addingTimeInterval(s.left ?? 0); n.left = nil }
        }
        return n
    }

    static func rescheduleDone(_ s: FocusAttributes.ContentState) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [notificationId])
        guard s.running, !s.stopwatch, let end = s.endAt, end > Date() else { return }
        let c = UNMutableNotificationContent()
        c.title = s.doneTitle
        c.body = s.doneBody
        c.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: end.timeIntervalSinceNow, repeats: false)
        center.add(UNNotificationRequest(identifier: notificationId, content: c, trigger: trigger))
    }
}

@available(iOS 17.0, *)
struct FocusControlIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Focus timer"
    static var isDiscoverable: Bool = false
    @Parameter(title: "Action") var action: String

    init() {}
    init(action: String) { self.action = action }

    func perform() async throws -> some IntentResult {
        let now = Date()
        FocusQueue.push(action, at: now)
        for activity in Activity<FocusAttributes>.activities {
            if action == "stop" {
                await activity.end(nil, dismissalPolicy: .immediate)
                UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [FocusQueue.notificationId])
            } else {
                let next = FocusQueue.apply(action, to: activity.content.state, at: now)
                await activity.update(ActivityContent(state: next, staleDate: next.endAt))
                FocusQueue.rescheduleDone(next)
            }
        }
        return .result()
    }
}
