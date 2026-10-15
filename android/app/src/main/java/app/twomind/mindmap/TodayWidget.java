package app.twomind.mindmap;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Виджет «SuperMind — Сегодня»: задачи на сегодня (просроченные сверху), прогресс привычек, кнопка «+».
 * Данные присылает приложение (WidgetBridge.update); дата «сегодня» считается здесь, поэтому
 * виджет остаётся верным после полуночи, даже если приложение не открывали.
 * Нажатие на кружок ставит выполнение в очередь — приложение применит его при запуске.
 */
public class TodayWidget extends AppWidgetProvider {

    static final String PREFS = "sm_widget";
    private static final String KEY_DATA = "data";
    private static final String KEY_PENDING = "pending";
    private static final String KEY_RECENT = "recentDone";
    private static final String KEY_RECENT_HABITS = "recentHabits";
    static final String ACTION_COMPLETE = "app.twomind.mindmap.widget.COMPLETE";
    static final String EXTRA_ACTION = "sm_action";
    private static final int MAX_ROWS = 6;
    private static final Locale RU = Locale.forLanguageTag("ru");

    // ---------- Хранилище ----------

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void saveData(Context ctx, String json) {
        // свежие данные приложения уже учитывают применённые выполнения
        prefs(ctx).edit().putString(KEY_DATA, json).remove(KEY_RECENT).remove(KEY_RECENT_HABITS).commit();
    }

    static synchronized void queue(Context ctx, JSONObject action) {
        SharedPreferences p = prefs(ctx);
        JSONArray list;
        try {
            list = new JSONArray(p.getString(KEY_PENDING, "[]"));
        } catch (JSONException e) {
            list = new JSONArray();
        }
        list.put(action);
        p.edit().putString(KEY_PENDING, list.toString()).commit();
    }

