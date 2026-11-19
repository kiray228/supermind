import SwiftUI
import WidgetKit

// Виджет «Финансы» (экран «Домой», малый и средний): траты сегодня и за месяц, бюджет месяца, кнопка «+ Трата».
// Суммы считает и форматирует приложение (src/native/widgetCore.ts → поле fin общего JSON виджетов);
// день и месяц в данных — чтобы после полуночи не показывать вчерашние траты как сегодняшние.

struct WFin: Codable {
    let d: String
    let m: String
    let cur: String
    let td: Double
    let mo: Double
    let tds: String
    let mos: String
    let zs: String?
    let lim: Double?
    let lims: String?
    let p: Double?
    let lfs: String?
    let over: Int?
    let lv: String?
}

struct FinPayload: Codable {
    var fin: WFin?
    var lang: String?
}

struct FinEntry: TimelineEntry {
    let date: Date
    let payload: FinPayload?
}

struct FinProvider: TimelineProvider {
    static func load() -> FinPayload? {
        guard let raw = Store.defaults?.string(forKey: dataKey) else { return nil }
        return try? JSONDecoder().decode(FinPayload.self, from: Data(raw.utf8))
    }

    func placeholder(in context: Context) -> FinEntry { FinEntry(date: Date(), payload: nil) }

    func getSnapshot(in context: Context, completion: @escaping (FinEntry) -> Void) {
        completion(FinEntry(date: Date(), payload: Self.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FinEntry>) -> Void) {
        let now = Date()
        // после полуночи — «сегодня» с нуля
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400)).addingTimeInterval(60)
        completion(Timeline(entries: [FinEntry(date: now, payload: Self.load())], policy: .after(min(midnight, now.addingTimeInterval(3 * 3600)))))
    }
}

struct FinanceView: View {
    @Environment(\.widgetFamily) var family
    let entry: FinEntry

    var body: some View {
        let l = WidgetLang.of(entry.payload?.lang)
        let fin = entry.payload?.fin
        let day = ymd(entry.date)
        let sameDay = fin?.d == day
        let sameMonth = fin?.m == String(day.prefix(7))
        let zero = fin?.zs ?? "0"
        let today = fin.map { sameDay ? $0.tds : zero } ?? "—"
        let month = fin.map { sameMonth ? $0.mos : zero } ?? "—"
        if family == .systemMedium {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    header(l)
                    Spacer(minLength: 0)
                    Text(L(l, "Сегодня", "Today", "Бүгін")).font(.system(size: 12)).foregroundStyle(.secondary)
                    amount(today, size: 26)
                    Text(L(l, "Этот месяц", "This month", "Осы ай") + ": " + month)
                        .font(.system(size: 12, weight: .medium)).lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 6) {
                    Spacer(minLength: 0)
                    budget(fin, sameMonth: sameMonth, l: l)
                    Link(destination: link("add_expense")) {
                        Label(L(l, "Трата", "Expense", "Шығын"), systemImage: "plus")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 34)
                            .background(Capsule().fill(Color.accentColor))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            // малый виджет нажимается целиком — сразу новая трата
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    header(l)
                    Spacer(minLength: 0)
                    Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(Color.accentColor)
                }
                Spacer(minLength: 0)
                Text(L(l, "Сегодня", "Today", "Бүгін")).font(.system(size: 11)).foregroundStyle(.secondary)
                amount(today, size: 22)
                Text(L(l, "Месяц", "Month", "Ай") + ": " + month)
                    .font(.system(size: 11, weight: .medium)).lineLimit(1).minimumScaleFactor(0.7)
                if fin?.lim != nil {
                    budget(fin, sameMonth: sameMonth, l: l, compact: true)
                }
            }
        }
    }

    func header(_ l: WidgetLang) -> some View {
        Label(L(l, "Финансы", "Finance", "Қаржы"), systemImage: "creditcard.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }

    func amount(_ s: String, size: CGFloat) -> some View {
        Text(s)
            .font(.system(size: size, weight: .bold).monospacedDigit())
            .lineLimit(1)
            .minimumScaleFactor(0.45)
    }

    @ViewBuilder
    func budget(_ fin: WFin?, sameMonth: Bool, l: WidgetLang, compact: Bool = false) -> some View {
        if let fin, let lims = fin.lims {
            let p = sameMonth ? (fin.p ?? 0) : 0
            let over = sameMonth && fin.over == 1
            let tint: Color = over || (sameMonth && fin.lv == "over") ? .red : (sameMonth && fin.lv == "warn") ? .orange : .green
            VStack(alignment: .leading, spacing: 3) {
                if !compact {
                    Text(L(l, "Бюджет", "Budget", "Бюджет") + " · " + lims).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
                ProgressView(value: min(1, max(0, p))).tint(tint)
                let left = sameMonth ? (fin.lfs ?? lims) : lims
                Text(over ? L(l, "Перерасход \(left)", "\(left) over budget", "Бюджеттен \(left) асып кетті") : L(l, "Осталось \(left)", "\(left) left", "\(left) қалды"))
                    .font(.system(size: compact ? 10 : 11, weight: .medium))
                    .foregroundStyle(over ? Color.red : Color.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        } else if !compact {
            Text(fin == nil ? L(l, "Откройте SuperMind, чтобы увидеть траты", "Open SuperMind to see your spending", "Шығындарды көру үшін SuperMind-ты ашыңыз") : L(l, "Бюджет на месяц не задан", "No monthly budget", "Айлық бюджет белгіленбеген"))
                .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
        }
    }
}

struct FinanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SuperMindFinance", provider: FinProvider()) { entry in
            FinanceViewHost(entry: entry)
        }
        .configurationDisplayName(L(WidgetLang.system, "Финансы", "Finance", "Қаржы"))
        .description(L(WidgetLang.system, "Траты за сегодня и месяц, бюджет и быстрая новая трата.", "Today's and this month's spending, your budget and a quick new expense.", "Бүгінгі және осы айғы шығындар, бюджет және жаңа шығынды жылдам қосу."))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// Малый виджет — касание открывает новую трату, средний — раздел «Финансы» (кнопка «+ Трата» — отдельно)
struct FinanceViewHost: View {
    @Environment(\.widgetFamily) var family
    let entry: FinEntry

    var body: some View {
        FinanceView(entry: entry)
            .containerBackground(.fill.tertiary, for: .widget)
            .widgetURL(family == .systemSmall ? link("add_expense") : link("open_view", ["view": "finance"]))
    }
}
