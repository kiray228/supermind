package app.twomind.mindmap;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.util.TimeZone;

/**
 * Календарь телефона: запись задач SuperMind как событий и чтение событий для вида «Календарь».
 */
@CapacitorPlugin(
    name = "SmCalendar",
    permissions = {
        @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR })
    }
)
public class SmCalendarPlugin extends Plugin {

    private boolean granted() {
        return getPermissionState("calendar") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void checkAccess(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (granted()) {
            checkAccess(call);
            return;
        }
        requestPermissionForAlias("calendar", call, "accessCallback");
    }

    @PermissionCallback
    private void accessCallback(PluginCall call) {
        checkAccess(call);
    }

    @PluginMethod
    public void listCalendars(PluginCall call) {
        if (!granted()) {
            call.reject("no-permission");
            return;
        }
        String[] proj = {
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.CALENDAR_COLOR,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.VISIBLE,
            CalendarContract.Calendars.IS_PRIMARY,
        };
        JSArray out = new JSArray();
        try (Cursor c = getContext().getContentResolver().query(CalendarContract.Calendars.CONTENT_URI, proj, null, null, null)) {
            while (c != null && c.moveToNext()) {
                JSObject o = new JSObject();
                o.put("id", String.valueOf(c.getLong(0)));
                o.put("name", c.getString(1));
                o.put("account", c.getString(2));
                o.put("color", String.format("#%06X", 0xFFFFFF & c.getInt(3)));
                o.put("writable", c.getInt(4) >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR);
                o.put("visible", c.getInt(5) == 1);
                o.put("primary", !c.isNull(6) && c.getInt(6) == 1);
                out.put(o);
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("calendars", out);
        call.resolve(r);
    }

    /** Первый доступный для записи календарь (основной — в приоритете) */
    private long defaultCalendarId(ContentResolver cr) {
        String[] proj = { CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL };
        long first = -1;
        try (Cursor c = cr.query(CalendarContract.Calendars.CONTENT_URI, proj, CalendarContract.Calendars.VISIBLE + "=1", null, null)) {
            while (c != null && c.moveToNext()) {
                if (c.getInt(2) < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) continue;
                if (!c.isNull(1) && c.getInt(1) == 1) return c.getLong(0);
                if (first < 0) first = c.getLong(0);
            }
        }
        return first >= 0 ? first : createLocalCalendar(cr);
    }

    /** На телефоне без аккаунтов календаря — свой локальный календарь «SuperMind» */
    private long createLocalCalendar(ContentResolver cr) {
        Uri uri = CalendarContract.Calendars.CONTENT_URI.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, "SuperMind")
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build();
        ContentValues v = new ContentValues();
        v.put(CalendarContract.Calendars.ACCOUNT_NAME, "SuperMind");
        v.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        v.put(CalendarContract.Calendars.NAME, "SuperMind");
        v.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, "SuperMind");
        v.put(CalendarContract.Calendars.CALENDAR_COLOR, 0xFF10B981);
        v.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER);
        v.put(CalendarContract.Calendars.OWNER_ACCOUNT, "SuperMind");
        v.put(CalendarContract.Calendars.VISIBLE, 1);
        v.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
        v.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().getID());
        try {
            Uri created = cr.insert(uri, v);
            return created != null ? Long.parseLong(created.getLastPathSegment()) : -1;
        } catch (Exception e) {
            return -1;
        }
    }

    /**
     * Создать или обновить событие.
     * start/end — миллисекунды; для событий на весь день — полночь UTC нужной даты.
     * rrule — правило повтора (RRULE без префикса) или пусто.
     */
    @PluginMethod
    public void upsertEvent(PluginCall call) {
        if (!granted()) {
            call.reject("no-permission");
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        String id = call.getString("id");
        String calId = call.getString("calendarId");
        long cal = calId != null && !calId.isEmpty() ? Long.parseLong(calId) : defaultCalendarId(cr);
        if (cal < 0) {
            call.reject("no-calendar");
            return;
        }
        boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));
        long start = call.getLong("start", 0L);
        long end = call.getLong("end", start + 30 * 60000L);
        String rrule = call.getString("rrule");
        boolean recurring = rrule != null && !rrule.isEmpty();

        ContentValues v = new ContentValues();
        v.put(CalendarContract.Events.CALENDAR_ID, cal);
        v.put(CalendarContract.Events.TITLE, call.getString("title", ""));
        v.put(CalendarContract.Events.DESCRIPTION, call.getString("description", ""));
        v.put(CalendarContract.Events.DTSTART, start);
        v.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
        v.put(CalendarContract.Events.EVENT_TIMEZONE, allDay ? "UTC" : TimeZone.getDefault().getID());
        v.put(CalendarContract.Events.HAS_ALARM, 0);
        if (recurring) {
            // у повторяющихся событий Android требует DURATION вместо DTEND
            long mins = Math.max(1, (end - start) / 60000L);
            v.put(CalendarContract.Events.RRULE, rrule);
            v.put(CalendarContract.Events.DURATION, allDay ? "P" + Math.max(1, mins / 1440) + "D" : "PT" + mins + "M");
            v.putNull(CalendarContract.Events.DTEND);
        } else {
            v.put(CalendarContract.Events.DTEND, end);
            v.putNull(CalendarContract.Events.RRULE);
            v.putNull(CalendarContract.Events.DURATION);
        }

        try {
            if (id != null && !id.isEmpty()) {
                Uri uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(id));
                int n = cr.update(uri, v, null, null);
                if (n > 0) {
                    JSObject r = new JSObject();
                    r.put("id", id);
                    call.resolve(r);
                    return;
                }
            }
            Uri created = cr.insert(CalendarContract.Events.CONTENT_URI, v);
            if (created == null) {
                call.reject("insert-failed");
                return;
            }
            JSObject r = new JSObject();
            r.put("id", created.getLastPathSegment());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void deleteEvents(PluginCall call) {
        if (!granted()) {
            call.reject("no-permission");
            return;
        }
        JSArray ids = call.getArray("ids");
        ContentResolver cr = getContext().getContentResolver();
        int n = 0;
        try {
            for (int i = 0; ids != null && i < ids.length(); i++) {
                Uri uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(ids.getString(i)));
                n += cr.delete(uri, null, null);
            }
        } catch (JSONException | NumberFormatException e) {
            call.reject(e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("deleted", n);
        call.resolve(r);
    }

    /** События (с развёрнутыми повторами) в интервале [from, to] */
    @PluginMethod
    public void listEvents(PluginCall call) {
        if (!granted()) {
            call.reject("no-permission");
            return;
        }
        long from = call.getLong("from", 0L);
        long to = call.getLong("to", 0L);
        String[] proj = {
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.DISPLAY_COLOR,
            CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.CALENDAR_ID,
        };
        JSArray out = new JSArray();
        try (Cursor c = CalendarContract.Instances.query(getContext().getContentResolver(), proj, from, to)) {
            while (c != null && c.moveToNext()) {
                JSObject o = new JSObject();
                o.put("eventId", String.valueOf(c.getLong(0)));
                o.put("title", c.getString(1));
                o.put("begin", c.getLong(2));
                o.put("end", c.getLong(3));
                o.put("allDay", c.getInt(4) == 1);
                o.put("color", String.format("#%06X", 0xFFFFFF & c.getInt(5)));
                o.put("calendar", c.getString(6));
                o.put("location", c.getString(7));
                o.put("calendarId", String.valueOf(c.getLong(8)));
                out.put(o);
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("events", out);
        call.resolve(r);
    }

    /** Открыть системный редактор события с заполненными полями (разрешение не нужно) */
    @PluginMethod
    public void insertWithPrompt(PluginCall call) {
        boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));
        Intent i = new Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, call.getString("title", ""))
            .putExtra(CalendarContract.Events.DESCRIPTION, call.getString("description", ""))
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, call.getLong("start", System.currentTimeMillis()))
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, call.getLong("end", System.currentTimeMillis() + 1800000L))
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay);
        String rrule = call.getString("rrule");
        if (rrule != null && !rrule.isEmpty()) i.putExtra(CalendarContract.Events.RRULE, rrule);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
