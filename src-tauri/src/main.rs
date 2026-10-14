//! MiIPTV Portable — backend Tauri mínimo.
//! Solo expone lo que el navegador no puede hacer:
//!  - leer/escribir archivos en data/ JUNTO AL .exe (portabilidad real)
//!  - abrir un stream en VLC externo (o reproductor por defecto)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::Manager;

/// Carpeta portable: <carpeta del exe>/data (se crea si no existe).
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .or_else(|| app.path().app_data_dir().ok())
        .ok_or("no se pudo resolver la carpeta de datos")?;
    let dir = base.join("data");
    std::fs::create_dir_all(&dir).map_err(|e| format!("no se pudo crear data/: {e}"))?;
    Ok(dir)
}

#[tauri::command]
fn read_data_file(app: tauri::AppHandle, name: String) -> Result<String, String> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("nombre de archivo no permitido".into());
    }
    let path = data_dir(&app)?.join(name);
    std::fs::read_to_string(&path).map_err(|e| format!("leer {}: {e}", path.display()))
}

#[tauri::command]
fn write_data_file(app: tauri::AppHandle, name: String, content: String) -> Result<(), String> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("nombre de archivo no permitido".into());
    }
    let path = data_dir(&app)?.join(name);
    std::fs::write(&path, content).map_err(|e| format!("escribir {}: {e}", path.display()))
}

#[tauri::command]
fn data_dir_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
async fn http_get(url: String) -> Result<String, String> {
    // Petición HTTP sin CORS (lado Rust). reqwest con gzip descomprime solo.
    let resp = reqwest::get(&url).await.map_err(|e| format!("HTTP: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    resp.text().await.map_err(|e| format!("leer cuerpo: {e}"))
}

/// Busca vlc.exe: instalación estándar, variables de entorno y
/// portable junto al exe (misma filosofía portable de la app).
#[cfg(target_os = "windows")]
fn find_vlc() -> Option<std::path::PathBuf> {
    let mut cands = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Ok(pf) = std::env::var(var) {
            cands.push(
                std::path::PathBuf::from(pf)
                    .join("VideoLAN")
                    .join("VLC")
                    .join("vlc.exe"),
            );
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            cands.push(dir.join("vlc").join("vlc.exe"));
            cands.push(dir.join("vlc.exe"));
        }
    }
    cands.into_iter().find(|p| p.is_file())
}

/// Abre la URL en VLC si está instalado; si no, usa el manejador
/// predeterminado del sistema. Devuelve "vlc" o "default".
#[tauri::command]
fn open_external(url: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    if let Some(exe) = find_vlc() {
        std::process::Command::new(exe)
            .arg(&url)
            .spawn()
            .map_err(|e| format!("abrir en VLC: {e}"))?;
        return Ok("vlc".into());
    }
    open::that(&url).map_err(|e| format!("abrir externo: {e}"))?;
    Ok("default".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            read_data_file,
            write_data_file,
            data_dir_path,
            http_get,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar MiIPTV Portable");
}
