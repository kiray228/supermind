package app.twomind.mindmap;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

/**
 * Звенящий будильник: звук будильника телефона по кругу, вибрация, уведомление с кнопками
 * и экран поверх блокировки (AlarmActivity). Сам замолкает через 10 минут.
 */
public class AlarmService extends Service {
    static final String ACTION_RING = "app.twomind.mindmap.ALARM_RING";
    static final String CHANNEL = "sm-alarm";
    static final int NOTIFICATION_ID = 777100;
    private static final long TIMEOUT_MS = 10 * 60_000L;

    /** Что звенит сейчас — для экрана будильника */
    static volatile Bundle ringing;

    private MediaPlayer player;
    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wake;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::stopSelf;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !ACTION_RING.equals(intent.getAction()) || intent.getExtras() == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Bundle ex = intent.getExtras();
        ringing = ex;
        startInForeground(buildNotification(ex));
        if (player == null && ringtone == null) startSound();
        if (vibrator == null) startVibration();
        if (wake == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "supermind:alarm");
                wake.acquire(TIMEOUT_MS + 5000);
            }
        }
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, TIMEOUT_MS);
        // экран будильника; если система не даёт показать его сама (полноэкранные уведомления запрещены) —
        // будильник всё равно звенит, а экран откроется по нажатию на уведомление
        try {
            startActivity(new Intent(this, AlarmActivity.class).putExtras(ex).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION));
        } catch (Exception ignored) {
        }
        return START_NOT_STICKY;
    }

    private void startInForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    // приложению с точными будильниками разрешён этот тип: звонить из фона можно
                    startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED);
                } catch (Exception e) {
                    startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                }
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
        } catch (Exception e) {
            // не дали стать сервисом переднего плана — хотя бы уведомление
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, n);
        }
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Будильники", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Напоминания-будильники: звонят, пока не выключите");
        // звук и вибрацию даёт сам будильник — у уведомления их нет, иначе звучало бы дважды
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private PendingIntent action(String action, Bundle ex, int code) {
        Intent i = new Intent(this, AlarmReceiver.class).setAction(action).putExtras(ex);
        return PendingIntent.getBroadcast(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification(Bundle ex) {
        ensureChannel(this);
        Intent full = new Intent(this, AlarmActivity.class).putExtras(ex).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent fullPi = PendingIntent.getActivity(this, 1, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String body = ex.getString("body", "");
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_supermind)
            .setColor(0xFF007AFF)
            .setContentTitle("⏰ " + ex.getString("title", "Задача"))
            .setContentText(body.isEmpty() ? "Будильник SuperMind" : body)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullPi)
            .setFullScreenIntent(fullPi, true)
            .addAction(0, "Выключить", action(AlarmReceiver.ACTION_STOP, ex, 11))
            .addAction(0, "Отложить 10 мин", action(AlarmReceiver.ACTION_SNOOZE, ex, 12));
        if (!ex.getString("taskId", "").isEmpty()) b.addAction(0, "✓ Готово", action(AlarmReceiver.ACTION_DONE, ex, 13));
        return b.build();
    }

    private void startSound() {
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(attrs);
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            if (player != null) player.release();
            player = null;
            // запасной путь: системная мелодия
            try {
                ringtone = RingtoneManager.getRingtone(this, uri);
                if (ringtone != null) {
                    ringtone.setAudioAttributes(attrs);
                    if (Build.VERSION.SDK_INT >= 28) ringtone.setLooping(true);
                    ringtone.play();
                }
            } catch (Exception ignored) {
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void startVibration() {
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = {0, 900, 700};
        if (Build.VERSION.SDK_INT >= 26) {
            AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build();
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs);
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeout);
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            player.release();
            player = null;
        }
        if (ringtone != null) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
        if (wake != null && wake.isHeld()) wake.release();
        ringing = null;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
        AlarmActivity.closeAll();
        super.onDestroy();
    }
}
