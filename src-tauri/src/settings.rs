use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};

const MAX_BINDING_CHARS: usize = 120;
const MAX_COMMANDS: usize = 200;
pub const MAX_REMAPS: usize = 200;
pub const MAX_REMAP_CHARS: usize = 120;
pub const MAX_LEADER_CHARS: usize = 8;
const MIN_TAB_SIZE: u32 = 1;
const MAX_TAB_SIZE: u32 = 8;
const MIN_SIDEBAR_WIDTH: u32 = 230;
const MAX_SIDEBAR_WIDTH: u32 = 600;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VimRemap {
    pub mode: String,
    pub lhs: String,
    pub rhs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub vim_enabled: bool,
    pub vim_leader: String,
    pub vim_yank_target: String,
    pub vim_delete_target: String,
    pub vim_paste_source: String,
    pub vim_keep_selection: bool,
    pub vim_remaps: Vec<VimRemap>,
    pub scroll_off: u32,
    pub line_numbers: String,
    pub tab_size: u32,
    pub indent_width: u32,
    pub insert_spaces: bool,
    pub ignore_case: bool,
    pub smart_case: bool,
    pub word_wrap: bool,
    pub main_width: u32,
    pub sidebar_width: u32,
    pub shortcuts: BTreeMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            vim_enabled: true,
            vim_leader: "Space".to_string(),
            vim_yank_target: "clipboard".to_string(),
            vim_delete_target: "blackhole".to_string(),
            vim_paste_source: "clipboard".to_string(),
            vim_keep_selection: true,
            vim_remaps: Vec::new(),
            scroll_off: 10,
            line_numbers: "relative".to_string(),
            tab_size: 2,
            indent_width: 2,
            insert_spaces: true,
            ignore_case: true,
            smart_case: true,
            word_wrap: true,
            main_width: 100,
            sidebar_width: 296,
            shortcuts: BTreeMap::new(),
        }
    }
}

fn valid_remap_mode(mode: &str) -> bool {
    matches!(mode, "normal" | "visual" | "insert" | "operator")
}

fn valid_yank_target(value: &str) -> bool {
    matches!(value, "unnamed" | "clipboard")
}

fn valid_delete_target(value: &str) -> bool {
    matches!(value, "unnamed" | "clipboard" | "blackhole")
}

fn valid_paste_source(value: &str) -> bool {
    matches!(value, "unnamed" | "clipboard")
}

fn valid_line_numbers(value: &str) -> bool {
    matches!(value, "off" | "absolute" | "relative")
}

fn has_register_prefix(value: &str) -> bool {
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '"' {
            continue;
        }
        while matches!(chars.peek(), Some(&' ')) {
            chars.next();
        }
        if let Some(&next) = chars.peek() {
            if next.is_ascii_alphanumeric() || matches!(next, '+' | '*' | '_' | '"') {
                return true;
            }
        }
    }
    false
}

fn trim_remaps(remaps: Vec<VimRemap>) -> Vec<VimRemap> {
    remaps
        .into_iter()
        .filter_map(|mut remap| {
            remap.mode = remap.mode.trim().to_lowercase();
            remap.lhs = remap.lhs.trim().to_string();
            remap.rhs = remap.rhs.trim().to_string();
            if !valid_remap_mode(&remap.mode)
                || remap.lhs.is_empty()
                || remap.rhs.is_empty()
                || has_register_prefix(&remap.lhs)
                || has_register_prefix(&remap.rhs)
                || remap.lhs.chars().count() > MAX_REMAP_CHARS
                || remap.rhs.chars().count() > MAX_REMAP_CHARS
            {
                return None;
            }
            Some(remap)
        })
        .take(MAX_REMAPS)
        .collect()
}

