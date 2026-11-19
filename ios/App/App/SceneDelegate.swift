import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // Свой контроллер: в нём регистрируются плагины без Package.swift (распознавание речи)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        // запуск касанием результата Spotlight
        for activity in connectionOptions.userActivities { SpotlightPlugin.handle(activity) }
        // запуск быстрым действием с иконки (удержание значка)
        if let item = connectionOptions.shortcutItem { Self.quickAction(item) }
    }

    /// Быстрое действие с иконки, когда приложение уже запущено
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(Self.quickAction(shortcutItem))
    }

    /// Тип из Info.plist (app.twomind.mindmap.quick_add …) → действие в очереди приложения (как у виджетов и Siri)
    @discardableResult
    static func quickAction(_ item: UIApplicationShortcutItem) -> Bool {
        let name = item.type.components(separatedBy: ".").last ?? ""
        switch name {
        case "quick_add": SmPending.push(["type": "quick_add"])
        case "voice": SmPending.push(["type": "voice"])
        case "focus": SmPending.push(["type": "open_view", "view": "focus"])
        case "new_map": SmPending.push(["type": "new_map"])
        default: return false
        }
        return true
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if SpotlightPlugin.handle(userActivity) { return }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
