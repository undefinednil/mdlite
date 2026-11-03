use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::paths::{is_media_name, safe_join};
use crate::tree::millis;

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_CONFLICT_BYTES: u64 = 1024 * 1024;

pub fn content_hash(bytes: &[u8]) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in bytes {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn disk_hash(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_FILE_BYTES {
        return None;
    }
    fs::read(path).ok().map(|bytes| content_hash(&bytes))
}
const MAX_UPLOAD_BYTES: usize = 60 * 1024 * 1024;
const TRASH_DIR: &str = ".mdlite-trash";
static TRASH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub path: String,
    pub name: String,
    pub original: String,
    pub original_known: bool,
    pub deleted_at: u64,
    pub kind: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashMeta {
    original: String,
    deleted_at: u64,
    kind: String,
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
    let bytes = fs::read(&abs)?;
    let content = match String::from_utf8(bytes) {
        Ok(text) if !text.contains('\0') => text,
        _ => return Err(ApiError::new("binary", "file is not text")),
    };
    Ok(FileDoc {
        path: rel.to_string(),
        content,
        mtime: metadata.modified().map(millis).unwrap_or(0),
        size: metadata.len(),
    })
}

fn conflict_content(path: &Path) -> String {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return String::new(),
    };
    let mut bytes = Vec::new();
    if file.take(MAX_CONFLICT_BYTES).read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes).to_string()
}

pub fn write_text(
    root: &Path,
    rel: &str,
    content: &str,
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
    expected_hash: Option<String>,
    force: bool,
) -> ApiResult<SaveResult> {
    let abs = safe_join(root, rel)?;
    let existing = fs::metadata(&abs).ok();

    if let Some(metadata) = &existing {
        if !metadata.is_file() {
            return Err(ApiError::bad_request("not a file"));
        }
        if !force {
            let current = metadata.modified().map(millis).unwrap_or(0);
            let changed = expected_mtime.map(|value| value != current).unwrap_or(false);
            let resized = expected_size.map(|value| value != metadata.len()).unwrap_or(false);
            let hashed = expected_hash
                .as_deref()
                .map(|expected| disk_hash(&abs).map(|actual| actual != expected).unwrap_or(true))
                .unwrap_or(false);
            if changed || resized || hashed {
                let disk = conflict_content(&abs);
                return Err(ApiError::conflict("file changed on disk", current, disk));
            }
        }
    }

    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    let name = abs
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "note".to_string());
    let temp = abs.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    let result: std::io::Result<()> = (|| {
        let mut handle = fs::File::create(&temp)?;
        if let Some(metadata) = &existing {
            fs::set_permissions(&temp, metadata.permissions())?;
        }
        handle.write_all(content.as_bytes())?;
        handle.sync_all()?;
        drop(handle);
        fs::rename(&temp, &abs)?;
        Ok(())
    })();
    if let Err(error) = result {
        fs::remove_file(&temp).ok();
        return Err(ApiError::io(&error));
    }

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
    let metadata = fs::symlink_metadata(from)?;
    if metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "cannot copy symbolic links",
        ));
    }
    if metadata.is_dir() {
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
    if from == to || (from.is_dir() && to.starts_with(&from)) {
        return Err(ApiError::bad_request(
            "cannot move or copy a folder into itself",
        ));
    }
    if to.exists() {
        return Err(ApiError::new("exists", "target already exists"));
    }
    if copy {
        copy_recursive(&from, &to)?;
    } else {
        fs::rename(from, to)?;
    }
    Ok(to_rel.to_string())
}

fn trash_meta_path(trash_dir: &Path, entry_name: &str) -> PathBuf {
    trash_dir.join(format!(".mdlite-meta-{}.json", content_hash(entry_name.as_bytes())))
}

fn inferred_trash_original(name: &str) -> (String, u64) {
    if let Some((prefix, rest)) = name.split_once('-') {
        if let Ok(stamp) = prefix.parse::<u64>() {
            return (rest.to_string(), stamp);
        }
    }
    if let Some((base, suffix)) = name.rsplit_once('-') {
        if suffix.len() >= 10 && suffix.chars().all(|character| character.is_ascii_digit()) {
            if let Ok(stamp) = suffix.parse::<u64>() {
                return (base.to_string(), stamp);
            }
        }
    }
    (name.to_string(), 0)
}

fn write_trash_meta(trash_dir: &Path, entry_name: &str, original: &str, deleted_at: u64, kind: &str) {
    let meta = TrashMeta {
        original: original.to_string(),
        deleted_at,
        kind: kind.to_string(),
    };
    if let Ok(bytes) = serde_json::to_vec(&meta) {
        let _ = fs::write(trash_meta_path(trash_dir, entry_name), bytes);
    }
}

