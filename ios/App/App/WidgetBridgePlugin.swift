import Capacitor
import Foundation
import WidgetKit

/// Мост к виджетам iPhone: тот же JS-интерфейс, что у Android (src/native/widget.ts).
/// update — данные для виджетов в общую группу App Group; consumePending — действия, нажатые в виджете
/// (выполнить задачу, отметить привычку, открыть раздел), пока приложение было закрыто.
/// Регистрируется в MainViewController.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePending", returnType: CAPPluginReturnPromise),
    ]

    static let group = "group.app.twomind.mindmap"
    static let dataKey = "widget-json"
    static let pendingKey = "widget-pending"

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let d = UserDefaults(suiteName: Self.group) else {
            call.resolve()
            return
        }
        d.set(json, forKey: Self.dataKey)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func consumePending(_ call: CAPPluginCall) {
        guard let d = UserDefaults(suiteName: Self.group) else {
            call.resolve(["actions": []])
            return
        }
        let raw = d.string(forKey: Self.pendingKey) ?? "[]"
        d.removeObject(forKey: Self.pendingKey)
        let list = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [Any] ?? []
        call.resolve(["actions": list])
    }
}
