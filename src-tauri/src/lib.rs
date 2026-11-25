mod error;
mod files;
mod paths;
mod search;
mod settings;
mod state;
mod tree;
mod watch;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{ApiError, ApiResult};
use crate::files::{FileDoc, SaveResult};
use crate::search::GrepResponse;
use crate::settings::AppSettings;
use crate::state::{AppState, RootEntry};
use crate::tree::TreeNode;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InfoResponse {
    root: String,
    name: String,
    id: String,
    roots: Vec<RootEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsResponse {
    settings: AppSettings,
    path: String,
}

fn root_of(state: &State<'_, AppState>) -> ApiResult<PathBuf> {
    state
        .root_path()
        .ok_or_else(|| ApiError::bad_request("no folder is open"))
}

#[tauri::command]
fn info(state: State<'_, AppState>) -> ApiResult<InfoResponse> {
    let config = state.config.lock().map_err(|_| ApiError::new("state", "lock"))?;
    let active = config.active();
    Ok(InfoResponse {
        root: active.map(|root| root.path.clone()).unwrap_or_default(),
        name: active.map(|root| root.name.clone()).unwrap_or_default(),
        id: active.map(|root| root.id.clone()).unwrap_or_default(),
        roots: config.list(),
    })
}

#[tauri::command]
fn root_add(state: State<'_, AppState>, path: String, name: Option<String>) -> ApiResult<RootEntry> {
    let mut config = state.config.lock().map_err(|_| ApiError::new("state", "lock"))?;
    config.add(&path, name)
}

#[tauri::command]
fn root_set(app: AppHandle, state: State<'_, AppState>, id: String) -> ApiResult<RootEntry> {
    let (root, root_path) = {
        let mut config = state.config.lock().map_err(|_| ApiError::new("state", "lock"))?;
        let root = config.set_active(&id)?;
        let path = PathBuf::from(&root.path);
        (root, path)
    };

    let mut watcher_slot = state.watcher.lock().map_err(|_| ApiError::new("state", "lock"))?;
    *watcher_slot = watch::start(app.clone(), root_path);

    Ok(root)
}

#[tauri::command]
fn root_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> ApiResult<Vec<RootEntry>> {
    let (roots, root_path) = {
        let mut config = state.config.lock().map_err(|_| ApiError::new("state", "lock"))?;
        config.remove(&id)?;
        (config.list(), config.active_path())
    };
    let mut watcher_slot = state.watcher.lock().map_err(|_| ApiError::new("state", "lock"))?;
    *watcher_slot = root_path.and_then(|path| watch::start(app, path));
    Ok(roots)
}

#[tauri::command(async)]
fn tree(state: State<'_, AppState>) -> ApiResult<Vec<TreeNode>> {
    let root = root_of(&state)?;
    if !root.is_dir() {
        return Err(ApiError::bad_request("root folder is not available"));
    }
    Ok(tree::build_tree(&root))
}

#[tauri::command(async)]
fn read_file(state: State<'_, AppState>, path: String) -> ApiResult<FileDoc> {
    files::read_text(&root_of(&state)?, &path)
}

#[tauri::command(async)]
fn write_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
    mtime: Option<u64>,
    size: Option<u64>,
    hash: Option<String>,
    force: Option<bool>,
) -> ApiResult<SaveResult> {
    files::write_text(
        &root_of(&state)?,
        &path,
        &content,
        mtime,
        size,
        hash,
        force.unwrap_or(false),
    )
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> ApiResult<()> {
    let target = PathBuf::from(path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, content)?;
    Ok(())
}

fn system_opener() -> std::process::Command {
    if cfg!(target_os = "windows") {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else {
        std::process::Command::new("xdg-open")
    }
}

#[tauri::command(async)]
fn open_path(path: String) -> ApiResult<()> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(ApiError::not_found("file not found"));
    }
    system_opener().arg(target).spawn().map_err(|error| ApiError::new("io", error.to_string()))?;
    Ok(())
}

#[tauri::command(async)]
fn reveal_path(state: State<'_, AppState>, path: String) -> ApiResult<()> {
    let target = paths::safe_join(&root_of(&state)?, &path)?;
    if !target.exists() {
        return Err(ApiError::not_found("file not found"));
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut command = std::process::Command::new("explorer");
        command.arg(format!("/select,{}", target.display()));
        command
    } else if cfg!(target_os = "macos") {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(&target);
        command
    } else {
        let folder = target.parent().map(|parent| parent.to_path_buf()).unwrap_or(target);
        let mut command = system_opener();
        command.arg(folder);
        command
    };
    command.spawn().map_err(|error| ApiError::new("io", error.to_string()))?;
    Ok(())
}

