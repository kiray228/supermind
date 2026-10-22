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

    /** Есть ли отпечаток или распознавание лица, которые можно использовать для входа */
    @PluginMethod
    public void biometricAvailable(PluginCall call) {
        int r = androidx.biometric.BiometricManager.from(getContext())
            .canAuthenticate(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK);
        JSObject o = new JSObject();
        o.put("available", r == androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(o);
    }

    /** Системное окно отпечатка: ok = true — подтверждено; отмена или «Ввести код» — ok = false */
    @PluginMethod
    public void biometricVerify(PluginCall call) {
        if (!(getActivity() instanceof androidx.fragment.app.FragmentActivity)) {
            call.reject("no activity");
            return;
        }
        androidx.fragment.app.FragmentActivity act = (androidx.fragment.app.FragmentActivity) getActivity();
        String title = call.getString("title", "SuperMind");
        String subtitle = call.getString("subtitle", "");
        String negative = call.getString("negative", "Отмена");
        act.runOnUiThread(() -> {
            // окно уже не на экране (приложение уходит в фон) — системное окно не откроется и не ответит
            if (!act.getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) || act.isFinishing()) {
                JSObject o = new JSObject();
                o.put("ok", false);
                o.put("error", "not resumed");
                call.resolve(o);
                return;
            }
            androidx.biometric.BiometricPrompt prompt = new androidx.biometric.BiometricPrompt(
                act,
                androidx.core.content.ContextCompat.getMainExecutor(act),
                new androidx.biometric.BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(androidx.biometric.BiometricPrompt.AuthenticationResult result) {
                        JSObject o = new JSObject();
                        o.put("ok", true);
                        call.resolve(o);
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence message) {
                        JSObject o = new JSObject();
                        o.put("ok", false);
                        o.put("error", String.valueOf(message));
                        call.resolve(o);
                    }
                }
            );
            androidx.biometric.BiometricPrompt.PromptInfo.Builder info = new androidx.biometric.BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setNegativeButtonText(negative)
                .setAllowedAuthenticators(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK);
            if (!subtitle.isEmpty()) info.setSubtitle(subtitle);
            prompt.authenticate(info.build());
        });
    }

    /** Прятать содержимое в списке недавних приложений (FLAG_SECURE — заодно запрещает скриншоты) */
    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (getActivity() == null) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    /**
     * Откуда установлено приложение: com.android.vending — Google Play (обновляет сам магазин),
     * пусто или другое — APK с сайта (обновление предлагает само приложение)
     */
    @PluginMethod
    public void installSource(PluginCall call) {
        String src = null;
        try {
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            if (android.os.Build.VERSION.SDK_INT >= 30) src = pm.getInstallSourceInfo(pkg).getInstallingPackageName();
            else src = pm.getInstallerPackageName(pkg);
        } catch (Exception ignored) {
            // неизвестно — как APK с сайта
        }
        JSObject r = new JSObject();
        r.put("installer", src == null ? "" : src);
        call.resolve(r);
    }

    /** Открыть ссылку в браузере телефона (скачать новую версию APK) — только https */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("bad url");
            return;
        }
        try {
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
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
