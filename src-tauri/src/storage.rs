//! JSON 持久化：对齐 Python 版 json.dump(ensure_ascii=False, indent=2) 行为
//! serde_json to_string_pretty 默认即 2 空格缩进、非 ASCII 不转义

use crate::config::LibraryPaths;
use crate::models::{Photo, Series, Settings};
use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::Path;

/// 读 JSON 列表文件；文件不存在返回空列表（对齐 load_photos/load_series）
fn load_list<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 {} 失败: {e}", path.display()))
}

/// 写 JSON 文件（2 空格缩进 + UTF-8 原文）
fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("写入 {} 失败: {e}", path.display()))
}

pub fn load_photos(paths: &LibraryPaths) -> Result<Vec<Photo>, String> {
    load_list(&paths.photos_json())
}

pub fn save_photos(paths: &LibraryPaths, photos: &[Photo]) -> Result<(), String> {
    save_json(&paths.photos_json(), &photos)
}

pub fn load_series(paths: &LibraryPaths) -> Result<Vec<Series>, String> {
    load_list(&paths.series_json())
}

pub fn save_series(paths: &LibraryPaths, series: &[Series]) -> Result<(), String> {
    save_json(&paths.series_json(), &series)
}

/// 读设置；缺失文件/字段回填默认值（对齐 load_settings）
pub fn load_settings(paths: &LibraryPaths) -> Result<Settings, String> {
    let file = paths.settings_json();
    if !file.exists() {
        return Ok(Settings::default());
    }
    let text = fs::read_to_string(&file).map_err(|e| format!("读取 {} 失败: {e}", file.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 {} 失败: {e}", file.display()))
}

pub fn save_settings(paths: &LibraryPaths, settings: &Settings) -> Result<(), String> {
    save_json(&paths.settings_json(), settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_library() -> LibraryPaths {
        let root = std::env::temp_dir().join(format!("pg_test_{}", uuid::Uuid::new_v4().simple()));
        let paths = LibraryPaths::new(&root);
        paths.ensure_dirs().unwrap();
        paths
    }

    #[test]
    fn photos_roundtrip_with_chinese_and_format() {
        let paths = temp_library();
        let json_text = r#"[{
  "id": "abc123",
  "filename": "abc123.jpg",
  "original_name": "山川-01.jpg",
  "title": "山路十八弯",
  "location": "观景台",
  "series": "shanchuan",
  "featured": true,
  "date_taken": "2026-07-18 11:14",
  "exif": {"camera": "Panasonic DC-G100D", "width": 5184, "height": 3888},
  "thumb": "abc123_thumb.jpg"
}]"#;
        fs::write(paths.photos_json(), json_text).unwrap();

        let photos = load_photos(&paths).unwrap();
        assert_eq!(photos.len(), 1);
        assert_eq!(photos[0].title, "山路十八弯");
        assert!(photos[0].featured);
        assert_eq!(photos[0].exif.get("width").unwrap(), 5184);

        save_photos(&paths, &photos).unwrap();
        let text = fs::read_to_string(paths.photos_json()).unwrap();
        // 对齐 Python json.dump(ensure_ascii=False, indent=2)
        assert!(text.contains("山路十八弯"), "中文必须不转义");
        assert!(text.contains("\n  {"), "必须 2 空格缩进");

        fs::remove_dir_all(&paths.root).ok();
    }

    #[test]
    fn missing_files_return_defaults() {
        let paths = temp_library();
        assert!(load_photos(&paths).unwrap().is_empty());
        assert!(load_series(&paths).unwrap().is_empty());
        assert_eq!(load_settings(&paths).unwrap().photographer_name, "");
        fs::remove_dir_all(&paths.root).ok();
    }

    #[test]
    fn settings_backfills_missing_fields() {
        let paths = temp_library();
        fs::write(paths.settings_json(), "{}").unwrap();
        assert_eq!(load_settings(&paths).unwrap().photographer_name, "");

        let s = Settings { photographer_name: "Shengkun".into() };
        save_settings(&paths, &s).unwrap();
        assert_eq!(load_settings(&paths).unwrap().photographer_name, "Shengkun");
        fs::remove_dir_all(&paths.root).ok();
    }
}
