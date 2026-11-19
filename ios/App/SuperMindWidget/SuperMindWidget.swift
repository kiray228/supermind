import AppIntents
import SwiftUI
import WidgetKit

// Виджеты SuperMind для iPhone: «Сегодня» (задачи и привычки дня) и «Привычки» — на экране «Домой»
// и на экране блокировки; кнопки «Новая задача» и «Голосом» для экрана блокировки; таймер фокуса (Live Activity).
// Данные кладёт приложение (WidgetBridgePlugin.update) в общую группу App Group — тот же JSON, что у Android-виджетов.
// Нажатия «выполнить» и «отметить» сразу меняют виджет и копятся очередью действий: приложение применяет их,
// когда открывается (src/native/widget.ts → consumePending). Переходы в приложение — ссылки supermind://…

let appGroup = "group.app.twomind.mindmap"
let dataKey = "widget-json"
let pendingKey = "widget-pending"

// MARK: - Данные

struct WTask: Codable, Hashable {
    let id: String
    let t: String
    let d: String?
    let tm: String?
    let p: Int?
}

struct WHabit: Codable, Hashable {
    let id: String
    let n: String
    let e: String?
    let c: String?
    let tg: Int?
    let u: String?
}

struct WHabits: Codable {
    var list: [WHabit]
    /// день → строки [id, сделано, серия, 1 — серия в неделях]
    var days: [String: [[StringOrInt]]]
}

/// Элемент строки привычки: id — строка, остальное — числа
enum StringOrInt: Codable, Hashable {
    case s(String)
    case i(Int)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Int.self) { self = .i(v) } else if let v = try? c.decode(Double.self) { self = .i(Int(v)) } else { self = .s(try c.decode(String.self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .s(let v): try c.encode(v)
        case .i(let v): try c.encode(v)
        }
    }

    var str: String { if case .s(let v) = self { return v }; return "" }
    var int: Int { if case .i(let v) = self { return v }; return 0 }
}

struct Payload: Codable {
    var tasks: [WTask]?
    var hab: WHabits?
    /// язык приложения: "ru" / "en"
    var lang: String?
}

/// Язык системы — до первого запуска приложения и для названий в галерее виджетов
let systemEn: Bool = {
    let ruLike: Set<String> = ["ru", "kk", "uk", "be", "uz", "ky", "tg", "hy", "az", "ka", "tk", "mn"]
    return !Locale.preferredLanguages.contains { ruLike.contains(String($0.prefix(2)).lowercased()) }
}()

/// Подпись на языке приложения
func L(_ en: Bool, _ ru: String, _ eng: String) -> String { en ? eng : ru }
func isEn(_ p: Payload?) -> Bool { p?.lang.map { $0 == "en" } ?? systemEn }

/// 1 задача / 2 задачи / 5 задач — или 1 task / 2 tasks
func count(_ n: Int, _ en: Bool, _ one: String, _ few: String, _ many: String, _ eOne: String, _ eMany: String) -> String {
    if en { return "\(n) " + (n == 1 ? eOne : eMany) }
    let a = n % 100, b = n % 10
    return "\(n) " + ((a > 10 && a < 20) ? many : b == 1 ? one : (b > 1 && b < 5) ? few : many)
}

/// Привычка на день: сколько сделано и серия
struct HabitDay: Hashable {
    let h: WHabit
    let count: Int
    let streak: Int
    var target: Int { max(1, h.tg ?? 1) }
    var done: Bool { count >= target }
}

enum Store {
    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func load() -> Payload? {
        guard let raw = defaults?.string(forKey: dataKey) else { return nil }
        return try? JSONDecoder().decode(Payload.self, from: Data(raw.utf8))
    }

    /// Сохранить данные, не трогая поля, которых виджет не знает (календарь, карты — для Android)
    static func edit(_ change: (inout [String: Any]) -> Void) {
        guard let d = defaults, let raw = d.string(forKey: dataKey),
              var obj = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else { return }
        change(&obj)
        if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
            d.set(s, forKey: dataKey)
        }
    }

    static func push(_ action: [String: Any]) {
        guard let d = defaults else { return }
        var list = (try? JSONSerialization.jsonObject(with: Data((d.string(forKey: pendingKey) ?? "[]").utf8))) as? [Any] ?? []
        list.append(action)
        if list.count > 200 { list.removeFirst(list.count - 200) }
        if let data = try? JSONSerialization.data(withJSONObject: list), let s = String(data: data, encoding: .utf8) {
            d.set(s, forKey: pendingKey)
        }
    }
}

