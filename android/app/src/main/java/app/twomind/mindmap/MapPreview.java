package app.twomind.mindmap;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Набросок карты для виджета: центральная тема и основные ветви — цветные «пилюли»,
 * соединённые плавными линиями. Рисуется в dp (canvas масштабируется); цвета не зависят
 * от светлой/тёмной темы — текст на заливке подбирается по контрасту.
 */
final class MapPreview {
    private MapPreview() {}

    private static final class Branch {
        String text;
        int color, children;
        boolean left;
    }

    static boolean isLight(int c) {
        double l = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255.0;
        return l > 0.66;
    }

    private static int onColor(int c) {
        return isLight(c) ? 0xFF1B1C20 : 0xFFFFFFFF;
    }

    /** Текст в несколько строк с многоточием; ширина — по самой длинной строке */
    private static StaticLayout layout(String text, TextPaint p, float maxW, int maxLines) {
        int w = (int) Math.max(8, Math.ceil(Math.min(maxW, p.measureText(text))));
        StaticLayout l = StaticLayout.Builder.obtain(text, 0, text.length(), p, w)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setMaxLines(maxLines)
            .setEllipsize(TextUtils.TruncateAt.END)
            .setIncludePad(false)
            .build();
        return l;
    }

    /** Ширина самой длинной строки (перенос мог оставить строки короче ширины макета) */
    private static float textWidth(StaticLayout l) {
        float real = 0;
        for (int i = 0; i < l.getLineCount(); i++) real = Math.max(real, l.getLineWidth(i));
        return real > 0 ? Math.min(real, l.getWidth()) : l.getWidth();
    }

    private static void drawLayout(Canvas cv, StaticLayout l, float cx, float cy) {
        cv.save();
        cv.translate(cx - l.getWidth() / 2f, cy - l.getHeight() / 2f);
        l.draw(cv);
        cv.restore();
    }

