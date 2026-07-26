//! Tauri 命令：与 Python 版 main.py 的 API 端点一一对应
//! 错误统一为 Err(String)，文案与 HTTPException detail 保持一致

use crate::config::{save_app_config, AppConfig, AppState, LibraryPaths};
use crate::exif::parse_exif;
use crate::models::{DuplicateGroup, Photo, PhotoUpdate, Series, Settings, SettingsUpdate};
use crate::storage;
use crate::thumbs::generate_thumbnail;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

/// 允许上传的图片后缀（对齐 Python 白名单）
const ALLOWED_SUFFIXES: [&str; 6] = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff"];

/// 指纹取值：字符串原样、数字转字符串、缺失用默认值（对齐 Python str(exif.get(...))）
fn fp_value(exif: &serde_json::Map<String, Value>, key: &str, default: &str) -> String {
    match exif.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
        None => default.to_string(),
    }
}

// ─── 库目录管理 ─────────────────────────────────────────

/// 库目录状态：是否已配置、路径、是否为空库（供首启引导判断）
#[tauri::command]
pub fn library_status(state: State<AppState>) -> Result<Value, String> {
    let guard = state.library_dir.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(root) => {
            let paths = LibraryPaths::new(root);
            Ok(json!({
                "configured": true,
                "path": root.to_string_lossy(),
                "empty": paths.is_empty_library(),
            }))
        }
        None => Ok(json!({ "configured": false, "path": null, "empty": true })),
    }
}

/// 设置库目录：建子目录、持久化配置、放行 asset protocol
#[tauri::command]
pub fn set_library_dir(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<Value, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("所选路径不是有效目录".to_string());
    }
    let paths = LibraryPaths::new(&root);
    paths.ensure_dirs()?;

    // asset protocol 允许读取该目录下的图片
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|e| e.to_string())?;

    // 持久化到应用配置
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    save_app_config(
        &config_dir,
        &AppConfig {
            library_dir: Some(root.to_string_lossy().into_owned()),
        },
    )?;

    let mut guard = state.library_dir.lock().map_err(|e| e.to_string())?;
    *guard = Some(root.clone());
    Ok(json!({
        "configured": true,
        "path": root.to_string_lossy(),
        "empty": paths.is_empty_library(),
    }))
}

/// 空库一键初始化示例库：把打包的 sample-library 拷入当前库目录
#[tauri::command]
pub fn init_sample_library(app: AppHandle, state: State<AppState>) -> Result<Value, String> {
    let paths = state.paths()?;
    if !paths.is_empty_library() {
        return Err("当前库不是空库，无法初始化示例数据".to_string());
    }
    paths.ensure_dirs()?;

    let sample_root = app
        .path()
        .resolve("sample-library", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("示例库资源不可用: {e}"))?;
    if !sample_root.is_dir() {
        return Err("示例库资源不可用".to_string());
    }

    copy_dir_recursive(&sample_root, &paths.root)?;
    Ok(json!({ "ok": true }))
}

