import AppIntents
import SwiftUI
import WidgetKit

// Виджеты SuperMind для iPhone: «Сегодня» (задачи и привычки дня) и «Привычки».
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
                            Text("\(d.count) из \(d.target)\(d.h.u.map { " " + $0 } ?? "")").font(.system(size: 11)).foregroundStyle(.secondary)
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
                        Text("просрочено").font(.system(size: 10)).foregroundStyle(.red)
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
        let maxTasks = family == .systemLarge ? 7 : family == .systemMedium ? 3 : 2
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Сегодня").font(.system(size: 15, weight: .bold))
                Spacer()
                if !habits.isEmpty {
                    Text("привычки \(doneH)/\(habits.count)").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if family != .systemSmall {
                    Link(destination: link("quick_add")) {
                        Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(Color.accentColor)
                    }
                }
            }
            if entry.payload == nil {
                Text("Откройте SuperMind, чтобы виджет показал ваш день").font(.system(size: 12)).foregroundStyle(.secondary)
            } else if tasks.isEmpty {
                Text("На сегодня задач нет 🎉").font(.system(size: 12)).foregroundStyle(.secondary)
            }
            ForEach(tasks.prefix(maxTasks), id: \.self) { t in
                TaskRow(t: t, day: day)
            }
            if tasks.count > maxTasks {
                Text("ещё \(tasks.count - maxTasks)").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            if family != .systemSmall && !habits.isEmpty {
                HStack(spacing: 8) {
                    ForEach(habits.prefix(family == .systemLarge ? 8 : 6), id: \.self) { h in
                        HabitButton(d: h, day: day, compact: true)
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
        let cap = family == .systemLarge ? 10 : family == .systemMedium ? 4 : 3
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Привычки").font(.system(size: 15, weight: .bold))
                Spacer()
                Text("\(doneH)/\(habits.count)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            }
            if habits.isEmpty {
                Text(entry.payload == nil ? "Откройте SuperMind, чтобы виджет показал привычки" : "На сегодня привычек нет")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            if family == .systemMedium {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 6) {
                    ForEach(habits.prefix(cap), id: \.self) { h in HabitButton(d: h, day: day) }
                }
            } else {
                ForEach(habits.prefix(cap), id: \.self) { h in HabitButton(d: h, day: day) }
            }
            if habits.count > cap {
                Text("ещё \(habits.count - cap)").font(.system(size: 11)).foregroundStyle(.secondary)
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
        .configurationDisplayName("Сегодня")
        .description("Задачи и привычки на сегодня: отмечайте прямо на экране «Домой».")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct HabitsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SuperMindHabits", provider: Provider()) { entry in
            HabitsView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(link("open_view", ["view": "habits"]))
        }
        .configurationDisplayName("Привычки")
        .description("Привычки на сегодня: касание — отметка.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct SuperMindWidgets: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        HabitsWidget()
    }
}
