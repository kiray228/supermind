package app.twomind.mindmap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

import java.lang.ref.WeakReference;

/**
 * Мост между приложением и виджетами SuperMind («Сегодня», «Календарь», «Привычки», «Карта»):
 * update — данные для виджетов; consumePending — действия из виджетов, ярлыков и «Поделиться».
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    private static WeakReference<WidgetBridgePlugin> instance = new WeakReference<>(null);

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json required");
            return;
        }
        TodayWidget.saveData(getContext(), json);
        SmWidgets.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void consumePending(PluginCall call) {
        JSONArray list = TodayWidget.drainPending(getContext());
        JSObject r = new JSObject();
        try {
            r.put("actions", new JSArray(list.toString()));
        } catch (JSONException e) {
            r.put("actions", new JSArray());
        }
        call.resolve(r);
    }

    /** Новые действия в очереди — приложение заберёт их сразу, если запущено */
    static void notifyPending() {
        WidgetBridgePlugin p = instance.get();
        if (p != null) p.notifyListeners("pending", new JSObject());
    }

    @Override
    protected void handleOnNewIntent(android.content.Intent intent) {
        super.handleOnNewIntent(intent);
        notifyPending();
    }
}
