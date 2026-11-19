import SwiftUI
import WidgetKit

// Виджет «Фокус» (экран «Домой», малый): идущий таймер — обратный отсчёт и кнопки «Пауза/Продолжить» и «Стоп»
// (те же FocusControlIntent, что у Live Activity); в покое — «Фокус 25 мин», касание запускает таймер в приложении
// (supermind://focus?action=start). Состояние таймера — Shared/FocusWidgetState.swift, длительность в покое — поле focus
// общего JSON виджетов.

struct WFocusIdle: Codable {
    let sw: Int?
    let min: Int
}

struct FocusIdlePayload: Codable {
    var focus: WFocusIdle?
    var lang: String?
}

struct FocusEntry: TimelineEntry {
    let date: Date
    let state: FocusAttributes.ContentState?
    let idle: WFocusIdle?
    let lang: String?

    /// Таймер идёт или на паузе (помодоро, чья фаза уже кончилась, а приложение не открывали, — как не запущенный)
    var active: Bool {
        guard let s = state else { return false }
        if s.running, !s.stopwatch, let end = s.endAt, end <= date { return false }
        return true
    }
}

struct FocusProvider: TimelineProvider {
    static func entry(_ date: Date) -> FocusEntry {
        var idle: FocusIdlePayload?
        if let raw = Store.defaults?.string(forKey: dataKey) {
            idle = try? JSONDecoder().decode(FocusIdlePayload.self, from: Data(raw.utf8))
        }
        return FocusEntry(date: date, state: FocusWidgetState.load(), idle: idle?.focus, lang: idle?.lang)
    }

    func placeholder(in context: Context) -> FocusEntry { FocusEntry(date: Date(), state: nil, idle: nil, lang: nil) }

    func getSnapshot(in context: Context, completion: @escaping (FocusEntry) -> Void) {
        completion(Self.entry(Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FocusEntry>) -> Void) {
        let now = Date()
        var entries = [Self.entry(now)]
        // конец фазы помодоро — виджет сам переходит в покой; дальше обновляет приложение и кнопки
        if let s = entries[0].state, s.running, !s.stopwatch, let end = s.endAt, end > now {
            entries.append(Self.entry(end))
        }
        completion(Timeline(entries: entries, policy: .never))
    }
}

struct FocusWidgetView: View {
    let entry: FocusEntry

    var body: some View {
        let l = WidgetLang.of(entry.lang)
        if entry.active, let s = entry.state {
            running(s, l)
        } else {
            idle(l)
        }
    }

    func running(_ s: FocusAttributes.ContentState, _ l: WidgetLang) -> some View {
        let tint = focusTint(s)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: s.stopwatch ? "stopwatch" : "timer").foregroundStyle(tint)
                Text(s.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            }
            Text(s.running ? (s.task ?? "") : L(l, "На паузе", "Paused", "Кідіртілді"))
                .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            FocusClock(s: s)
                .font(.system(size: 32, weight: .semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Button(intent: FocusControlIntent(action: s.running ? "pause" : "resume")) {
                    Image(systemName: s.running ? "pause.fill" : "play.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .background(Capsule().fill(tint.opacity(0.22)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(s.running ? L(l, "Пауза", "Pause", "Кідірту") : L(l, "Продолжить", "Resume", "Жалғастыру"))
                Button(intent: FocusControlIntent(action: "stop")) {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .background(Capsule().fill(Color.secondary.opacity(0.2)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L(l, "Стоп", "Stop", "Тоқтату"))
            }
        }
    }

    func idle(_ l: WidgetLang) -> some View {
        let sw = entry.idle?.sw == 1
        let min = entry.idle?.min ?? 25
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: sw ? "stopwatch" : "timer").foregroundStyle(sw ? Color.orange : Color.purple)
                Text(sw ? L(l, "Секундомер", "Stopwatch", "Секундомер") : L(l, "Фокус", "Focus", "Фокус"))
                    .font(.system(size: 13, weight: .semibold))
            }
            Spacer(minLength: 0)
            Text(sw ? "00:00" : String(format: "%02d:00", min))
                .font(.system(size: 32, weight: .semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(sw ? L(l, "Секундомер", "Stopwatch", "Секундомер") : L(l, "Фокус \(min) мин", "Focus \(min) min", "Фокус \(min) мин"))
                .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            Label(L(l, "Начать", "Start", "Бастау"), systemImage: "play.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 32)
                .background(Capsule().fill(sw ? Color.orange : Color.purple))
        }
    }
}

struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: FocusWidgetState.kind, provider: FocusProvider()) { entry in
            FocusWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                // в покое касание сразу запускает фокус, иначе — открывает таймер
                .widgetURL(entry.active ? link("open_view", ["view": "focus"]) : link("focus", ["action": "start"]))
        }
        .configurationDisplayName(L(WidgetLang.system, "Фокус", "Focus", "Фокус"))
        .description(L(WidgetLang.system, "Таймер фокуса: старт, пауза и стоп прямо с экрана «Домой».", "Focus timer: start, pause and stop right from your Home Screen.", "Фокус таймері: «Үй» экранынан бастау, кідірту және тоқтату."))
        .supportedFamilies([.systemSmall])
    }
}
