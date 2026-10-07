package app.twomind.mindmap;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Виджет «SuperMind — Календарь»: полоса недели и повестка на две недели —
 * задачи (со временем и на весь день), сроки целей 🎯 и события календаря телефона.
 * Список прокручивается (RemoteViewsService); нажатие открывает задачу, цель или календарь.
 */
public class CalendarWidget extends AppWidgetProvider {

    static final int DAYS = 14;

    /** Строка повестки: 0 — заголовок дня, 1 — пункт, 2 — «свободно» */
    static final class Item {
        int type;
        String kind = "", id, title = "", day, time = "", end = "", emoji = "";
        int color;
        boolean past;
    }

    // ---------- Данные ----------

    /** Пункты повестки с сегодняшнего дня (из agenda; для старых данных — из tasks) */
    static List<Item> items(Context ctx, JSONObject data, String today) {
        List<Item> out = new ArrayList<>();
        if (data == null) return out;
        String last = SmWidgets.addDays(today, DAYS - 1);
        Set<String> hidden = TodayWidget.hiddenIds(ctx);
        JSONArray agenda = data.optJSONArray("agenda");
        boolean legacy = agenda == null;
        if (legacy) agenda = data.optJSONArray("tasks");
        if (agenda == null) return out;
        int accent = ctx.getColor(R.color.widget_accent);
        for (int i = 0; i < agenda.length(); i++) {
            JSONObject o = agenda.optJSONObject(i);
            if (o == null) continue;
            Item it = new Item();
            it.type = 1;
            it.kind = legacy ? "t" : o.optString("k", "t");
            it.id = o.optString("id", null);
            it.day = o.optString("d");
            if (it.day.length() != 10 || it.day.compareTo(today) < 0 || it.day.compareTo(last) > 0) continue;
            if ("t".equals(it.kind) && it.id != null && hidden.contains(it.id) && it.day.compareTo(today) <= 0) continue;
            it.title = o.optString("t");
            it.time = o.optString("tm", "");
            it.end = o.optString("te", "");
            it.emoji = o.optString("e", "");
            int[] pc = { accent, 0xFFEF4444, 0xFFF59E0B, 0xFF3B82F6 };
            int p = o.optInt("p", 0);
            it.color = SmWidgets.parseColor(o.optString("c", null), legacy && p >= 1 && p <= 3 ? pc[p] : "g".equals(it.kind) ? 0xFFF59E0B : accent);
            out.add(it);
        }
        return out;
    }

    /** Строки списка: заголовки дней и пункты; сегодня показывается всегда */
    static List<Item> rows(Context ctx) {
        List<Item> rows = new ArrayList<>();
        JSONObject data = SmWidgets.data(ctx);
        if (data == null) return rows;
        Calendar now = Calendar.getInstance();
        String today = SmWidgets.ymd(now);
        int nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        List<Item> items = items(ctx, data, today);
        // agenda уже отсортирована по дню и времени; для старых данных — тоже по дню
        String cur = null;
        boolean todayShown = false;
        for (Item it : items) {
            if (!it.day.equals(cur)) {
                if (!todayShown && it.day.compareTo(today) > 0) {
                    rows.add(header(today, today));
                    rows.add(free());
                    todayShown = true;
                }
                cur = it.day;
                rows.add(header(it.day, today));
                if (it.day.equals(today)) todayShown = true;
            }
            if (it.day.equals(today) && !it.time.isEmpty()) {
                int end = it.end.isEmpty() ? SmWidgets.minutesOf(it.time) + 30 : SmWidgets.minutesOf(it.end);
                it.past = end <= nowMin;
            }
            rows.add(it);
        }
        if (!todayShown) {
            rows.add(0, header(today, today));
            rows.add(1, free());
        }
        return rows;
    }

    private static Item header(String day, String today) {
        Item h = new Item();
        h.type = 0;
        h.day = day;
        Calendar c = SmWidgets.parseYmd(day);
        if (day.equals(today)) h.title = "Сегодня · " + SmWidgets.fmt("EE, d MMM", c);
        else if (day.equals(SmWidgets.addDays(today, 1))) h.title = "Завтра · " + SmWidgets.fmt("EE, d MMM", c);
        else h.title = SmWidgets.cap(SmWidgets.fmt("EEEE, d MMM", c));
        return h;
    }

