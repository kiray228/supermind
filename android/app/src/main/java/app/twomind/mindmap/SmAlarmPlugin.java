package app.twomind.mindmap;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Iterator;

/**
 * Напоминания-будильники для приложения:
 * sync — расписание будильников (отложенные на будильнике сохраняются); list / cancel — что запланировано;
 * takeActions — «Готово», нажатые на будильнике; test — прозвенеть сейчас; fullScreen* — разрешение на экран поверх блокировки.
 */
@CapacitorPlugin(name = "SmAlarm")
public class SmAlarmPlugin extends Plugin {
    private static WeakReference<SmAlarmPlugin> instance = new WeakReference<>(null);

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        AlarmService.ensureChannel(getContext());
    }

    /** На будильнике нажали «Готово» — приложение (если открыто) заберёт действие сразу */
    static void notifyActions() {
        SmAlarmPlugin p = instance.get();
        if (p != null) p.notifyListeners("actions", new JSObject());
    }

    @PluginMethod
    public void sync(PluginCall call) {
        Context c = getContext();
        JSArray list = call.getArray("alarms", new JSArray());
        JSONObject old = AlarmStore.all(c);
        JSONObject next = new JSONObject();
        try {
            // отложенные на самом будильнике — не из расписания приложения, их не трогаем (отменяет cancel)
            Iterator<String> keys = old.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                JSONObject a = old.optJSONObject(k);
                if (a != null && a.optInt("snooze") == 1 && a.optLong("at") > System.currentTimeMillis()) next.put(k, a);
            }
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.getJSONObject(i);
                next.put(String.valueOf(a.getInt("id")), new JSONObject()
                    .put("at", a.getLong("at"))
                    .put("title", a.optString("title", "Задача"))
                    .put("body", a.optString("body", ""))
                    .put("taskId", a.optString("taskId", ""))
                    .put("date", a.optString("date", "")));
            }
        } catch (JSONException e) {
            call.reject("bad alarms: " + e.getMessage());
            return;
        }
        Iterator<String> oldKeys = old.keys();
        while (oldKeys.hasNext()) {
            String k = oldKeys.next();
            if (!next.has(k)) AlarmScheduler.cancel(c, Integer.parseInt(k));
        }
        int set = 0;
        Iterator<String> nextKeys = next.keys();
        while (nextKeys.hasNext()) {
            String k = nextKeys.next();
            JSONObject a = next.optJSONObject(k);
            JSONObject was = old.optJSONObject(k);
            if (a == null) continue;
            if (was == null || was.optLong("at") != a.optLong("at")) {
                AlarmScheduler.set(c, Integer.parseInt(k), a.optLong("at"));
                set++;
            }
        }
        AlarmStore.putAll(c, next);
        JSObject r = new JSObject();
        r.put("count", next.length());
        r.put("set", set);
        call.resolve(r);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSONObject all = AlarmStore.all(getContext());
        JSArray out = new JSArray();
        Iterator<String> keys = all.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            JSONObject a = all.optJSONObject(k);
            if (a == null) continue;
            try {
                out.put(new JSONObject(a.toString()).put("id", Integer.parseInt(k)));
            } catch (JSONException ignored) {
            }
        }
        JSObject r = new JSObject();
        r.put("alarms", out);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        for (int i = 0; i < ids.length(); i++) {
            int id = ids.optInt(i);
            AlarmScheduler.cancel(getContext(), id);
            AlarmStore.remove(getContext(), id);
        }
        call.resolve();
    }

    @PluginMethod
    public void takeActions(PluginCall call) {
        JSONArray list = AlarmStore.drainActions(getContext());
        JSObject r = new JSObject();
        try {
            r.put("actions", new JSArray(list.toString()));
        } catch (JSONException e) {
            r.put("actions", new JSArray());
        }
        call.resolve(r);
    }

    /** Прозвенеть сейчас — проверка, как звучит будильник */
    @PluginMethod
    public void test(PluginCall call) {
        try {
            AlarmReceiver.ring(getContext(), new JSONObject().put("title", "Проверка будильника").put("body", "Так зазвонит напоминание-будильник"));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Можно ли показывать экран будильника поверх блокировки (Android 14+ спрашивает разрешение) */
    @PluginMethod
    public void fullScreenAllowed(PluginCall call) {
        boolean ok = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            ok = nm == null || nm.canUseFullScreenIntent();
        }
        JSObject r = new JSObject();
        r.put("allowed", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        try {
            Intent i = Build.VERSION.SDK_INT >= 34
                ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()))
                : new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
