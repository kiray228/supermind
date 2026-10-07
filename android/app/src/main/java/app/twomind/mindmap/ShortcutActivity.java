package app.twomind.mindmap;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Ярлыки значка приложения («Новая задача», «Привычки», «Поиск», «Новая заметка»).
 * Лаунчер запускает статические ярлыки с CLEAR_TASK — если бы они вели прямо в MainActivity,
 * приложение каждый раз перезапускалось бы. Эта невидимая активность живёт в своей задаче
 * и передаёт действие в уже открытое приложение (onNewIntent → очередь WidgetBridge).
 */
public class ShortcutActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent src = getIntent();
        Intent i = new Intent(this, MainActivity.class);
        String action = src != null ? src.getStringExtra(TodayWidget.EXTRA_ACTION) : null;
        if (action != null) {
            i.setAction("app.twomind.mindmap.shortcut." + action);
            i.putExtras(src);
        } else i.setAction(Intent.ACTION_MAIN);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
        finish();
        overridePendingTransition(0, 0);
    }
}
