package app.twomind.mindmap;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

import java.util.Iterator;

/**
 * Системный будильник Android (setAlarmClock): срабатывает точно, будит телефон из сна,
 * показывает значок будильника в строке состояния и время на экране блокировки.
 */
final class AlarmScheduler {
    private AlarmScheduler() {}

    private static PendingIntent fireIntent(Context c, int id, int flags) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(AlarmReceiver.ACTION_FIRE).putExtra("id", id);
        return PendingIntent.getBroadcast(c, id, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    static void set(Context c, int id, long at) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent fire = fireIntent(c, id, PendingIntent.FLAG_UPDATE_CURRENT);
        // точные будильники запретили в настройках — хотя бы «почти точно», даже в режиме сна
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
            return;
        }
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent show = PendingIntent.getActivity(c, 0, open == null ? new Intent() : open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), fire);
    }

    static void cancel(Context c, int id) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent fire = fireIntent(c, id, PendingIntent.FLAG_NO_CREATE);
        if (am != null && fire != null) {
            am.cancel(fire);
            fire.cancel();
        }
    }

    /** «yyyy-MM-dd HH:mm» в текущем часовом поясе → миллисекунды; -1 — не разобрать */
    private static long localToMillis(String local) {
        if (local == null || local.isEmpty()) return -1;
        try {
            java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.ROOT);
            f.setTimeZone(java.util.TimeZone.getDefault());
            java.util.Date d = f.parse(local);
            return d == null ? -1 : d.getTime();
        } catch (Exception e) {
            return -1;
        }
    }

    /** После перезагрузки, обновления приложения или смены времени: заново поставить будущие будильники */
    static void restoreAll(Context c) {
        restoreAll(c, false);
    }

    /** tzChanged — сменился часовой пояс: время берётся «как на часах» (local), а не прежний момент */
    static void restoreAll(Context c, boolean tzChanged) {
        JSONObject all = AlarmStore.all(c);
        long now = System.currentTimeMillis();
        JSONObject keep = new JSONObject();
        Iterator<String> keys = all.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            JSONObject a = all.optJSONObject(k);
            if (a == null) continue;
            long at = a.optLong("at");
            if (tzChanged) {
                long local = localToMillis(a.optString("local", ""));
                if (local > 0) {
                    at = local;
                    try {
                        a.put("at", at);
                    } catch (Exception ignored) {
                    }
                }
            }
            // пропущенный за последние 10 минут (телефон перезагружался) — прозвенит сейчас;
            // давно прошедший (в новом поясе это время уже было) — убрать и системный будильник
            if (at < now - 10 * 60_000L) {
                try {
                    cancel(c, Integer.parseInt(k));
                } catch (NumberFormatException ignored) {
                }
                continue;
            }
            try {
                keep.put(k, a);
                set(c, Integer.parseInt(k), Math.max(at, now + 3000));
            } catch (Exception ignored) {
            }
        }
        AlarmStore.putAll(c, keep);
    }
}