fn external_url(url: &str) -> ApiResult<&str> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let allowed = lower.starts_with("http://") || lower.starts_with("https://");
    if !allowed || trimmed.chars().any(|ch| ch.is_whitespace() || ch.is_control()) {
        return Err(ApiError::bad_request("only http and https links can be opened"));
    }
    Ok(trimmed)
}

#[tauri::command(async)]
fn open_url(url: String) -> ApiResult<()> {
    let target = external_url(&url)?;
    system_opener().arg(target).spawn().map_err(|error| ApiError::new("io", error.to_string()))?;
    Ok(())
}

#[tauri::command(async)]
fn search_grep(
    state: State<'_, AppState>,
    query: String,
    regex: Option<bool>,
    case_sensitive: Option<bool>,
) -> ApiResult<GrepResponse> {
    search::grep(
        &root_of(&state)?,
        &query,
        regex.unwrap_or(false),
        case_sensitive.unwrap_or(false),
    )
}

#[tauri::command(async)]
fn upload(state: State<'_, AppState>, dir: String, name: String, data: String) -> ApiResult<String> {
    files::save_upload(&root_of(&state)?, &dir, &name, &data)
}

#[tauri::command(async)]
fn create_entry(state: State<'_, AppState>, path: String, kind: String) -> ApiResult<String> {
    files::create_entry(&root_of(&state)?, &path, kind == "dir")
}

#[tauri::command(async)]
fn rename_entry(state: State<'_, AppState>, path: String, name: String) -> ApiResult<String> {
    files::rename_entry(&root_of(&state)?, &path, &name)
}

#[tauri::command(async)]
fn transfer_entry(
    state: State<'_, AppState>,
    from: String,
    to: String,
    copy: Option<bool>,
) -> ApiResult<String> {
    files::transfer_entry(&root_of(&state)?, &from, &to, copy.unwrap_or(false))
}

#[tauri::command(async)]
fn trash_entry(state: State<'_, AppState>, path: String) -> ApiResult<String> {
    files::trash_entry(&root_of(&state)?, &path)
}

#[tauri::command(async)]
fn trash_list(state: State<'_, AppState>) -> ApiResult<Vec<files::TrashEntry>> {
    files::trash_list(&root_of(&state)?)
}

#[tauri::command(async)]
fn trash_purge(state: State<'_, AppState>, path: String) -> ApiResult<()> {
    files::trash_purge(&root_of(&state)?, &path)
}

#[tauri::command(async)]
fn restore_entry(state: State<'_, AppState>, from: String, to: String) -> ApiResult<String> {
    files::restore_entry(&root_of(&state)?, &from, &to)
}

#[tauri::command]
fn settings_get(state: State<'_, AppState>) -> ApiResult<SettingsResponse> {
    Ok(SettingsResponse {
        settings: state.settings()?,
        path: state::config_path().to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn settings_set(state: State<'_, AppState>, settings: AppSettings) -> ApiResult<SettingsResponse> {
    let saved = state.set_settings(settings.sanitize()?)?;
    Ok(SettingsResponse {
        settings: saved,
        path: state::config_path().to_string_lossy().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            info,
            root_add,
            root_set,
            root_remove,
            tree,
            read_file,
            write_file,
            save_text_file,
            open_path,
            reveal_path,
            open_url,
            search_grep,
            upload,
            create_entry,
            rename_entry,
            transfer_entry,
            trash_entry,
            trash_list,
            trash_purge,
            restore_entry,
            settings_get,
            settings_set
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let root = app.state::<AppState>().root_path();
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut slot) = state.watcher.lock() {
                    *slot = root.and_then(|path| watch::start(handle, path));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mdlite");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_http_and_https_links() {
        assert_eq!(external_url(" https://example.com/a ").unwrap(), "https://example.com/a");
        assert!(external_url("HTTP://example.com").is_ok());
        assert!(external_url("javascript:alert(1)").is_err());
        assert!(external_url("file:///etc/passwd").is_err());
        assert!(external_url("mailto:note@example.com").is_err());
        assert!(external_url("https://example.com/a b").is_err());
    }
}
