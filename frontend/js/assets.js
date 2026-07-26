/* ═══════════════════════════════════════════
   assets.js — 图片资源 URL 防腐层（双模式）
   Tauri 环境：convertFileSrc(库根绝对路径) 走 asset protocol；
   浏览器环境：拼接 FastAPI 静态挂载路径 /assets（开发回归用）。
   页面启动时需先 await initAssets() 完成库根路径缓存。
   ═══════════════════════════════════════════ */

const TAURI = typeof window !== 'undefined' && window.__TAURI__ ? window.__TAURI__ : null;

/** 库根目录绝对路径（Tauri 下由 initAssets 填充） */
let libRoot = null;

/**
 * 初始化资源层：Tauri 下查询库目录并缓存。
 * 页面 init 入口处 await 一次；更换库目录后可再次调用刷新。
 */
export async function initAssets() {
  if (!TAURI) return;
  try {
    const st = await TAURI.core.invoke('library_status');
    libRoot = st && st.configured ? st.path : null;
  } catch (_) {
    libRoot = null;
  }
}

/** 任意本地绝对路径 → 可渲染 URL（上传预览等场景） */
export function localSrc(absPath) {
  return TAURI ? TAURI.core.convertFileSrc(absPath) : absPath;
}

/** 照片原图 URL */
export function photoSrc(photo) {
  if (TAURI && libRoot) {
    return TAURI.core.convertFileSrc(`${libRoot}/assets/${photo.filename}`);
  }
  return `/assets/${photo.filename}`;
}

/** 缩略图 URL（无缩略图时回退原图） */
export function thumbSrc(photo) {
  if (!photo.thumb) return photoSrc(photo);
  if (TAURI && libRoot) {
    return TAURI.core.convertFileSrc(`${libRoot}/assets/thumbs/${photo.thumb}`);
  }
  return `/assets/thumbs/${photo.thumb}`;
}
