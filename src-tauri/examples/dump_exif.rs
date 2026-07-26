//! 对齐验证工具：对指定图片跑 parse_exif，输出 JSON（与 photos.json 中 exif 对比）
//! 用法：cargo run --example dump_exif -- <图片路径>...

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut out = serde_json::Map::new();
    for path in &args {
        let exif = photo_gallery_lib::exif::parse_exif(std::path::Path::new(path));
        let name = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.insert(name, serde_json::Value::Object(exif.to_map()));
    }
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
