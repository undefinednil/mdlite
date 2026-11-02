mod error;
mod files;
mod paths;
mod search;
mod state;
mod tree;
mod watch;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{ApiError, ApiResult};
use crate::files::{FileDoc, SaveResult};
use crate::search::GrepResponse;
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
struct VimrcResponse {
    path: String,
    exists: bool,
    content: String,
}

fn root_of(state: &State<'_, AppState>) -> PathBuf {
    state.root_path()
}

#[tauri::command]
fn info(state: State<'_, AppState>) -> ApiResult<InfoResponse> {
    let roots = state.roots.lock().map_err(|_| ApiError::new("state", "lock"))?;
    let active = roots.active().clone();
    Ok(InfoResponse {
        root: active.path.clone(),
        name: active.name.clone(),
        id: active.id.clone(),
        roots: roots.list(),
    })
}

#[tauri::command]
fn root_add(state: State<'_, AppState>, path: String, name: Option<String>) -> ApiResult<RootEntry> {
    let mut roots = state.roots.lock().map_err(|_| ApiError::new("state", "lock"))?;
    roots.add(&path, name)
}

#[tauri::command]
fn root_set(app: AppHandle, state: State<'_, AppState>, id: String) -> ApiResult<RootEntry> {
    let (root, root_path) = {
        let mut roots = state.roots.lock().map_err(|_| ApiError::new("state", "lock"))?;
        let root = roots.set_active(&id)?;
        let path = PathBuf::from(&root.path);
        (root, path)
    };

    let mut watcher_slot = state.watcher.lock().map_err(|_| ApiError::new("state", "lock"))?;
    *watcher_slot = watch::start(app.clone(), root_path);

    Ok(root)
}

#[tauri::command]
fn root_remove(state: State<'_, AppState>, id: String) -> ApiResult<Vec<RootEntry>> {
    let mut roots = state.roots.lock().map_err(|_| ApiError::new("state", "lock"))?;
    roots.remove(&id)?;
    Ok(roots.list())
}

#[tauri::command]
fn tree(state: State<'_, AppState>) -> ApiResult<Vec<TreeNode>> {
    let root = root_of(&state);
    if !root.is_dir() {
        return Err(ApiError::bad_request("root folder is not available"));
    }
    Ok(tree::build_tree(&root))
}

#[tauri::command]
fn read_file(state: State<'_, AppState>, path: String) -> ApiResult<FileDoc> {
    files::read_text(&root_of(&state), &path)
}

#[tauri::command]
fn write_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
    mtime: Option<u64>,
    force: Option<bool>,
) -> ApiResult<SaveResult> {
    files::write_text(&root_of(&state), &path, &content, mtime, force.unwrap_or(false))
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

#[tauri::command]
fn open_path(path: String) -> ApiResult<()> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(ApiError::not_found("file not found"));
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else {
        std::process::Command::new("xdg-open")
    };
    command.arg(target).spawn().map_err(|error| ApiError::new("io", error.to_string()))?;
    Ok(())
}

#[tauri::command]
fn search_grep(
    state: State<'_, AppState>,
    query: String,
    regex: Option<bool>,
    case_sensitive: Option<bool>,
) -> ApiResult<GrepResponse> {
    search::grep(
        &root_of(&state),
        &query,
        regex.unwrap_or(false),
        case_sensitive.unwrap_or(false),
    )
}

#[tauri::command]
fn upload(state: State<'_, AppState>, dir: String, name: String, data: String) -> ApiResult<String> {
    files::save_upload(&root_of(&state), &dir, &name, &data)
}

#[tauri::command]
fn create_entry(state: State<'_, AppState>, path: String, kind: String) -> ApiResult<String> {
    files::create_entry(&root_of(&state), &path, kind == "dir")
}

#[tauri::command]
fn rename_entry(state: State<'_, AppState>, path: String, name: String) -> ApiResult<String> {
    files::rename_entry(&root_of(&state), &path, &name)
}

#[tauri::command]
fn transfer_entry(
    state: State<'_, AppState>,
    from: String,
    to: String,
    copy: Option<bool>,
) -> ApiResult<String> {
    files::transfer_entry(&root_of(&state), &from, &to, copy.unwrap_or(false))
}

#[tauri::command]
fn trash_entry(state: State<'_, AppState>, path: String) -> ApiResult<String> {
    files::trash_entry(&root_of(&state), &path)
}

#[tauri::command]
fn restore_entry(state: State<'_, AppState>, from: String, to: String) -> ApiResult<String> {
    files::restore_entry(&root_of(&state), &from, &to)
}

#[tauri::command]
fn vimrc() -> VimrcResponse {
    let path = state::home_dir().join(".vimrc");
    match std::fs::read_to_string(&path) {
        Ok(content) => VimrcResponse {
            path: path.to_string_lossy().to_string(),
            exists: true,
            content: content.chars().take(200_000).collect(),
        },
        Err(_) => VimrcResponse {
            path: path.to_string_lossy().to_string(),
            exists: false,
            content: String::new(),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            search_grep,
            upload,
            create_entry,
            rename_entry,
            transfer_entry,
            trash_entry,
            restore_entry,
            vimrc
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let root = app.state::<AppState>().root_path();
            let watcher = watch::start(handle, root);
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut slot) = state.watcher.lock() {
                    *slot = watcher;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mdlite");
}
