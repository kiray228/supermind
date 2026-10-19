package app.twomind.mindmap;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Random;

/**
 * Срабатывание будильника (из AlarmManager), кнопки «Выключить / Отложить / Готово» в уведомлении
 * и восстановление будильников после перезагрузки телефона.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION_FIRE = "app.twomind.mindmap.ALARM_FIRE";
    static final String ACTION_STOP = "app.twomind.mindmap.ALARM_STOP";
    static final String ACTION_SNOOZE = "app.twomind.mindmap.ALARM_SNOOZE";
    static final String ACTION_DONE = "app.twomind.mindmap.ALARM_DONE";
    static final long SNOOZE_MS = 10 * 60_000L;

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (ACTION_FIRE.equals(a)) {
            int id = intent.getIntExtra("id", 0);
            JSONObject alarm = AlarmStore.get(c, id);
            if (alarm == null) return;
            AlarmStore.remove(c, id);
            ring(c, alarm);
        } else if (ACTION_STOP.equals(a) || ACTION_SNOOZE.equals(a) || ACTION_DONE.equals(a)) {
            act(c, a, intent.getExtras());
        } else {
            // BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED
            AlarmScheduler.restoreAll(c, Intent.ACTION_TIMEZONE_CHANGED.equals(a));
        }
    }

    /** Зазвонить: сервис со звуком будильника, вибрацией и экраном поверх блокировки */
    static void ring(Context c, JSONObject alarm) {
        Intent s = new Intent(c, AlarmService.class)
            .setAction(AlarmService.ACTION_RING)
            .putExtra("title", alarm.optString("title", "Задача"))
            .putExtra("body", alarm.optString("body", ""))
            .putExtra("taskId", alarm.optString("taskId", ""))
            .putExtra("date", alarm.optString("date", ""));
        try {
            ContextCompat.startForegroundService(c, s);
        } catch (RuntimeException e) {
            // Android 12: точные будильники запрещены в настройках — срабатывание «почти точное», и запускать
            // звонок из фона система не даёт. Не падаем: хотя бы громкое уведомление о задаче
            fallbackNotify(c, alarm);
        }
    }

    /** Уведомление вместо звонка (канал напоминаний со звуком, если он есть) */
    private static void fallbackNotify(Context c, JSONObject alarm) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            String channel = "sm-reminders";
            if (android.os.Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(channel) == null) {
                AlarmService.ensureChannel(c);
                channel = AlarmService.CHANNEL;
            }
            Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
            android.app.PendingIntent tap = android.app.PendingIntent.getActivity(
                c, 0, open == null ? new Intent() : open, android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            androidx.core.app.NotificationCompat.Builder b = new androidx.core.app.NotificationCompat.Builder(c, channel)
                .setSmallIcon(c.getApplicationInfo().icon)
                .setContentTitle("⏰ " + alarm.optString("title", "Задача"))
                .setContentText(alarm.optString("body", ""))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MAX)
                .setCategory(androidx.core.app.NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(tap);
            nm.notify(new Random().nextInt(700_000) + 1, b.build());
        } catch (RuntimeException ignored) {
        }
    }

    /** Кнопка будильника (в уведомлении или на экране будильника) */
    static void act(Context c, String action, Bundle ex) {
        String title = ex == null ? "Задача" : ex.getString("title", "Задача");
        String taskId = ex == null ? "" : ex.getString("taskId", "");
        String date = ex == null ? "" : ex.getString("date", "");
        try {
            if (ACTION_SNOOZE.equals(action)) {
                // 1..700000 — как отложенные уведомления в приложении: не пересекается с id напоминаний (от 1 000 000)
                int id = new Random().nextInt(700_000) + 1;
                long at = System.currentTimeMillis() + SNOOZE_MS;
                JSONObject o = new JSONObject()
                    .put("at", at)
                    .put("title", title)
                    .put("body", "Отложено на 10 минут")
                    .put("taskId", taskId)
                    .put("date", date)
                    .put("snooze", 1);
                AlarmStore.put(c, id, o);
                AlarmScheduler.set(c, id, at);
            } else if (ACTION_DONE.equals(action) && !taskId.isEmpty()) {
                // отметит приложение — сразу, если оно запущено, иначе при следующем открытии
                AlarmStore.addAction(c, new JSONObject().put("action", "done").put("taskId", taskId).put("date", date));
                SmAlarmPlugin.notifyActions();
            }
        } catch (JSONException ignored) {
        }
        c.stopService(new Intent(c, AlarmService.class));
    }
}
