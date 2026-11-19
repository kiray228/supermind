import Capacitor
import Foundation
import UIKit
import Vision
import VisionKit

/// «Текст с фото» на iPhone: распознавание текста прямо на устройстве (Apple Vision), фото никуда не уходит.
/// recognize — снимок (base64 JPEG) → строки с рамками; scanDocument — сканер документов VisionKit
/// (сам находит страницу и выравнивает её) → строки каждой страницы. Строки в текст собирает JS (src/notes/ocrCore.ts).
/// Регистрируется в MainViewController.
@objc(TextScanPlugin)
public class TextScanPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "TextScanPlugin"
    public let jsName = "TextScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "canScan", returnType: CAPPluginReturnPromise),
    ]

    private var scanCall: CAPPluginCall?
    private var scanLanguages: [String] = []

    /// Языки, которые Vision знает: запрошенные по порядку, неизвестные (например, казахский) пропускаются
    private static func languages(_ wanted: [String]) -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        let supported = (try? request.supportedRecognitionLanguages()) ?? ["en-US"]
        let lower = Set(supported.map { $0.lowercased() })
        var out = wanted.filter { lower.contains($0.lowercased()) }
        if out.isEmpty { out = supported.contains("ru-RU") ? ["ru-RU", "en-US"] : ["en-US"] }
        return out
    }

    /// Строки с рамками в долях снимка; у Vision начало координат внизу — переворачиваем, чтобы верх был 0
    private static func recognize(_ image: CGImage, languages: [String]) throws -> [[String: Any]] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = languages
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
        let found = request.results ?? []
        return found.compactMap { obs -> [String: Any]? in
            guard let top = obs.topCandidates(1).first else { return nil }
            let b = obs.boundingBox
            return ["text": top.string, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height]
        }
    }

    @objc func canScan(_ call: CAPPluginCall) {
        call.resolve(["value": VNDocumentCameraViewController.isSupported])
    }

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"), let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let ui = UIImage(data: data), let cg = Self.upright(ui)
        else {
            call.reject("Не удалось открыть изображение")
            return
        }
        let langs = Self.languages(call.getArray("languages", String.self) ?? ["ru-RU", "en-US"])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                call.resolve(["lines": try Self.recognize(cg, languages: langs), "languages": langs])
            } catch {
                call.reject("Не удалось распознать текст", nil, error)
            }
        }
    }

    @objc func scanDocument(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Сканер документов недоступен на этом устройстве")
            return
        }
        scanLanguages = Self.languages(call.getArray("languages", String.self) ?? ["ru-RU", "en-US"])
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("Нет окна приложения")
                return
            }
            self.scanCall?.resolve(["cancelled": true])
            self.scanCall = call
            let scanner = VNDocumentCameraViewController()
            scanner.delegate = self
            vc.present(scanner, animated: true)
        }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let call = scanCall
        scanCall = nil
        let langs = scanLanguages
        var images: [UIImage] = []
        for i in 0 ..< min(scan.pageCount, 20) { images.append(scan.imageOfPage(at: i)) }
        controller.dismiss(animated: true)
        DispatchQueue.global(qos: .userInitiated).async {
            var pages: [[String: Any]] = []
            for img in images {
                guard let cg = Self.upright(img) else { continue }
                let lines = (try? Self.recognize(cg, languages: langs)) ?? []
                pages.append(["lines": lines])
            }
            // первая страница — для превью и «Добавить фото в заметку» (уменьшенная)
            var result: [String: Any] = ["pages": pages]
            if let first = images.first, let jpeg = Self.scaled(first, max: 1600).jpegData(compressionQuality: 0.8) {
                result["image"] = jpeg.base64EncodedString()
            }
            call?.resolve(result)
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        scanCall?.resolve(["cancelled": true])
        scanCall = nil
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        scanCall?.reject("Не удалось отсканировать документ", nil, error)
        scanCall = nil
    }

    /// Снимок «как видит человек»: ориентация из EXIF применяется, Vision получает уже повёрнутую картинку
    private static func upright(_ image: UIImage) -> CGImage? {
        if image.imageOrientation == .up, let cg = image.cgImage { return cg }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let r = UIGraphicsImageRenderer(size: image.size, format: format)
        return r.image { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }.cgImage
    }

    private static func scaled(_ image: UIImage, max side: CGFloat) -> UIImage {
        let w = image.size.width, h = image.size.height
        let k = min(1, side / Swift.max(w, h))
        if k >= 1 { return image }
        let size = CGSize(width: (w * k).rounded(), height: (h * k).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