fn remove_trash_meta(trash_dir: &Path, entry_name: &str) {
    let _ = fs::remove_file(trash_meta_path(trash_dir, entry_name));
}

pub fn trash_entry(root: &Path, rel: &str) -> ApiResult<String> {
    let _guard = TRASH_LOCK
        .lock()
        .map_err(|_| ApiError::new("state", "trash is busy"))?;
    let from = safe_join(root, rel)?;
    if from == root {
        return Err(ApiError::bad_request("cannot trash the root folder"));
    }
    let metadata = fs::metadata(&from)?;
    let original = rel.trim_start_matches('/').to_string();
    let name = from
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    let trash_dir = root.join(TRASH_DIR);
    fs::create_dir_all(&trash_dir)?;

    let mut entry_name = name.clone();
    let mut target = trash_dir.join(&entry_name);
    if target.exists() {
        let mut attempt = 0u64;
        loop {
            let suffix = stamp.saturating_add(attempt);
            entry_name = format!("{name}-{suffix}");
            target = trash_dir.join(&entry_name);
            if !target.exists() {
                break;
            }
            attempt = attempt.saturating_add(1);
        }
    }

    fs::rename(&from, &target)?;
    let kind = if metadata.is_dir() { "dir" } else { "file" };
    write_trash_meta(&trash_dir, &entry_name, &original, stamp, kind);
    Ok(format!("{TRASH_DIR}/{entry_name}"))
}

pub fn trash_list(root: &Path) -> ApiResult<Vec<TrashEntry>> {
    let trash_dir = root.join(TRASH_DIR);
    let dir = match fs::read_dir(&trash_dir) {
        Ok(dir) => dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(ApiError::from(error)),
    };

    let mut entries: Vec<TrashEntry> = Vec::new();
    for entry in dir.flatten() {
        let entry_name = entry.file_name().to_string_lossy().to_string();
        if entry_name == ".DS_Store" || entry_name.starts_with(".mdlite-meta-") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let meta = fs::read(trash_meta_path(&trash_dir, &entry_name))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<TrashMeta>(&bytes).ok());
        let (original, deleted_at, original_known) = match meta {
            Some(meta) => (meta.original, meta.deleted_at, true),
            None => {
                let (original, deleted_at) = inferred_trash_original(&entry_name);
                (original, deleted_at, false)
            }
        };
        entries.push(TrashEntry {
            path: format!("{TRASH_DIR}/{entry_name}"),
            name: entry_name,
            original,
            original_known,
            deleted_at,
            kind: if metadata.is_dir() { "dir" } else { "file" }.to_string(),
            size: metadata.len(),
        });
    }
    entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then_with(|| a.original.cmp(&b.original)));
    Ok(entries)
}

pub fn restore_entry(root: &Path, from_rel: &str, to_rel: &str) -> ApiResult<String> {
    let trash_root = root.join(TRASH_DIR);
    let from = safe_join(root, from_rel)?;
    if from == trash_root || !from.starts_with(&trash_root) {
        return Err(ApiError::bad_request("not a trash path"));
    }
    let to = safe_join(root, to_rel)?;
    if to == trash_root || to.starts_with(&trash_root) {
        return Err(ApiError::bad_request("cannot restore into the trash"));
    }
    if to.exists() {
        return Err(ApiError::new("exists", "target already exists"));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&from, &to)?;
    if let Some(entry_name) = from.file_name().map(|value| value.to_string_lossy().to_string()) {
        remove_trash_meta(&trash_root, &entry_name);
    }
    Ok(to_rel.to_string())
}

