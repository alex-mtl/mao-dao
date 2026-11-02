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
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, Submenu},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry,
};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_BASE: &str = "https://mao-dao.com";
const OVERLAY_PORT: u16 = 7777;

const LANGS: [(&str, &str); 4] = [("ru", "Русский"), ("en", "English"), ("fr", "Français"), ("es", "Español")];
const SCHEMES: [&str; 6] = ["light-warm", "light-cool", "light-soft", "dark-warm", "dark-cool", "dark-neon"];

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
    lang: Option<String>,    // the app's language (menus, key form), kept in lang.txt and sent to the site
    scheme: Option<String>,  // the site's color scheme, as the account has it
}
type Store = Arc<Mutex<Shared>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionReply {
    enter_url: String,
    overlay_url: String,
    ui_language: Option<String>,
    color_scheme: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayReply {
    overlay_url: String,
}

fn data_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(name))
}

fn read_data(app: &AppHandle, name: &str) -> Option<String> {
    data_file(app, name)
        .and_then(|f| fs::read_to_string(f).ok())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn write_data(app: &AppHandle, name: &str, value: &str) {
    if let Some(file) = data_file(app, name) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(file, value);
    }
}

/// the app's own page (the key form); `change` = opened from the menu, with Cancel
fn local_url(change: bool) -> Url {
    let root = if cfg!(windows) { "http://tauri.localhost/index.html" } else { "tauri://localhost/index.html" };
    Url::parse(&format!("{root}{}", if change { "?change=1" } else { "" })).expect("local url")
}

