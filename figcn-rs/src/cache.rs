// src/cache.rs
// Figma 缓存清理

use std::fs;
use std::path::PathBuf;

/// 获取 Figma 桌面版缓存基础目录
fn figma_cache_base() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let base = home
        .join("Library")
        .join("Application Support")
        .join("Figma")
        .join("DesktopProfile");
    if base.exists() {
        Some(base)
    } else {
        None
    }
}

/// 清理 Figma 缓存
pub fn clear() -> anyhow::Result<()> {
    let base = match figma_cache_base() {
        Some(b) => b,
        None => {
            println!("ℹ️  未找到 Figma 缓存目录，无需清理。");
            return Ok(());
        }
    };

    let entries = fs::read_dir(&base)?;
    let mut cleared = Vec::new();
    let mut skipped = Vec::new();

    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let cache_dir = entry.path().join("Cache");
        if !cache_dir.exists() {
            skipped.push(cache_dir);
            continue;
        }

        if !cache_dir.is_dir() {
            skipped.push(cache_dir);
            continue;
        }

        // 删除并重建
        match fs::remove_dir_all(&cache_dir) {
            Ok(()) => {
                fs::create_dir_all(&cache_dir)?;
                cleared.push(cache_dir);
            }
            Err(e) => {
                eprintln!("⚠️  清理失败：{} — {}", cache_dir.display(), e);
            }
        }
    }

    if cleared.is_empty() {
        println!("ℹ️  未发现需要清理的缓存。");
    } else {
        println!("✅ 已清理 {} 个缓存目录：", cleared.len());
        for p in &cleared {
            println!("   {}", p.display());
        }
    }

    if !skipped.is_empty() {
        println!("⏭️  跳过 {} 个目录（不存在或非目录）", skipped.len());
    }

    println!("\n💡 请在 Figma 中点击 Figma → Check for Updates → Reload All Tabs");
    Ok(())
}
