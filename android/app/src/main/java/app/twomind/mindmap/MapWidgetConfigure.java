package app.twomind.mindmap;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.res.TypedArray;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

/** Выбор карты для виджета «Карта» (при добавлении и через «Настроить виджет») */
public class MapWidgetConfigure extends AppCompatActivity {

    private int wid = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Bundle extras = getIntent() != null ? getIntent().getExtras() : null;
        if (extras != null) wid = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        // «Назад» — виджет не добавляется
        setResult(RESULT_CANCELED, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid));
        if (wid == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        setTitle("Карта на виджете");
        buildUi();
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private int attrColor(int attr) {
        TypedArray a = obtainStyledAttributes(new int[] { attr });
        int c = a.getColor(0, 0xFF808080);
        a.recycle();
        return c;
    }

    private void buildUi() {
        int text = attrColor(android.R.attr.textColorPrimary);
        int text2 = attrColor(android.R.attr.textColorSecondary);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(8), dp(20), dp(8), dp(12));

        TextView title = new TextView(this);
        title.setText("Какую карту показать?");
        title.setTextColor(text);
        title.setTextSize(20);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        title.setPadding(dp(16), 0, dp(16), dp(4));
        root.addView(title);

        TextView hint = new TextView(this);
        hint.setText("Виджет покажет центральную тему и основные ветви. Нажатие откроет карту.");
        hint.setTextColor(text2);
        hint.setTextSize(13);
        hint.setPadding(dp(16), 0, dp(16), dp(12));
        root.addView(hint);

        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        String current = MapWidget.chosen(this, wid);
        JSONObject data = SmWidgets.data(this);
        JSONArray maps = MapWidget.maps(data);

        list.addView(row("✨", 0xFFFF4A2B, "Последняя изменённая", "Всегда карта, с которой вы работали последней", "".equals(current), text, text2, ""));
        for (int i = 0; i < maps.length(); i++) {
            JSONObject m = maps.optJSONObject(i);
            if (m == null) continue;
            String id = m.optString("id");
            list.addView(row(null, SmWidgets.parseColor(m.optString("rc"), 0xFF6366F1), m.optString("t", "Карта"), MapWidget.subtitle(m),
                id.equals(current), text, text2, id));
        }
        if (maps.length() == 0) {
            TextView none = new TextView(this);
            none.setText(data == null ? "Откройте SuperMind хотя бы раз — здесь появятся ваши карты." : "Пока нет карт. Виджет покажет первую созданную карту.");
            none.setTextColor(text2);
            none.setTextSize(13);
            none.setPadding(dp(16), dp(12), dp(16), dp(8));
            list.addView(none);
        }
        // скруглённая карточка в стиле Material You
        GradientDrawable card = new GradientDrawable();
        card.setColor(attrColor(android.R.attr.colorBackground));
        card.setCornerRadius(dp(28));
        root.setBackground(card);
        root.setClipToOutline(true);
        setContentView(root);
        if (getWindow() != null) {
            getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0));
            int w = Math.min(getResources().getDisplayMetrics().widthPixels - dp(32), dp(460));
            getWindow().setLayout(w, ViewGroup.LayoutParams.WRAP_CONTENT);
        }
    }

    private View row(String emoji, int color, String name, String sub, boolean selected, int text, int text2, final String id) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(dp(16), dp(10), dp(16), dp(10));
        r.setMinimumHeight(dp(60));
        TypedValue tv = new TypedValue();
        if (getTheme().resolveAttribute(android.R.attr.selectableItemBackground, tv, true)) r.setBackgroundResource(tv.resourceId);
        r.setClickable(true);
        r.setFocusable(true);

        TextView dot = new TextView(this);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(color);
        dot.setBackground(g);
        dot.setGravity(Gravity.CENTER);
        dot.setTextSize(16);
        dot.setTextColor(MapPreview.isLight(color) ? 0xFF1B1C20 : 0xFFFFFFFF);
        dot.setText(emoji != null ? emoji : name.isEmpty() ? "•" : name.substring(0, name.offsetByCodePoints(0, 1)).toUpperCase(SmWidgets.RU));
        r.addView(dot, new LinearLayout.LayoutParams(dp(36), dp(36)));

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(14), 0, dp(8), 0);
        TextView t = new TextView(this);
        t.setText(name);
        t.setTextColor(text);
        t.setTextSize(16);
        t.setSingleLine(true);
        t.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(t);
        TextView s = new TextView(this);
        s.setText(sub);
        s.setTextColor(text2);
        s.setTextSize(12);
        s.setMaxLines(2);
        s.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(s);
        r.addView(col, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        if (selected) {
            TextView check = new TextView(this);
            check.setText("✓");
            check.setTextSize(18);
            check.setTextColor(0xFFFF4A2B);
            r.addView(check);
        }
        r.setOnClickListener(v -> done(id));
        return r;
    }

    private void done(String id) {
        MapWidget.choose(this, wid, id);
        MapWidget.render(this, AppWidgetManager.getInstance(this), wid);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, wid));
        finish();
    }
}
