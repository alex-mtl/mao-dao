// The streamer app for Guess the Word (stream-client/README.md): a window onto the streamer's room
// on the platform, signed in with the access key of a client account, and a local address
// (http://localhost:7777/overlay) that OBS / TikTok LIVE Studio load and get sent on to the overlay.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_BASE: &str = "https://mao-dao.com";
const OVERLAY_PORT: u16 = 7777;

/// GW_BASE_URL points a test build at a local platform
fn base() -> String {
    std::env::var("GW_BASE_URL")
        .unwrap_or_else(|_| DEFAULT_BASE.into())
        .trim_end_matches('/')
        .to_string()
}

#[derive(Default)]
struct Shared {
    key: Option<String>,
    overlay: Option<String>, // the last overlay link: OBS keeps working through a short network hiccup
}
type Store = Arc<Mutex<Shared>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionReply {
    enter_url: String,
    overlay_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayReply {
    overlay_url: String,
}

fn key_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("key.txt"))
}

/// the app's own pages (the key form)
fn local_url() -> Url {
    let url = if cfg!(windows) { "http://tauri.localhost/index.html" } else { "tauri://localhost/index.html" };
    Url::parse(url).expect("local url")
}

fn is_local(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

/// "bad_key" / "no_access" / "network" go back to the key form as they are
async fn session(key: &str) -> Result<SessionReply, String> {
    let res = reqwest::Client::new()
        .post(format!("{}/guessword/client/api/session", base()))
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "key": key }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    match res.status().as_u16() {
        200 => res.json().await.map_err(|_| "network".to_string()),
        401 => Err("bad_key".into()),
        403 => Err("no_access".into()),
        _ => Err("network".into()),
    }
}

#[tauri::command]
fn stored_key(app: AppHandle) -> Option<String> {
    key_file(&app)
        .and_then(|f| fs::read_to_string(f).ok())
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

#[tauri::command]
async fn sign_in(app: AppHandle, store: tauri::State<'_, Store>, key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    let reply = session(&key).await?;
    if let Some(file) = key_file(&app) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(file, &key);
    }
    {
        let mut s = store.lock().unwrap();
        s.key = Some(key);
        s.overlay = Some(reply.overlay_url);
    }
    let url = Url::parse(&reply.enter_url).map_err(|_| "network".to_string())?;
    app.get_webview_window("main")
        .ok_or("network")?
        .navigate(url)
        .map_err(|_| "network".to_string())
}

/// the menu's "Change key": forget it and show the key form
fn forget_key(app: &AppHandle) {
    if let Some(file) = key_file(app) {
        let _ = fs::remove_file(file);
    }
    let store = app.state::<Store>();
    *store.lock().unwrap() = Shared::default();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(local_url());
    }
}

enum Overlay {
    Url(String),
    Refused, // the key was revoked or the pack switched off: no stale link either
    Offline,
}

fn fetch_overlay(key: &str) -> Overlay {
    let res = reqwest::blocking::Client::new()
        .post(format!("{}/guessword/client/api/overlay", base()))
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "key": key }))
        .timeout(Duration::from_secs(10))
        .send();
    match res {
        Ok(r) if r.status().is_success() => match r.json::<OverlayReply>() {
            Ok(o) => Overlay::Url(o.overlay_url),
            Err(_) => Overlay::Offline,
        },
        Ok(r) if matches!(r.status().as_u16(), 401 | 403) => Overlay::Refused,
        _ => Overlay::Offline,
    }
}

// what OBS shows while the app has no key yet: transparent, asks again every 5 s
const WAITING_HTML: &str = "<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=5>\
<style>html,body{background:transparent;margin:0;font:600 18px system-ui;color:#fff;text-shadow:0 1px 3px #000}\
p{padding:16px}</style><p>Guess the Word: open the app and enter your key</p>";

/// http://localhost:7777/overlay → 302 to the room's overlay (asked anew on every load, so a new
/// Studio link from the room works at once)
fn serve_overlay(store: Store) {
    let server = match tiny_http::Server::http(("127.0.0.1", OVERLAY_PORT)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("overlay port {OVERLAY_PORT} is busy: {e}");
            return;
        }
    };
    for req in server.incoming_requests() {
        let path = req.url().split('?').next().unwrap_or("").trim_end_matches('/').to_string();
        if path != "/overlay" {
            let _ = req.respond(tiny_http::Response::from_string("Not found").with_status_code(404));
            continue;
        }
        let key = store.lock().unwrap().key.clone();
        let target = match key.as_deref().map(fetch_overlay) {
            Some(Overlay::Url(u)) => {
                store.lock().unwrap().overlay = Some(u.clone());
                Some(u)
            }
            Some(Overlay::Offline) => store.lock().unwrap().overlay.clone(),
            Some(Overlay::Refused) | None => None,
        };
        let _ = match target {
            Some(url) => req.respond(
                tiny_http::Response::empty(302)
                    .with_header(tiny_http::Header::from_bytes("Location", url.as_bytes()).unwrap())
                    .with_header(tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap()),
            ),
            None => req.respond(
                tiny_http::Response::from_string(WAITING_HTML)
                    .with_header(tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap()),
            ),
        };
    }
}

fn main() {
    let store: Store = Arc::default();
    let overlay_store = store.clone();
    thread::spawn(move || serve_overlay(overlay_store));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(store)
        .invoke_handler(tauri::generate_handler![stored_key, sign_in])
        .setup(|app| {
            let handle = app.handle().clone();
            let reload = MenuItem::with_id(app, "reload", "Обновить / Reload", true, Some("F5"))?;
            let change = MenuItem::with_id(app, "change_key", "Сменить ключ / Change key", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&Submenu::with_items(app, "Меню / Menu", true, &[&reload, &change])?])?;

            let our_host = Url::parse(&base()).ok().and_then(|u| u.host_str().map(String::from));
            let nav = handle.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Guess the Word")
                .inner_size(1280.0, 860.0)
                .min_inner_size(400.0, 500.0)
                .menu(menu)
                // only the room on our site; the site's other pages (a lost session lands on /login)
                // go back to the key form, which signs in again; anything else opens in the browser
                .on_navigation(move |url| {
                    if is_local(url) {
                        return true;
                    }
                    if url.host_str() == our_host.as_deref() {
                        if url.path().starts_with("/guessword/") || url.path() == "/guessword" {
                            return true;
                        }
                        let h = nav.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(w) = h.get_webview_window("main") {
                                let _ = w.navigate(local_url());
                            }
                        });
                        return false;
                    }
                    let _ = nav.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "reload" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.eval("location.reload()");
                    }
                }
                "change_key" => forget_key(app),
                _ => {}
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
