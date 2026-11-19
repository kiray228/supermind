package app.twomind.mindmap;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Таймер фокуса в закреплённом уведомлении: обратный отсчёт помодоро или секундомер, кнопки «Пауза/Продолжить» и «Стоп».
 * Состояние присылает приложение (src/native/focusLive.ts). Кнопки сразу меняют уведомление и кладут действие
 * в очередь виджетов ({type:'focus', action, at}) — приложение применяет его к своему таймеру, как только откроется.
 */
@CapacitorPlugin(name = "FocusLive")
public class FocusLivePlugin extends Plugin {
    static final String CHANNEL = "sm-focus";
    static final int NID = 777002;
    private static final String PREFS = "sm_focus_live";
    private static final String KEY = "state";

    @PluginMethod
    public void update(PluginCall call) {
        JSObject s = call.getData();
        Context ctx = getContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, s.toString()).apply();
        show(ctx, s);
        call.resolve();
    }

    @PluginMethod
    public void end(PluginCall call) {
        cancel(getContext());
        call.resolve();
    }

    static void cancel(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NID);
    }

    private static void channel(Context ctx, NotificationManager nm, String name) {
        if (Build.VERSION.SDK_INT < 26 || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    static void show(Context ctx, JSONObject s) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        channel(ctx, nm, s.optString("channel", Lang.t(ctx, "Фокус", "Focus")));
        boolean running = s.optBoolean("running");
        boolean stopwatch = s.optBoolean("stopwatch");
        long now = System.currentTimeMillis();

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_supermind)
            .setContentTitle(s.optString("title", Lang.t(ctx, "Фокус", "Focus")))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(openIntent(ctx));
        String task = s.optString("task", "");
        if (running) {
            b.setUsesChronometer(true).setShowWhen(true);
            if (stopwatch) b.setWhen(s.optLong("start", now));
            else {
                b.setWhen(s.optLong("endAt", now));
                if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
            }
            if (!task.isEmpty()) b.setContentText(task);
        } else {
            b.setShowWhen(false);
            long ms = stopwatch ? s.optLong("elapsed", 0) : s.optLong("left", 0);
            String text = s.optString("pausedLabel", Lang.t(ctx, "На паузе", "Paused")) + " · " + clock(ms);
            b.setContentText(task.isEmpty() ? text : text + " · " + task);
        }
        if (!stopwatch && s.optLong("total", 0) > 0) {
            long total = s.optLong("total");
            long left = running ? Math.max(0, s.optLong("endAt", now) - now) : s.optLong("left", 0);
            b.setProgress(1000, (int) Math.min(1000, Math.max(0, (total - left) * 1000 / total)), false);
        }
        b.addAction(new Notification.Action.Builder(null, running ? s.optString("pauseLabel", Lang.t(ctx, "Пауза", "Pause")) : s.optString("resumeLabel", Lang.t(ctx, "Продолжить", "Resume")),
            actionIntent(ctx, running ? "pause" : "resume")).build());
        b.addAction(new Notification.Action.Builder(null, s.optString("stopLabel", Lang.t(ctx, "Стоп", "Stop")), actionIntent(ctx, "stop")).build());
        try {
            nm.notify(NID, b.build());
        } catch (SecurityException ignored) {
            // нет разрешения на уведомления — таймер работает и без них
        }
    }

    private static String clock(long ms) {
        long sec = Math.max(0, ms / 1000);
        long h = sec / 3600, m = (sec % 3600) / 60, ss = sec % 60;
        return h > 0 ? String.format(java.util.Locale.ROOT, "%d:%02d:%02d", h, m, ss) : String.format(java.util.Locale.ROOT, "%02d:%02d", m, ss);
    }

    private static PendingIntent openIntent(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("app.twomind.mindmap.widget.open_view");
        i.putExtra(TodayWidget.EXTRA_ACTION, "open_view");
        i.putExtra("sm_view", "focus");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 9101, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent actionIntent(Context ctx, String action) {
        Intent i = new Intent(ctx, Receiver.class);
        i.setAction("app.twomind.mindmap.focus." + action);
        i.putExtra("sm_focus", action);
        return PendingIntent.getBroadcast(ctx, 9102 + action.hashCode() % 100, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Кнопки уведомления: сразу перерисовать и передать действие приложению */
    public static class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getStringExtra("sm_focus");
            if (action == null) return;
            long now = System.currentTimeMillis();
            try {
                JSONObject o = new JSONObject();
                o.put("type", "focus");
                o.put("action", action);
                o.put("at", now);
                TodayWidget.queue(ctx, o);
            } catch (JSONException ignored) {
                return;
            }
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if ("stop".equals(action)) cancel(ctx);
            else {
                try {
                    JSONObject s = new JSONObject(p.getString(KEY, "{}"));
                    boolean stopwatch = s.optBoolean("stopwatch");
                    if ("pause".equals(action) && s.optBoolean("running")) {
                        s.put("running", false);
                        if (stopwatch) s.put("elapsed", Math.max(0, now - s.optLong("start", now)));
                        else s.put("left", Math.max(0, s.optLong("endAt", now) - now));
                    } else if ("resume".equals(action) && !s.optBoolean("running")) {
                        s.put("running", true);
                        if (stopwatch) s.put("start", now - s.optLong("elapsed", 0));
                        else s.put("endAt", now + s.optLong("left", 0));
                    }
                    p.edit().putString(KEY, s.toString()).apply();
                    show(ctx, s);
                } catch (JSONException ignored) {
                    // нет сохранённого состояния — уведомление обновит приложение
                }
            }
            WidgetBridgePlugin.notifyPending();
        }
    }
}
