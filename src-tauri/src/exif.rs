//! EXIF 解析：对齐 Python 版 parse_exif 的字段与格式化规则
//! 使用 kamadak-exif 读取元数据，image crate 读取像素尺寸

use exif::{In, Tag, Value};
use serde_json::{json, Map};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// 解析结果：字段名与 Python 版 result dict 一致
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExifData {
    pub camera: String,
    pub lens: String,
    pub focal_length: String,
    pub aperture: String,
    pub shutter_speed: String,
    pub iso: String,
    pub date_taken: String,
    pub width: u32,
    pub height: u32,
}

impl ExifData {
    /// 转为 JSON map（photos.json 中 exif 字段的存储形态）
    pub fn to_map(&self) -> Map<String, serde_json::Value> {
        let mut m = Map::new();
        m.insert("camera".into(), json!(self.camera));
        m.insert("lens".into(), json!(self.lens));
        m.insert("focal_length".into(), json!(self.focal_length));
        m.insert("aperture".into(), json!(self.aperture));
        m.insert("shutter_speed".into(), json!(self.shutter_speed));
        m.insert("iso".into(), json!(self.iso));
        m.insert("date_taken".into(), json!(self.date_taken));
        m.insert("width".into(), json!(self.width));
        m.insert("height".into(), json!(self.height));
        m
    }
}

/// 焦距：int 截断 + "mm" 后缀（Python: f"{int(focal)}mm"）
pub fn format_focal(focal: f64) -> String {
    format!("{}mm", focal as i64)
}

/// 光圈：一位小数（Python: f"f/{float(v):.1f}"）
pub fn format_aperture(fnumber: f64) -> String {
    format!("f/{fnumber:.1}")
}

/// 快门：<1s 用分数形式（int 截断），否则一位小数秒
pub fn format_shutter(seconds: f64) -> Option<String> {
    if seconds <= 0.0 {
        return None; // Python 侧 ZeroDivisionError 被吞
    }
    if seconds < 1.0 {
        Some(format!("1/{}s", (1.0 / seconds) as i64))
    } else {
        Some(format!("{seconds:.1}s"))
    }
}

/// 拍摄时间："YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DD HH:MM"；格式不符保留原串
pub fn format_datetime(raw: &str) -> String {
    let raw = raw.trim();
    let bytes = raw.as_bytes();
    // 固定 19 字符格式校验：数字位与分隔符位
    if bytes.len() == 19 {
        let seps_ok = bytes[4] == b':'
            && bytes[7] == b':'
            && bytes[10] == b' '
            && bytes[13] == b':'
            && bytes[16] == b':';
        let digits_ok = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
            .iter()
            .all(|&i| bytes[i].is_ascii_digit());
        // 与 Python strptime 一致：校验各字段取值范围
        if seps_ok && digits_ok {
            let month: u32 = raw[5..7].parse().unwrap_or(0);
            let day: u32 = raw[8..10].parse().unwrap_or(0);
            let hour: u32 = raw[11..13].parse().unwrap_or(99);
            let minute: u32 = raw[14..16].parse().unwrap_or(99);
            let second: u32 = raw[17..19].parse().unwrap_or(99);
            if (1..=12).contains(&month)
                && (1..=31).contains(&day)
                && hour <= 23
                && minute <= 59
                && second <= 59
            {
                return format!(
                    "{}-{}-{} {}:{}",
                    &raw[0..4],
                    &raw[5..7],
                    &raw[8..10],
                    &raw[11..13],
                    &raw[14..16]
                );
            }
        }
    }
    raw.to_string()
}

/// 取 ASCII 字段字符串（清理 \x00 填充并 trim，对齐 Python 处理）
fn ascii_field(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    if let Value::Ascii(ref vec) = field.value {
        let joined = vec
            .iter()
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .collect::<Vec<_>>()
            .join(" ");
        let cleaned = joined.replace('\u{0}', "").trim().to_string();
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    None
}

/// 取有理数字段的浮点值
fn rational_field(exif: &exif::Exif, tag: Tag) -> Option<f64> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    match field.value {
        Value::Rational(ref v) => v.first().map(|r| r.to_f64()),
        Value::SRational(ref v) => v.first().map(|r| r.to_f64()),
        _ => None,
    }
}

