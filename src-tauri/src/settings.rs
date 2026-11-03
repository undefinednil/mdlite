use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::state::{expand_home, home_dir};

pub const VIMRC_LIMIT: usize = 200_000;
const VIMRC_BYTE_CAP: u64 = 1_000_000;
const MAX_BINDING_CHARS: usize = 120;
const MAX_COMMANDS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VimrcConfig {
    pub mode: String,
    pub path: String,
    pub text: String,
}

impl Default for VimrcConfig {
    fn default() -> Self {
        Self {
            mode: "auto".to_string(),
            path: String::new(),
            text: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub vim_enabled: bool,
    pub word_wrap: bool,
    pub main_width: u32,
    pub vimrc: VimrcConfig,
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            vim_enabled: true,
            word_wrap: true,
            main_width: 100,
            vimrc: VimrcConfig::default(),
            shortcuts: BTreeMap::new(),
        }
    }
}

pub struct VimrcSource {
    pub path: String,
    pub exists: bool,
    pub content: String,
}

fn read_capped(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(VIMRC_BYTE_CAP).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(text.chars().take(VIMRC_LIMIT).collect())
}

impl AppSettings {
    pub fn repair(mut self) -> Self {
        self.main_width = self.main_width.clamp(50, 100);
        if !matches!(self.vimrc.mode.as_str(), "auto" | "path" | "inline") {
            self.vimrc.mode = "auto".to_string();
        }
        self.vimrc.text = self.vimrc.text.chars().take(VIMRC_LIMIT).collect();
        if self.vimrc.path.len() > 4096 {
            self.vimrc.path.clear();
            self.vimrc.mode = "auto".to_string();
        }
        let mut kept = BTreeMap::new();
        for (id, binding) in self.shortcuts {
            if kept.len() >= MAX_COMMANDS {
                break;
            }
            if id.is_empty() || id.len() > 80 || binding.len() > MAX_BINDING_CHARS {
                continue;
            }
            kept.insert(id, binding.trim().to_string());
        }
        self.shortcuts = kept;
        self
    }

    pub fn sanitize(mut self) -> ApiResult<Self> {
        if !(50..=100).contains(&self.main_width) {
            return Err(ApiError::bad_request("main width must be between 50 and 100"));
        }
        if !matches!(self.vimrc.mode.as_str(), "auto" | "path" | "inline") {
            return Err(ApiError::bad_request("unknown vimrc mode"));
        }
        if self.vimrc.text.chars().count() > VIMRC_LIMIT {
            return Err(ApiError::bad_request(
                "vimrc text is longer than 200,000 characters",
            ));
        }
        if self.vimrc.path.len() > 4096 {
            return Err(ApiError::bad_request("vimrc path is too long"));
        }
        if self.shortcuts.len() > MAX_COMMANDS {
            return Err(ApiError::bad_request("too many shortcut entries"));
        }
        for (id, binding) in self.shortcuts.iter_mut() {
            if id.is_empty() || id.len() > 80 {
                return Err(ApiError::bad_request("invalid shortcut id"));
            }
            if binding.len() > MAX_BINDING_CHARS {
                return Err(ApiError::bad_request("shortcut binding is too long"));
            }
            *binding = binding.trim().to_string();
        }
        Ok(self)
    }

    pub fn load_vimrc(&self) -> VimrcSource {
        match self.vimrc.mode.as_str() {
            "inline" => {
                let text = self.vimrc.text.chars().take(VIMRC_LIMIT).collect();
                VimrcSource {
                    path: "Settings → Editor".to_string(),
                    exists: !self.vimrc.text.trim().is_empty(),
                    content: text,
                }
            }
            "path" => {
                let configured = self.vimrc.path.trim();
                if configured.is_empty() {
                    return VimrcSource {
                        path: String::new(),
                        exists: false,
                        content: String::new(),
                    };
                }
                let path = expand_home(configured);
                let content = read_capped(&path);
                VimrcSource {
                    path: path.to_string_lossy().to_string(),
                    exists: content.is_some(),
                    content: content.unwrap_or_default(),
                }
            }
            _ => {
                let path = home_dir().join(".vimrc");
                let content = read_capped(&path);
                VimrcSource {
                    path: path.to_string_lossy().to_string(),
                    exists: content.is_some(),
                    content: content.unwrap_or_default(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_keep_vim_on_and_auto_vimrc() {
        let settings = AppSettings::default();
        assert!(settings.vim_enabled);
        assert!(settings.word_wrap);
        assert_eq!(settings.main_width, 100);
        assert_eq!(settings.vimrc.mode, "auto");
        assert!(settings.shortcuts.is_empty());
    }

    #[test]
    fn clamps_and_rejects_out_of_range_main_width() {
        let mut settings = AppSettings::default();
        settings.main_width = 200;
        assert_eq!(settings.repair().main_width, 100);

        let mut settings = AppSettings::default();
        settings.main_width = 10;
        assert!(settings.sanitize().is_err());
    }

    #[test]
    fn sanitize_rejects_unknown_modes_and_long_text() {
        let mut settings = AppSettings::default();
        settings.vimrc.mode = "elsewhere".into();
        assert!(settings.sanitize().is_err());

        let mut settings = AppSettings::default();
        settings.vimrc.text = "x".repeat(VIMRC_LIMIT + 1);
        assert!(settings.sanitize().is_err());
    }

    #[test]
    fn inline_vimrc_comes_from_the_settings_text() {
        let mut settings = AppSettings::default();
        settings.vimrc.mode = "inline".into();
        settings.vimrc.text = "set number\n".into();
        let source = settings.load_vimrc();
        assert!(source.exists);
        assert_eq!(source.content, "set number\n");
    }
}
