//! 拾光画廊 Tauri 应用装配：读取库目录配置、注册状态与命令

mod commands;
mod config;
pub mod exif;
pub mod models;
mod storage;
pub mod thumbs;

use config::{load_app_config, AppState};
use std::path::PathBuf;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 启动时读取已保存的库目录；无效路径视为未配置（前端走首启引导）
            let config_dir = app.path().app_config_dir()?;
            let cfg = load_app_config(&config_dir);
            let library_dir: Option<PathBuf> = cfg
                .library_dir
                .map(PathBuf::from)
                .filter(|p| p.is_dir());

            // 已配置的库目录放行 asset protocol，前端才能显示图片
            if let Some(ref dir) = library_dir {
                app.asset_protocol_scope().allow_directory(dir, true)?;
            }

            app.manage(AppState::new(library_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_status,
            commands::set_library_dir,
            commands::init_sample_library,
            commands::list_photos,
            commands::upload_photos,
            commands::update_photo,
            commands::delete_photo,
            commands::reorder_photos,
            commands::regenerate_thumbs,
            commands::find_duplicates,
            commands::get_settings,
            commands::update_settings,
            commands::list_series,
            commands::create_series,
            commands::rename_series,
            commands::delete_series,
        ])
        .run(tauri::generate_context!())
        .expect("拾光画廊启动失败");
}
