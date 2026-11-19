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
        call.resolve(["actions": list.map(Self.takeSharedImages)])
    }

    /// «Поделиться» из расширения: картинки лежат в папке группы — перенести в папку приложения (Directory.Data),
    /// где их читает src/native/share.ts. Путь shared/… остаётся тем же.
    static func takeSharedImages(_ action: Any) -> Any {
        guard var a = action as? [String: Any], a["group"] as? Bool == true, let images = a["images"] as? [[String: Any]],
              let from = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let to = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return action }
        try? FileManager.default.createDirectory(at: to.appendingPathComponent("shared", isDirectory: true), withIntermediateDirectories: true)
        a["images"] = images.filter { im in
            guard let path = im["path"] as? String, path.hasPrefix("shared/"), !path.contains("..") else { return false }
            let dst = to.appendingPathComponent(path)
            try? FileManager.default.removeItem(at: dst)
            return (try? FileManager.default.moveItem(at: from.appendingPathComponent(path), to: dst)) != nil
        }
        a.removeValue(forKey: "group")
        return a
    }
}