/// 从图片文件解析 EXIF；任何失败均返回已有部分结果（对齐 Python 吞异常）
pub fn parse_exif(file_path: &Path) -> ExifData {
    let mut result = ExifData::default();

    // 像素尺寸（Python: img.width/height）
    if let Ok((w, h)) = image::image_dimensions(file_path) {
        result.width = w;
        result.height = h;
    }

    let file = match File::open(file_path) {
        Ok(f) => f,
        Err(_) => return result,
    };
    let mut reader = BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(e) => e,
        Err(_) => return result,
    };

    // 相机品牌 + 型号
    let make = ascii_field(&exif, Tag::Make).unwrap_or_default();
    let model = ascii_field(&exif, Tag::Model).unwrap_or_default();
    if !make.is_empty() && !model.is_empty() {
        result.camera = format!("{make} {model}");
    } else if !model.is_empty() {
        result.camera = model;
    }

    // 镜头
    if let Some(lens) = ascii_field(&exif, Tag::LensModel) {
        result.lens = lens;
    }

    // 焦距
    if let Some(focal) = rational_field(&exif, Tag::FocalLength) {
        result.focal_length = format_focal(focal);
    }

    // 光圈
    if let Some(fnum) = rational_field(&exif, Tag::FNumber) {
        result.aperture = format_aperture(fnum);
    }

    // 快门
    if let Some(shutter) = rational_field(&exif, Tag::ExposureTime) {
        if let Some(s) = format_shutter(shutter) {
            result.shutter_speed = s;
        }
    }

    // ISO
    if let Some(field) = exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY) {
        if let Some(iso) = field.value.get_uint(0) {
            result.iso = format!("ISO {iso}");
        }
    }

    // 拍摄日期：DateTimeOriginal 优先，回退 DateTime
    let date_str = ascii_field(&exif, Tag::DateTimeOriginal)
        .or_else(|| ascii_field(&exif, Tag::DateTime))
        .unwrap_or_default();
    if !date_str.is_empty() {
        result.date_taken = format_datetime(&date_str);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focal_truncates_like_python_int() {
        assert_eq!(format_focal(12.0), "12mm");
        assert_eq!(format_focal(59.9), "59mm"); // int() 截断而非四舍五入
    }

    #[test]
    fn aperture_one_decimal() {
        assert_eq!(format_aperture(5.0), "f/5.0");
        assert_eq!(format_aperture(3.5), "f/3.5");
        assert_eq!(format_aperture(1.79), "f/1.8");
    }

    #[test]
    fn shutter_fraction_below_one_second() {
        assert_eq!(format_shutter(0.0025).unwrap(), "1/400s");
        assert_eq!(format_shutter(1.0 / 60.0).unwrap(), "1/60s");
        assert_eq!(format_shutter(2.5).unwrap(), "2.5s");
        assert_eq!(format_shutter(1.0).unwrap(), "1.0s");
        assert!(format_shutter(0.0).is_none()); // 对齐 Python 吞 ZeroDivisionError
    }

    #[test]
    fn datetime_reformat_and_fallback() {
        assert_eq!(format_datetime("2026:07:18 11:14:32"), "2026-07-18 11:14");
        // 非法格式保留原串（对齐 strptime ValueError 分支）
        assert_eq!(format_datetime("2026-07-18"), "2026-07-18");
        assert_eq!(format_datetime("2026:13:18 11:14:32"), "2026:13:18 11:14:32");
        assert_eq!(format_datetime(""), "");
    }

    #[test]
    fn exif_map_field_names_match_python() {
        let m = ExifData::default().to_map();
        let keys: Vec<&str> = m.keys().map(|k| k.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "camera", "lens", "focal_length", "aperture", "shutter_speed",
                "iso", "date_taken", "width", "height"
            ]
        );
    }
}