    /** Забрать очередь действий. Выполненные задачи остаются скрытыми до следующего update */
    static synchronized JSONArray drainPending(Context ctx) {
        SharedPreferences p = prefs(ctx);
        JSONArray list;
        try {
            list = new JSONArray(p.getString(KEY_PENDING, "[]"));
        } catch (JSONException e) {
            list = new JSONArray();
        }
        Set<String> recent = new HashSet<>(p.getStringSet(KEY_RECENT, Collections.<String>emptySet()));
        recent.addAll(completedIds(list));
        // отметки привычек тоже видны до следующего update — виджет не «откатывается»
        JSONArray habits;
        try {
            habits = new JSONArray(p.getString(KEY_RECENT_HABITS, "[]"));
        } catch (JSONException e) {
            habits = new JSONArray();
        }
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && "habit".equals(o.optString("type"))) habits.put(o);
        }
        p.edit().putString(KEY_PENDING, "[]").putStringSet(KEY_RECENT, recent).putString(KEY_RECENT_HABITS, habits.toString()).commit();
        return list;
    }

    /** Отметки привычек, ещё не учтённые в данных приложения: «дата|id» → новое значение счётчика */
    static synchronized Map<String, Integer> habitOverrides(Context ctx) {
        SharedPreferences p = prefs(ctx);
        Map<String, Integer> out = new HashMap<>();
        for (String key : new String[] { KEY_RECENT_HABITS, KEY_PENDING }) {
            try {
                JSONArray list = new JSONArray(p.getString(key, "[]"));
                for (int i = 0; i < list.length(); i++) {
                    JSONObject o = list.optJSONObject(i);
                    if (o != null && "habit".equals(o.optString("type"))) out.put(o.optString("date") + "|" + o.optString("id"), o.optInt("n"));
                }
            } catch (JSONException ignored) {
            }
        }
        return out;
    }

    private static Set<String> completedIds(JSONArray list) {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && "complete".equals(o.optString("type"))) ids.add(o.optString("id"));
        }
        return ids;
    }

    static synchronized Set<String> hiddenIds(Context ctx) {
        SharedPreferences p = prefs(ctx);
        Set<String> ids = new HashSet<>(p.getStringSet(KEY_RECENT, Collections.<String>emptySet()));
        try {
            ids.addAll(completedIds(new JSONArray(p.getString(KEY_PENDING, "[]"))));
        } catch (JSONException ignored) {
        }
        return ids;
    }

    /** Действия из intent активности: кнопки виджета (sm_action) и «Поделиться» (ACTION_SEND) */
    /** не больше стольких картинок за раз и такого размера каждая */
    private static final int MAX_SHARED_IMAGES = 10;
    private static final long MAX_SHARED_BYTES = 25L * 1024 * 1024;

    /**
     * Присланные картинки — копией в files/shared (ссылка content:// живёт недолго):
     * приложение прочитает их, вставит в заметку и удалит. Пути — относительно files.
     */
    static JSONArray copySharedImages(Context ctx, Intent intent) {
        JSONArray out = new JSONArray();
        List<Uri> uris = new ArrayList<>();
        try {
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) uris.addAll(list);
            } else {
                Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            }
            if (uris.isEmpty() && intent.getClipData() != null) {
                android.content.ClipData clip = intent.getClipData();
                for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) uris.add(clip.getItemAt(i).getUri());
            }
        } catch (RuntimeException ignored) {
            return out;
        }
        if (uris.isEmpty()) return out;
        java.io.File dir = new java.io.File(ctx.getFilesDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) return out;
        android.content.ContentResolver cr = ctx.getContentResolver();
        long stamp = System.currentTimeMillis();
        int n = 0;
        for (Uri u : uris) {
            if (n >= MAX_SHARED_IMAGES) break;
            String type = cr.getType(u);
            if (type == null) type = intent.getType();
            if (type == null || !type.startsWith("image/")) continue;
            String ext = type.contains("png") ? "png" : type.contains("webp") ? "webp" : type.contains("gif") ? "gif" : type.contains("heic") || type.contains("heif") ? "heic" : "jpg";
            java.io.File f = new java.io.File(dir, stamp + "_" + n + "." + ext);
            long total = 0;
            boolean ok = true;
            try (java.io.InputStream in = cr.openInputStream(u)) {
                if (in == null) continue;
                try (java.io.OutputStream os = new java.io.FileOutputStream(f)) {
                    byte[] buf = new byte[64 * 1024];
                    int r;
                    while ((r = in.read(buf)) > 0) {
                        total += r;
                        if (total > MAX_SHARED_BYTES) {
                            ok = false;
                            break;
                        }
                        os.write(buf, 0, r);
                    }
                }
            } catch (Exception e) {
                ok = false;
            }
            if (!ok || total == 0) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                continue;
            }
            try {
                JSONObject img = new JSONObject();
                img.put("path", "shared/" + f.getName());
                img.put("type", type);
                out.put(img);
                n++;
            } catch (JSONException ignored) {
            }
        }
        return out;
    }

    static void queueFromIntent(Context ctx, Intent intent) {
        try {
            if (Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
                JSONArray images = copySharedImages(ctx, intent);
                boolean hasText = text != null && text.toString().trim().length() > 0;
                if (hasText || images.length() > 0) {
                    JSONObject o = new JSONObject();
                    o.put("type", "share");
                    o.put("text", hasText ? text.toString() : "");
                    if (subject != null) o.put("title", subject);
                    if (images.length() > 0) o.put("images", images);
                    queue(ctx, o);
                }
                intent.removeExtra(Intent.EXTRA_TEXT);
                intent.removeExtra(Intent.EXTRA_STREAM);
                intent.setAction(Intent.ACTION_MAIN);
                return;
            }
            String a = intent.getStringExtra(EXTRA_ACTION);
            if (a == null) return;
            JSONObject o = new JSONObject();
            o.put("type", a);
            String id = intent.getStringExtra("sm_id");
            if (id != null) o.put("id", id);
            String view = intent.getStringExtra("sm_view");
            if (view != null) o.put("view", view);
            String date = intent.getStringExtra("sm_date");
            if (date != null) o.put("date", date);
            queue(ctx, o);
            intent.removeExtra(EXTRA_ACTION);
        } catch (JSONException ignored) {
        }
    }

    // ---------- Жизненный цикл виджета ----------

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle opts) {
        render(ctx, m, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ACTION_COMPLETE.equals(intent.getAction())) {
            String id = intent.getStringExtra("sm_id");
            if (id != null) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("type", "complete");
                    o.put("id", id);
                    String date = intent.getStringExtra("sm_date");
                    if (date != null) o.put("date", date);
                    queue(ctx, o);
                } catch (JSONException ignored) {
                }
                refreshAll(ctx);
                CalendarWidget.refreshAll(ctx);
                WidgetBridgePlugin.notifyPending();
            }
            return;
        }
        if (SmWidgets.ACTION_TICK.equals(intent.getAction())) {
            SmWidgets.refreshAll(ctx);
            return;
        }
        super.onReceive(ctx, intent);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, TodayWidget.class));
        for (int id : ids) render(ctx, m, id);
    }

    // ---------- Отрисовка ----------

    private static String ymd(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    private static String cap(String s) {
        return s.isEmpty() ? s : s.substring(0, 1).toUpperCase(RU) + s.substring(1);
    }

    private static int minutesOf(String hhmm) {
        try {
            String[] p = hhmm.split(":");
            return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]);
        } catch (Exception e) {
            return 0;
        }
    }

    private static final class Row {
        String id, title, date, time;
        int duration, priority;
        boolean overdue;
    }

    private static int rank(int priority) {
        return priority == 0 ? 4 : priority;
    }

    static void render(Context ctx, AppWidgetManager m, int wid) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        Calendar now = Calendar.getInstance();
        String today = ymd(now);
        Calendar y = (Calendar) now.clone();
        y.add(Calendar.DAY_OF_MONTH, -1);
        String yesterday = ymd(y);
        int nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);

        rv.setTextViewText(R.id.w_date, cap(new SimpleDateFormat("EEEE, d MMMM", RU).format(now.getTime())));

        String raw = prefs(ctx).getString(KEY_DATA, null);
        JSONObject data = null;
        try {
            if (raw != null) data = new JSONObject(raw);
        } catch (JSONException ignored) {
        }

        // задачи на сегодня и просроченные
        Set<String> hidden = hiddenIds(ctx);
        List<Row> rows = new ArrayList<>();
        JSONArray tasks = data != null ? data.optJSONArray("tasks") : null;
        if (tasks != null) {
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject t = tasks.optJSONObject(i);
                if (t == null) continue;
                Row r = new Row();
                r.id = t.optString("id");
                r.date = t.optString("d");
                if (r.id.isEmpty() || r.date.isEmpty() || r.date.compareTo(today) > 0 || hidden.contains(r.id)) continue;
                r.title = t.optString("t");
                r.time = t.optString("tm", "");
                r.duration = t.optInt("du", 0);
                r.priority = t.optInt("p", 0);
                r.overdue = r.date.compareTo(today) < 0
                    || (!r.time.isEmpty() && minutesOf(r.time) + r.duration < nowMin - 1);
                rows.add(r);
            }
        }
        Collections.sort(rows, (a, b) -> {
            if (a.overdue != b.overdue) return a.overdue ? -1 : 1;
            int c = a.date.compareTo(b.date);
            if (c != 0) return c;
            if (a.time.isEmpty() != b.time.isEmpty()) return a.time.isEmpty() ? 1 : -1;
            c = a.time.compareTo(b.time);
            if (c != 0) return c;
            return rank(a.priority) - rank(b.priority);
        });

        // привычки за сегодня
        int hDone = 0, hTotal = 0;
        int[] hp = HabitsWidget.progress(ctx, data, today);
        if (hp != null) {
            hDone = hp[0];
            hTotal = hp[1];
        } else {
            JSONObject habits = data != null ? data.optJSONObject("habits") : null;
            JSONArray h = habits != null ? habits.optJSONArray(today) : null;
            if (h != null && h.length() >= 2) {
                hDone = h.optInt(0);
                hTotal = h.optInt(1);
            }
        }
        boolean showHabits = hTotal > 0;
        rv.setViewVisibility(R.id.w_habits, showHabits ? View.VISIBLE : View.GONE);
        if (showHabits) {
            rv.setTextViewText(R.id.w_habits_text, "Привычки " + hDone + "/" + hTotal);
            rv.setProgressBar(R.id.w_habits_bar, hTotal, Math.min(hDone, hTotal), false);
        }

        // сколько строк помещается по высоте виджета
        Bundle opts = m.getAppWidgetOptions(wid);
        int height = opts != null ? opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) : 0;
        if (height <= 0) height = 180;
        int avail = height - 24 - 44 - (showHabits ? 38 : 0) - 22;
        int fit = Math.max(1, Math.min(MAX_ROWS, avail / 40));
        int shown = Math.min(fit, rows.size());

        rv.removeAllViews(R.id.w_list);
        for (int i = 0; i < shown; i++) {
            Row r = rows.get(i);
            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.widget_task_row);
            row.setTextViewText(R.id.w_row_title, r.title);
            String label;
            if (r.date.compareTo(today) < 0) {
                label = r.date.equals(yesterday) ? "Вчера" : shortDate(r.date);
            } else label = r.time;
            row.setTextViewText(R.id.w_row_time, label);
            row.setViewVisibility(R.id.w_row_time, label.isEmpty() ? View.GONE : View.VISIBLE);
            SmWidgets.textColor(ctx, row, R.id.w_row_time, r.overdue ? R.color.widget_danger : R.color.widget_text2);
            if (r.priority >= 1 && r.priority <= 3) {
                int[] colors = { 0, 0xFFEF4444, 0xFFF59E0B, 0xFF3B82F6 };
                row.setInt(R.id.w_row_check, "setColorFilter", colors[r.priority]);
            }
            row.setOnClickPendingIntent(R.id.w_row, activityIntent(ctx, 1000 + wid * 16 + i, "open_task", r.id, null));
            row.setOnClickPendingIntent(R.id.w_row_check, completeIntent(ctx, r.id, r.date));
            row.setContentDescription(R.id.w_row_check, "Выполнить: " + r.title);
            rv.addView(R.id.w_list, row);
        }

        boolean empty = rows.isEmpty();
        rv.setViewVisibility(R.id.w_empty, empty ? View.VISIBLE : View.GONE);
        if (empty) rv.setTextViewText(R.id.w_empty, data == null ? "Откройте SuperMind, чтобы увидеть задачи" : "На сегодня всё сделано 🎉");
        int more = rows.size() - shown;
        rv.setViewVisibility(R.id.w_more, more > 0 ? View.VISIBLE : View.GONE);
        if (more > 0) rv.setTextViewText(R.id.w_more, "Ещё " + more + " →");
        rv.setTextViewText(R.id.w_count, rows.isEmpty() ? "" : String.valueOf(rows.size()));
        rv.setViewVisibility(R.id.w_count, rows.isEmpty() ? View.GONE : View.VISIBLE);

        rv.setOnClickPendingIntent(R.id.w_add, activityIntent(ctx, 1, "quick_add", null, null));
        rv.setOnClickPendingIntent(R.id.w_mic, activityIntent(ctx, 7, "voice", null, null));
        rv.setOnClickPendingIntent(R.id.w_header, activityIntent(ctx, 2, "open_view", null, "tasks"));
        rv.setOnClickPendingIntent(R.id.w_more, activityIntent(ctx, 2, "open_view", null, "tasks"));
        rv.setOnClickPendingIntent(R.id.w_empty, activityIntent(ctx, 2, "open_view", null, "tasks"));
        rv.setOnClickPendingIntent(R.id.w_habits, activityIntent(ctx, 3, "open_view", null, "habits"));

        m.updateAppWidget(wid, rv);
    }

    private static String shortDate(String ymd) {
        try {
            Calendar c = Calendar.getInstance();
            c.set(Integer.parseInt(ymd.substring(0, 4)), Integer.parseInt(ymd.substring(5, 7)) - 1, Integer.parseInt(ymd.substring(8, 10)));
            return new SimpleDateFormat("d MMM", RU).format(c.getTime()).replace(".", "");
        } catch (Exception e) {
            return ymd;
        }
    }

    private static PendingIntent activityIntent(Context ctx, int req, String action, String id, String view) {
        Intent i = new Intent(ctx, MainActivity.class);
        // своё действие (не VIEW): Capacitor не принимает его за ссылку
        i.setAction("app.twomind.mindmap.widget." + action);
        i.putExtra(EXTRA_ACTION, action);
        if (id != null) i.putExtra("sm_id", id);
        if (view != null) i.putExtra("sm_view", view);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent completeIntent(Context ctx, String id, String date) {
        Intent i = new Intent(ctx, TodayWidget.class);
        i.setAction(ACTION_COMPLETE);
        i.setData(Uri.parse("supermind-widget://complete/" + Uri.encode(id)));
        i.putExtra("sm_id", id);
        i.putExtra("sm_date", date);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
