use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;

use crate::error::{ApiError, ApiResult};
use crate::paths::{is_media_name, safe_join};
use crate::tree::millis;

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES: usize = 60 * 1024 * 1024;
const TRASH_DIR: &str = ".mdlite-trash";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDoc {
    pub path: String,
    pub content: String,
    pub mtime: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub mtime: u64,
    pub size: u64,
}

pub fn read_text(root: &Path, rel: &str) -> ApiResult<FileDoc> {
    let abs = safe_join(root, rel)?;
    let metadata = fs::metadata(&abs)?;
    if !metadata.is_file() {
        return Err(ApiError::bad_request("not a file"));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(ApiError::new("too_large", "file is too large to open"));
    }
    let content = fs::read_to_string(&abs)?;
    Ok(FileDoc {
        path: rel.to_string(),
        content,
        mtime: metadata.modified().map(millis).unwrap_or(0),
        size: metadata.len(),
    })
}

pub fn write_text(
    root: &Path,
    rel: &str,
    content: &str,
    expected_mtime: Option<u64>,
    force: bool,
) -> ApiResult<SaveResult> {
    let abs = safe_join(root, rel)?;
    let existing = fs::metadata(&abs).ok();

    if let Some(metadata) = &existing {
        if !metadata.is_file() {
            return Err(ApiError::bad_request("not a file"));
        }
        if !force {
            if let Some(expected) = expected_mtime {
                let current = metadata.modified().map(millis).unwrap_or(0);
                if current != expected {
                    let disk = fs::read_to_string(&abs).unwrap_or_default();
                    return Err(ApiError::conflict("file changed on disk", current, disk));
                }
            }
        }
    }

    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut handle = fs::File::create(&abs)?;
    handle.write_all(content.as_bytes())?;
    handle.flush().ok();

    let metadata = fs::metadata(&abs)?;
    Ok(SaveResult {
        path: rel.to_string(),
        mtime: metadata.modified().map(millis).unwrap_or(0),
        size: metadata.len(),
    })
}

pub fn create_entry(root: &Path, rel: &str, is_dir: bool) -> ApiResult<String> {
    let abs = safe_join(root, rel)?;
    if abs.exists() {
        return Err(ApiError::new("exists", "already exists"));
    }
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    if is_dir {
        fs::create_dir(&abs)?;
    } else {
        fs::write(&abs, b"")?;
    }
    Ok(rel.to_string())
}

fn assert_name(name: &str) -> ApiResult<()> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(ApiError::bad_request("invalid name"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(ApiError::bad_request("name cannot contain slashes"));
    }
    if name.starts_with('.') {
        return Err(ApiError::bad_request("name cannot start with a dot"));
    }
    if name.len() > 200 {
        return Err(ApiError::bad_request("name is too long"));
    }
    Ok(())
}

fn sibling(rel: &str, name: &str) -> String {
    match rel.rfind('/') {
        Some(index) => format!("{}/{}", &rel[..index], name),
        None => name.to_string(),
    }
}

pub fn rename_entry(root: &Path, rel: &str, name: &str) -> ApiResult<String> {
    assert_name(name)?;
    let from = safe_join(root, rel)?;
    let to_rel = sibling(rel, name);
    let to = safe_join(root, &to_rel)?;
    if to.exists() {
        return Err(ApiError::new("exists", "target already exists"));
    }
    fs::rename(from, to)?;
    Ok(to_rel)
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(from, to).map(|_| ())
    }
}

pub fn transfer_entry(root: &Path, from_rel: &str, to_rel: &str, copy: bool) -> ApiResult<String> {
    let from = safe_join(root, from_rel)?;
    let to = safe_join(root, to_rel)?;
    if to.exists() {
        return Err(ApiError::new("exists", "target already exists"));
    }
    if copy {
        copy_recursive(&from, &to)?;
    } else {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(from, to)?;
    }
    Ok(to_rel.to_string())
}