    /** w, h — в dp; scale — пикселей на dp */
    static Bitmap draw(JSONObject map, float w, float h, float scale) {
        int pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale));
        Bitmap bmp = Bitmap.createBitmap(pw, ph, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        cv.scale(scale, scale);

        int rootColor = SmWidgets.parseColor(map.optString("rc"), 0xFF6366F1);
        String rootText = map.optString("r", "Карта");
        List<Branch> all = new ArrayList<>();
        JSONArray b = map.optJSONArray("b");
        if (b != null) {
            for (int i = 0; i < b.length(); i++) {
                JSONObject o = b.optJSONObject(i);
                if (o == null) continue;
                Branch br = new Branch();
                br.text = o.optString("t", "…");
                br.color = SmWidgets.parseColor(o.optString("c"), rootColor);
                br.children = o.optInt("n", 0);
                br.left = o.optInt("l", 0) == 1;
                all.add(br);
            }
        }

        boolean big = h >= 150 && w >= 280;
        TextPaint rootPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        rootPaint.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        rootPaint.setTextSize(big ? 15 : 13.5f);
        TextPaint brPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        brPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        brPaint.setTextSize(big ? 13 : 12);
        TextPaint smallPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        smallPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        smallPaint.setTextSize(10);

        final float pad = 4, gap = 18;
        boolean twoSided = map.optInt("s", 0) != 1 && w >= 240 && all.size() > 1;

        // правая сторона — первая половина ветвей (сверху вниз), левая — остальные (снизу вверх)
        List<Branch> right = new ArrayList<>(), left = new ArrayList<>();
        if (twoSided) {
            // стороны — как в редакторе (поле l); без них — поровну
            boolean known = false;
            for (Branch x : all) known |= x.left;
            int nr = (all.size() + 1) / 2;
            for (int i = 0; i < all.size(); i++) {
                Branch x = all.get(i);
                if (known ? !x.left : i < nr) right.add(x);
                else left.add(x);
            }
            if (!known) Collections.reverse(left);
            if (left.isEmpty() || right.isEmpty()) {
                right.clear();
                left.clear();
                right.addAll(all);
                twoSided = false;
            }
        } else right.addAll(all);

        // центральная тема: до 2–3 строк
        float rootMax = Math.min(twoSided ? w * 0.32f : w * 0.38f, 150);
        rootPaint.setColor(onColor(rootColor));
        StaticLayout rl = layout(rootText, rootPaint, rootMax - 24, h >= 150 ? 3 : 2);
        float rootW = Math.max(56, textWidth(rl) + 24);
        float rootH = rl.getHeight() + 18;
        float cx = twoSided ? w / 2 : pad + rootW / 2 + 2;
        float cy = h / 2;

        Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(2.4f);
        line.setStrokeCap(Paint.Cap.ROUND);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setStyle(Paint.Style.FILL);

        float colW = twoSided ? (w - rootW) / 2 - gap - pad : w - (cx + rootW / 2) - gap - pad;
        drawSide(cv, right, true, cx + rootW / 2, cy, cx + rootW / 2 + gap, colW, h, pad, line, fill, brPaint, smallPaint);
        drawSide(cv, left, false, cx - rootW / 2, cy, cx - rootW / 2 - gap, colW, h, pad, line, fill, brPaint, smallPaint);

        // центральная тема — поверх линий, с мягкой тенью
        RectF rr = new RectF(cx - rootW / 2, cy - rootH / 2, cx + rootW / 2, cy + rootH / 2);
        fill.setColor(rootColor);
        fill.setShadowLayer(5, 0, 2, 0x40000000);
        cv.drawRoundRect(rr, 14, 14, fill);
        fill.clearShadowLayer();
        drawLayout(cv, rl, cx, cy);

        if (all.isEmpty()) {
            smallPaint.setColor(rootColor);
            String hint = "Пока без ветвей";
            cv.drawText(hint, cx - smallPaint.measureText(hint) / 2, cy + rootH / 2 + 16, smallPaint);
        }
        return bmp;
    }

    private static void drawSide(Canvas cv, List<Branch> list, boolean toRight, float fromX, float fromY, float edgeX, float colW,
                                 float h, float pad, Paint line, Paint fill, TextPaint brPaint, TextPaint smallPaint) {
        if (list.isEmpty() || colW < 28) return;
        float avail = h - 2 * pad;
        float oneLine = brPaint.getFontSpacing() + 12;
        int fit = Math.max(1, (int) (avail / (oneLine + 4)));
        int hidden = 0;
        List<Branch> shown = list;
        if (list.size() > fit) {
            hidden = list.size() - (fit - 1);
            shown = new ArrayList<>(list.subList(0, fit - 1));
        }
        int slots = shown.size() + (hidden > 0 ? 1 : 0);
        float slot = Math.min(avail / slots, 64);
        // две строки в «пилюле», если хватает высоты
        int lines = slot >= brPaint.getFontSpacing() * 2 + 18 ? 2 : 1;
        boolean badges = colW >= 110;
        float top = h / 2 - slot * slots / 2;
        for (int i = 0; i < shown.size(); i++) {
            Branch br = shown.get(i);
            float by = top + slot * i + slot / 2;
            String badge = badges && br.children > 0 ? String.valueOf(br.children) : "";
            float badgeW = badge.isEmpty() ? 0 : Math.max(16, smallPaint.measureText(badge) + 8) + 4;
            brPaint.setColor(onColor(br.color));
            StaticLayout tl = layout(br.text, brPaint, Math.max(10, colW - 22 - badgeW), lines);
            float bw = textWidth(tl) + 22;
            float bh = tl.getHeight() + 10;
            float rad = Math.min(bh / 2, 14);
            float x0 = toRight ? edgeX : edgeX - bw;
            float x1 = x0 + bw;
            float nearX = toRight ? x0 : x1;

            // линия ветви: от центральной темы к ближнему краю «пилюли»
            line.setColor(br.color);
            Path p = new Path();
            p.moveTo(fromX + (toRight ? -6 : 6), fromY);
            float mx = (fromX + nearX) / 2;
            p.cubicTo(mx, fromY, mx, by, nearX, by);
            cv.drawPath(p, line);

            RectF r = new RectF(x0, by - bh / 2, x1, by + bh / 2);
            fill.setColor(br.color);
            cv.drawRoundRect(r, rad, rad, fill);
            drawLayout(cv, tl, (x0 + x1) / 2, by);

            // число подтем — маленький кружок снаружи
            if (!badge.isEmpty()) {
                float bwid = badgeW - 4;
                float bx0 = toRight ? x1 + 4 : x0 - 4 - bwid;
                RectF br2 = new RectF(bx0, by - 8, bx0 + bwid, by + 8);
                Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
                ring.setStyle(Paint.Style.STROKE);
                ring.setStrokeWidth(1.4f);
                ring.setColor(br.color);
                cv.drawRoundRect(br2, 8, 8, ring);
                smallPaint.setColor(br.color);
                cv.drawText(badge, bx0 + (bwid - smallPaint.measureText(badge)) / 2, by - (smallPaint.descent() + smallPaint.ascent()) / 2, smallPaint);
            }
        }
        if (hidden > 0) {
            float by = top + slot * shown.size() + slot / 2;
            String more = "+" + hidden;
            float bw = smallPaint.measureText(more) + 16;
            float x0 = toRight ? edgeX : edgeX - bw;
            RectF r = new RectF(x0, by - 9, x0 + bw, by + 9);
            Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(1.4f);
            ring.setColor(0xFF8A8F99);
            cv.drawRoundRect(r, 9, 9, ring);
            smallPaint.setColor(0xFF8A8F99);
            cv.drawText(more, x0 + 8, by - (smallPaint.descent() + smallPaint.ascent()) / 2, smallPaint);
        }
    }
}
