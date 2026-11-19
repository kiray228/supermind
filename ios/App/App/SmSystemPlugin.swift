import Capacitor
import Foundation
import LocalAuthentication

/// Системное на iPhone (src/native/system.ts): вход по Face ID / Touch ID вместо кода-пароля и событие 'pending' —
/// Siri, Spotlight или кнопка Пункта управления положили действие в очередь, пока приложение открыто.
/// Регистрируется в MainViewController.
@objc(SmSystemPlugin)
public class SmSystemPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SmSystemPlugin"
    public let jsName = "SmSystem"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "biometricAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricVerify", returnType: CAPPluginReturnPromise),
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(forName: SmPending.changed, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("pending", data: [:], retainUntilConsumed: true)
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    private static func kind(_ ctx: LAContext) -> String {
        switch ctx.biometryType {
        case .faceID: return "face"
        case .touchID: return "touch"
        default:
            if #available(iOS 17.0, *), ctx.biometryType == .opticID { return "optic" }
            return ""
        }
    }

    /// Можно ли войти по Face ID / Touch ID; kind — что именно стоит на телефоне
    @objc func biometricAvailable(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var error: NSError?
        let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        call.resolve(["available": ok, "kind": Self.kind(ctx)])
    }

    /// Системное окно Face ID / Touch ID: ok = true — подтверждено; отмена или «Ввести код» — ok = false (код в приложении)
    @objc func biometricVerify(_ call: CAPPluginCall) {
        let ctx = LAContext()
        // кнопка после неудачной попытки — ввести код-пароль приложения, а не код телефона
        ctx.localizedFallbackTitle = call.getString("negative") ?? ""
        let reason = call.getString("subtitle").flatMap { $0.isEmpty ? nil : $0 } ?? call.getString("title") ?? "SuperMind"
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            call.resolve(["ok": false, "error": error?.localizedDescription ?? "unavailable"])
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, err in
            var r: [String: Any] = ["ok": ok]
            if let err { r["error"] = err.localizedDescription }
            call.resolve(r)
        }
    }
}