func ymd(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}

func habitsOn(_ p: Payload?, _ day: String) -> [HabitDay] {
    guard let hab = p?.hab, let rows = hab.days[day] else { return [] }
    let byId = Dictionary(hab.list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    return rows.compactMap { r in
        guard r.count >= 3, let h = byId[r[0].str] else { return nil }
        return HabitDay(h: h, count: r[1].int, streak: r[2].int)
    }
}

/// Задачи на сегодня и просроченные: сначала просроченные, затем по времени
func tasksOn(_ p: Payload?, _ day: String) -> [WTask] {
    (p?.tasks ?? []).filter { ($0.d ?? "9999") <= day }
        .sorted { a, b in
            let ao = (a.d ?? "") < day, bo = (b.d ?? "") < day
            if ao != bo { return ao }
            return (a.tm ?? "99") < (b.tm ?? "99")
        }
}

func color(_ hex: String?, _ fallback: Color = .green) -> Color {
    guard let hex, hex.hasPrefix("#"), hex.count == 7, let v = Int(hex.dropFirst(), radix: 16) else { return fallback }
    return Color(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
}

func link(_ type: String, _ q: [String: String] = [:]) -> URL {
    var c = URLComponents()
    c.scheme = "supermind"
    c.host = type
    if !q.isEmpty { c.queryItems = q.map { URLQueryItem(name: $0.key, value: $0.value) } }
    return c.url ?? URL(string: "supermind://open")!
}

// MARK: - Действия в виджете (iOS 17+)

struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Выполнить задачу"
    static var isDiscoverable: Bool = false
    @Parameter(title: "Задача") var id: String
    @Parameter(title: "Дата") var date: String

    init() {}
    init(id: String, date: String) {
        self.id = id
        self.date = date
    }

    func perform() async throws -> some IntentResult {
        Store.push(["type": "complete", "id": id, "date": date])
        Store.edit { obj in
            if var tasks = obj["tasks"] as? [[String: Any]] {
                tasks.removeAll { ($0["id"] as? String) == id }
                obj["tasks"] = tasks
            }
        }
        return .result()
    }
}

struct HabitIntent: AppIntent {
    static var title: LocalizedStringResource = "Отметить привычку"
    static var isDiscoverable: Bool = false
    @Parameter(title: "Привычка") var id: String
    @Parameter(title: "Дата") var date: String
    @Parameter(title: "Значение") var n: Int

    init() {}
    init(id: String, date: String, n: Int) {
        self.id = id
        self.date = date
        self.n = n
    }

    func perform() async throws -> some IntentResult {
        Store.push(["type": "habit", "id": id, "date": date, "n": n])
        Store.edit { obj in
            guard var hab = obj["hab"] as? [String: Any], var days = hab["days"] as? [String: Any],
                  var rows = days[date] as? [[Any]] else { return }
            for i in rows.indices where (rows[i].first as? String) == id && rows[i].count >= 2 {
                rows[i][1] = n
            }
            days[date] = rows
            hab["days"] = days
            obj["hab"] = hab
        }
        return .result()
    }
}

// MARK: - Таймлайн

struct Entry: TimelineEntry {
    let date: Date
    let payload: Payload?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), payload: nil) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), payload: Store.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let now = Date()
        let payload = Store.load()
        // обновить после полуночи: «сегодня» виджет считает сам
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400)).addingTimeInterval(60)
        completion(Timeline(entries: [Entry(date: now, payload: payload)], policy: .after(min(midnight, now.addingTimeInterval(3 * 3600)))))
    }
}

// MARK: - Вид

struct HabitButton: View {
    let d: HabitDay
    let day: String
    var compact = false
    var en = false

