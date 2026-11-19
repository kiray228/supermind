package app.twomind.mindmap;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * Виджет «SuperMind — Финансы»: траты сегодня и за месяц, бюджет месяца, кнопка «+ Трата» (окно новой траты в приложении).
 * Суммы считает и форматирует приложение (src/native/widgetCore.ts → поле fin); день и месяц в данных —
 * после полуночи виджет показывает «0», пока приложение не пришлёт новые.
 */
public class FinanceWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager m, int id, Bundle opts) {
        render(ctx, m, id);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, FinanceWidget.class));
        for (int id : ids) render(ctx, m, id);
    }

    static void render(Context ctx, AppWidgetManager m, int wid) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_finance);
        JSONObject data = SmWidgets.data(ctx);
        JSONObject fin = data != null ? data.optJSONObject("fin") : null;
        String today = SmWidgets.ymd(Calendar.getInstance());
        boolean sameDay = fin != null && today.equals(fin.optString("d"));
        boolean sameMonth = fin != null && today.substring(0, 7).equals(fin.optString("m"));
        String zero = fin != null ? fin.optString("zs", "0") : "—";

        rv.setTextViewText(R.id.w_fin_title, Lang.str(ctx, R.string.w_fin_title));
        rv.setTextViewText(R.id.w_fin_today_label, Lang.t(ctx, "Сегодня", "Today", "Бүгін"));
        rv.setTextViewText(R.id.w_fin_today, sameDay ? fin.optString("tds", zero) : zero);
        String month = sameMonth ? fin.optString("mos", zero) : zero;
        rv.setTextViewText(R.id.w_fin_month, Lang.t(ctx, "Этот месяц: ", "This month: ", "Осы ай: ") + month);
        rv.setTextViewText(R.id.w_fin_add_text, Lang.str(ctx, R.string.w_add_expense));
        rv.setContentDescription(R.id.w_fin_add, Lang.str(ctx, R.string.w_add_expense));

        // бюджет месяца
        String lims = fin != null ? fin.optString("lims", "") : "";
        boolean budget = !lims.isEmpty();
        rv.setViewVisibility(R.id.w_fin_budget, budget ? View.VISIBLE : View.GONE);
        if (budget) {
            double p = sameMonth ? fin.optDouble("p", 0) : 0;
            boolean over = sameMonth && fin.optInt("over", 0) == 1;
            String left = sameMonth ? fin.optString("lfs", lims) : lims;
            rv.setProgressBar(R.id.w_fin_bar, 1000, (int) Math.round(Math.min(1, Math.max(0, p)) * 1000), false);
            rv.setTextViewText(R.id.w_fin_left, over
                ? Lang.t(ctx, "Перерасход " + left, left + " over budget", "Бюджеттен " + left + " асып кетті")
                : Lang.t(ctx, "Осталось " + left, left + " left", left + " қалды"));
            rv.setTextViewText(R.id.w_fin_limit, Lang.t(ctx, "из ", "of ", "/ ") + lims);
            SmWidgets.textColor(ctx, rv, R.id.w_fin_left, over ? R.color.widget_danger : R.color.widget_text2);
        }
        rv.setViewVisibility(R.id.w_fin_hint, fin == null ? View.VISIBLE : View.GONE);
        if (fin == null) rv.setTextViewText(R.id.w_fin_hint, Lang.t(ctx, "Откройте SuperMind, чтобы увидеть траты", "Open SuperMind to see your spending", "Шығындарды көру үшін SuperMind-ты ашыңыз"));

        rv.setOnClickPendingIntent(R.id.w_fin_add, SmWidgets.activityIntent(ctx, 4100, "add_expense", null, null));
        rv.setOnClickPendingIntent(R.id.w_fin_body, SmWidgets.activityIntent(ctx, 4101, "open_view", null, "finance"));
        m.updateAppWidget(wid, rv);
    }
}