    private static Item free() {
        Item f = new Item();
        f.type = 2;
        f.title = "Ничего не запланировано";
        return f;
    }

    // ---------- Жизненный цикл ----------

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
        m.notifyAppWidgetViewDataChanged(ids, R.id.w_cal_list);
        SmWidgets.scheduleMidnight(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle opts) {
        render(ctx, m, id);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, CalendarWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) render(ctx, m, id);
        m.notifyAppWidgetViewDataChanged(ids, R.id.w_cal_list);
    }

    // ---------- Отрисовка ----------

    static void render(Context ctx, AppWidgetManager m, int wid) {
        String pkg = ctx.getPackageName();
        RemoteViews rv = new RemoteViews(pkg, R.layout.widget_calendar);
        Calendar now = Calendar.getInstance();
        String today = SmWidgets.ymd(now);
        JSONObject data = SmWidgets.data(ctx);
        List<Item> items = items(ctx, data, today);

        rv.setTextViewText(R.id.w_cal_title, SmWidgets.cap(SmWidgets.fmt("LLLL", now)));
        int todayCount = 0;
        Set<String> busy = new HashSet<>();
        for (Item it : items) {
            busy.add(it.day);
            if (it.day.equals(today)) todayCount++;
        }
        rv.setTextViewText(R.id.w_cal_sub, data == null ? SmWidgets.cap(SmWidgets.fmt("EEEE, d MMMM", now))
            : todayCount == 0 ? "Сегодня свободно"
            : "Сегодня " + todayCount + " " + HabitsWidget.plural(todayCount, "дело", "дела", "дел"));

        // полоса недели (с понедельника); на низком виджете — скрыта
        int[] size = SmWidgets.sizeDp(m, wid, 250, 250);
        boolean week = size[1] >= 260;
        rv.setViewVisibility(R.id.w_cal_week, week ? View.VISIBLE : View.GONE);
        rv.removeAllViews(R.id.w_cal_week);
        if (week) {
            Calendar c = (Calendar) now.clone();
            int dow = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7; // пн = 0
            c.add(Calendar.DAY_OF_MONTH, -dow);
            PendingIntent openCal = SmWidgets.activityIntent(ctx, 40, "open_view", null, "calendar");
            for (int i = 0; i < 7; i++) {
                String d = SmWidgets.ymd(c);
                boolean isToday = d.equals(today);
                RemoteViews cell = new RemoteViews(pkg, R.layout.widget_cal_day);
                cell.setTextViewText(R.id.w_cd_wd, SmWidgets.fmt("EE", c).toUpperCase(SmWidgets.RU));
                cell.setTextViewText(R.id.w_cd_num, String.valueOf(c.get(Calendar.DAY_OF_MONTH)));
                cell.setViewVisibility(R.id.w_cd_dot, busy.contains(d) ? View.VISIBLE : View.INVISIBLE);
                if (isToday) {
                    cell.setInt(R.id.w_cd, "setBackgroundResource", R.drawable.widget_today_mark);
                    SmWidgets.textColor(ctx, cell, R.id.w_cd_wd, R.color.widget_on_accent);
                    SmWidgets.textColor(ctx, cell, R.id.w_cd_num, R.color.widget_on_accent);
                    SmWidgets.textColor(ctx, cell, R.id.w_cd_dot, R.color.widget_on_accent);
                } else if (d.compareTo(today) < 0) {
                    SmWidgets.textColor(ctx, cell, R.id.w_cd_num, R.color.widget_text2);
                }
                cell.setOnClickPendingIntent(R.id.w_cd, openCal);
                rv.addView(R.id.w_cal_week, cell);
                c.add(Calendar.DAY_OF_MONTH, 1);
            }
        }

        // прокручиваемая повестка
        Intent svc = new Intent(ctx, CalendarWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid);
        svc.setData(Uri.parse("supermind-widget://calendar/" + wid));
        rv.setRemoteAdapter(R.id.w_cal_list, svc);
        rv.setEmptyView(R.id.w_cal_list, R.id.w_cal_empty);
        rv.setTextViewText(R.id.w_cal_empty, "Откройте SuperMind, чтобы увидеть планы");

        Intent tpl = new Intent(ctx, MainActivity.class);
        tpl.setAction("app.twomind.mindmap.widget.calendar_item");
        tpl.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int mut = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        rv.setPendingIntentTemplate(R.id.w_cal_list, PendingIntent.getActivity(ctx, 41, tpl, PendingIntent.FLAG_UPDATE_CURRENT | mut));

        rv.setOnClickPendingIntent(R.id.w_cal_header, SmWidgets.activityIntent(ctx, 40, "open_view", null, "calendar"));
        rv.setOnClickPendingIntent(R.id.w_cal_empty, SmWidgets.activityIntent(ctx, 40, "open_view", null, "calendar"));
        rv.setOnClickPendingIntent(R.id.w_cal_add, SmWidgets.activityIntent(ctx, 1, "quick_add", null, null));
        m.updateAppWidget(wid, rv);
    }

    /** Строка списка (вызывается фабрикой RemoteViewsService) */
    static RemoteViews rowView(Context ctx, Item it, String today) {
        String pkg = ctx.getPackageName();
        Intent fill = new Intent();
        if (it.type == 0) {
            RemoteViews v = new RemoteViews(pkg, R.layout.widget_cal_dayhead);
            v.setTextViewText(R.id.w_ch, it.title);
            SmWidgets.textColor(ctx, v, R.id.w_ch, it.day.equals(today) ? R.color.widget_accent : R.color.widget_text);
            fill.putExtra(TodayWidget.EXTRA_ACTION, "open_view");
            fill.putExtra("sm_view", "calendar");
            v.setOnClickFillInIntent(R.id.w_ch, fill);
            return v;
        }
        if (it.type == 2) {
            RemoteViews v = new RemoteViews(pkg, R.layout.widget_cal_free);
            v.setTextViewText(R.id.w_cf, it.title);
            fill.putExtra(TodayWidget.EXTRA_ACTION, "quick_add");
            v.setOnClickFillInIntent(R.id.w_cf, fill);
            return v;
        }
        RemoteViews v = new RemoteViews(pkg, R.layout.widget_cal_item);
        v.setTextViewText(R.id.w_ci_title, "g".equals(it.kind) ? it.emoji + " " + it.title : it.title);
        SmWidgets.textColor(ctx, v, R.id.w_ci_title, it.past ? R.color.widget_text2 : R.color.widget_text);
        v.setInt(R.id.w_ci_bar, "setColorFilter", it.color);
        if (!it.time.isEmpty()) {
            v.setTextViewText(R.id.w_ci_time, it.time);
            v.setTextViewText(R.id.w_ci_end, it.end);
            v.setViewVisibility(R.id.w_ci_end, it.end.isEmpty() ? View.GONE : View.VISIBLE);
        } else {
            v.setTextViewText(R.id.w_ci_time, "Весь");
            v.setTextViewText(R.id.w_ci_end, "день");
            v.setViewVisibility(R.id.w_ci_end, View.VISIBLE);
        }
        String sub = "g".equals(it.kind) ? "Срок цели" : "e".equals(it.kind) ? "Календарь телефона" : "";
        v.setTextViewText(R.id.w_ci_sub, sub);
        v.setViewVisibility(R.id.w_ci_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
        if ("t".equals(it.kind) && it.id != null) {
            fill.putExtra(TodayWidget.EXTRA_ACTION, "open_task");
            fill.putExtra("sm_id", it.id);
        } else if ("g".equals(it.kind) && it.id != null) {
            fill.putExtra(TodayWidget.EXTRA_ACTION, "open_goal");
            fill.putExtra("sm_id", it.id);
        } else {
            fill.putExtra(TodayWidget.EXTRA_ACTION, "open_view");
            fill.putExtra("sm_view", "calendar");
        }
        v.setOnClickFillInIntent(R.id.w_ci, fill);
        return v;
    }
}
