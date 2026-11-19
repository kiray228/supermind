import Capacitor
import UIKit

/// Иконка приложения: «default» — основная (AppIcon), остальные — альтернативные наборы AppIcon-<Имя> в Assets.xcassets
/// (ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES в ios/scripts/setup-targets.rb). Тот же JS-интерфейс, что у Android
/// (src/native/appIcon.ts). Регистрируется в MainViewController.
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    /// id из приложения → имя набора иконок
    static let names: [String: String] = [
        "dark": "AppIcon-Dark",
        "light": "AppIcon-Light",
        "green": "AppIcon-Green",
        "sunset": "AppIcon-Sunset",
        "purple": "AppIcon-Purple",
    ]

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let app = UIApplication.shared
            let current = app.alternateIconName
            let id = Self.names.first { $0.value == current }?.key ?? "default"
            call.resolve(["name": id, "supported": app.supportsAlternateIcons])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        let id = call.getString("name") ?? "default"
        let target: String? = id == "default" ? nil : Self.names[id]
        if id != "default" && target == nil {
            call.reject("unknown icon")
            return
        }
        DispatchQueue.main.async {
            let app = UIApplication.shared
            guard app.supportsAlternateIcons else {
                call.reject("not supported")
                return
            }
            if app.alternateIconName == target {
                call.resolve(["name": id])
                return
            }
            app.setAlternateIconName(target) { error in
                if let error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["name": id])
                }
            }
        }
    }
}
