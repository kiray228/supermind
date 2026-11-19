import Social
import UIKit
import UniformTypeIdentifiers

/// «Поделиться» → SuperMind: текст, ссылка и до 5 картинок. Сохраняется в очередь App Group (как нажатия в виджетах):
/// при следующем открытии приложение покажет окно «Сохранить в SuperMind» — в задачи, заметки или карту
/// (src/native/widget.ts → applyPending → openShare). Картинки лежат в общей папке группы до этого момента.
class ShareViewController: SLComposeServiceViewController {
    static let group = "group.app.twomind.mindmap"
    static let pendingKey = "widget-pending"

    /// Язык приложения ('ru' | 'en' | 'kk') — из данных виджетов; до первого запуска — по языкам системы
    private var lang: String {
        if let l = UserDefaults(suiteName: Self.group)?.string(forKey: "widget-json").flatMap({ raw -> String? in
            guard let o = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else { return nil }
            return o["lang"] as? String
        }) { return l }
        let ruLike: Set<String> = ["ru", "uk", "be", "uz", "ky", "tg", "hy", "az", "ka", "tk", "mn"]
        for code in Locale.preferredLanguages.map({ String($0.prefix(2)).lowercased() }) {
            if code == "kk" { return "kk" }
            if ruLike.contains(code) { return "ru" }
        }
        return "en"
    }

    private func L(_ ru: String, _ en: String, _ kk: String) -> String {
        switch lang {
        case "en": return en
        case "kk": return kk
        default: return ru
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "SuperMind"
        placeholder = L("Комментарий (необязательно)", "Comment (optional)", "Түсініктеме (міндетті емес)")
        navigationController?.navigationBar.topItem?.rightBarButtonItem?.title = L("Сохранить", "Save", "Сақтау")
    }

    override func isContentValid() -> Bool { true }

    override func didSelectPost() {
        let note = (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        let subject = (extensionContext?.inputItems.first as? NSExtensionItem)?.attributedContentText?.string
        Task {
            var texts: [String] = []
            var urls: [String] = []
            var images: [[String: String]] = []
            for p in providers {
                if p.hasItemConformingToTypeIdentifier(UTType.image.identifier), images.count < 5 {
                    if let saved = await Self.saveImage(p, index: images.count) { images.append(saved) }
                } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    if let u = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, !u.isFileURL { urls.append(u.absoluteString) }
                } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    if let t = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String { texts.append(t) }
                }
            }
            // как на Android: комментарий, текст и ссылка одним текстом; заголовок — тема письма/страницы
            var parts = [note] + texts
            for u in urls where !parts.contains(where: { $0.contains(u) }) { parts.append(u) }
            let text = parts.filter { !$0.isEmpty }.joined(separator: "\n")
            if !text.isEmpty || !images.isEmpty {
                var action: [String: Any] = ["type": "share", "text": text]
                if let subject, !subject.isEmpty, subject != note { action["title"] = subject }
                if !images.isEmpty {
                    action["images"] = images
                    action["group"] = true
                }
                Self.push(action)
            }
            await MainActor.run { self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil) }
        }
    }

    override func configurationItems() -> [Any]! {
        let item = SLComposeSheetConfigurationItem()
        item?.title = L("Куда сохранить — выберете в SuperMind", "Choose where to save when you open SuperMind", "Қайда сақтауды SuperMind-та таңдайсыз")
        return item.map { [$0] } ?? []
    }

    /// Картинка → общая папка группы shared/; путь тот же, что приложение использует у себя (Directory.Data)
    static func saveImage(_ p: NSItemProvider, index: Int) async -> [String: String]? {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("shared", isDirectory: true) else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let item = try? await p.loadItem(forTypeIdentifier: UTType.image.identifier)
        var data: Data?
        if let u = item as? URL { data = try? Data(contentsOf: u) }
        else if let d = item as? Data { data = d }
        else if let img = item as? UIImage { data = img.jpegData(compressionQuality: 0.9) }
        // HEIC и прочее — в JPEG: WebView читает его везде
        guard let raw = data, raw.count <= 15_000_000, let jpg = UIImage(data: raw)?.jpegData(compressionQuality: 0.9) else { return nil }
        let name = "\(Int(Date().timeIntervalSince1970 * 1000))_\(index).jpg"
        do {
            try jpg.write(to: dir.appendingPathComponent(name))
        } catch { return nil }
        return ["path": "shared/" + name, "type": "image/jpeg"]
    }

    static func push(_ action: [String: Any]) {
        guard let d = UserDefaults(suiteName: group) else { return }
        var list = (try? JSONSerialization.jsonObject(with: Data((d.string(forKey: pendingKey) ?? "[]").utf8))) as? [Any] ?? []
        list.append(action)
        if list.count > 200 { list.removeFirst(list.count - 200) }
        if let data = try? JSONSerialization.data(withJSONObject: list), let s = String(data: data, encoding: .utf8) {
            d.set(s, forKey: pendingKey)
        }
    }
}
