package app.twomind.mindmap;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.ArrayList;

/**
 * Распознавание одной фразы системным распознавателем Android — вместо стороннего плагина, у которого:
 * режим диктовки (сам не заканчивает фразу), ошибки после старта не доходят до приложения, а повторный
 * запуск сразу после уничтожения прошлого распознавателя падает («Service is unbinding») — каждый второй раз молча.
 *
 * Здесь распознаватель один на всё время работы (создаётся заново только после сбоя службы), все события —
 * в одном потоке «speech» с номером сеанса: ready, begin, level, partial, end, result, error.
 */
@CapacitorPlugin(name = "SmSpeech", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class SmSpeechPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    /** номер текущего сеанса: события прошлых сеансов приложение отбрасывает */
    private int session = 0;
    private boolean active = false;
    /** сеанс отменили сами — ошибка «клиента» после отмены не считается */
    private boolean cancelled = false;
    private String language = null;
    /** уровень громкости отправляем не чаще ~12 раз в секунду */
    private long lastLevel = 0;
    private int retries = 0;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("microphone", "permission");
            return;
        }
        language = call.getString("language");
        main.post(() -> {
            try {
                session++;
                retries = 0;
                begin();
                JSObject r = new JSObject();
                r.put("session", session);
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "start failed");
            }
        });
    }

    /** Закончить фразу: распознаватель досчитает и пришлёт result */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            if (recognizer != null && active) recognizer.stopListening();
            call.resolve();
        });
    }

    /** Прервать без результата */
    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            cancelled = true;
            active = false;
            if (recognizer != null) recognizer.cancel();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(this::destroyRecognizer);
    }

    private void begin() {
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new Listener());
        } else if (active) {
            cancelled = true;
            recognizer.cancel();
        }
        cancelled = false;
        active = true;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        if (language != null && !language.isEmpty()) intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        // подсказки распознавателю: фраза закончена после ~1 с тишины (многие распознаватели их учитывают)
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 800L);
        recognizer.startListening(intent);
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (Exception ignored) {
                // уже отключён
            }
            recognizer = null;
        }
        active = false;
    }

    private void emit(String type, JSObject extra) {
        JSObject o = extra != null ? extra : new JSObject();
        o.put("type", type);
        o.put("session", session);
        notifyListeners("speech", o);
    }

    private static String first(Bundle b) {
        if (b == null) return "";
        ArrayList<String> m = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return m != null && !m.isEmpty() && m.get(0) != null ? m.get(0) : "";
    }

    private class Listener implements RecognitionListener {
        @Override
        public void onReadyForSpeech(Bundle params) {
            emit("ready", null);
        }

        @Override
        public void onBeginningOfSpeech() {
            emit("begin", null);
        }

        @Override
        public void onRmsChanged(float rmsdB) {
            long now = System.currentTimeMillis();
            if (now - lastLevel < 80) return;
            lastLevel = now;
            JSObject o = new JSObject();
            o.put("level", rmsdB);
            emit("level", o);
        }

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {
            emit("end", null);
        }

        @Override
        public void onPartialResults(Bundle partial) {
            String t = first(partial);
            if (t.isEmpty()) return;
            JSObject o = new JSObject();
            o.put("text", t);
            emit("partial", o);
        }

        @Override
        public void onResults(Bundle results) {
            active = false;
            JSObject o = new JSObject();
            o.put("text", first(results));
            emit("result", o);
        }

        @Override
        public void onError(int error) {
            boolean wasCancelled = cancelled;
            active = false;
            if (wasCancelled && error == SpeechRecognizer.ERROR_CLIENT) return;
            // служба распознавания занята или отключилась — пересоздаём распознаватель и пробуем ещё раз
            if ((error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED || error == SpeechRecognizer.ERROR_CLIENT) && retries < 2 && !wasCancelled) {
                retries++;
                destroyRecognizer();
                main.postDelayed(() -> {
                    try {
                        begin();
                    } catch (Exception e) {
                        report(SpeechRecognizer.ERROR_CLIENT);
                    }
                }, 350);
                return;
            }
            // после сбоя службы распознаватель лучше не переиспользовать
            if (error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED) destroyRecognizer();
            report(error);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    }

    private void report(int error) {
        String code;
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                code = "no-speech";
                break;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                code = "permission";
                break;
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
                code = "network";
                break;
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                code = "language";
                break;
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                code = "busy";
                break;
            default:
                code = "failed";
        }
        JSObject o = new JSObject();
        o.put("code", code);
        o.put("error", error);
        emit("error", o);
    }
}
