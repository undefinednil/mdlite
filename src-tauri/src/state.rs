use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::paths::lexical;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RootEntry {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RootsState {
    pub roots: Vec<RootEntry>,
    pub active: String,
}

pub struct AppState {
    pub roots: Mutex<RootsState>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub fn home_dir() -> PathBuf {
    if cfg!(windows) {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            return PathBuf::from(profile);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home);
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return PathBuf::from(profile);
    }
    let drive = std::env::var_os("HOMEDRIVE").unwrap_or_default();
    let path = std::env::var_os("HOMEPATH").unwrap_or_default();
    let mut combined = PathBuf::from(drive);
    combined.push(path);
    if combined.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        combined
    }
}

fn strip_unc(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().to_string();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

fn config_path() -> PathBuf {
    std::env::var_os("MDLITE_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".mdlite.json"))
}

fn real_dir(target: &str) -> ApiResult<PathBuf> {
    let expanded = if let Some(rest) = target.strip_prefix("~") {
        home_dir().join(rest.trim_start_matches('/'))
    } else {
        PathBuf::from(target)
    };
    let canonical = expanded
        .canonicalize()
        .map_err(|_| ApiError::bad_request(format!("folder is not readable: {target}")))?;
    if !canonical.is_dir() {
        return Err(ApiError::bad_request("not a directory"));
    }
    Ok(lexical(&strip_unc(canonical)))
}

fn seed() -> RootsState {
    let candidate = std::env::var("MDLITE_ROOT").unwrap_or_else(|_| {
        home_dir()
            .join("git")
            .join("notes")
            .to_string_lossy()
            .to_string()
    });

    let path = real_dir(&candidate).unwrap_or_else(|_| PathBuf::from(&candidate));
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    RootsState {
        roots: vec![RootEntry {
            id: Uuid::new_v4().to_string(),
            name,
            path: path.to_string_lossy().to_string(),
        }],
        active: String::new(),
    }
    .normalized()
}

impl RootsState {
    fn normalized(mut self) -> Self {
        if self.roots.is_empty() {
            return seed();
        }
        if !self.roots.iter().any(|root| root.id == self.active) {
            self.active = self.roots[0].id.clone();
        }
        self
    }

    pub fn load() -> Self {
        let path = config_path();
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => return seed(),
        };
        match serde_json::from_str::<RootsState>(&raw) {
            Ok(state) => state.normalized(),
            Err(_) => seed(),
        }
    }

    pub fn persist(&self) {
        let path = config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }
        if let Ok(raw) = serde_json::to_string_pretty(self) {
            fs::write(path, raw).ok();
        }
    }

    pub fn active(&self) -> &RootEntry {
        self.roots
            .iter()
            .find(|root| root.id == self.active)
            .unwrap_or(&self.roots[0])
    }

    pub fn active_path(&self) -> PathBuf {
        PathBuf::from(&self.active().path)
    }

    pub fn list(&self) -> Vec<RootEntry> {
        self.roots.clone()
    }

    pub fn set_active(&mut self, id: &str) -> ApiResult<RootEntry> {
        let root = self
            .roots
            .iter()
            .find(|root| root.id == id)
            .ok_or_else(|| ApiError::not_found("unknown root"))?
            .clone();
        real_dir(&root.path)?;
        self.active = root.id.clone();
        self.persist();
        Ok(root)
    }

    pub fn add(&mut self, path: &str, name: Option<String>) -> ApiResult<RootEntry> {
        let resolved = real_dir(path)?;
        let resolved_string = resolved.to_string_lossy().to_string();

        if let Some(existing) = self
            .roots
            .iter()
            .find(|root| root.path == resolved_string)
        {
            return Ok(existing.clone());
        }

        let root = RootEntry {
            id: Uuid::new_v4().to_string(),
            name: name
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| {
                    resolved
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_else(|| resolved_string.clone())
                }),
            path: resolved_string,
        };
        self.roots.push(root.clone());
        self.persist();
        Ok(root)
    }

    pub fn remove(&mut self, id: &str) -> ApiResult<()> {
        if self.roots.len() <= 1 {
            return Err(ApiError::bad_request("cannot remove the last root"));
        }
        let index = self
            .roots
            .iter()
            .position(|root| root.id == id)
            .ok_or_else(|| ApiError::not_found("unknown root"))?;
        self.roots.remove(index);
        if self.active == id {
            self.active = self.roots[0].id.clone();
        }
        self.persist();
        Ok(())
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            roots: Mutex::new(RootsState::load()),
            watcher: Mutex::new(None),
        }
    }

    pub fn root_path(&self) -> PathBuf {
        self.roots.lock().map(|state| state.active_path()).unwrap_or_else(|_| PathBuf::from("/"))
    }
}
