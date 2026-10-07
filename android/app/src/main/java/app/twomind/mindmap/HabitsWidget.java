package app.twomind.mindmap;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Виджет «SuperMind — Привычки»: привычки на сегодня крупными строками (эмодзи, серия, счётчик).
 * Нажатие на кружок отмечает привычку (счётчик — +1) сразу в виджете и ставит действие в очередь —
 * приложение применит его при запуске/возврате. Нажатие на строку открывает раздел «Привычки».
 */
public class HabitsWidget extends AppWidgetProvider {

    static final String ACTION_HABIT = "app.twomind.mindmap.widget.HABIT";

    static final class Row {
        String id, name, emoji, unit;
        int color, target, count, streak;
        boolean weeks;

        boolean done() {
            return count >= target;
        }
    }

    // ---------- Данные ----------

    /** Привычки на день с учётом ещё не применённых отметок; null — нет данных на этот день */
    static List<Row> rows(Context ctx, JSONObject data, String day) {
        JSONObject hab = data != null ? data.optJSONObject("hab") : null;
        if (hab == null) return null;
        JSONObject days = hab.optJSONObject("days");
        JSONArray list = days != null ? days.optJSONArray(day) : null;
        if (list == null) return null;
        Map<String, JSONObject> meta = new HashMap<>();
        JSONArray all = hab.optJSONArray("list");
        if (all != null) {
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.optJSONObject(i);
                if (o != null) meta.put(o.optString("id"), o);
            }
        }
        Map<String, Integer> ovr = TodayWidget.habitOverrides(ctx);
        List<Row> out = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            JSONArray a = list.optJSONArray(i);
            if (a == null) continue;
            JSONObject h = meta.get(a.optString(0));
            if (h == null) continue;
            Row r = new Row();
            r.id = a.optString(0);
            r.name = h.optString("n", "Привычка");
            r.emoji = h.optString("e", "");
            r.unit = h.optString("u", "");
            r.color = SmWidgets.parseColor(h.optString("c"), 0xFF22C55E);
            r.target = Math.max(1, h.optInt("tg", 1));
            r.count = a.optInt(1);
            r.streak = a.optInt(2);
            r.weeks = a.optInt(3) == 1;
            Integer o = ovr.get(day + "|" + r.id);
            if (o != null && o != r.count) {
                boolean was = r.done();
                r.count = Math.max(0, o);
                // серия по дням: отметка сегодня добавляет день, снятие — убирает
                if (!r.weeks && was != r.done()) r.streak = Math.max(0, r.streak + (r.done() ? 1 : -1));
            }
            out.add(r);
        }
        return out;
    }

    /** «Выполнено / всего» на день — для виджета «Сегодня»; null — нет подробных данных */
    static int[] progress(Context ctx, JSONObject data, String day) {
        List<Row> rows = rows(ctx, data, day);
        if (rows == null) return null;
        int done = 0;
        for (Row r : rows) if (r.done()) done++;
        return new int[] { done, rows.size() };
    }

    // ---------- Жизненный цикл ----------

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
        SmWidgets.scheduleMidnight(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle opts) {
        render(ctx, m, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ACTION_HABIT.equals(intent.getAction())) {
            String id = intent.getStringExtra("sm_id");
            String date = intent.getStringExtra("sm_date");
            if (id != null && date != null) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("type", "habit");
                    o.put("id", id);
                    o.put("date", date);
                    o.put("n", intent.getIntExtra("sm_n", 0));
                    TodayWidget.queue(ctx, o);
                } catch (JSONException ignored) {
                }
                refreshAll(ctx);
                TodayWidget.refreshAll(ctx);
                WidgetBridgePlugin.notifyPending();
            }
            return;
        }
        super.onReceive(ctx, intent);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, HabitsWidget.class));
        for (int id : ids) render(ctx, m, id);
    }

    // ---------- Отрисовка ----------

    static String plural(int n, String one, String few, String many) {
        int a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b == 1) return one;
        if (b >= 2 && b <= 4) return few;
        return many;
    }

    private static String subtitle(Row r) {
        StringBuilder sb = new StringBuilder();
        if (r.target > 1) {
            sb.append(Math.min(r.count, 999)).append(" из ").append(r.target);
            if (!r.unit.isEmpty()) sb.append(' ').append(r.unit);
        }
        if (r.streak > 0) {
            if (sb.length() > 0) sb.append("  ·  ");
            sb.append("🔥 ").append(r.streak).append(' ');
            sb.append(r.weeks ? plural(r.streak, "неделя", "недели", "недель") : plural(r.streak, "день", "дня", "дней"));
        }
        if (sb.length() == 0) sb.append(r.done() ? "Выполнено" : "Отметьте сегодня");
        return sb.toString();
    }

    static void render(Context ctx, AppWidgetManager m, int wid) {
        String pkg = ctx.getPackageName();
        RemoteViews rv = new RemoteViews(pkg, R.layout.widget_habits);
        Calendar now = Calendar.getInstance();
        String today = SmWidgets.ymd(now);
        JSONObject data = SmWidgets.data(ctx);
        List<Row> rows = rows(ctx, data, today);

        int done = 0, total = rows != null ? rows.size() : 0;
        if (rows != null) for (Row r : rows) if (r.done()) done++;

        rv.setTextViewText(R.id.w_hb_date, total > 0 && done == total ? "Всё выполнено 🎉" : SmWidgets.cap(SmWidgets.fmt("EEEE, d MMMM", now)));
        rv.setViewVisibility(R.id.w_hb_count, total > 0 ? View.VISIBLE : View.GONE);
        rv.setViewVisibility(R.id.w_hb_ring, total > 0 ? View.VISIBLE : View.GONE);
        if (total > 0) {
            rv.setTextViewText(R.id.w_hb_count, done + " из " + total);
            rv.setProgressBar(R.id.w_hb_ring, total, done, false);
        }

        int[] size = SmWidgets.sizeDp(m, wid, 250, 200);
        // две колонки — только на широком виджете (планшет, горизонтально): иначе названия не помещаются
        int cols = size[0] >= 400 ? 2 : 1;
        int avail = size[1] - 22 - 52 - 20;
        int fitRows = Math.max(1, avail / 58);
        int capacity = fitRows * cols;
        int n = rows == null ? 0 : rows.size();
        int shown = Math.min(n, capacity);
        // порядок постоянный (как в приложении) — строка не «уезжает» из-под пальца после отметки
        List<Row> order = rows != null ? rows : new ArrayList<Row>();

        rv.removeAllViews(R.id.w_hb_list);
        for (int i = 0; i < shown; i += cols) {
            RemoteViews line = new RemoteViews(pkg, R.layout.widget_habit_line);
            for (int c = 0; c < cols; c++) {
                int k = i + c;
                RemoteViews chip = new RemoteViews(pkg, R.layout.widget_habit_item);
                if (k < shown) fillChip(ctx, chip, order.get(k), today, wid, k);
                else chip.setViewVisibility(R.id.w_hb_chip, View.INVISIBLE);
                line.addView(R.id.w_hb_line, chip);
            }
            rv.addView(R.id.w_hb_list, line);
        }

        boolean empty = n == 0;
        rv.setViewVisibility(R.id.w_hb_empty, empty ? View.VISIBLE : View.GONE);
        if (empty) {
            rv.setTextViewText(R.id.w_hb_empty, data == null ? "Откройте SuperMind, чтобы увидеть привычки"
                : rows == null ? "Откройте SuperMind, чтобы обновить привычки" : "На сегодня привычек нет.\nНажмите, чтобы добавить");
        }
        int more = n - shown;
        rv.setViewVisibility(R.id.w_hb_more, more > 0 ? View.VISIBLE : View.GONE);
        if (more > 0) rv.setTextViewText(R.id.w_hb_more, "Ещё " + more + " →");

        PendingIntent open = SmWidgets.activityIntent(ctx, 30, "open_view", null, "habits");
        rv.setOnClickPendingIntent(R.id.w_hb_header, open);
        rv.setOnClickPendingIntent(R.id.w_hb_empty, open);
        rv.setOnClickPendingIntent(R.id.w_hb_more, open);
        m.updateAppWidget(wid, rv);
    }

    private static void fillChip(Context ctx, RemoteViews chip, Row r, String today, int wid, int k) {
        boolean done = r.done();
        chip.setInt(R.id.w_hb_icon_bg, "setColorFilter", r.color);
        chip.setInt(R.id.w_hb_icon_bg, "setImageAlpha", done ? 80 : 48);
        String glyph = !r.emoji.isEmpty() ? r.emoji : r.name.isEmpty() ? "•" : r.name.substring(0, r.name.offsetByCodePoints(0, 1)).toUpperCase(SmWidgets.RU);
        chip.setTextViewText(R.id.w_hb_emoji, glyph);
        chip.setTextColor(R.id.w_hb_emoji, r.color);
        chip.setTextViewText(R.id.w_hb_name, r.name);
        SmWidgets.textColor(ctx, chip, R.id.w_hb_name, done ? R.color.widget_text2 : R.color.widget_text);
        chip.setTextViewText(R.id.w_hb_sub, subtitle(r));

        boolean counter = r.target > 1;
        chip.setViewVisibility(R.id.w_hb_fill, done ? View.VISIBLE : View.GONE);
        chip.setViewVisibility(R.id.w_hb_tick, done ? View.VISIBLE : View.GONE);
        chip.setViewVisibility(R.id.w_hb_check_ring, !done && (!counter || r.count == 0) ? View.VISIBLE : View.GONE);
        chip.setViewVisibility(R.id.w_hb_prog, !done && counter && r.count > 0 ? View.VISIBLE : View.GONE);
        chip.setViewVisibility(R.id.w_hb_cnt, !done && counter ? View.VISIBLE : View.GONE);
        if (done) chip.setInt(R.id.w_hb_fill, "setColorFilter", r.color);
        else {
            chip.setInt(R.id.w_hb_check_ring, "setColorFilter", r.color);
            if (counter) {
                chip.setTextViewText(R.id.w_hb_cnt, r.count == 0 ? "+" : String.valueOf(r.count));
                chip.setTextColor(R.id.w_hb_cnt, r.color);
                chip.setProgressBar(R.id.w_hb_prog, r.target, Math.min(r.count, r.target), false);
                if (Build.VERSION.SDK_INT >= 31) chip.setColorStateList(R.id.w_hb_prog, "setProgressTintList", ColorStateList.valueOf(r.color));
            }
        }
        int next = counter ? (done ? 0 : r.count + 1) : (done ? 0 : 1);
        chip.setOnClickPendingIntent(R.id.w_hb_btn, toggleIntent(ctx, r.id, today, next));
        chip.setContentDescription(R.id.w_hb_btn, (done ? "Снять отметку: " : counter ? "Плюс один: " : "Отметить: ") + r.name);
        chip.setOnClickPendingIntent(R.id.w_hb_chip, SmWidgets.activityIntent(ctx, 31, "open_view", null, "habits"));
    }

    private static PendingIntent toggleIntent(Context ctx, String id, String date, int n) {
        Intent i = new Intent(ctx, HabitsWidget.class);
        i.setAction(ACTION_HABIT);
        i.setData(Uri.parse("supermind-widget://habit/" + date + "/" + Uri.encode(id)));
        i.putExtra("sm_id", id);
        i.putExtra("sm_date", date);
        i.putExtra("sm_n", n);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