/// 递归拷贝目录（仅示例库初始化使用，不覆盖已存在文件）
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if !target.exists() {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ─── 照片 API ───────────────────────────────────────────

/// GET /api/photos
#[tauri::command]
pub fn list_photos(
    state: State<AppState>,
    series: Option<String>,
    featured: Option<bool>,
    sort: Option<String>,
) -> Result<Vec<Photo>, String> {
    let paths = state.paths()?;
    let mut photos = storage::load_photos(&paths)?;

    if let Some(ref s) = series {
        if !s.is_empty() && s != "all" {
            photos.retain(|p| &p.series == s);
        }
    }
    if let Some(f) = featured {
        photos.retain(|p| p.featured == f);
    }
    match sort.as_deref() {
        // 拍摄日期倒序（稳定排序，等键保持原序，与 Python 一致）
        Some("date") => photos.sort_by(|a, b| b.date_taken.cmp(&a.date_taken)),
        // 原始文件名；缺失回退存储文件名
        Some("filename") => photos.sort_by(|a, b| {
            let ka = if a.original_name.is_empty() { &a.filename } else { &a.original_name };
            let kb = if b.original_name.is_empty() { &b.filename } else { &b.original_name };
            ka.cmp(kb)
        }),
        _ => {}
    }
    Ok(photos)
}

/// POST /api/photos/upload —— Tauri 版入参为本地文件路径（dialog / 拖放提供）
#[tauri::command]
pub fn upload_photos(state: State<AppState>, paths_in: Vec<String>) -> Result<Vec<Photo>, String> {
    let lib = state.paths()?;
    lib.ensure_dirs()?;

    // 先整体校验后缀，避免中途失败留下脏文件
    for p in &paths_in {
        let src = Path::new(p);
        let suffix = src
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        if !ALLOWED_SUFFIXES.contains(&suffix.as_str()) {
            let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            return Err(format!("不支持的文件格式: {name}"));
        }
    }

    let mut results: Vec<Photo> = Vec::new();
    for p in &paths_in {
        let src = Path::new(p);
        let original_name = src
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let suffix = src
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();

        let photo_id = uuid::Uuid::new_v4().simple().to_string()[..10].to_string();
        let safe_name = format!("{photo_id}{suffix}");
        let dest = lib.assets.join(&safe_name);
        fs::copy(src, &dest).map_err(|e| format!("复制文件失败 {original_name}: {e}"))?;

        let exif = parse_exif(&dest);
        let thumb_name = generate_thumbnail(&dest, &lib.thumbs, &photo_id);

        // 标题默认取原文件名主干，- 和 _ 换成空格
        let stem = src
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let title = stem.replace('-', " ").replace('_', " ");

        results.push(Photo {
            id: photo_id,
            filename: safe_name,
            thumb: thumb_name,
            original_name,
            title,
            location: String::new(),
            series: "shanchuan".to_string(),
            featured: false,
            date_taken: exif.date_taken.clone(),
            exif: exif.to_map(),
        });
    }

    // 直接入库，前端确认时 PATCH 回写元数据；取消则 DELETE 移除
    let mut photos = storage::load_photos(&lib)?;
    photos.extend(results.iter().cloned());
    storage::save_photos(&lib, &photos)?;
    Ok(results)
}

/// PATCH /api/photos/{photo_id}
#[tauri::command]
pub fn update_photo(
    state: State<AppState>,
    photo_id: String,
    body: PhotoUpdate,
) -> Result<Photo, String> {
    let paths = state.paths()?;
    let mut photos = storage::load_photos(&paths)?;
    let series_list = storage::load_series(&paths)?;

    let target = photos
        .iter_mut()
        .find(|p| p.id == photo_id)
        .ok_or_else(|| "照片不存在".to_string())?;

    if let Some(title) = body.title {
        target.title = title;
    }
    if let Some(location) = body.location {
        target.location = location;
    }
    if let Some(series) = body.series {
        let mut valid_ids: HashSet<String> = series_list.iter().map(|s| s.id.clone()).collect();
        valid_ids.insert("uncategorized".to_string());
        if !valid_ids.contains(&series) {
            return Err("无效的系列值".to_string());
        }
        target.series = series;
    }
    if let Some(featured) = body.featured {
        target.featured = featured;
    }
    if let Some(date_taken) = body.date_taken {
        target.date_taken = date_taken;
    }
    if let Some(exif_patch) = body.exif {
        // 合并更新（对齐 Python dict.update）
        for (k, v) in exif_patch {
            target.exif.insert(k, v);
        }
    }

    let updated = target.clone();
    storage::save_photos(&paths, &photos)?;
    Ok(updated)
}

/// DELETE /api/photos/{photo_id}
#[tauri::command]
pub fn delete_photo(state: State<AppState>, photo_id: String) -> Result<Value, String> {
    let paths = state.paths()?;
    let mut photos = storage::load_photos(&paths)?;
    let target = photos
        .iter()
        .find(|p| p.id == photo_id)
        .cloned()
        .ok_or_else(|| "照片不存在".to_string())?;

    let file_path = paths.assets.join(&target.filename);
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    if !target.thumb.is_empty() {
        let thumb_path = paths.thumbs.join(&target.thumb);
        if thumb_path.exists() {
            fs::remove_file(&thumb_path).map_err(|e| e.to_string())?;
        }
    }

    photos.retain(|p| p.id != photo_id);
    storage::save_photos(&paths, &photos)?;
    Ok(json!({ "ok": true, "deleted": photo_id }))
}

/// PUT /api/photos/order
#[tauri::command]
pub fn reorder_photos(state: State<AppState>, ids: Vec<String>) -> Result<Vec<Photo>, String> {
    let paths = state.paths()?;
    let photos = storage::load_photos(&paths)?;
    let known: HashSet<&str> = photos.iter().map(|p| p.id.as_str()).collect();
    for pid in &ids {
        if !known.contains(pid.as_str()) {
            return Err(format!("无效的照片 ID: {pid}"));
        }
    }

    // 按新顺序重建：先放排序后的照片，再放其余（保持原相对顺序）
    let id_set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let mut reordered: Vec<Photo> = ids
        .iter()
        .filter_map(|pid| photos.iter().find(|p| &p.id == pid).cloned())
        .collect();
    reordered.extend(photos.iter().filter(|p| !id_set.contains(p.id.as_str())).cloned());

    storage::save_photos(&paths, &reordered)?;
    Ok(reordered)
}

/// POST /api/photos/regenerate-thumbs
#[tauri::command]
pub fn regenerate_thumbs(state: State<AppState>) -> Result<Value, String> {
    let paths = state.paths()?;
    let mut photos = storage::load_photos(&paths)?;
    let mut count = 0;
    for p in photos.iter_mut() {
        let missing = p.thumb.is_empty() || !paths.thumbs.join(&p.thumb).exists();
        if missing {
            let src = paths.assets.join(&p.filename);
            if src.exists() {
                p.thumb = generate_thumbnail(&src, &paths.thumbs, &p.id);
                count += 1;
            }
        }
    }
    storage::save_photos(&paths, &photos)?;
    Ok(json!({ "regenerated": count }))
}

/// GET /api/duplicates
#[tauri::command]
pub fn find_duplicates(state: State<AppState>) -> Result<Vec<DuplicateGroup>, String> {
    let paths = state.paths()?;
    let photos = storage::load_photos(&paths)?;
    let series_list = storage::load_series(&paths)?;

    // 指纹 → 照片列表（Vec 保插入序，对齐 Python dict 行为）
    let mut groups: Vec<(String, Vec<Photo>)> = Vec::new();
    for p in &photos {
        let file_path = paths.assets.join(&p.filename);
        let file_size = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
        let fingerprint = [
            fp_value(&p.exif, "camera", ""),
            fp_value(&p.exif, "lens", ""),
            fp_value(&p.exif, "focal_length", ""),
            fp_value(&p.exif, "aperture", ""),
            fp_value(&p.exif, "shutter_speed", ""),
            fp_value(&p.exif, "iso", ""),
            fp_value(&p.exif, "date_taken", ""),
            fp_value(&p.exif, "width", "0"),
            fp_value(&p.exif, "height", "0"),
            file_size.to_string(),
        ]
        .join("|");

        match groups.iter_mut().find(|(fp, _)| fp == &fingerprint) {
            Some((_, members)) => members.push(p.clone()),
            None => groups.push((fingerprint, vec![p.clone()])),
        }
    }

    // 只保留有重复的组，按系列归类
    let mut by_series: Vec<(String, Vec<Vec<Photo>>)> = Vec::new();
    for (_, members) in groups {
        if members.len() < 2 {
            continue;
        }
        let sid = if members[0].series.is_empty() {
            "uncategorized".to_string()
        } else {
            members[0].series.clone()
        };
        match by_series.iter_mut().find(|(s, _)| s == &sid) {
            Some((_, g)) => g.push(members),
            None => by_series.push((sid, vec![members])),
        }
    }

    let output = by_series
        .into_iter()
        .map(|(sid, dup_groups)| DuplicateGroup {
            series_name: series_list
                .iter()
                .find(|s| s.id == sid)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| sid.clone()),
            series: sid,
            groups: dup_groups,
        })
        .collect();
    Ok(output)
}

