// SuperMind для Windows: окно с веб-версией на встроенном в Windows движке (WebView2).
// Сайт кэшируется service worker'ом — после первого запуска работает офлайн,
// а обновления приходят сами вместе с сайтом. Саму программу обновляет tauri-plugin-updater:
// при запуске сверяется с latest.json в релизе `windows` и ставит подписанный установщик.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

const APP_URL: &str = "https://kiray228.github.io/supermind/";
// прежний адрес (до переименования) переадресует на новый
const OLD_URL: &str = "https://kiray228.github.io/2mind/";

/// Сам сайт или заставка из программы — всё остальное открывается в обычном браузере
fn is_app(url: &Url) -> bool {
    let s = url.as_str();
    s.starts_with(APP_URL)
        || s.starts_with(OLD_URL)
        || url.host_str() == Some("tauri.localhost")
        || matches!(url.scheme(), "tauri" | "about" | "data" | "blob")
}

fn open_outside(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

/// Журнал для разбора проблем на чужих компьютерах: %LOCALAPPDATA%\app.twomind.supermind\logs\log.txt
fn log<R: Runtime>(app: &AppHandle<R>, msg: &str) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("log.txt")) {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "{secs} {msg}");
    }
}

/// «1.50.0» → «1.50», как в названиях релизов
fn short(v: &str) -> &str {
    v.strip_suffix(".0").unwrap_or(v)
}

/// Новая версия программы: спросить и поставить (установщик закроет окно, обновит и откроет программу снова).
/// Без сети или при ошибке — тихо, до следующего запуска.
async fn check_update(app: AppHandle) {
    let update = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => return log(&app, &format!("updater: {e}")),
    };
    let update = match update {
        Ok(Some(u)) => u,
        Ok(None) => return,
        Err(e) => return log(&app, &format!("update check: {e}")),
    };
    log(&app, &format!("update available {}", update.version));
    let ok = app
        .dialog()
        .message(format!(
            "Вышла новая версия SuperMind {} (у вас {}).

Обновить сейчас? Это займёт несколько секунд, карты и задачи останутся на месте.",
            short(&update.version),
            short(&update.current_version)
        ))
        .title("Обновление SuperMind")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Обновить".into(), "Позже".into()))
        .blocking_show();
    if !ok {
        return log(&app, "update postponed");
    }
    // окно с сайтом — успеть записать несохранённое (pagehide → сохранение карт и задач)
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("window.dispatchEvent(new Event('pagehide'))");
    }
    match update.download_and_install(|_, _| {}, || {}).await {
        // на Windows сюда обычно не доходит: установщик сам закрывает программу и запускает новую
        Ok(()) => app.restart(),
        Err(e) => {
            log(&app, &format!("update install: {e}"));
            app.dialog()
                .message(format!("Не удалось обновить SuperMind: {e}

Попробуйте позже или скачайте установщик с сайта."))
                .title("Обновление SuperMind")
                .kind(MessageDialogKind::Error)
                .blocking_show();
        }
    }
}

fn main() {
    tauri::Builder::default()
        // второй запуск только показывает уже открытое окно
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // размер и место окна между запусками (за край экрана не восстанавливает)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            log(&handle, &format!("start {}", app.package_info().version));
            let page_log = handle.clone();
            // окно видно сразу: сначала заставка из программы, она сама переходит на сайт
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("SuperMind")
                .inner_size(1280.0, 820.0)
                .min_inner_size(360.0, 500.0)
                .center()
                // метка для сайта: внутри программы не предлагать «Скачать для Windows»
                .initialization_script(format!("window.__SUPERMIND_DESKTOP__ = '{}';", app.package_info().version))
                .on_navigation(|url| {
                    if is_app(url) {
                        return true;
                    }
                    open_outside(url);
                    false
                })
                .on_new_window(|url, _features| {
                    if !is_app(&url) {
                        open_outside(&url);
                    }
                    NewWindowResponse::Deny
                })
                // встроенный браузер Windows без ответа молча запрещает: напоминания (уведомления),
                // голосовой ввод и заметки (микрофон), вставка из буфера
                .on_permission_request(|_w, kind| match kind {
                    PermissionKind::Notifications | PermissionKind::Microphone | PermissionKind::ClipboardRead => {
                        PermissionResponse::Allow
                    }
                    _ => PermissionResponse::Default,
                })
                .on_page_load(move |_w, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        log(&page_log, &format!("loaded {}", payload.url()));
                    }
                })
                .build()?;
            // проверка обновления — после того как окно открылось
            // (отдельный поток: окно-вопрос ждёт ответа, не задерживая программу)
            let upd = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                tauri::async_runtime::block_on(check_update(upd));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("SuperMind не запустился");
}
