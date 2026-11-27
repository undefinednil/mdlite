use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

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

fn deserialize_active<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum ActiveField {
        One(String),
        Many(Vec<String>),
    }

    Ok(match Option::<ActiveField>::deserialize(deserializer)? {
        Some(ActiveField::One(id)) if id.is_empty() => None,
        Some(ActiveField::One(id)) => Some(vec![id]),
        Some(ActiveField::Many(ids)) => Some(ids),
        None => None,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub roots: Vec<RootEntry>,
    #[serde(default, deserialize_with = "deserialize_active", skip_serializing_if = "Option::is_none")]
    pub active: Option<Vec<String>>,
    pub settings: AppSettings,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            active: Some(Vec::new()),
            settings: AppSettings::default(),
        }
    }
}

pub struct AppState {
    pub config: Mutex<Config>,
    pub watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
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

pub fn expand_home(input: &str) -> PathBuf {
    let trimmed = input.trim();
    if trimmed == "~" {
        return home_dir();
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        return home_dir().join(rest);
    }
    PathBuf::from(trimmed)
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
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{}", rest));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

fn real_dir(target: &str) -> ApiResult<PathBuf> {
    let expanded = expand_home(target);
    let canonical = expanded
        .canonicalize()
        .map_err(|_| ApiError::bad_request(format!("folder is not readable: {target}")))?;
    if !canonical.is_dir() {
        return Err(ApiError::bad_request("not a directory"));
    }
    Ok(lexical(&strip_unc(canonical)))
}

fn seed_root() -> Option<RootEntry> {
    let candidate = std::env::var("MDLITE_ROOT").ok()?;
    let path = real_dir(&candidate).ok()?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    Some(RootEntry {
        id: Uuid::new_v4().to_string(),
        name,
        path: path.to_string_lossy().to_string(),
    })
}

fn seed() -> Config {
    let mut config = Config::default();
    if let Some(root) = seed_root() {
        config.active = Some(vec![root.id.clone()]);
        config.roots.push(root);
    }
    config.normalized()
}

fn backup_corrupt(path: &Path) -> bool {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "mdlite.json".to_string());
    fs::rename(path, path.with_file_name(format!("{name}.corrupt-{stamp}"))).is_ok()
}

impl Config {
    fn normalized(mut self) -> Self {
        self.settings = self.settings.repair();
        let known: Vec<String> = self.roots.iter().map(|root| root.id.clone()).collect();
        match &mut self.active {
            Some(active) => {
                let had_ids = !active.is_empty();
                active.retain(|id| known.iter().any(|root| root == id));
                active.dedup();
                if had_ids && active.is_empty() {
                    *active = known;
                }
            }
            None => self.active = Some(known),
        }
        self
    }

    pub fn load() -> Self {
        let path = config_path();
        match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Config>(&raw) {
                Ok(config) => config.normalized(),
                Err(_) => {
                    let seeded = seed();
                    if backup_corrupt(&path) {
                        seeded.persist().ok();
                    }
                    seeded
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
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
            Err(_) => seed(),
        }
    }

    pub fn persist(&self) -> ApiResult<()> {
        let raw = serde_json::to_string_pretty(self)
            .map_err(|error| ApiError::new("state", error.to_string()))?;
        let path = config_path();
        let path = fs::canonicalize(&path).unwrap_or(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "mdlite.json".to_string());
        let temp = path.with_file_name(format!("{name}.{}.tmp", Uuid::new_v4()));

        let result: std::io::Result<()> = (|| {
            let mut file = fs::File::create(&temp)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))?;
            }
            file.write_all(raw.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp, &path)?;
            #[cfg(unix)]
            if let Some(parent) = path.parent() {
                if let Ok(directory) = fs::File::open(parent) {
                    directory.sync_all().ok();
                }
            }
            Ok(())
        })();

