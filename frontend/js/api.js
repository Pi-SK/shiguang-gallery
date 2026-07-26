/* ═══════════════════════════════════════════
   api.js — 后端调用防腐层
   阶段 1：全部走 FastAPI HTTP 接口；
   阶段 3：本文件整体切换为 Tauri invoke()，页面代码零改动。
   ═══════════════════════════════════════════ */

/**
 * 统一请求封装：非 2xx 时抛出带后端 detail 的 Error；
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

/* ─── 照片 ─── */

/**
 * 查询照片列表。
 * @param {{series?: string, featured?: boolean, sort?: string}} [params]
 */
export async function listPhotos(params = {}) {
  const q = new URLSearchParams();
  if (params.series) q.set('series', params.series);
  if (params.featured) q.set('featured', 'true');
  if (params.sort) q.set('sort', params.sort);
  const qs = q.toString();
  return request(`/api/photos${qs ? `?${qs}` : ''}`);
}

/**
 * 上传照片（多文件），返回解析后的照片元数据数组。
 * @param {File[]} files
 */
export async function uploadPhotos(files) {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  return request('/api/photos/upload', { method: 'POST', body: formData });
}

/**
 * 更新照片元数据（部分字段）。
 * @param {string} id
 * @param {object} patch 例如 { title, featured, series, date_taken, exif: {...} }
 */
export async function updatePhoto(id, patch) {
  return request(`/api/photos/${id}`, jsonBody('PATCH', patch));
}

/** 删除照片（文件 + 缩略图 + 元数据），失败时抛错 */
export async function deletePhoto(id) {
  return request(`/api/photos/${id}`, { method: 'DELETE' });
}

/**
 * 重排精选照片顺序（仅影响 featured 照片展示顺序）。
 * @param {string[]} ids 新顺序的照片 id 列表
 */
export async function reorderPhotos(ids) {
  return request('/api/photos/order', jsonBody('PUT', { ids }));
}

/** 为缺少缩略图的已有照片补生成 */
export async function regenThumbs() {
  return request('/api/photos/regenerate-thumbs', { method: 'POST' });
}

/* ─── 系列 ─── */

/** 获取所有系列（不含 uncategorized） */
export async function listSeries() {
  return request('/api/series');
}

/** 新增系列 */
export async function createSeries(name) {
  return request('/api/series', jsonBody('POST', { name }));
}

/** 重命名系列（不影响照片归属） */
export async function renameSeries(id, name) {
  return request(`/api/series/${id}`, jsonBody('PATCH', { name }));
}

/** 删除系列，其下照片归入 uncategorized */
export async function deleteSeries(id) {
  return request(`/api/series/${id}`, { method: 'DELETE' });
}

/* ─── 去重 ─── */

/** 检测重复照片，返回按系列分组的重复组 */
export async function findDuplicates() {
  return request('/api/duplicates');
}
