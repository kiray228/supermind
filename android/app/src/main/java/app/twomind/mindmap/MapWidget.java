package app.twomind.mindmap;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * Виджет «SuperMind — Карта»: набросок выбранной интеллект-карты (центральная тема и основные ветви).
 * Карта выбирается при добавлении (MapWidgetConfigure); «автоматически» — последняя изменённая.
 * Нажатие открывает карту в приложении.
 */
public class MapWidget extends AppWidgetProvider {

    private static final String KEY_MAP = "map_";

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE);
    }

    /** Выбранная карта виджета: "" — последняя изменённая; null — ещё не настроен */
    static String chosen(Context ctx, int wid) {
        return prefs(ctx).getString(KEY_MAP + wid, null);
    }

    static void choose(Context ctx, int wid, String docId) {
        prefs(ctx).edit().putString(KEY_MAP + wid, docId == null ? "" : docId).commit();
    }

    static JSONArray maps(JSONObject data) {
        JSONArray a = data != null ? data.optJSONArray("maps") : null;
        return a != null ? a : new JSONArray();
    }

    /** Карта для виджета: выбранная, а если её нет (удалена, защищена паролем) — последняя изменённая */
    static JSONObject pick(JSONObject data, String id) {
        JSONArray a = maps(data);
        if (id != null && !id.isEmpty()) {
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && id.equals(o.optString("id"))) return o;
            }
        }
        return a.optJSONObject(0);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle opts) {
        render(ctx, m, id);
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        for (int id : ids) e.remove(KEY_MAP + id);
        e.apply();
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, MapWidget.class));
        for (int id : ids) render(ctx, m, id);
    }

    static String updatedLabel(long at) {
        if (at <= 0) return "";
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        Calendar now = Calendar.getInstance();
        if (SmWidgets.ymd(c).equals(SmWidgets.ymd(now))) return "изменена сегодня в " + SmWidgets.fmt("HH:mm", c);
        now.add(Calendar.DAY_OF_MONTH, -1);
        if (SmWidgets.ymd(c).equals(SmWidgets.ymd(now))) return "изменена вчера";
        return "изменена " + SmWidgets.fmt("d MMM", c);
    }

    static String subtitle(JSONObject map) {
        JSONArray b = map.optJSONArray("b");
        int n = b != null ? b.length() : 0;
        String s = n == 0 ? "без ветвей" : n + " " + HabitsWidget.plural(n, "ветвь", "ветви", "ветвей");
        String u = updatedLabel(map.optLong("u"));
        return u.isEmpty() ? s : s + " · " + u;
    }

    static void render(Context ctx, AppWidgetManager m, int wid) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_map);
        JSONObject data = SmWidgets.data(ctx);
        String id = chosen(ctx, wid);
        JSONObject map = pick(data, id);
        if (map == null) {
            rv.setTextViewText(R.id.w_map_title, "Карта");
            rv.setTextViewText(R.id.w_map_sub, "SuperMind");
            rv.setViewVisibility(R.id.w_map_img, View.GONE);
            rv.setViewVisibility(R.id.w_map_empty, View.VISIBLE);
            rv.setTextViewText(R.id.w_map_empty, data == null ? "Откройте SuperMind, чтобы увидеть карты" : "Пока нет карт — создайте первую");
            rv.setOnClickPendingIntent(android.R.id.background, SmWidgets.activityIntent(ctx, 50, "open_view", null, "home"));
            m.updateAppWidget(wid, rv);
            return;
        }
        rv.setTextViewText(R.id.w_map_title, map.optString("t", "Карта"));
        rv.setTextViewText(R.id.w_map_sub, subtitle(map));
        rv.setViewVisibility(R.id.w_map_empty, View.GONE);
        rv.setViewVisibility(R.id.w_map_img, View.VISIBLE);

        int[] size = SmWidgets.sizeDp(m, wid, 250, 180);
        float w = Math.max(80, size[0] - 24);
        float h = Math.max(60, size[1] - 12 - 44 - 10);
        float density = ctx.getResources().getDisplayMetrics().density;
        float scale = Math.min(density, 2f);
        // память RemoteViews ограничена — большой виджет рисуем чуть мельче
        while (w * h * scale * scale * 4 > 3_000_000 && scale > 1f) scale -= 0.25f;
        try {
            Bitmap bmp = MapPreview.draw(map, w, h, scale);
            rv.setImageViewBitmap(R.id.w_map_img, bmp);
        } catch (Throwable t) {
            rv.setViewVisibility(R.id.w_map_img, View.GONE);
        }
        rv.setContentDescription(R.id.w_map_img, "Карта «" + map.optString("t") + "»");
        rv.setOnClickPendingIntent(android.R.id.background, SmWidgets.activityIntent(ctx, 5000 + wid, "open_map", map.optString("id"), null));
        m.updateAppWidget(wid, rv);
    }
}
