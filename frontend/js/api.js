/* ═══════════════════════════════════════════
   api.js — 后端调用防腐层（双模式）
   Tauri 环境：走 invoke() 调 Rust 命令；
   浏览器环境：走 FastAPI HTTP 接口（开发回归用）。
   页面代码零改动。
   ═══════════════════════════════════════════ */

const TAURI = typeof window !== 'undefined' && window.__TAURI__ ? window.__TAURI__ : null;

/** 是否运行在 Tauri 桌面环境 */
export const isTauri = !!TAURI;

/** invoke 封装：Rust 命令 Err(String) 统一转成 Error，与 HTTP detail 行为一致 */
async function invoke(cmd, args) {
  try {
    return await TAURI.core.invoke(cmd, args);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : (e && e.message) || String(e));
  }
}

/**
 * 统一 HTTP 请求封装：非 2xx 时抛出带后端 detail 的 Error；
 * 响应体按 JSON 解析（无法解析时返回 null，如空响应）。
 */
async function request(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    try {
      const body = await res.json();
      if (body && body.detail) detail = body.detail;
    } catch (_) {}
    throw new Error(detail);
  }
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

/** JSON 体请求的简写 */
function jsonBody(method, data) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

/* ─── 库目录（仅 Tauri） ─── */

/** 库目录状态：{configured, path, empty}；浏览器模式视为已配置 */
export async function libraryStatus() {
  if (!TAURI) return { configured: true, path: null, empty: false };
  return invoke('library_status');
}

/** 设置库目录（首启引导 / 更换库目录） */
export async function setLibraryDir(path) {
  return invoke('set_library_dir', { path });
}

/** 空库一键初始化示例库 */
export async function initSampleLibrary() {
  return invoke('init_sample_library');
}

/* ─── 照片 ─── */

/**
 * 查询照片列表。
 * @param {{series?: string, featured?: boolean, sort?: string}} [params]
 */
export async function listPhotos(params = {}) {
  if (TAURI) {
    return invoke('list_photos', {
      series: params.series || null,
      featured: params.featured ? true : null,
      sort: params.sort || null,
    });
  }
  const q = new URLSearchParams();
  if (params.series) q.set('series', params.series);
  if (params.featured) q.set('featured', 'true');
  if (params.sort) q.set('sort', params.sort);
  const qs = q.toString();
  return request(`/api/photos${qs ? `?${qs}` : ''}`);
}

/**
 * 上传照片，返回解析后的照片元数据数组。
 * Tauri 环境：入参为本地文件路径数组（dialog / 拖放提供）；
 * 浏览器环境：入参为 File[]。
 * @param {string[]|File[]} filesOrPaths
 */
export async function uploadPhotos(filesOrPaths) {
  if (TAURI) {
    return invoke('upload_photos', { pathsIn: filesOrPaths });
  }
  const formData = new FormData();
  filesOrPaths.forEach((f) => formData.append('files', f));
  return request('/api/photos/upload', { method: 'POST', body: formData });
}

/**
 * 更新照片元数据（部分字段）。
 * @param {string} id
 * @param {object} patch 例如 { title, featured, series, date_taken, exif: {...} }
 */
export async function updatePhoto(id, patch) {
  if (TAURI) return invoke('update_photo', { photoId: id, body: patch });
  return request(`/api/photos/${id}`, jsonBody('PATCH', patch));
}

/** 删除照片（文件 + 缩略图 + 元数据），失败时抛错 */
export async function deletePhoto(id) {
  if (TAURI) return invoke('delete_photo', { photoId: id });
  return request(`/api/photos/${id}`, { method: 'DELETE' });
}

/**
 * 重排精选照片顺序（仅影响 featured 照片展示顺序）。
 * @param {string[]} ids 新顺序的照片 id 列表
 */
export async function reorderPhotos(ids) {
  if (TAURI) return invoke('reorder_photos', { ids });
  return request('/api/photos/order', jsonBody('PUT', { ids }));
}

/** 为缺少缩略图的已有照片补生成 */
export async function regenThumbs() {
  if (TAURI) return invoke('regenerate_thumbs');
  return request('/api/photos/regenerate-thumbs', { method: 'POST' });
}

/* ─── 系列 ─── */

/** 获取所有系列（不含 uncategorized） */
export async function listSeries() {
  if (TAURI) return invoke('list_series');
  return request('/api/series');
}

/** 新增系列 */
export async function createSeries(name) {
  if (TAURI) return invoke('create_series', { name });
  return request('/api/series', jsonBody('POST', { name }));
}

/** 重命名系列（不影响照片归属） */
export async function renameSeries(id, name) {
  if (TAURI) return invoke('rename_series', { seriesId: id, name });
  return request(`/api/series/${id}`, jsonBody('PATCH', { name }));
}

/** 删除系列，其下照片归入 uncategorized */
export async function deleteSeries(id) {
  if (TAURI) return invoke('delete_series', { seriesId: id });
  return request(`/api/series/${id}`, { method: 'DELETE' });
}

/* ─── 设置 ─── */

/** 获取应用设置（摄影师署名等） */
export async function getSettings() {
  if (TAURI) return invoke('get_settings');
  return request('/api/settings');
}

/**
 * 更新应用设置（部分字段）。
 * @param {{photographer_name?: string}} patch
 */
export async function updateSettings(patch) {
  if (TAURI) return invoke('update_settings', { body: patch });
  return request('/api/settings', jsonBody('PATCH', patch));
}

/* ─── 去重 ─── */

/** 检测重复照片，返回按系列分组的重复组 */
export async function findDuplicates() {
  if (TAURI) return invoke('find_duplicates');
  return request('/api/duplicates');
}
