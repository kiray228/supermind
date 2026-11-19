package app.twomind.mindmap;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Иконка приложения: в манифесте на каждую иконку — activity-alias к MainActivity с LAUNCHER (включён ровно один).
 * Смена — включить нужный и выключить остальные (без перезапуска приложения; лаунчеру нужно несколько секунд).
 * Виджеты, уведомления и ярлыки открывают MainActivity напрямую — от выбранного alias не зависят.
 * Тот же JS-интерфейс, что у iPhone (src/native/appIcon.ts).
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    /** id из приложения → activity-alias в AndroidManifest.xml */
    private static final String[][] ICONS = {
        { "default", "IconDefault" },
        { "dark", "IconDark" },
        { "light", "IconLight" },
        { "green", "IconGreen" },
        { "sunset", "IconSunset" },
        { "purple", "IconPurple" },
    };

    private static ComponentName component(Context ctx, String alias) {
        return new ComponentName(ctx.getPackageName(), ctx.getPackageName() + "." + alias);
    }

    private static boolean enabled(Context ctx, String alias) {
        PackageManager pm = ctx.getPackageManager();
        int st = pm.getComponentEnabledSetting(component(ctx, alias));
        // «по умолчанию» — как в манифесте: включён только IconDefault
        if (st == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT) return "IconDefault".equals(alias);
        return st == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    static String current(Context ctx) {
        for (String[] i : ICONS) if (enabled(ctx, i[1])) return i[0];
        return "default";
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("name", current(getContext()));
        r.put("supported", true);
        call.resolve(r);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = call.getString("name", "default");
        String target = null;
        for (String[] i : ICONS) if (i[0].equals(name)) target = i[1];
        if (target == null) {
            call.reject("unknown icon");
            return;
        }
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        try {
            // сначала включить новый (чтобы ни на миг не остаться без значка), потом выключить остальные
            pm.setComponentEnabledSetting(component(ctx, target), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            for (String[] i : ICONS) {
                if (i[1].equals(target)) continue;
                pm.setComponentEnabledSetting(component(ctx, i[1]), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            }
        } catch (RuntimeException e) {
            call.reject("failed", e);
            return;
        }
        JSObject r = new JSObject();
        r.put("name", name);
        call.resolve(r);
    }
}