fn is_local(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

fn norm_lang(lang: &str) -> String {
    let l = lang.get(..2).unwrap_or("").to_lowercase();
    if LANGS.iter().any(|(c, _)| *c == l) { l } else { "en".into() }
}

// ---- menu ------------------------------------------------------------------------------------

struct Labels {
    menu: &'static str,
    reload: &'static str,
    change_key: &'static str,
    language: &'static str,
    theme: &'static str,
    schemes: [&'static str; 6], // in SCHEMES order; the same names as the site's profile page
}

fn labels(lang: &str) -> Labels {
    match lang {
        "ru" => Labels { menu: "Меню", reload: "Обновить", change_key: "Сменить ключ…", language: "Язык", theme: "Тема",
            schemes: ["Тёплая", "Холодная", "Мягкая", "Тёмная тёплая", "Тёмная холодная", "Неон"] },
        "fr" => Labels { menu: "Menu", reload: "Actualiser", change_key: "Changer de clé…", language: "Langue", theme: "Thème",
            schemes: ["Chaude", "Froide", "Douce", "Sombre chaude", "Sombre froide", "Néon"] },
        "es" => Labels { menu: "Menú", reload: "Actualizar", change_key: "Cambiar clave…", language: "Idioma", theme: "Tema",
            schemes: ["Cálida", "Fría", "Suave", "Oscura cálida", "Oscura fría", "Neón"] },
        _ => Labels { menu: "Menu", reload: "Reload", change_key: "Change key…", language: "Language", theme: "Theme",
            schemes: ["Warm", "Cool", "Soft", "Dark Warm", "Dark Cool", "Neon"] },
    }
}

/// the whole menu bar in the app's language, the current language and theme checked
fn build_menu(app: &AppHandle, lang: &str, scheme: Option<&str>) -> tauri::Result<Menu<Wry>> {
    let l = labels(lang);
    let reload = MenuItem::with_id(app, "reload", l.reload, true, Some("F5"))?;
    let change = MenuItem::with_id(app, "change_key", l.change_key, true, None::<&str>)?;
    let main = Submenu::with_items(app, l.menu, true, &[&reload, &change])?;

    let langs = LANGS
        .iter()
        .map(|(code, name)| CheckMenuItem::with_id(app, format!("lang:{code}"), *name, true, *code == lang, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let lang_refs: Vec<&dyn IsMenuItem<Wry>> = langs.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let language = Submenu::with_items(app, l.language, true, &lang_refs)?;

    let schemes = SCHEMES
        .iter()
        .zip(l.schemes)
        .map(|(id, name)| CheckMenuItem::with_id(app, format!("scheme:{id}"), name, true, Some(*id) == scheme, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let scheme_refs: Vec<&dyn IsMenuItem<Wry>> = schemes.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let theme = Submenu::with_items(app, l.theme, true, &scheme_refs)?;

    Menu::with_items(app, &[&main, &language, &theme])
}

fn refresh_menu(app: &AppHandle) {
    let (lang, scheme) = {
        let s = app.state::<Store>();
        let s = s.lock().unwrap();
        (s.lang.clone().unwrap_or_else(|| "en".into()), s.scheme.clone())
    };
    if let (Some(w), Ok(menu)) = (app.get_webview_window("main"), build_menu(app, &lang, scheme.as_deref())) {
        let _ = w.set_menu(menu);
    }
}

/// a profile setting saved on the site by the signed-in page itself (its session and CSRF cookie),
/// then the page reloads in it; on the key form only the form reloads
fn apply_on_site(app: &AppHandle, path: &str, field: &str, value: &str) {
    let Some(w) = app.get_webview_window("main") else { return };
    let on_site = w.url().map(|u| !is_local(&u)).unwrap_or(false);
    let js = if on_site {
        format!(
            "(async()=>{{const m=document.cookie.match(/XSRF-TOKEN=([^;]+)/);\
             try{{await fetch('{path}',{{method:'PATCH',credentials:'same-origin',headers:{{'Content-Type':'application/json',\
             'Accept':'application/json','X-XSRF-TOKEN':m?decodeURIComponent(m[1]):''}},body:JSON.stringify({{{field}:'{value}'}})}});}}catch(e){{}}\
             location.reload();}})()"
        )
    } else {
        "location.reload()".to_string()
    };
    let _ = w.eval(&js);
}

fn on_menu(app: &AppHandle, id: &str) {
    if id == "reload" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.eval("location.reload()");
        }
    } else if id == "change_key" {
        // the key stays until another one signs in: Cancel on the form goes back to the room
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.navigate(local_url(true));
        }
    } else if let Some(lang) = id.strip_prefix("lang:") {
        app.state::<Store>().lock().unwrap().lang = Some(lang.to_string());
        write_data(app, "lang.txt", lang);
        refresh_menu(app);
        apply_on_site(app, "/profile/language", "ui_language", lang);
    } else if let Some(scheme) = id.strip_prefix("scheme:") {
        app.state::<Store>().lock().unwrap().scheme = Some(scheme.to_string());
        refresh_menu(app);
        apply_on_site(app, "/profile/color-scheme", "color_scheme", scheme);
    }
}

// ---- signing in ------------------------------------------------------------------------------

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
    read_data(&app, "key.txt")
}

/// the key form's language: the app's, or (first start) the system's that the form passes in
#[tauri::command]
fn ui_lang(app: AppHandle, store: tauri::State<'_, Store>, fallback: String) -> String {
    let (lang, fresh) = {
        let mut s = store.lock().unwrap();
        let fresh = s.lang.is_none();
        (s.lang.get_or_insert_with(|| norm_lang(&fallback)).clone(), fresh)
    };
    if fresh {
        refresh_menu(&app);
    }
    lang
}

#[tauri::command]
async fn sign_in(app: AppHandle, store: tauri::State<'_, Store>, key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    let reply = session(&key).await?;
    write_data(&app, "key.txt", &key);

    // the app's language and a theme picked on the key form go to the account
    let (lang, scheme) = {
        let mut s = store.lock().unwrap();
        s.key = Some(key);
        s.overlay = Some(reply.overlay_url);
        let lang = s.lang.clone().or(reply.ui_language).unwrap_or_else(|| "en".into());
        let scheme = s.scheme.clone().or(reply.color_scheme);
        s.lang = Some(lang.clone());
        s.scheme = scheme.clone();
        (lang, scheme)
    };
    write_data(&app, "lang.txt", &lang);
    refresh_menu(&app);

    let mut url = Url::parse(&reply.enter_url).map_err(|_| "network".to_string())?;
    url.query_pairs_mut().append_pair("ui_language", &lang);
    if let Some(scheme) = scheme {
        url.query_pairs_mut().append_pair("color_scheme", &scheme);
    }
    app.get_webview_window("main")
        .ok_or("network")?
        .navigate(url)
        .map_err(|_| "network".to_string())
}

// ---- the overlay address for OBS ---------------------------------------------------------------

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
        .invoke_handler(tauri::generate_handler![stored_key, ui_lang, sign_in])
        .setup(|app| {
            let handle = app.handle().clone();
            let lang = read_data(&handle, "lang.txt").map(|l| norm_lang(&l));
            app.state::<Store>().lock().unwrap().lang = lang.clone();
            let menu = build_menu(&handle, lang.as_deref().unwrap_or("en"), None)?;

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
                                let _ = w.navigate(local_url(false));
                            }
                        });
                        return false;
                    }
                    let _ = nav.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;

            app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
