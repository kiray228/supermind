package app.twomind.mindmap;

import android.content.Intent;
import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Активность восстановлена системой — исходный intent уже обработан раньше */
    private boolean restored = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmCalendarPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(SmAlarmPlugin.class);
        registerPlugin(FocusLivePlugin.class);
        registerPlugin(AppIconPlugin.class);
        restored = savedInstanceState != null;
        // от края до края и на Android 14 и старше — как в Android 15+ (рекомендация Google Play):
        // приложение само рисует фон под панелями, отступы берёт из safe-area. После super: окно AppCompat уже создано
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }

    /** Вызывается и для intent запуска (из BridgeActivity.load), и для новых (виджет, «Поделиться») */
    @Override
    protected void onNewIntent(Intent intent) {
        if (intent != null) {
            boolean stale = (restored && intent == getIntent())
                || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
            if (!stale) TodayWidget.queueFromIntent(this, intent);
        }
        super.onNewIntent(intent);
    }
}
