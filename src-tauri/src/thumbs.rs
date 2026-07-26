//! 缩略图生成：对齐 Python 版 generate_thumbnail
//! 800px 长边、等比缩小不放大、转 RGB、JPEG quality=82

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

/// PIL thumbnail((800,800)) 的等价目标尺寸：等比缩小、原图更小时不放大
pub fn thumbnail_size(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    if width <= max_side && height <= max_side {
        return (width, height);
    }
    let scale = f64::from(max_side) / f64::from(width.max(height));
    // 按 PIL 的 round 行为取整，且至少为 1
    let w = ((f64::from(width) * scale).round() as u32).max(1);
    let h = ((f64::from(height) * scale).round() as u32).max(1);
    (w, h)
}

/// 生成缩略图，返回缩略图文件名；失败返回空串（对齐 Python 吞异常）
pub fn generate_thumbnail(file_path: &Path, thumbs_dir: &Path, photo_id: &str) -> String {
    let thumb_name = format!("{photo_id}_thumb.jpg");
    let thumb_path = thumbs_dir.join(&thumb_name);

    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let img = image::open(file_path)?;
        let (tw, th) = thumbnail_size(img.width(), img.height(), 800);
        let resized = if (tw, th) == (img.width(), img.height()) {
            img
        } else {
            // Triangle 滤镜：缩略图尺寸下与 Lanczos3 视觉无差，速度快数倍（对齐 Pillow thumbnail 的速度取向）
            img.resize_exact(tw, th, FilterType::Triangle)
        };
        // 转 RGB（丢弃 alpha / 调色板）
        let rgb = resized.to_rgb8();
        let file = File::create(&thumb_path)?;
        let mut encoder = JpegEncoder::new_with_quality(BufWriter::new(file), 82);
        encoder.encode_image(&rgb)?;
        Ok(())
    })();

    match result {
        Ok(_) => thumb_name,
        Err(_) => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_upscale_for_small_images() {
        assert_eq!(thumbnail_size(640, 480, 800), (640, 480));
        assert_eq!(thumbnail_size(800, 800, 800), (800, 800));
    }

    #[test]
    fn landscape_and_portrait_scaling() {
        // 5184x3888 → 长边 800
        assert_eq!(thumbnail_size(5184, 3888, 800), (800, 600));
        assert_eq!(thumbnail_size(3888, 5184, 800), (600, 800));
    }

    #[test]
    fn extreme_aspect_ratio_keeps_min_one() {
        assert_eq!(thumbnail_size(10000, 2, 800), (800, 1));
    }
}
