import ActivityKit
import Capacitor
import Foundation

/// Таймер фокуса в Live Activity (экран блокировки, Dynamic Island). Тот же JS-интерфейс, что у Android
/// (src/native/focusLive.ts): update — запустить или обновить, end — убрать. Регистрируется в MainViewController.
@objc(FocusLivePlugin)
public class FocusLivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusLivePlugin"
    public let jsName = "FocusLive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    private static func date(_ call: CAPPluginCall, _ key: String) -> Date? {
        guard let ms = call.getDouble(key) else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    @objc func update(_ call: CAPPluginCall) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve()
            return
        }
        let state = FocusAttributes.ContentState(
            running: call.getBool("running") ?? false,
            stopwatch: call.getBool("stopwatch") ?? false,
            phase: call.getString("phase") ?? "work",
            title: call.getString("title") ?? "",
            task: call.getString("task"),
            endAt: Self.date(call, "endAt"),
            start: Self.date(call, "start"),
            left: call.getDouble("left").map { $0 / 1000 },
            elapsed: call.getDouble("elapsed").map { $0 / 1000 },
            total: (call.getDouble("total") ?? 0) / 1000,
            doneTitle: call.getString("doneTitle") ?? "",
            doneBody: call.getString("doneBody") ?? ""
        )
        let attrs = FocusAttributes(
            pauseLabel: call.getString("pauseLabel") ?? "Pause",
            resumeLabel: call.getString("resumeLabel") ?? "Resume",
            stopLabel: call.getString("stopLabel") ?? "Stop",
            pausedLabel: call.getString("pausedLabel") ?? "Paused"
        )
        let content = ActivityContent(state: state, staleDate: state.endAt)
        Task {
            if let current = Activity<FocusAttributes>.activities.first {
                await current.update(content)
            } else {
                _ = try? Activity.request(attributes: attrs, content: content, pushType: nil)
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        Task {
            for a in Activity<FocusAttributes>.activities {
                await a.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }
}
