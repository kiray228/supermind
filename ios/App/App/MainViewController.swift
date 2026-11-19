import Capacitor
import UIKit

/// Окно приложения: подключает свои плагины, которых нет среди пакетов Capacitor (речь, виджеты)
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SpeechRecognitionPlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}
