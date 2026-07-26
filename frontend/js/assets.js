/* ═══════════════════════════════════════════
   assets.js — 图片资源 URL 防腐层
   阶段 1：拼接 FastAPI 静态挂载路径 /assets；
   阶段 3：切换为 Tauri convertFileSrc()，页面代码零改动。
   ═══════════════════════════════════════════ */

/** 照片原图 URL */
export function photoSrc(photo) {
  return `/assets/${photo.filename}`;
}

/** 缩略图 URL（无缩略图时回退原图） */
export function thumbSrc(photo) {
  return photo.thumb ? `/assets/thumbs/${photo.thumb}` : `/assets/${photo.filename}`;
}