// ─── 设置 API ───────────────────────────────────────────

/// GET /api/settings
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    let paths = state.paths()?;
    storage::load_settings(&paths)
}

/// PATCH /api/settings
#[tauri::command]
pub fn update_settings(state: State<AppState>, body: SettingsUpdate) -> Result<Settings, String> {
    let paths = state.paths()?;
    let mut settings = storage::load_settings(&paths)?;
    if let Some(name) = body.photographer_name {
        let name = name.trim();
        // 与 Python len() 一致：按字符数而非字节数
        if name.chars().count() > 30 {
            return Err("署名不能超过 30 个字符".to_string());
        }
        settings.photographer_name = name.to_string();
    }
    storage::save_settings(&paths, &settings)?;
    Ok(settings)
}

// ─── 系列管理 API ───────────────────────────────────────

/// GET /api/series
#[tauri::command]
pub fn list_series(state: State<AppState>) -> Result<Vec<Series>, String> {
    let paths = state.paths()?;
    storage::load_series(&paths)
}

/// POST /api/series
#[tauri::command]
pub fn create_series(state: State<AppState>, name: String) -> Result<Series, String> {
    let paths = state.paths()?;
    let mut series = storage::load_series(&paths)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("系列名称不能为空".to_string());
    }
    if series.iter().any(|s| s.name == name) {
        return Err("系列名称已存在".to_string());
    }
    let new_id = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    let entry = Series { id: new_id, name };
    series.push(entry.clone());
    storage::save_series(&paths, &series)?;
    Ok(entry)
}