    var body: some View {
        let next = d.done ? (d.target > 1 ? max(0, d.count - 1) : 0) : d.count + 1
        Button(intent: HabitIntent(id: d.h.id, date: day, n: next)) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().stroke(color(d.h.c).opacity(0.3), lineWidth: 3)
                    Circle().trim(from: 0, to: CGFloat(min(d.count, d.target)) / CGFloat(d.target))
                        .stroke(color(d.h.c), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    Text(d.h.e?.isEmpty == false ? d.h.e! : (d.done ? "✓" : ""))
                        .font(.system(size: 13))
                }
                .frame(width: 26, height: 26)
                if !compact {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(d.h.n).font(.system(size: 13, weight: .medium)).lineLimit(1)
                            .strikethrough(d.done && d.target == 1, color: .secondary)
                            .foregroundStyle(d.done ? .secondary : .primary)
                        if d.target > 1 {
                            Text("\(d.count) \(L(en, "из", "of")) \(d.target)\(d.h.u.map { " " + $0 } ?? "")").font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

struct TaskRow: View {
    let t: WTask
    let day: String
    var en = false

    var body: some View {
        HStack(spacing: 8) {
            Button(intent: CompleteTaskIntent(id: t.id, date: t.d ?? day)) {
                Image(systemName: "circle")
                    .font(.system(size: 17))
                    .foregroundStyle(t.p == 1 ? Color.red : t.p == 2 ? Color.orange : Color.secondary)
            }
            .buttonStyle(.plain)
            Link(destination: link("open_task", ["id": t.id])) {
                HStack(spacing: 4) {
                    Text(t.t).font(.system(size: 13)).lineLimit(1)
                    Spacer(minLength: 0)
                    if let d = t.d, d < day {
                        Text(L(en, "просрочено", "overdue")).font(.system(size: 10)).foregroundStyle(.red)
                    } else if let tm = t.tm {
                        Text(tm).font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

struct TodayView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let day = ymd(entry.date)
        let tasks = tasksOn(entry.payload, day)
        let habits = habitsOn(entry.payload, day)
        let doneH = habits.filter(\.done).count
        let en = isEn(entry.payload)
        switch family {
        case .accessoryInline:
            Label(tasks.isEmpty ? L(en, "Задач нет", "No tasks") : count(tasks.count, en, "задача", "задачи", "задач", "task", "tasks"), systemImage: "checkmark.circle")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text("\(tasks.count)").font(.system(size: 22, weight: .bold)).minimumScaleFactor(0.6)
                    Text(L(en, "задачи", "tasks")).font(.system(size: 9)).lineLimit(1)
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(L(en, "Сегодня", "Today")).font(.headline).widgetAccentable()
                if tasks.isEmpty {
                    Text(entry.payload == nil ? L(en, "Откройте SuperMind", "Open SuperMind") : L(en, "Задач нет 🎉", "No tasks 🎉")).font(.caption)
                }
                ForEach(tasks.prefix(2), id: \.self) { t in
                    Text("○ " + t.t).font(.caption).lineLimit(1)
                }
                if tasks.count > 2 {
                    Text(L(en, "ещё \(tasks.count - 2)", "+\(tasks.count - 2) more")).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            home(day: day, tasks: tasks, habits: habits, doneH: doneH, en: en)
        }
    }

    @ViewBuilder
    func home(day: String, tasks: [WTask], habits: [HabitDay], doneH: Int, en: Bool) -> some View {
        let maxTasks = family == .systemLarge ? 7 : family == .systemMedium ? 3 : 2
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(L(en, "Сегодня", "Today")).font(.system(size: 15, weight: .bold))
                Spacer()
                if !habits.isEmpty {
                    Text(L(en, "привычки", "habits") + " \(doneH)/\(habits.count)").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if family != .systemSmall {
                    Link(destination: link("quick_add")) {
                        Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(Color.accentColor)
                    }
                }
            }
            if entry.payload == nil {
                Text(L(en, "Откройте SuperMind, чтобы виджет показал ваш день", "Open SuperMind to see your day here")).font(.system(size: 12)).foregroundStyle(.secondary)
            } else if tasks.isEmpty {
                Text(L(en, "На сегодня задач нет 🎉", "Nothing due today 🎉")).font(.system(size: 12)).foregroundStyle(.secondary)
            }
            ForEach(tasks.prefix(maxTasks), id: \.self) { t in
                TaskRow(t: t, day: day, en: en)
            }
            if tasks.count > maxTasks {
                Text(L(en, "ещё \(tasks.count - maxTasks)", "+\(tasks.count - maxTasks) more")).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            if family != .systemSmall && !habits.isEmpty {
                HStack(spacing: 8) {
                    ForEach(habits.prefix(family == .systemLarge ? 8 : 6), id: \.self) { h in
                        HabitButton(d: h, day: day, compact: true, en: en)
                    }
                }
                .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
    }
}

struct HabitsView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let day = ymd(entry.date)
        let habits = habitsOn(entry.payload, day)
        let doneH = habits.filter(\.done).count
        let en = isEn(entry.payload)
        switch family {
        case .accessoryInline:
            Label(L(en, "Привычки", "Habits") + " \(doneH)/\(habits.count)", systemImage: "flame")
        case .accessoryCircular:
            Gauge(value: Double(doneH), in: 0...Double(max(1, habits.count))) {
                Image(systemName: "flame")
            } currentValueLabel: {
                Text("\(doneH)/\(habits.count)")
            }
            .gaugeStyle(.accessoryCircularCapacity)
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(L(en, "Привычки", "Habits") + " \(doneH)/\(habits.count)").font(.headline).widgetAccentable()
                if habits.isEmpty {
                    Text(entry.payload == nil ? L(en, "Откройте SuperMind", "Open SuperMind") : L(en, "На сегодня привычек нет", "No habits today")).font(.caption)
                }
                ForEach(habits.prefix(3), id: \.self) { h in
                    Text((h.done ? "✓ " : "○ ") + h.h.n).font(.caption).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            home(day: day, habits: habits, doneH: doneH, en: en)
        }
    }

    @ViewBuilder
    func home(day: String, habits: [HabitDay], doneH: Int, en: Bool) -> some View {
        let cap = family == .systemLarge ? 10 : family == .systemMedium ? 4 : 3
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(L(en, "Привычки", "Habits")).font(.system(size: 15, weight: .bold))
                Spacer()
                Text("\(doneH)/\(habits.count)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            }
            if habits.isEmpty {
                Text(entry.payload == nil ? L(en, "Откройте SuperMind, чтобы виджет показал привычки", "Open SuperMind to see your habits here") : L(en, "На сегодня привычек нет", "No habits today"))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            if family == .systemMedium {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 6) {
                    ForEach(habits.prefix(cap), id: \.self) { h in HabitButton(d: h, day: day, en: en) }
                }
            } else {
                ForEach(habits.prefix(cap), id: \.self) { h in HabitButton(d: h, day: day, en: en) }
            }
            if habits.count > cap {
                Text(L(en, "ещё \(habits.count - cap)", "+\(habits.count - cap) more")).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Виджеты

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SuperMindToday", provider: Provider()) { entry in
            TodayView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(link("open_view", ["view": "today"]))
        }
        .configurationDisplayName(L(systemEn, "Сегодня", "Today"))
        .description(L(systemEn, "Задачи и привычки на сегодня: отмечайте прямо на экране «Домой».", "Today's tasks and habits: check them off right from your Home Screen."))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct HabitsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SuperMindHabits", provider: Provider()) { entry in
            HabitsView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(link("open_view", ["view": "habits"]))
        }
        .configurationDisplayName(L(systemEn, "Привычки", "Habits"))
        .description(L(systemEn, "Привычки на сегодня: касание — отметка.", "Today's habits: tap to check one off."))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

/// Кнопка на экране блокировки: одно касание — сразу в нужное место приложения
struct ActionButtonView: View {
    let symbol: String
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: symbol).font(.system(size: 24, weight: .semibold))
        }
    }
}

struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SuperMindQuickAdd", provider: Provider()) { _ in
            ActionButtonView(symbol: "plus")
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(link("quick_add"))
        }
        .configurationDisplayName(L(systemEn, "Новая задача", "New task"))
        .description(L(systemEn, "Добавить задачу с экрана блокировки.", "Add a task from your Lock Screen."))
        .supportedFamilies([.accessoryCircular])
    }
}

struct VoiceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SuperMindVoice", provider: Provider()) { _ in
            ActionButtonView(symbol: "mic.fill")
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(link("voice"))
        }
        .configurationDisplayName(L(systemEn, "Голосом", "By voice"))
        .description(L(systemEn, "Голосовая команда: задача, трата, заметка.", "Voice command: a task, an expense or a note."))
        .supportedFamilies([.accessoryCircular])
    }
}

// MARK: - Таймер фокуса (Live Activity)

func focusTint(_ s: FocusAttributes.ContentState) -> Color {
    s.stopwatch ? .orange : s.phase == "work" ? .purple : .green
}

func clock(_ sec: Double) -> String {
    let t = max(0, Int(sec))
    let h = t / 3600, m = (t % 3600) / 60, s = t % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
}

struct FocusClock: View {
    let s: FocusAttributes.ContentState
    var body: some View {
        if s.running, s.stopwatch, let start = s.start {
            Text(start, style: .timer)
        } else if s.running, let end = s.endAt {
            Text(timerInterval: Date()...max(end, Date()), countsDown: true)
        } else {
            Text(clock(s.stopwatch ? (s.elapsed ?? 0) : (s.left ?? 0)))
        }
    }
}

struct FocusButtons: View {
    let s: FocusAttributes.ContentState
    let a: FocusAttributes
    var body: some View {
        HStack(spacing: 8) {
            Button(intent: FocusControlIntent(action: s.running ? "pause" : "resume")) {
                Label(s.running ? a.pauseLabel : a.resumeLabel, systemImage: s.running ? "pause.fill" : "play.fill")
                    .labelStyle(.iconOnly)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .background(Circle().fill(Color.white.opacity(0.18)))
            Button(intent: FocusControlIntent(action: "stop")) {
                Label(a.stopLabel, systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .background(Circle().fill(Color.white.opacity(0.18)))
        }
    }
}

struct FocusProgress: View {
    let s: FocusAttributes.ContentState
    var body: some View {
        if !s.stopwatch, s.total > 0 {
            if s.running, let end = s.endAt {
                ProgressView(timerInterval: end.addingTimeInterval(-s.total)...max(end, end.addingTimeInterval(-s.total + 1)), countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
            } else {
                ProgressView(value: min(1, max(0, (s.total - (s.left ?? s.total)) / s.total)))
            }
        }
    }
}

struct FocusLiveWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusAttributes.self) { ctx in
            let s = ctx.state
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: s.stopwatch ? "stopwatch" : "timer")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(focusTint(s))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.running ? s.title : s.title + " · " + ctx.attributes.pausedLabel).font(.headline).lineLimit(1)
                        if let task = s.task, !task.isEmpty {
                            Text(task).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 4)
                    FocusClock(s: s)
                        .font(.system(size: 30, weight: .semibold).monospacedDigit())
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 120, alignment: .trailing)
                    FocusButtons(s: s, a: ctx.attributes)
                }
                FocusProgress(s: s).tint(focusTint(s))
            }
            .padding(16)
            .widgetURL(link("open_view", ["view": "focus"]))
        } dynamicIsland: { ctx in
            let s = ctx.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(s.title, systemImage: s.stopwatch ? "stopwatch" : "timer")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(focusTint(s))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    FocusClock(s: s)
                        .font(.title2.weight(.semibold).monospacedDigit())
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 110, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(s.task ?? (s.running ? "" : ctx.attributes.pausedLabel)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        FocusButtons(s: s, a: ctx.attributes)
                    }
                }
            } compactLeading: {
                Image(systemName: s.stopwatch ? "stopwatch" : "timer").foregroundStyle(focusTint(s))
            } compactTrailing: {
                FocusClock(s: s)
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: s.stopwatch ? "stopwatch" : "timer").foregroundStyle(focusTint(s))
            }
            .widgetURL(link("open_view", ["view": "focus"]))
        }
    }
}

@main
struct SuperMindWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        HabitsWidget()
        QuickAddWidget()
        VoiceWidget()
        FocusLiveWidget()
        FinanceWidget()
        FocusWidget()
        if #available(iOS 18.0, *) {
            SmNewTaskControl()
            SmVoiceControl()
            SmFocusControl()
        }
    }
}
