use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::paths::{is_ignored, relative};

const MAX_ENTRIES: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub size: u64,
    pub mtime: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

pub fn millis(time: std::time::SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub fn build_tree(root: &Path) -> Vec<TreeNode> {
    let mut budget = MAX_ENTRIES;
    read_dir(root, root, &mut budget)
}

fn read_dir(dir: &Path, root: &Path, budget: &mut usize) -> Vec<TreeNode> {
    let mut nodes: Vec<TreeNode> = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return nodes,
    };

    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let rel = relative(root, &path);
        if is_ignored(&rel) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let mtime = metadata
            .modified()
            .map(millis)
            .unwrap_or(0);

        if file_type.is_dir() {
            *budget -= 1;
            let children = read_dir(&path, root, budget);
            let child_mtime = children.iter().map(|child| child.mtime).max().unwrap_or(0);
            nodes.push(TreeNode {
                name,
                path: rel,
                kind: "dir".to_string(),
                size: 0,
                mtime: mtime.max(child_mtime),
                children: Some(children),
            });
        } else if file_type.is_file() {
            *budget -= 1;
            nodes.push(TreeNode {
                name,
                path: rel,
                kind: "file".to_string(),
                size: metadata.len(),
                mtime,
                children: None,
            });
        }
    }

    nodes.sort_by(|a, b| {
        if a.kind != b.kind {
            return if a.kind == "dir" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    nodes
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn walks_directories_and_skips_hidden() {
        let base = std::env::temp_dir().join(format!("mdlite-tree-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(base.join("docs")).unwrap();
        fs::write(base.join("docs/a.md"), "# a").unwrap();
        fs::write(base.join(".hidden"), "x").unwrap();
        fs::create_dir_all(base.join(".git")).unwrap();
        fs::write(base.join(".git/config"), "x").unwrap();

        let tree = build_tree(&base);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "docs");
        assert_eq!(tree[0].kind, "dir");
        let children = tree[0].children.as_ref().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].path, "docs/a.md");

        fs::remove_dir_all(&base).ok();
    }
}
