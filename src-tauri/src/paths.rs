use std::path::{Component, Path, PathBuf};

use crate::error::{ApiError, ApiResult};

const IGNORED_DIRS: [&str; 7] = [
    ".git",
    "node_modules",
    ".obsidian",
    ".trash",
    ".cache",
    "dist",
    ".mdlite-trash",
];

pub fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn safe_join(root: &Path, rel: &str) -> ApiResult<PathBuf> {
    let clean = rel.trim_start_matches('/');
    let root_norm = lexical(root);
    let candidate = lexical(&root_norm.join(clean));

    if candidate != root_norm && !candidate.starts_with(&root_norm) {
        return Err(ApiError::bad_request("path escapes root"));
    }

    if let (Ok(real), Ok(real_root)) = (candidate.canonicalize(), root_norm.canonicalize()) {
        if real != real_root && !real.starts_with(&real_root) {
            return Err(ApiError::bad_request("path escapes root"));
        }
    }

    Ok(candidate)
}

pub fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn is_ignored(rel: &str) -> bool {
    if rel.is_empty() {
        return false;
    }
    for part in rel.split('/') {
        if part.is_empty() {
            continue;
        }
        if part.starts_with('.') || IGNORED_DIRS.contains(&part) {
            return true;
        }
    }
    false
}

pub fn is_media_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    let extension = lower.rsplit('.').next().unwrap_or("");
    matches!(
        extension,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" | "mp4" | "webm" | "mov"
            | "m4v" | "ogv"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_traversal() {
        let root = Path::new("/tmp/vault");
        assert!(safe_join(root, "../../etc/passwd").is_err());
        assert!(safe_join(root, "docs/../../outside").is_err());
    }

    #[test]
    fn treats_absolute_paths_as_root_relative() {
        let root = Path::new("/tmp/vault");
        let resolved = safe_join(root, "/etc/passwd").unwrap();
        assert_eq!(resolved, PathBuf::from("/tmp/vault/etc/passwd"));
    }

    #[test]
    fn accepts_nested_paths() {
        let root = Path::new("/tmp/vault");
        let joined = safe_join(root, "docs/a.md").unwrap();
        assert_eq!(joined, PathBuf::from("/tmp/vault/docs/a.md"));
        assert_eq!(safe_join(root, "").unwrap(), PathBuf::from("/tmp/vault"));
    }

    #[test]
    fn ignores_hidden_and_build_dirs() {
        assert!(is_ignored(".git/config"));
        assert!(is_ignored("docs/.obsidian/app.json"));
        assert!(is_ignored("node_modules/pkg/index.js"));
        assert!(!is_ignored("docs/notes.md"));
    }
}
