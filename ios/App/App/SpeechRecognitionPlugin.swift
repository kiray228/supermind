import AVFoundation
import Capacitor
import Foundation
import Speech

/// Диктовка и голосовые команды на iPhone: тот же JS-интерфейс, что у @capacitor-community/speech-recognition
/// (у плагина нет Package.swift, поэтому в сборку через Swift Package Manager он не попадает — здесь своя реализация
/// по его образцу, лицензия MIT). Регистрируется в MainViewController.
@objc(SpeechRecognitionPlugin)
public class SpeechRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechRecognitionPlugin"
    public let jsName = "SpeechRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSupportedLanguages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
    ]

    private var recognizer: SFSpeechRecognizer?
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": SFSpeechRecognizer()?.isAvailable ?? false])
    }

    @objc func start(_ call: CAPPluginCall) {
        if engine?.isRunning == true {
            call.reject("Ongoing speech recognition")
            return
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            call.reject("Missing permission")
            return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else {
                    call.reject("User denied access to microphone")
                    return
                }
                self.begin(call)
            }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        let language = call.getString("language") ?? "ru-RU"
        let maxResults = call.getInt("maxResults") ?? 5
        let partial = call.getBool("partialResults") ?? false

        task?.cancel()
        task = nil
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)), recognizer.isAvailable else {
            call.reject("Speech recognition is not available")
            return
        }
        self.recognizer = recognizer

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("Microphone is already in use by another application.")
            return
        }

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = partial
        self.engine = engine
        self.request = request

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let matches = result.transcriptions.prefix(max(maxResults, 1)).map { $0.formattedString }
                if partial {
                    self.notifyListeners("partialResults", data: ["matches": matches])
                } else if result.isFinal {
                    call.resolve(["matches": matches])
                }
                if result.isFinal { self.finish() }
            }
            if let error = error {
                self.finish()
                if !partial { call.reject(error.localizedDescription) }
            }
        }

        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
            notifyListeners("listeningState", data: ["status": "started"])
            if partial { call.resolve() }
        } catch {
            finish()
            call.reject("Unknown error occured")
        }
    }

    /// Остановить микрофон и вернуть звук другим приложениям (музыка снова играет громко)
    private func finish() {
        guard engine != nil || request != nil else { return }
        if engine?.isRunning == true { engine?.stop() }
        engine?.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        engine = nil
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        notifyListeners("listeningState", data: ["status": "stopped"])
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // endAudio — распознаватель допишет последнее слово и сам вызовет finish
            if self.engine?.isRunning == true {
                self.engine?.stop()
                self.engine?.inputNode.removeTap(onBus: 0)
                self.request?.endAudio()
            } else {
                self.finish()
            }
            call.resolve()
        }
    }

    @objc func isListening(_ call: CAPPluginCall) {
        call.resolve(["listening": engine?.isRunning ?? false])
    }

    @objc func getSupportedLanguages(_ call: CAPPluginCall) {
        call.resolve(["languages": SFSpeechRecognizer.supportedLocales().map { $0.identifier }])
    }

    private func permission() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            return AVAudioSession.sharedInstance().recordPermission == .denied ? "denied" : "granted"
        case .denied, .restricted:
            return "denied"
        default:
            return "prompt"
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["speechRecognition": permission()])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                DispatchQueue.main.async { call.resolve(["speechRecognition": self.permission()]) }
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async { call.resolve(["speechRecognition": granted ? "granted" : "denied"]) }
            }
        }
    }
}
