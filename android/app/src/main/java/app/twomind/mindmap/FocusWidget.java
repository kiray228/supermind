package app.twomind.mindmap;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Виджет «SuperMind — Фокус»: идущий таймер (обратный отсчёт помодоро или секундомер) с кнопками «Пауза/Продолжить» и «Стоп»;
 * в покое — «Фокус 25 мин» и «Начать» (открывает приложение и запускает таймер: {type:'focus', action:'start'}).
 * Состояние — то же, что у уведомления таймера (FocusLivePlugin), кнопки — те же (FocusLivePlugin.Receiver).
 */
public class FocusWidget extends AppWidgetProvider {
    static final String ACTION_TICK = "app.twomind.mindmap.focus.WIDGET_TICK";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ACTION_TICK.equals(intent.getAction())) {
            refreshAll(ctx);
            return;
        }
        super.onReceive(ctx, intent);
    }

    static void refreshAll(Context ctx) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(ctx);
            int[] ids = m.getAppWidgetIds(new ComponentName(ctx, FocusWidget.class));
            for (int id : ids) render(ctx, m, id);
            if (ids.length > 0) scheduleEnd(ctx);
        } catch (RuntimeException ignored) {
            // виджет необязателен
        }
    }

    /** Состояние таймера; null — не запущен (или фаза помодоро уже кончилась, а приложение не открывали) */
    static JSONObject state(Context ctx) {
        String raw = ctx.getSharedPreferences(FocusLivePlugin.PREFS, Context.MODE_PRIVATE).getString(FocusLivePlugin.KEY, null);
        if (raw == null) return null;
        try {
            JSONObject s = new JSONObject(raw);
            if (s.optBoolean("running") && !s.optBoolean("stopwatch") && s.optLong("endAt", 0) <= System.currentTimeMillis()) return null;
            return s;
        } catch (Exception e) {
            return null;
        }
    }

    static void render(Context ctx, AppWidgetManager m, int wid) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_focus);
        JSONObject s = state(ctx);
        long now = System.currentTimeMillis();
        if (s == null) {
            JSONObject data = SmWidgets.data(ctx);
            JSONObject idle = data != null ? data.optJSONObject("focus") : null;
            boolean sw = idle != null && idle.optInt("sw", 0) == 1;
            int min = idle != null ? Math.max(1, idle.optInt("min", 25)) : 25;
            rv.setTextViewText(R.id.w_fc_title, sw ? Lang.t(ctx, "Секундомер", "Stopwatch", "Секундомер") : Lang.str(ctx, R.string.w_focus_title));
            rv.setTextViewText(R.id.w_fc_sub, sw ? "" : Lang.t(ctx, "Фокус " + min + " мин", "Focus " + min + " min", "Фокус " + min + " мин"));
            rv.setViewVisibility(R.id.w_fc_sub, sw ? View.GONE : View.VISIBLE);
            rv.setViewVisibility(R.id.w_fc_chrono, View.GONE);
            rv.setViewVisibility(R.id.w_fc_clock, View.VISIBLE);
            rv.setTextViewText(R.id.w_fc_clock, sw ? "00:00" : String.format(java.util.Locale.ROOT, "%02d:00", min));
            rv.setViewVisibility(R.id.w_fc_stop, View.GONE);
            rv.setTextViewText(R.id.w_fc_main, "▶  " + Lang.str(ctx, R.string.w_focus_start));
            PendingIntent start = startIntent(ctx);
            rv.setOnClickPendingIntent(R.id.w_fc_main, start);
            rv.setOnClickPendingIntent(R.id.w_fc_body, start);
        } else {
            boolean running = s.optBoolean("running");
            boolean sw = s.optBoolean("stopwatch");
            rv.setTextViewText(R.id.w_fc_title, s.optString("title", Lang.str(ctx, R.string.w_focus_title)));
            String task = s.optString("task", "");
            String sub = running ? task : Lang.t(ctx, "На паузе", "Paused", "Кідіртілді");
            rv.setTextViewText(R.id.w_fc_sub, sub);
            rv.setViewVisibility(R.id.w_fc_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
            if (running) {
                // Chronometer считает от elapsedRealtime: «ноль» секундомера или конец фазы помодоро
                long base = SystemClock.elapsedRealtime() + ((sw ? s.optLong("start", now) : s.optLong("endAt", now)) - now);
                rv.setChronometer(R.id.w_fc_chrono, base, null, true);
                rv.setChronometerCountDown(R.id.w_fc_chrono, !sw);
                rv.setViewVisibility(R.id.w_fc_chrono, View.VISIBLE);
                rv.setViewVisibility(R.id.w_fc_clock, View.GONE);
            } else {
                rv.setChronometer(R.id.w_fc_chrono, SystemClock.elapsedRealtime(), null, false);
                rv.setViewVisibility(R.id.w_fc_chrono, View.GONE);
                rv.setViewVisibility(R.id.w_fc_clock, View.VISIBLE);
                rv.setTextViewText(R.id.w_fc_clock, clock(sw ? s.optLong("elapsed", 0) : s.optLong("left", 0)));
            }
            rv.setTextViewText(R.id.w_fc_main, running ? "❚❚  " + Lang.str(ctx, R.string.w_focus_pause) : "▶  " + Lang.str(ctx, R.string.w_focus_resume));
            rv.setOnClickPendingIntent(R.id.w_fc_main, controlIntent(ctx, running ? "pause" : "resume"));
            rv.setViewVisibility(R.id.w_fc_stop, View.VISIBLE);
            rv.setTextViewText(R.id.w_fc_stop, "■  " + Lang.str(ctx, R.string.w_focus_stop));
            rv.setOnClickPendingIntent(R.id.w_fc_stop, controlIntent(ctx, "stop"));
            rv.setOnClickPendingIntent(R.id.w_fc_body, SmWidgets.activityIntent(ctx, 4200, "open_view", null, "focus"));
        }
        m.updateAppWidget(wid, rv);
    }

    private static String clock(long ms) {
        long sec = Math.max(0, ms / 1000);
        long h = sec / 3600, mm = (sec % 3600) / 60, ss = sec % 60;
        return h > 0 ? String.format(java.util.Locale.ROOT, "%d:%02d:%02d", h, mm, ss) : String.format(java.util.Locale.ROOT, "%02d:%02d", mm, ss);
    }

    /** «Начать»: открыть приложение — оно запустит таймер и покажет раздел «Фокус» */
    private static PendingIntent startIntent(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("app.twomind.mindmap.widget.focus_start");
        i.putExtra(TodayWidget.EXTRA_ACTION, "focus");
        i.putExtra("sm_focus", "start");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 4201, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Пауза / продолжить / стоп — без открытия приложения, как кнопки уведомления */
    private static PendingIntent controlIntent(Context ctx, String action) {
        Intent i = new Intent(ctx, FocusLivePlugin.Receiver.class);
        i.setAction("app.twomind.mindmap.focus.widget." + action);
        i.putExtra("sm_focus", action);
        return PendingIntent.getBroadcast(ctx, 4210 + Math.abs(action.hashCode() % 50), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Конец фазы помодоро — перерисовать (обратный отсчёт Chronometer ушёл бы в минус) */
    private static void scheduleEnd(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(ctx, FocusWidget.class).setAction(ACTION_TICK);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 4220, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            JSONObject s = state(ctx);
            if (s != null && s.optBoolean("running") && !s.optBoolean("stopwatch")) am.set(AlarmManager.RTC, s.optLong("endAt") + 1000, pi);
            else am.cancel(pi);
        } catch (RuntimeException ignored) {
        }
    }
}
