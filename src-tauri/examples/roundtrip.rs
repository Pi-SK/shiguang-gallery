//! 零转换接管验证：读入现有 photos.json 再原样序列化输出，供与原文件 diff
//! 用法：cargo run --example roundtrip -- <photos.json 路径>

fn main() {
    let path = std::env::args().nth(1).expect("需要 photos.json 路径");
    let text = std::fs::read_to_string(&path).expect("读取失败");
    let generic: serde_json::Value = serde_json::from_str(&text).expect("解析失败");
    // 经过 Photo 强类型模型走一遍往返
    let typed: Vec<photo_gallery_lib::models::Photo> =
        serde_json::from_str(&text).expect("Photo 模型解析失败");
    let reserialized = serde_json::to_string_pretty(&typed).unwrap();
    // 数据等价断言（serde_json 的 == 与键序无关）：模型未丢失任何字段/值
    let reparsed: serde_json::Value = serde_json::from_str(&reserialized).unwrap();
    assert_eq!(reparsed, generic, "Photo 模型往返后数据不等价");
    println!("{reserialized}");
}
