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
 * Приложение присылает его в данных виджетов (поле lang); пока данных нет — по языкам системы,
 * как в src/i18n: русский, если среди них есть русский или соседний, иначе английский.
 */
final class Lang {
    private Lang() {}

    private static final String KEY_LANG = "lang";
    /** Языки, носители которых чаще читают по-русски, чем по-английски (как RU_LIKE в src/i18n) */
    private static final Pattern RU_LIKE = Pattern.compile("^(ru|kk|uk|be|uz|ky|tg|hy|az|ka|tk|mn)\\b", Pattern.CASE_INSENSITIVE);
    static final Locale RU = Locale.forLanguageTag("ru");
    static final Locale EN = Locale.ENGLISH;

    private static volatile Boolean en;
    private static volatile Resources resRu, resEn;

    /** Язык из данных приложения ("ru" / "en") или null */
    static String fromJson(String json) {
        if (json == null) return null;
        try {
            String l = new JSONObject(json).optString("lang", "");
            return "ru".equals(l) || "en".equals(l) ? l : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Приложение прислало данные: запомнить язык отдельно (для быстрого чтения) */
    static void onData(Context ctx, String json) {
        String l = fromJson(json);
        if (l == null) return;
        ctx.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LANG, l).apply();
        en = "en".equals(l);
    }

    /** Подписи — по-английски */
    static boolean en(Context ctx) {
        Boolean v = en;
        if (v != null) return v;
        android.content.SharedPreferences p = ctx.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE);
        String l = p.getString(KEY_LANG, null);
        if (l == null) l = fromJson(p.getString("data", null));
        v = l != null ? "en".equals(l) : !systemRu();
        en = v;
        return v;
    }

    private static boolean systemRu() {
        if (Build.VERSION.SDK_INT >= 24) {
            android.os.LocaleList list = android.os.LocaleList.getDefault();
            if (list.isEmpty()) return true;
            for (int i = 0; i < list.size(); i++) if (RU_LIKE.matcher(list.get(i).toLanguageTag()).find()) return true;
            return false;
        }
        return RU_LIKE.matcher(Locale.getDefault().toLanguageTag()).find();
    }

    static Locale locale(Context ctx) {
        return en(ctx) ? EN : RU;
    }

    /** Русский или английский вариант */
    static String t(Context ctx, String ru, String en) {
        return en(ctx) ? en : ru;
    }

    /**
     * Число со словом: по-русски — три формы (1 день, 2 дня, 5 дней), по-английски — две (1 day, 2 days).
     * Возвращает только слово, без числа.
     */
    static String plural(Context ctx, int n, String one, String few, String many, String enOne, String enMany) {
        if (en(ctx)) return Math.abs(n) == 1 ? enOne : enMany;
        return ruPlural(n, one, few, many);
    }

    static String ruPlural(int n, String one, String few, String many) {
        int a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b == 1) return one;
        if (b >= 2 && b <= 4) return few;
        return many;
    }

    /** Ресурсы на языке приложения (а не системы): для строк из values / values-en */
    static Resources res(Context ctx) {
        boolean e = en(ctx);
        Resources r = e ? resEn : resRu;
        if (r != null) return r;
        Configuration c = new Configuration(ctx.getResources().getConfiguration());
        c.setLocale(e ? EN : RU);
        r = ctx.createConfigurationContext(c).getResources();
        if (e) resEn = r;
        else resRu = r;
        return r;
    }

    static String str(Context ctx, int id) {
        return res(ctx).getString(id);
    }
}
