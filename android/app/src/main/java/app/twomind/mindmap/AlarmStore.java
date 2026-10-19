package app.twomind.mindmap;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Будильники-напоминания: что запланировано (переживает перезагрузку телефона — AlarmManager её не переживает)
 * и действия для приложения («Готово» на будильнике отмечает задачу, когда приложение откроется).
 */
final class AlarmStore {
    private static final String PREFS = "sm_alarms";
    private static final String ALARMS = "alarms";
    private static final String ACTIONS = "actions";

    private AlarmStore() {}

    private static boolean migrated = false;

    /**
     * Хранилище, доступное до первой разблокировки после перезагрузки (direct boot): иначе после ночного
     * обновления системы утренний будильник молчал бы, пока телефон не разблокируют.
     * Прежний список (из обычного хранилища) переносится сюда один раз — когда телефон разблокирован.
     */
    private static SharedPreferences prefs(Context c) {
        Context dc = c;
        if (android.os.Build.VERSION.SDK_INT >= 24) {
            dc = c.createDeviceProtectedStorageContext();
            if (!migrated) {
                android.os.UserManager um = (android.os.UserManager) c.getSystemService(Context.USER_SERVICE);
                if (um != null && um.isUserUnlocked()) {
                    try {
                        // старого файла нет — переносить нечего (moveSharedPreferencesFrom ничего не затирает)
                        java.io.File old = new java.io.File(c.getApplicationInfo().dataDir, "shared_prefs/" + PREFS + ".xml");
                        if (old.exists()) dc.moveSharedPreferencesFrom(c, PREFS);
                    } catch (RuntimeException ignored) {
                    }
                    migrated = true;
                }
            }
        }
        return dc.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** id → { at, title, body, taskId, date, snooze? } */
    static synchronized JSONObject all(Context c) {
        try {
            return new JSONObject(prefs(c).getString(ALARMS, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static synchronized void putAll(Context c, JSONObject alarms) {
        prefs(c).edit().putString(ALARMS, alarms.toString()).apply();
    }

    static synchronized JSONObject get(Context c, int id) {
        return all(c).optJSONObject(String.valueOf(id));
    }

    static synchronized void put(Context c, int id, JSONObject alarm) {
        JSONObject a = all(c);
        try {
            a.put(String.valueOf(id), alarm);
        } catch (JSONException ignored) {
        }
        putAll(c, a);
    }

    static synchronized void remove(Context c, int id) {
        JSONObject a = all(c);
        a.remove(String.valueOf(id));
        putAll(c, a);
    }

    static synchronized void addAction(Context c, JSONObject action) {
        JSONArray list;
        try {
            list = new JSONArray(prefs(c).getString(ACTIONS, "[]"));
        } catch (JSONException e) {
            list = new JSONArray();
        }
        list.put(action);
        prefs(c).edit().putString(ACTIONS, list.toString()).apply();
    }

    static synchronized JSONArray drainActions(Context c) {
        JSONArray list;
        try {
            list = new JSONArray(prefs(c).getString(ACTIONS, "[]"));
        } catch (JSONException e) {
            list = new JSONArray();
        }
        prefs(c).edit().putString(ACTIONS, "[]").apply();
        return list;
    }
}