pub fn trash_entry(root: &Path, rel: &str) -> ApiResult<String> {
    let from = safe_join(root, rel)?;
    let name = from
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let trash_dir = root.join(TRASH_DIR);
    fs::create_dir_all(&trash_dir)?;
    let target = trash_dir.join(format!("{stamp}-{name}"));
    fs::rename(from, &target)?;
    Ok(format!(
        "{TRASH_DIR}/{}",
        target.file_name().unwrap_or_default().to_string_lossy()
    ))
}

pub fn restore_entry(root: &Path, from_rel: &str, to_rel: &str) -> ApiResult<String> {
    let trash_root = root.join(TRASH_DIR);
    let from = safe_join(root, from_rel)?;
    if !from.starts_with(&trash_root) {
        return Err(ApiError::bad_request("not a trash path"));
    }
    let to = safe_join(root, to_rel)?;
    if to.exists() {
        return Err(ApiError::new("exists", "target already exists"));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(from, to)?;
    Ok(to_rel.to_string())
}

fn sanitize(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "media".to_string());
    let cleaned: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '.' || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "media".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

pub fn save_upload(root: &Path, dir_rel: &str, name: &str, data: &str) -> ApiResult<String> {
    if !is_media_name(name) {
        return Err(ApiError::bad_request("unsupported media type"));
    }
    let engine = base64::engine::general_purpose::STANDARD;
    let bytes = engine
        .decode(data)
        .map_err(|_| ApiError::bad_request("invalid base64 payload"))?;
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(ApiError::new("too_large", "file is larger than 60 MB"));
    }

    let dir = safe_join(root, dir_rel)?;
    if !dir.is_dir() {
        return Err(ApiError::bad_request("target folder does not exist"));
    }

    let extension = Path::new(name)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "png".to_string());
    let stem = sanitize(name);
    let media_dir = dir.join("images");
    fs::create_dir_all(&media_dir)?;

    let mut target: PathBuf = media_dir.join(format!("{stem}.{extension}"));
    let mut counter = 1;
    while target.exists() {
        target = media_dir.join(format!("{stem}-{counter}.{extension}"));
        counter += 1;
    }
    fs::write(&target, &bytes)?;

    Ok(format!(
        "images/{}",
        target.file_name().unwrap_or_default().to_string_lossy()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let base = std::env::temp_dir().join(format!("mdlite-files-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn writes_and_detects_conflicts() {
        let root = scratch();
        fs::write(root.join("a.md"), "one").unwrap();
        let first = fs::metadata(root.join("a.md")).unwrap().modified().map(millis).unwrap();

        let saved = write_text(&root, "a.md", "two", Some(first), false).unwrap();
        assert_eq!(saved.size, 3);

        let stale = write_text(&root, "a.md", "three", Some(first), false).unwrap_err();
        assert_eq!(stale.kind, "conflict");
        assert_eq!(stale.content.as_deref(), Some("two"));

        let forced = write_text(&root, "a.md", "three", Some(first), true).unwrap();
        assert_eq!(forced.size, 5);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn renames_moves_and_restores() {
        let root = scratch();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("a.md"), "x").unwrap();

        assert_eq!(rename_entry(&root, "a.md", "b.md").unwrap(), "b.md");
        transfer_entry(&root, "b.md", "sub/b.md", false).unwrap();
        assert!(root.join("sub/b.md").exists());

        let trashed = trash_entry(&root, "sub/b.md").unwrap();
        assert!(trashed.starts_with(".mdlite-trash/"));
        assert!(!root.join("sub/b.md").exists());

        restore_entry(&root, &trashed, "sub/b.md").unwrap();
        assert!(root.join("sub/b.md").exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stores_uploads_next_to_the_note() {
        let root = scratch();
        fs::create_dir_all(root.join("notes")).unwrap();
        let payload = base64::engine::general_purpose::STANDARD.encode(b"png-bytes");
        let saved = save_upload(&root, "notes", "shot one.png", &payload).unwrap();
        assert_eq!(saved, "images/shot-one.png");
        assert_eq!(fs::read(root.join("notes").join(&saved)).unwrap(), b"png-bytes");

        let second = save_upload(&root, "notes", "shot one.png", &payload).unwrap();
        assert_eq!(second, "images/shot-one-1.png");

        fs::remove_dir_all(&root).ok();
    }
}
