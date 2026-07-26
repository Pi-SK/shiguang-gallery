//! 库目录配置：用户自选照片库目录，沿用 assets/ + assets/thumbs/ + data/ 布局
//! 目录选择持久化在应用配置目录的 config.json 中

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 应用级配置（持久化于 app_config_dir/config.json）
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AppConfig {
    /// 照片库根目录；None 表示尚未选择（首启引导）
    pub library_dir: Option<String>,
}

/// 全局状态：当前库目录（Tauri managed state）
pub struct AppState {
    pub library_dir: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new(dir: Option<PathBuf>) -> Self {
        AppState {
            library_dir: Mutex::new(dir),
        }
    }

    /// 取当前库路径集；未设置时报错（前端首启引导会先调 set_library_dir）
    pub fn paths(&self) -> Result<LibraryPaths, String> {
        let guard = self.library_dir.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(root) => Ok(LibraryPaths::new(root)),
            None => Err("库目录未设置".to_string()),
        }
    }
}

/// 库目录内的固定布局（与 Python 版 BASE_DIR 布局一致）
#[derive(Debug, Clone)]
pub struct LibraryPaths {
    pub root: PathBuf,
    pub assets: PathBuf,
    pub thumbs: PathBuf,
    pub data: PathBuf,
}

impl LibraryPaths {
    pub fn new(root: &Path) -> Self {
        LibraryPaths {
            root: root.to_path_buf(),
            assets: root.join("assets"),
            thumbs: root.join("assets").join("thumbs"),
            data: root.join("data"),
        }
    }

    pub fn photos_json(&self) -> PathBuf {
        self.data.join("photos.json")
    }

    pub fn series_json(&self) -> PathBuf {
        self.data.join("series.json")
    }

    pub fn settings_json(&self) -> PathBuf {
        self.data.join("settings.json")
    }

    /// 确保 assets/thumbs/data 子目录存在
    pub fn ensure_dirs(&self) -> Result<(), String> {
        for dir in [&self.assets, &self.thumbs, &self.data] {
            fs::create_dir_all(dir).map_err(|e| format!("创建目录失败 {}: {e}", dir.display()))?;
        }
        Ok(())
    }

    /// 库目录是否为空库（没有任何照片记录）——供首启"一键初始化示例库"判断
    pub fn is_empty_library(&self) -> bool {
        !self.photos_json().exists()
    }
}

/// 读应用配置；文件缺失或损坏时返回默认值
pub fn load_app_config(config_dir: &Path) -> AppConfig {
    let file = config_dir.join("config.json");
    if let Ok(text) = fs::read_to_string(&file) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&text) {
            return cfg;
        }
    }
    AppConfig::default()
}

/// 写应用配置
pub fn save_app_config(config_dir: &Path, cfg: &AppConfig) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_dir.join("config.json"), text).map_err(|e| e.to_string())
}