        if let Err(error) = result {
            fs::remove_file(&temp).ok();
            return Err(ApiError::io(&error));
        }
        Ok(())
    }

    pub fn active_ids(&self) -> Vec<String> {
        self.active.clone().unwrap_or_default()
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.active_ids().iter().any(|active| active == id)
    }

    pub fn list(&self) -> Vec<RootEntry> {
        self.roots.clone()
    }

    pub fn set_active(&mut self, id: &str, active: bool) -> ApiResult<()> {
        if !self.roots.iter().any(|root| root.id == id) {
            return Err(ApiError::not_found("unknown root"));
        }
        let mut next = self.clone();
        let mut ids = next.active_ids();
        ids.retain(|current| current != id);
        if active {
            ids.push(id.to_string());
        }
        next.active = Some(ids);
        next.persist()?;
        *self = next;
        Ok(())
    }

    pub fn add(&mut self, path: &str, name: Option<String>) -> ApiResult<RootEntry> {
        let resolved = real_dir(path)?;
        let resolved_string = resolved.to_string_lossy().to_string();

        if let Some(existing) = self
            .roots
            .iter()
            .find(|root| root.path == resolved_string)
            .cloned()
        {
            if !self.is_active(&existing.id) {
                let mut next = self.clone();
                let mut active = next.active_ids();
                active.push(existing.id.clone());
                next.active = Some(active);
                next.persist()?;
                *self = next;
            }
            return Ok(existing);
        }

        let mut next = self.clone();
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
        next.roots.push(root.clone());
        let mut active = next.active_ids();
        if !active.iter().any(|id| id == &root.id) {
            active.push(root.id.clone());
        }
        next.active = Some(active);
        next.persist()?;
        *self = next;
        Ok(root)
    }

    pub fn remove(&mut self, id: &str) -> ApiResult<()> {
        let mut next = self.clone();
        let index = next
            .roots
            .iter()
            .position(|root| root.id == id)
            .ok_or_else(|| ApiError::not_found("unknown root"))?;
        next.roots.remove(index);
        let mut active = next.active_ids();
        active.retain(|current| current != id);
        next.active = Some(active);
        next.persist()?;
        *self = next;
        Ok(())
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(Config::load()),
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn root_path(&self, id: &str) -> Option<PathBuf> {
        self.config
            .lock()
            .ok()?
            .roots
            .iter()
            .find(|root| root.id == id)
            .map(|root| PathBuf::from(&root.path))
    }

    pub fn active_roots(&self) -> Vec<(String, PathBuf)> {
        let Ok(config) = self.config.lock() else {
            return Vec::new();
        };
        let active = config.active_ids();
        config
            .roots
            .iter()
            .filter(|root| active.iter().any(|id| id == &root.id))
            .map(|root| (root.id.clone(), PathBuf::from(&root.path)))
            .collect()
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
        let mut next = config.clone();
        next.settings = settings;
        next.persist()?;
        *config = next;
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
        assert_eq!(config.active, Some(vec!["a".to_string()]));
        assert_eq!(config.roots.len(), 1);
        assert!(config.settings.vim_enabled);
        assert!(config.settings.word_wrap);
        assert_eq!(config.settings.vim_leader, "Space");
        assert_eq!(config.settings.line_numbers, "relative");
        assert!(config.settings.shortcuts.is_empty());
    }

    #[test]
    fn reads_settings_with_missing_fields() {
        let raw = r#"{
            "roots": [{"id": "a", "name": "notes", "path": "/tmp/notes"}],
            "active": "a",
            "settings": {
                "vimEnabled": false,
                "shortcuts": {"app.recentFiles": "ctrl+alt+r"}
            }
        }"#;
        let config: Config = serde_json::from_str(raw).unwrap();
        assert!(!config.settings.vim_enabled);
        assert_eq!(config.settings.vim_leader, "Space");
        assert!(config.settings.word_wrap);
        assert_eq!(config.settings.line_numbers, "relative");
        assert_eq!(config.settings.sidebar_width, 296);
        assert!(config.settings.show_mode_toggle);
        assert!(config.settings.show_pen_button);
        assert_eq!(
            config.settings.shortcuts.get("app.recentFiles").unwrap(),
            "ctrl+alt+r"
        );
    }

    #[test]
    fn settings_roundtrip_uses_camel_case() {
        let mut config = Config::default();
        config.settings.vim_leader = ",".into();
        config
            .settings
            .shortcuts
            .insert("tree.down".into(), "shift+j".into());
        let raw = serde_json::to_string(&config).unwrap();
        assert!(raw.contains("\"vimEnabled\""));
        assert!(raw.contains("\"vimLeader\""));
        assert!(raw.contains("\"lineNumbers\""));
        assert!(raw.contains("\"wordWrap\""));
        assert!(raw.contains("\"settings\""));
        let loaded: Config = serde_json::from_str(&raw).unwrap();
        assert_eq!(loaded.settings.shortcuts.get("tree.down").unwrap(), "shift+j");
        assert_eq!(loaded.settings.vim_leader, ",");
    }

    #[test]
    fn empty_roots_keep_settings_and_stay_empty() {
        let mut config = Config {
            roots: Vec::new(),
            active: Some(Vec::new()),
            settings: AppSettings::default(),
        };
        config.settings.word_wrap = false;
        config.settings.line_numbers = "off".into();
        let normalized = config.normalized();
        assert!(normalized.roots.is_empty());
        assert_eq!(normalized.active, Some(Vec::new()));
        assert!(!normalized.settings.word_wrap);
        assert_eq!(normalized.settings.line_numbers, "off");
    }

    #[test]
    fn reads_multiple_active_roots_and_defaults_missing_active_to_all() {
        let raw = r#"{
            "roots": [
                {"id": "a", "name": "notes", "path": "/tmp/a"},
                {"id": "b", "name": "work", "path": "/tmp/b"}
            ],
            "active": ["a", "b"]
        }"#;
        let config: Config = serde_json::from_str(raw).unwrap();
        assert_eq!(config.active, Some(vec!["a".to_string(), "b".to_string()]));

        let legacy: Config = serde_json::from_str(
            r#"{"roots":[{"id":"a","name":"notes","path":"/tmp/a"},{"id":"b","name":"work","path":"/tmp/b"}]}"#,
        )
        .unwrap();
        let normalized = legacy.normalized();
        assert_eq!(normalized.active, Some(vec!["a".to_string(), "b".to_string()]));

        let empty_string: Config = serde_json::from_str(
            r#"{"roots":[{"id":"a","name":"notes","path":"/tmp/a"}],"active":""}"#,
        )
        .unwrap();
        assert_eq!(empty_string.normalized().active, Some(vec!["a".to_string()]));

        let empty_array: Config = serde_json::from_str(
            r#"{"roots":[{"id":"a","name":"notes","path":"/tmp/a"}],"active":[]}"#,
        )
        .unwrap();
        assert_eq!(empty_array.normalized().active, Some(Vec::<String>::new()));
    }

    #[test]
    fn invalid_settings_are_repaired_on_load() {
        let mut settings = AppSettings::default();
        settings.vim_leader = "   ".into();
        settings.line_numbers = "Elsewhere".into();
        settings.tab_size = 0;
        settings.indent_width = 99;
        let config = Config {
            roots: vec![RootEntry {
                id: "a".into(),
                name: "notes".into(),
                path: "/tmp/notes".into(),
            }],
            active: Some(vec!["a".into()]),
            settings,
        };
        let normalized = config.normalized();
        assert_eq!(normalized.settings.vim_leader, "Space");
        assert_eq!(normalized.settings.line_numbers, "relative");
        assert_eq!(normalized.settings.tab_size, 1);
        assert_eq!(normalized.settings.indent_width, 8);
    }
}