impl AppSettings {
    pub fn repair(mut self) -> Self {
        self.main_width = self.main_width.clamp(50, 100);
        self.sidebar_width = if self.sidebar_width == 0 {
            0
        } else {
            self.sidebar_width.clamp(MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
        };
        self.tab_size = self.tab_size.clamp(MIN_TAB_SIZE, MAX_TAB_SIZE);
        self.indent_width = self.indent_width.clamp(MIN_TAB_SIZE, MAX_TAB_SIZE);
        self.scroll_off = self.scroll_off.clamp(0, 50);
        self.vim_leader = self.vim_leader.trim().to_string();
        if self.vim_leader.is_empty() || self.vim_leader.chars().count() > MAX_LEADER_CHARS {
            self.vim_leader = "Space".to_string();
        }
        if !valid_yank_target(&self.vim_yank_target) {
            self.vim_yank_target = "clipboard".to_string();
        }
        if !valid_delete_target(&self.vim_delete_target) {
            self.vim_delete_target = "blackhole".to_string();
        }
        if !valid_paste_source(&self.vim_paste_source) {
            self.vim_paste_source = "clipboard".to_string();
        }
        if !valid_line_numbers(&self.line_numbers) {
            self.line_numbers = "relative".to_string();
        }
        self.vim_remaps = trim_remaps(self.vim_remaps);

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
        if self.sidebar_width != 0
            && !(MIN_SIDEBAR_WIDTH..=MAX_SIDEBAR_WIDTH).contains(&self.sidebar_width)
        {
            return Err(ApiError::bad_request(
                "sidebar width must be 0 or between 230 and 600",
            ));
        }
        if !(MIN_TAB_SIZE..=MAX_TAB_SIZE).contains(&self.tab_size) {
            return Err(ApiError::bad_request("tab size must be between 1 and 8"));
        }
        if !(MIN_TAB_SIZE..=MAX_TAB_SIZE).contains(&self.indent_width) {
            return Err(ApiError::bad_request("indent width must be between 1 and 8"));
        }
        if self.scroll_off > 50 {
            return Err(ApiError::bad_request("scroll offset must be between 0 and 50"));
        }

        self.vim_leader = self.vim_leader.trim().to_string();
        if self.vim_leader.is_empty() {
            return Err(ApiError::bad_request("leader key is required"));
        }
        if self.vim_leader.chars().count() > MAX_LEADER_CHARS {
            return Err(ApiError::bad_request("leader key is too long"));
        }
        if !valid_yank_target(&self.vim_yank_target) {
            return Err(ApiError::bad_request("unknown yank target"));
        }
        if !valid_delete_target(&self.vim_delete_target) {
            return Err(ApiError::bad_request("unknown delete target"));
        }
        if !valid_paste_source(&self.vim_paste_source) {
            return Err(ApiError::bad_request("unknown paste source"));
        }
        if !valid_line_numbers(&self.line_numbers) {
            return Err(ApiError::bad_request("unknown line number mode"));
        }

        if self.vim_remaps.len() > MAX_REMAPS {
            return Err(ApiError::bad_request("too many vim remaps"));
        }
        for remap in self.vim_remaps.iter_mut() {
            remap.mode = remap.mode.trim().to_lowercase();
            remap.lhs = remap.lhs.trim().to_string();
            remap.rhs = remap.rhs.trim().to_string();
            if !valid_remap_mode(&remap.mode) {
                return Err(ApiError::bad_request("unknown remap mode"));
            }
            if has_register_prefix(&remap.lhs) || has_register_prefix(&remap.rhs) {
                return Err(ApiError::bad_request(
                    "remap registers are not supported; use the clipboard settings",
                ));
            }
            if remap.lhs.chars().count() > MAX_REMAP_CHARS
                || remap.rhs.chars().count() > MAX_REMAP_CHARS
            {
                return Err(ApiError::bad_request("remap is too long"));
            }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_configured_vim() {
        let settings = AppSettings::default();
        assert!(settings.vim_enabled);
        assert_eq!(settings.vim_leader, "Space");
        assert_eq!(settings.vim_yank_target, "clipboard");
        assert_eq!(settings.vim_delete_target, "blackhole");
        assert_eq!(settings.vim_paste_source, "clipboard");
        assert!(settings.vim_keep_selection);
        assert_eq!(settings.scroll_off, 10);
        assert_eq!(settings.line_numbers, "relative");
        assert_eq!(settings.tab_size, 2);
        assert_eq!(settings.indent_width, 2);
        assert!(settings.insert_spaces);
        assert!(settings.ignore_case);
        assert!(settings.smart_case);
        assert!(settings.word_wrap);
        assert_eq!(settings.main_width, 100);
        assert!(settings.vim_remaps.is_empty());
        assert!(settings.shortcuts.is_empty());
    }

    #[test]
    fn clamps_and_rejects_out_of_range_values() {
        let mut settings = AppSettings::default();
        settings.main_width = 200;
        settings.sidebar_width = 999;
        settings.tab_size = 0;
        settings.indent_width = 99;
        settings.scroll_off = 999;
        let repaired = settings.repair();
        assert_eq!(repaired.main_width, 100);
        assert_eq!(repaired.sidebar_width, MAX_SIDEBAR_WIDTH);
        assert_eq!(repaired.tab_size, MIN_TAB_SIZE);
        assert_eq!(repaired.indent_width, MAX_TAB_SIZE);
        assert_eq!(repaired.scroll_off, 50);

        let mut settings = AppSettings::default();
        settings.tab_size = 0;
        assert!(settings.sanitize().is_err());

        let mut settings = AppSettings::default();
        settings.scroll_off = 51;
        assert!(settings.sanitize().is_err());

        let mut settings = AppSettings::default();
        settings.sidebar_width = MAX_SIDEBAR_WIDTH + 1;
        assert!(settings.sanitize().is_err());

        let mut settings = AppSettings::default();
        settings.sidebar_width = 200;
        assert!(settings.sanitize().is_err());

        let mut settings = AppSettings::default();
        settings.sidebar_width = 0;
        assert!(settings.sanitize().is_ok());
    }

    #[test]
    fn repairs_unknown_vim_values() {
        let mut settings = AppSettings::default();
        settings.vim_leader = "   ".into();
        settings.vim_yank_target = "elsewhere".into();
        settings.vim_delete_target = "elsewhere".into();
        settings.vim_paste_source = "elsewhere".into();
        settings.line_numbers = "elsewhere".into();
        let repaired = settings.repair();
        assert_eq!(repaired.vim_leader, "Space");
        assert_eq!(repaired.vim_yank_target, "clipboard");
        assert_eq!(repaired.vim_delete_target, "blackhole");
        assert_eq!(repaired.vim_paste_source, "clipboard");
        assert_eq!(repaired.line_numbers, "relative");
    }

    #[test]
    fn repairs_remaps() {
        let mut settings = AppSettings::default();
        settings.vim_remaps = vec![
            VimRemap {
                mode: " Normal ".into(),
                lhs: " <leader>d ".into(),
                rhs: " dd ".into(),
            },
            VimRemap {
                mode: "elsewhere".into(),
                lhs: "x".into(),
                rhs: "y".into(),
            },
            VimRemap {
                mode: "normal".into(),
                lhs: "".into(),
                rhs: "y".into(),
            },
            VimRemap {
                mode: "normal".into(),
                lhs: "x".repeat(MAX_REMAP_CHARS + 1),
                rhs: "y".into(),
            },
            VimRemap {
                mode: "normal".into(),
                lhs: "X".into(),
                rhs: "\"+x".into(),
            },
        ];
        let repaired = settings.repair();
        assert_eq!(repaired.vim_remaps.len(), 1);
        assert_eq!(repaired.vim_remaps[0].mode, "normal");
        assert_eq!(repaired.vim_remaps[0].lhs, "<leader>d");
        assert_eq!(repaired.vim_remaps[0].rhs, "dd");
    }

    #[test]
    fn register_prefixes_are_detected() {
        assert!(has_register_prefix("\"+x"));
        assert!(has_register_prefix("\"_d"));
        assert!(has_register_prefix("\"ay"));
        assert!(!has_register_prefix("dd"));
        assert!(!has_register_prefix(":noh<CR>"));
    }

    #[test]
    fn sanitize_rejects_bad_remaps_and_leader() {
        let mut settings = AppSettings::default();
        settings.vim_remaps = vec![VimRemap {
            mode: "elsewhere".into(),
            lhs: "x".into(),
            rhs: "y".into(),
        }];
        assert!(settings.sanitize().is_err());

        let mut settings = AppSettings::default();
        settings.vim_leader = "".into();
        assert!(settings.sanitize().is_err());

        let mut settings = AppSettings::default();
        settings.vim_remaps = vec![VimRemap {
            mode: "normal".into(),
            lhs: "X".into(),
            rhs: "\"+x".into(),
        }];
        assert!(settings.sanitize().is_err());
    }

    #[test]
    fn empty_remap_rows_are_kept_while_editing_and_dropped_on_load() {
        let mut settings = AppSettings::default();
        settings.vim_remaps = vec![VimRemap {
            mode: "normal".into(),
            lhs: "".into(),
            rhs: "".into(),
        }];
        assert!(settings.clone().sanitize().is_ok());
        assert!(settings.repair().vim_remaps.is_empty());
    }

    #[test]
    fn remaps_are_capped() {
        let mut settings = AppSettings::default();
        settings.vim_remaps = (0..MAX_REMAPS + 20)
            .map(|index| VimRemap {
                mode: "normal".into(),
                lhs: format!("<leader>{}", index),
                rhs: "dd".into(),
            })
            .collect();
        let repaired = settings.repair();
        assert_eq!(repaired.vim_remaps.len(), MAX_REMAPS);
    }
}