pub fn trash_purge(root: &Path, rel: &str) -> ApiResult<()> {
    let trash_root = root.join(TRASH_DIR);
    let target = safe_join(root, rel)?;
    if target == trash_root || !target.starts_with(&trash_root) {
        return Err(ApiError::bad_request("not a trash path"));
    }
    let metadata = fs::symlink_metadata(&target)?;
    if metadata.is_dir() {
        fs::remove_dir_all(&target)?;
    } else {
        fs::remove_file(&target)?;
    }
    if let Some(entry_name) = target.file_name().map(|value| value.to_string_lossy().to_string()) {
        remove_trash_meta(&trash_root, &entry_name);
    }
    Ok(())
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
        let metadata = fs::metadata(root.join("a.md")).unwrap();
        let first = metadata.modified().map(millis).unwrap();
        let first_size = metadata.len();
        let first_hash = content_hash(b"one");

        let saved =
            write_text(&root, "a.md", "two", Some(first), Some(first_size), Some(first_hash.clone()), false)
                .unwrap();
        assert_eq!(saved.size, 3);

        let stale = write_text(
            &root,
            "a.md",
            "three",
            Some(first),
            Some(first_size),
            Some(first_hash.clone()),
            false,
        )
        .unwrap_err();
        assert_eq!(stale.kind, "conflict");
        assert_eq!(stale.content.as_deref(), Some("two"));

        let forced = write_text(
            &root,
            "a.md",
            "three",
            Some(first),
            Some(first_size),
            Some(first_hash),
            true,
        )
        .unwrap();
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
    fn keeps_trash_names_and_numbers_conflicts() {
        let root = scratch();
        fs::write(root.join("note.md"), "one").unwrap();
        let first = trash_entry(&root, "note.md").unwrap();
        assert_eq!(first, ".mdlite-trash/note.md");

        fs::write(root.join("note.md"), "two").unwrap();
        let second = trash_entry(&root, "note.md").unwrap();
        assert!(second.starts_with(".mdlite-trash/note.md-"));
        assert!(root.join(&second).exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn lists_trash_entries_with_their_original_paths() {
        let root = scratch();
        fs::create_dir_all(root.join("docs/archive")).unwrap();
        fs::write(root.join("docs/archive/plan.md"), "x").unwrap();

        let trashed = trash_entry(&root, "docs/archive").unwrap();
        let entries = trash_list(&root).unwrap();
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.path, trashed);
        assert_eq!(entry.original, "docs/archive");
        assert_eq!(entry.kind, "dir");
        assert!(entry.original_known);
        assert!(entry.deleted_at > 0);

        restore_entry(&root, &entry.path, &entry.original).unwrap();
        assert!(root.join("docs/archive/plan.md").exists());
        assert!(trash_list(&root).unwrap().is_empty());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reads_legacy_timestamped_trash_names() {
        let root = scratch();
        let legacy = root.join(TRASH_DIR).join("1793941371851-archive");
        fs::create_dir_all(legacy.join("originals")).unwrap();
        fs::write(legacy.join("originals/a.md"), "x").unwrap();

        let entries = trash_list(&root).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].original, "archive");
        assert_eq!(entries[0].deleted_at, 1793941371851);
        assert!(!entries[0].original_known);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn purges_trash_entries_permanently() {
        let root = scratch();
        fs::write(root.join("old.md"), "x").unwrap();
        let trashed = trash_entry(&root, "old.md").unwrap();
        trash_purge(&root, &trashed).unwrap();
        assert!(!root.join(&trashed).exists());
        assert!(trash_list(&root).unwrap().is_empty());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_to_restore_into_the_trash() {
        let root = scratch();
        fs::write(root.join("old.md"), "x").unwrap();
        let trashed = trash_entry(&root, "old.md").unwrap();
        let error = restore_entry(&root, &trashed, trashed.as_str()).unwrap_err();
        assert_eq!(error.kind, "bad_request");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reads_extensionless_text_and_rejects_binary() {
        let root = scratch();
        fs::write(root.join("run"), "#!/bin/sh\necho ok\n").unwrap();
        let doc = read_text(&root, "run").unwrap();
        assert_eq!(doc.content, "#!/bin/sh\necho ok\n");

        fs::write(root.join("blob"), [0u8, 159u8, 146u8, 150u8]).unwrap();
        let error = read_text(&root, "blob").unwrap_err();
        assert_eq!(error.kind, "binary");

        fs::write(root.join("nul"), b"a\0b").unwrap();
        let error = read_text(&root, "nul").unwrap_err();
        assert_eq!(error.kind, "binary");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn content_hash_matches_the_frontend() {
        assert_eq!(content_hash(b"hello"), "4f9f2cab");
        assert_eq!(content_hash(b""), "811c9dc5");
        assert_eq!(content_hash("こんにちは".as_bytes()), "1cfa9ccd");
    }

    #[test]
    fn refuses_to_copy_a_folder_into_itself() {
        let root = scratch();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs/a.md"), "x").unwrap();

        let error = transfer_entry(&root, "docs", "docs/nested", true).unwrap_err();
        assert_eq!(error.kind, "bad_request");
        assert!(!root.join("docs/nested").exists());

        let error = transfer_entry(&root, "docs", "docs/nested", false).unwrap_err();
        assert_eq!(error.kind, "bad_request");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn move_does_not_recreate_a_missing_destination() {
        let root = scratch();
        fs::write(root.join("a.md"), "x").unwrap();
        assert!(transfer_entry(&root, "a.md", "missing/a.md", false).is_err());
        assert!(!root.join("missing").exists());

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
