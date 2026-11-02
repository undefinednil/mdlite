use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::paths::is_ignored;

pub fn start(app: AppHandle, root: PathBuf) -> Option<RecommendedWatcher> {
    if !root.is_dir() {
        return None;
    }

    let (sender, receiver) = channel::<Vec<String>>();
    let watch_root = root.clone();

    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let event = match result {
            Ok(event) => event,
            Err(_) => return,
        };
        let changed: Vec<String> = event
            .paths
            .iter()
            .filter_map(|path| path.strip_prefix(&watch_root).ok())
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .filter(|path| !path.is_empty() && !is_ignored(path))
            .collect();
        if !changed.is_empty() {
            let _ = sender.send(changed);
        }
    })
    .ok()?;

    watcher.watch(&root, RecursiveMode::Recursive).ok()?;

    std::thread::spawn(move || {
        let mut pending: Vec<String> = Vec::new();
        loop {
            match receiver.recv_timeout(Duration::from_millis(250)) {
                Ok(paths) => pending.extend(paths),
                Err(RecvTimeoutError::Timeout) => {
                    if pending.is_empty() {
                        continue;
                    }
                    pending.sort();
                    pending.dedup();
                    let payload = serde_json::json!({ "paths": pending });
                    let _ = app.emit("fs-change", payload);
                    pending.clear();
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Some(watcher)
}
