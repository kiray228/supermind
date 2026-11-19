package app.twomind.mindmap;

import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Build;

import org.json.JSONObject;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Язык подписей нативной части (виджеты, будильники, выбор карты): как в приложении.
 * Приложение присылает его в данных виджетов (поле lang: ru / en / kk); пока данных нет — по языкам системы,
 * как в src/i18n: первый казахский или русский/соседний — он, иначе английский.
 * Строки из ресурсов (values, values-en, values-kk) — на любом из трёх; t(ru, en) для казахского — по-русски,
 * t(ru, en, kk) — по-казахски.
 */
final class Lang {
    private Lang() {}

    private static final String KEY_LANG = "lang";
    /** Языки, носители которых чаще читают по-русски, чем по-английски (как RU_LIKE в src/i18n) */
    private static final Pattern RU_LIKE = Pattern.compile("^(ru|uk|be|uz|ky|tg|hy|az|ka|tk|mn)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern KK = Pattern.compile("^kk\\b", Pattern.CASE_INSENSITIVE);
    static final Locale RU = Locale.forLanguageTag("ru");
    static final Locale EN = Locale.ENGLISH;
    static final Locale KZ = Locale.forLanguageTag("kk");

    /** "ru" / "en" / "kk" */
    private static volatile String code;
    private static final java.util.Map<String, Resources> resCache = new java.util.concurrent.ConcurrentHashMap<>();

    /** Язык из данных приложения ("ru" / "en" / "kk") или null */
    static String fromJson(String json) {
        if (json == null) return null;
        try {
            String l = new JSONObject(json).optString("lang", "");
            return "ru".equals(l) || "en".equals(l) || "kk".equals(l) ? l : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Приложение прислало данные: запомнить язык отдельно (для быстрого чтения) */
    static void onData(Context ctx, String json) {
        String l = fromJson(json);
        if (l == null) return;
        ctx.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LANG, l).apply();
        code = l;
    }

    /** Язык подписей: "ru", "en" или "kk" */
    static String code(Context ctx) {
        String v = code;
        if (v != null) return v;
        android.content.SharedPreferences p = ctx.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE);
        String l = p.getString(KEY_LANG, null);
        if (l == null) l = fromJson(p.getString("data", null));
        v = l != null ? l : systemLang();
        code = v;
        return v;
    }

    /** Подписи — по-английски */
    static boolean en(Context ctx) {
        return "en".equals(code(ctx));
    }

    /** Подписи — по-казахски */
    static boolean kk(Context ctx) {
        return "kk".equals(code(ctx));
    }

    private static String systemLang() {
        if (Build.VERSION.SDK_INT >= 24) {
            android.os.LocaleList list = android.os.LocaleList.getDefault();
            if (list.isEmpty()) return "ru";
            for (int i = 0; i < list.size(); i++) {
                String tag = list.get(i).toLanguageTag();
                if (KK.matcher(tag).find()) return "kk";
                if (RU_LIKE.matcher(tag).find()) return "ru";
            }
            return "en";
        }
        String tag = Locale.getDefault().toLanguageTag();
        return KK.matcher(tag).find() ? "kk" : RU_LIKE.matcher(tag).find() ? "ru" : "en";
    }

    static Locale locale(Context ctx) {
        String c = code(ctx);
        return "en".equals(c) ? EN : "kk".equals(c) ? KZ : RU;
    }

    /** Русский или английский вариант (для казахского — русский) */
    static String t(Context ctx, String ru, String en) {
        return en(ctx) ? en : ru;
    }

    /** Русский, английский или казахский вариант */
    static String t(Context ctx, String ru, String en, String kk) {
        String c = code(ctx);
        return "en".equals(c) ? en : "kk".equals(c) ? kk : ru;
    }

    /**
     * Число со словом: по-русски — три формы (1 день, 2 дня, 5 дней), по-английски — две (1 day, 2 days).
     * Возвращает только слово, без числа. Для казахского — русские формы; с аргументом kk — казахское слово.
     */
    static String plural(Context ctx, int n, String one, String few, String many, String enOne, String enMany) {
        if (en(ctx)) return Math.abs(n) == 1 ? enOne : enMany;
        return ruPlural(n, one, few, many);
    }

    /** То же с казахским: после числа слово по-казахски не меняется (5 күн, 3 тапсырма) — одна форма */
    static String plural(Context ctx, int n, String one, String few, String many, String enOne, String enMany, String kk) {
        if (kk(ctx)) return kk;
        return plural(ctx, n, one, few, many, enOne, enMany);
    }

    static String ruPlural(int n, String one, String few, String many) {
        int a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b == 1) return one;
        if (b >= 2 && b <= 4) return few;
        return many;
    }

    /** Ресурсы на языке приложения (а не системы): для строк из values / values-en / values-kk */
    static Resources res(Context ctx) {
        String k = code(ctx);
        Resources r = resCache.get(k);
        if (r != null) return r;
        Configuration c = new Configuration(ctx.getResources().getConfiguration());
        c.setLocale(locale(ctx));
        r = ctx.createConfigurationContext(c).getResources();
        resCache.put(k, r);
        return r;
    }

    static String str(Context ctx, int id) {
        return res(ctx).getString(id);
    }
}
