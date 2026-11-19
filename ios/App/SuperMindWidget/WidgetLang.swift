import Foundation

// Язык подписей новых виджетов («Финансы», «Фокус»): русский, английский или казахский — как в приложении
// (поле lang в данных виджетов); до первого запуска приложения — по языкам системы, как src/i18n.

enum WidgetLang {
    case ru, en, kk

    /// Язык системы: первый казахский или русский/соседний — он, иначе английский
    static let system: WidgetLang = {
        let ruLike: Set<String> = ["ru", "uk", "be", "uz", "ky", "tg", "hy", "az", "ka", "tk", "mn"]
        for l in Locale.preferredLanguages {
            let code = String(l.prefix(2)).lowercased()
            if code == "kk" { return .kk }
            if ruLike.contains(code) { return .ru }
        }
        return Locale.preferredLanguages.isEmpty ? .ru : .en
    }()

    static func of(_ code: String?) -> WidgetLang {
        switch code {
        case "ru": return .ru
        case "en": return .en
        case "kk": return .kk
        default: return system
        }
    }
}

/// Подпись на языке приложения: русский, английский, казахский
func L(_ l: WidgetLang, _ ru: String, _ en: String, _ kk: String) -> String {
    switch l {
    case .ru: return ru
    case .en: return en
    case .kk: return kk
    }
}

/// Язык из общих данных виджетов (тот же JSON, что у остальных виджетов)
func widgetLang() -> WidgetLang {
    guard let raw = Store.defaults?.string(forKey: dataKey),
          let obj = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else { return .system }
    return WidgetLang.of(obj["lang"] as? String)
}
