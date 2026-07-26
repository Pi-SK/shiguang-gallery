//! 数据模型：与 Python 版 photos.json / series.json / settings.json 字段完全对齐
//! 现有数据零转换接管，因此所有可缺省字段都带 serde default

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// 照片记录（对应 photos.json 中的一项）
/// 字段声明顺序与现有 photos.json 的键序一致，保证保存后 diff 最小
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Photo {
    pub id: String,
    pub filename: String,
    #[serde(default)]
    pub original_name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub series: String,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub date_taken: String,
    /// EXIF 采用宽松 map 建模：Python 侧是 dict 合并更新，保持同等行为
    #[serde(default)]
    pub exif: Map<String, Value>,
    #[serde(default)]
    pub thumb: String,
}

/// 系列记录（对应 series.json 中的一项）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Series {
    pub id: String,
    pub name: String,
}

/// 应用设置（对应 settings.json）；缺失字段回填默认值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub photographer_name: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            photographer_name: String::new(),
        }
    }
}

/// PATCH /api/photos/{id} 请求体：None 字段跳过不更新
#[derive(Debug, Deserialize)]
pub struct PhotoUpdate {
    pub title: Option<String>,
    pub location: Option<String>,
    pub series: Option<String>,
    pub featured: Option<bool>,
    pub date_taken: Option<String>,
    /// 合并更新（不整体替换）
    pub exif: Option<Map<String, Value>>,
}

/// PATCH /api/settings 请求体
#[derive(Debug, Deserialize)]
pub struct SettingsUpdate {
    pub photographer_name: Option<String>,
}

/// 去重结果：按系列分组的重复组
#[derive(Debug, Serialize)]
pub struct DuplicateGroup {
    pub series: String,
    pub series_name: String,
    pub groups: Vec<Vec<Photo>>,
}
