import Capacitor
import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

/// Поиск iPhone (Spotlight): карты, заметки и задачи — названия и короткий отрывок (src/native/spotlight.ts).
/// Касание результата → SceneDelegate → SpotlightPlugin.handle → очередь действий (open_map / open_note / open_task).
/// Регистрируется в MainViewController.
@objc(SpotlightPlugin)
public class SpotlightPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpotlightPlugin"
    public let jsName = "Spotlight"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "index", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    static let kinds: Set<String> = ["map", "note", "task"]

    /// items: [{id, kind: 'map'|'note'|'task', title, text?}]
    @objc func index(_ call: CAPPluginCall) {
        let raw = (call.getArray("items") ?? []).compactMap { $0 as? JSObject }
        let items: [CSSearchableItem] = raw.compactMap { o in
            guard let id = o["id"] as? String, let kind = o["kind"] as? String, Self.kinds.contains(kind),
                  let title = o["title"] as? String, !title.isEmpty else { return nil }
            let attrs = CSSearchableItemAttributeSet(contentType: UTType.text)
            attrs.title = title
            attrs.displayName = title
            if let text = o["text"] as? String, !text.isEmpty { attrs.contentDescription = text }
            let item = CSSearchableItem(uniqueIdentifier: kind + ":" + id, domainIdentifier: kind, attributeSet: attrs)
            // по умолчанию Spotlight забывает запись через месяц
            item.expirationDate = .distantFuture
            return item
        }
        guard !items.isEmpty else {
            call.resolve()
            return
        }
        CSSearchableIndex.default().indexSearchableItems(items) { err in
            if let err { call.reject(err.localizedDescription) } else { call.resolve() }
        }
    }

    /// ids: ['map:…', 'note:…', …]
    @objc func remove(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") ?? []).compactMap { $0 as? String }
        guard !ids.isEmpty else {
            call.resolve()
            return
        }
        CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids) { err in
            if let err { call.reject(err.localizedDescription) } else { call.resolve() }
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        CSSearchableIndex.default().deleteAllSearchableItems { err in
            if let err { call.reject(err.localizedDescription) } else { call.resolve() }
        }
    }

    /// Касание результата Spotlight → действие в очередь приложения; true — это был результат Spotlight
    @discardableResult
    static func handle(_ activity: NSUserActivity) -> Bool {
        guard activity.activityType == CSSearchableItemActionType,
              let uid = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String,
              let sep = uid.firstIndex(of: ":") else { return false }
        let kind = String(uid[..<sep])
        let id = String(uid[uid.index(after: sep)...])
        guard !id.isEmpty else { return false }
        switch kind {
        case "map": SmPending.push(["type": "open_map", "id": id])
        case "note": SmPending.push(["type": "open_note", "id": id])
        case "task": SmPending.push(["type": "open_task", "id": id])
        default: return false
        }
        return true
    }
}
