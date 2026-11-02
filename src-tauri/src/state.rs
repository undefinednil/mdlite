use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::paths::lexical;
use crate::settings::AppSettings;

const APP_ID: &str = "dev.mdlite.app";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RootEntry {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub roots: Vec<RootEntry>,
    pub active: String,
    pub settings: AppSettings,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            active: String::new(),
            settings: AppSettings::default(),
        }
    }
}

pub struct AppState {
    pub config: Mutex<Config>,
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

pub fn config_path() -> PathBuf {
    std::env::var_os("MDLITE_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            home_dir()
                .join(".config")
                .join("mdlite")
                .join("mdlite.json")
        })
}

fn import_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(target_os = "macos") {
        paths.push(
            home_dir()
                .join("Library")
                .join("Application Support")
                .join(APP_ID)
                .join("config.json"),
        );
    } else if cfg!(target_os = "windows") {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            paths.push(PathBuf::from(appdata).join(APP_ID).join("config.json"));
        }
    } else {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".config"));
        paths.push(base.join(APP_ID).join("config.json"));
    }
    paths.push(home_dir().join(".mdlite.json"));
    paths
}

fn strip_unc(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().to_string();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
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

fn seed() -> Config {
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

    Config {
        roots: vec![RootEntry {
            id: Uuid::new_v4().to_string(),
            name,
            path: path.to_string_lossy().to_string(),
        }],
        active: String::new(),
        settings: AppSettings::default(),
    }
    .normalized()
}

impl Config {
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
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<Config>(&raw) {
                return config.normalized();
            }
        }
        if std::env::var_os("MDLITE_CONFIG").is_none() {
            for candidate in import_paths() {
                if let Ok(raw) = fs::read_to_string(&candidate) {
                    if let Ok(config) = serde_json::from_str::<Config>(&raw) {
                        let config = config.normalized();
                        config.persist().ok();
                        return config;
                    }
                }
            }
        }
        seed()
    }

    pub fn persist(&self) -> ApiResult<()> {
        let path = config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(self)
            .map_err(|error| ApiError::new("state", error.to_string()))?;
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "mdlite.json".to_string());
        let temp = path.with_file_name(format!("{name}.tmp"));
        fs::write(&temp, raw)?;
        if cfg!(windows) && path.exists() {
            fs::remove_file(&path)?;
        }
        fs::rename(&temp, &path)?;
        Ok(())
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
        self.persist()?;
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
        self.persist()?;
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
        self.persist()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(Config::load()),
            watcher: Mutex::new(None),
        }
    }

    pub fn root_path(&self) -> PathBuf {
        self.config
            .lock()
            .map(|config| config.active_path())
            .unwrap_or_else(|_| PathBuf::from("/"))
    }

    pub fn settings(&self) -> ApiResult<AppSettings> {
        let config = self
            .config
            .lock()
            .map_err(|_| ApiError::new("state", "lock"))?;
        Ok(config.settings.clone())
    }

    pub fn set_settings(&self, settings: AppSettings) -> ApiResult<AppSettings> {
        let mut config = self
            .config
            .lock()
            .map_err(|_| ApiError::new("state", "lock"))?;
        config.settings = settings;
        config.persist()?;
        Ok(config.settings.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_legacy_config_shape() {
        let raw = r#"{
            "roots": [{"id": "a", "name": "notes", "path": "/tmp/notes"}],
            "active": "a"
        }"#;
        let config: Config = serde_json::from_str(raw).unwrap();
        assert_eq!(config.active, "a");
        assert_eq!(config.roots.len(), 1);
        assert!(config.settings.vim_enabled);
        assert!(config.settings.word_wrap);
        assert_eq!(config.settings.vimrc.mode, "auto");
        assert!(config.settings.shortcuts.is_empty());
    }

    #[test]
    fn settings_roundtrip_uses_camel_case() {
        let mut config = Config::default();
        config.settings.vimrc.mode = "inline".into();
        config.settings.shortcuts.insert("tree.down".into(), "shift+j".into());
        let raw = serde_json::to_string(&config).unwrap();
        assert!(raw.contains("\"vimEnabled\""));
        assert!(raw.contains("\"wordWrap\""));
        assert!(raw.contains("\"settings\""));
        let loaded: Config = serde_json::from_str(&raw).unwrap();
        assert_eq!(loaded.settings.shortcuts.get("tree.down").unwrap(), "shift+j");
    }
}
