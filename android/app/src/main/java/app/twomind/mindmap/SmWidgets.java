package app.twomind.mindmap;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/** Общее для всех виджетов SuperMind: данные, даты, интенты, обновление */
final class SmWidgets {
    private SmWidgets() {}

    static final Locale RU = Locale.forLanguageTag("ru");
    static final String ACTION_TICK = "app.twomind.mindmap.widget.TICK";

    /** Данные, которые прислало приложение (WidgetBridge.update) */
    static JSONObject data(Context ctx) {
        String raw = ctx.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE).getString("data", null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException e) {
            return null;
        }
    }

    static String ymd(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static Calendar parseYmd(String ymd) {
        Calendar c = Calendar.getInstance();
        try {
            c.clear();
            c.set(Integer.parseInt(ymd.substring(0, 4)), Integer.parseInt(ymd.substring(5, 7)) - 1, Integer.parseInt(ymd.substring(8, 10)));
        } catch (Exception ignored) {
        }
        return c;
    }

    static String addDays(String ymd, int n) {
        Calendar c = parseYmd(ymd);
        c.add(Calendar.DAY_OF_MONTH, n);
        return ymd(c);
    }

    static String cap(String s) {
        return s.isEmpty() ? s : s.substring(0, 1).toUpperCase(RU) + s.substring(1);
    }

    static String fmt(String pattern, Calendar c) {
        return new SimpleDateFormat(pattern, RU).format(c.getTime()).replace(".", "");
    }

    static int minutesOf(String hhmm) {
        try {
            String[] p = hhmm.split(":");
            return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]);
        } catch (Exception e) {
            return 0;
        }
    }

    static int parseColor(String c, int fallback) {
        if (c == null || c.isEmpty()) return fallback;
        try {
            if (c.length() == 4 && c.charAt(0) == '#') {
                c = "#" + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2) + c.charAt(3) + c.charAt(3);
            }
            return android.graphics.Color.parseColor(c);
        } catch (Exception e) {
            return fallback;
        }
    }

    /** Размер виджета в dp: ширина (портрет — минимальная) и высота (портрет — максимальная) */
    static int[] sizeDp(AppWidgetManager m, int wid, int defW, int defH) {
        Bundle o = m.getAppWidgetOptions(wid);
        int w = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) : 0;
        int h = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) : 0;
        return new int[] { w > 0 ? w : defW, h > 0 ? h : defH };
    }

    /**
     * Цвет текста из ресурса. На Android 12+ цвет берётся при показе виджета — он сам
     * переключается со светлой темой на тёмную; раньше — фиксируется при отрисовке.
     */
    static void textColor(Context ctx, android.widget.RemoteViews rv, int viewId, int colorRes) {
        if (android.os.Build.VERSION.SDK_INT >= 31) rv.setColorStateList(viewId, "setTextColor", colorRes);
        else rv.setTextColor(viewId, ctx.getColor(colorRes));
    }

    /** Открыть приложение с действием (как кнопки виджета «Сегодня») */
    static PendingIntent activityIntent(Context ctx, int req, String action, String id, String view) {
        Intent i = new Intent(ctx, MainActivity.class);
        // своё действие (не VIEW): Capacitor не принимает его за ссылку
        i.setAction("app.twomind.mindmap.widget." + action);
        i.putExtra(TodayWidget.EXTRA_ACTION, action);
        if (id != null) i.putExtra("sm_id", id);
        if (view != null) i.putExtra("sm_view", view);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Перерисовать все виджеты приложения */
    static void refreshAll(Context ctx) {
        TodayWidget.refreshAll(ctx);
        CalendarWidget.refreshAll(ctx);
        HabitsWidget.refreshAll(ctx);
        MapWidget.refreshAll(ctx);
        scheduleMidnight(ctx);
    }

    /** После полуночи — перерисовать («сегодня» сменилось), даже если приложение не открывали */
    static void scheduleMidnight(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Calendar c = Calendar.getInstance();
            c.add(Calendar.DAY_OF_MONTH, 1);
            c.set(Calendar.HOUR_OF_DAY, 0);
            c.set(Calendar.MINUTE, 0);
            c.set(Calendar.SECOND, 30);
            c.set(Calendar.MILLISECOND, 0);
            Intent i = new Intent(ctx, TodayWidget.class).setAction(ACTION_TICK);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 7, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.set(AlarmManager.RTC, c.getTimeInMillis(), pi);
        } catch (Exception ignored) {
        }
    }
}
