use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Instant;

use regex::RegexBuilder;
use serde::Serialize;

use crate::error::{ApiError, ApiResult};
use crate::paths::{is_ignored, relative};

const MAX_FILES: usize = 120;
const MAX_PER_FILE: usize = 6;
const MAX_TOTAL: usize = 400;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepFile {
    pub path: String,
    pub matches: Vec<GrepMatch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResponse {
    pub files: Vec<GrepFile>,
    pub truncated: bool,
    pub took_ms: u64,
}

fn empty() -> GrepResponse {
    GrepResponse {
        files: Vec::new(),
        truncated: false,
        took_ms: 0,
    }
}

fn clamp(text: &str) -> String {
    let line = text.trim_end_matches(['\r', '\n']);
    if line.chars().count() > 240 {
        let mut shortened: String = line.chars().take(240).collect();
        shortened.push('…');
        shortened
    } else {
        line.to_string()
    }
}

pub fn grep(root: &Path, query: &str, regex: bool, case_sensitive: bool) -> ApiResult<GrepResponse> {
    if query.is_empty() {
        return Ok(empty());
    }
    if regex {
        regex::Regex::new(query).map_err(|error| ApiError::bad_request(error.to_string()))?;
    }

    let started = Instant::now();
    match grep_with_rg(root, query, regex, case_sensitive) {
        Ok(result) => Ok(result),
        Err(_) => grep_fallback(root, query, regex, case_sensitive, started),
    }
}

fn grep_with_rg(
    root: &Path,
    query: &str,
    regex: bool,
    case_sensitive: bool,
) -> Result<GrepResponse, ApiError> {
    let started = Instant::now();
    let mut args: Vec<String> = vec![
        "--json".into(),
        "--no-config".into(),
        "--with-filename".into(),
        "--line-number".into(),
        "--max-columns".into(),
        "300".into(),
        "--max-columns-preview".into(),
        "--max-count".into(),
        MAX_PER_FILE.to_string(),
        "--glob".into(),
        "!**/.git/**".into(),
        "--glob".into(),
        "!**/node_modules/**".into(),
        "--glob".into(),
        "!**/.obsidian/**".into(),
        "--glob".into(),
        "!**/dist/**".into(),
    ];
    if !regex {
        args.push("-F".into());
    }
    if !case_sensitive {
        args.push("-i".into());
    }
    args.push("--".into());
    args.push(query.to_string());
    args.push(".".into());

    let mut child = Command::new("rg")
        .args(&args)
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| ApiError::new("rg", error.to_string()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::new("rg", "no stdout"))?;

    let mut files: Vec<GrepFile> = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;

    for line in BufReader::new(stdout).lines().flatten() {
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("type").and_then(|kind| kind.as_str()) != Some("match") {
            continue;
        }
        let data = match value.get("data") {
            Some(data) => data,
            None => continue,
        };
        let raw_path = data
            .pointer("/path/text")
            .and_then(|path| path.as_str())
            .unwrap_or_default()
            .trim_start_matches("./")
            .to_string();
        if raw_path.is_empty() || raw_path.starts_with("..") {
            continue;
        }
        let text = clamp(
            data.pointer("/lines/text")
                .and_then(|text| text.as_str())
                .unwrap_or_default(),
        );
        let line_number = data
            .get("line_number")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32;

        if let Some(existing) = files.iter_mut().find(|file| file.path == raw_path) {
            existing.matches.push(GrepMatch {
                line: line_number,
                text,
            });
        } else {
            if files.len() >= MAX_FILES {
                truncated = true;
                break;
            }
            files.push(GrepFile {
                path: raw_path,
                matches: vec![GrepMatch {
                    line: line_number,
                    text,
                }],
            });
        }
        total += 1;
        if total >= MAX_TOTAL {
            truncated = true;
            break;
        }
    }

    let _ = child.kill();
    let _ = child.wait();

    Ok(GrepResponse {
        files,
        truncated,
        took_ms: started.elapsed().as_millis() as u64,
    })
}

fn grep_fallback(
    root: &Path,
    query: &str,
    regex: bool,
    case_sensitive: bool,
    started: Instant,
) -> ApiResult<GrepResponse> {
    let pattern = if regex {
        Some(
            RegexBuilder::new(query)
                .case_insensitive(!case_sensitive)
                .build()
                .map_err(|error| ApiError::bad_request(error.to_string()))?,
        )
    } else {
        None
    };
    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    let mut files: Vec<GrepFile> = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;

    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let rel = relative(root, entry.path());
            entry.depth() == 0 || !is_ignored(&rel)
        })
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.len() > 2_000_000 {
            continue;
        }
        let content = match fs::read_to_string(entry.path()) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let mut matches: Vec<GrepMatch> = Vec::new();
        for (index, line) in content.lines().enumerate() {
            let hit = match &pattern {
                Some(pattern) => pattern.is_match(line),
                None => {
                    if case_sensitive {
                        line.contains(&needle)
                    } else {
                        line.to_lowercase().contains(&needle)
                    }
                }
            };
            if !hit {
                continue;
            }
            matches.push(GrepMatch {
                line: index as u32 + 1,
                text: clamp(line),
            });
            total += 1;
            if matches.len() >= MAX_PER_FILE || total >= MAX_TOTAL {
                break;
            }
        }

        if !matches.is_empty() {
            if files.len() >= MAX_FILES {
                truncated = true;
                break;
            }
            files.push(GrepFile {
                path: relative(root, entry.path()),
                matches,
            });
        }
        if total >= MAX_TOTAL {
            truncated = true;
            break;
        }
    }

    Ok(GrepResponse {
        files,
        truncated,
        took_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_matches_with_fallback() {
        let base = std::env::temp_dir().join(format!("mdlite-grep-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(base.join("docs")).unwrap();
        fs::write(base.join("docs/a.md"), "alpha\nmermaid diagram\nbeta\n").unwrap();
        fs::write(base.join("docs/b.md"), "nothing here\n").unwrap();

        let result = grep_fallback(&base, "mermaid", false, false, Instant::now()).unwrap();
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.files[0].path, "docs/a.md");
        assert_eq!(result.files[0].matches[0].line, 2);

        fs::remove_dir_all(&base).ok();
    }
}