/// PATCH /api/series/{series_id}
#[tauri::command]
pub fn rename_series(
    state: State<AppState>,
    series_id: String,
    name: String,
) -> Result<Series, String> {
    let paths = state.paths()?;
    let mut series = storage::load_series(&paths)?;
    if !series.iter().any(|s| s.id == series_id) {
        return Err("系列不存在".to_string());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("系列名称不能为空".to_string());
    }
    if series.iter().any(|s| s.name == name && s.id != series_id) {
        return Err("系列名称已存在".to_string());
    }
    let target = series.iter_mut().find(|s| s.id == series_id).unwrap();
    target.name = name;
    let updated = target.clone();
    storage::save_series(&paths, &series)?;
    Ok(updated)
}

/// DELETE /api/series/{series_id}
#[tauri::command]
pub fn delete_series(state: State<AppState>, series_id: String) -> Result<Value, String> {
    let paths = state.paths()?;
    let mut series = storage::load_series(&paths)?;
    if !series.iter().any(|s| s.id == series_id) {
        return Err("系列不存在".to_string());
    }
    // 其下照片归入 uncategorized
    let mut photos = storage::load_photos(&paths)?;
    let mut moved = 0;
    for p in photos.iter_mut() {
        if p.series == series_id {
            p.series = "uncategorized".to_string();
            moved += 1;
        }
    }
    storage::save_photos(&paths, &photos)?;
    series.retain(|s| s.id != series_id);
    storage::save_series(&paths, &series)?;
    Ok(json!({ "ok": true, "deleted": series_id, "photos_moved": moved }))
}
