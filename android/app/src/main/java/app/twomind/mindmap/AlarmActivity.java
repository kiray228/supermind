package app.twomind.mindmap;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Экран будильника поверх экрана блокировки: время, задача и кнопки «Готово / Отложить / Выключить» */
public class AlarmActivity extends Activity {
    private static WeakReference<AlarmActivity> current = new WeakReference<>(null);

    /** Будильник выключили (в уведомлении или по таймауту) — экран тоже закрыть */
    static void closeAll() {
        AlarmActivity a = current.get();
        if (a != null) a.finish();
    }

    private Bundle ex;
    private TextView title;
    private TextView body;

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(0xFF0B0C10);
        getWindow().setNavigationBarColor(0xFF0B0C10);
        setContentView(build());
        show(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        show(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // будильник уже выключили, а экран открыли из списка недавних — закрыть
        if (AlarmService.ringing == null) finish();
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    private void show(Intent intent) {
        ex = intent != null && intent.getExtras() != null ? intent.getExtras() : AlarmService.ringing;
        if (ex == null) ex = new Bundle();
        title.setText(ex.getString("title", "Задача"));
        String b = ex.getString("body", "");
        body.setText(b);
        body.setVisibility(b.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private float dp(float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String s, int bg, int fg, String action) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setTextColor(fg);
        GradientDrawable d = new GradientDrawable();
        d.setColor(bg);
        d.setCornerRadius(dp(18));
        b.setBackground(d);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (int) dp(58));
        lp.topMargin = (int) dp(12);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> {
            AlarmReceiver.act(this, action, ex);
            // «Готово» — открыть приложение: отметка задачи сразу уйдёт в облако
            if (AlarmReceiver.ACTION_DONE.equals(action)) {
                Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (open != null) startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            finish();
        });
        return b;
    }

    private View build() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(0xFF0B0C10);
        int pad = (int) dp(28);
        root.setPadding(pad, pad, pad, pad);

        TextView label = text("⏰ Будильник SuperMind", 16, 0xFF8E8E93, false);
        TextView clock = text(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()), 72, Color.WHITE, true);
        title = text("", 26, Color.WHITE, true);
        title.setPadding(0, (int) dp(16), 0, (int) dp(6));
        body = text("", 16, 0xFFAEAEB2, false);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.VERTICAL);
        buttons.setPadding(0, (int) dp(40), 0, 0);
        boolean task = AlarmService.ringing != null && !AlarmService.ringing.getString("taskId", "").isEmpty();
        Bundle in = getIntent() != null ? getIntent().getExtras() : null;
        if (in != null && !in.getString("taskId", "").isEmpty()) task = true;
        if (task) buttons.addView(button("✓ Готово", 0xFF007AFF, Color.WHITE, AlarmReceiver.ACTION_DONE));
        buttons.addView(button("Отложить 10 минут", 0xFF2C2C2E, Color.WHITE, AlarmReceiver.ACTION_SNOOZE));
        buttons.addView(button("Выключить", 0xFF2C2C2E, 0xFFFF453A, AlarmReceiver.ACTION_STOP));

        root.addView(label);
        root.addView(clock);
        root.addView(title);
        root.addView(body);
        root.addView(buttons);
        return root;
    }
}
