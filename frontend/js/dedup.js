/* ═══════════════════════════════════════════
   dedup.js — 照片去重页逻辑
   后端调用统一走 api.js 防腐层，图片地址走 assets.js。
   ═══════════════════════════════════════════ */

import { findDuplicates, deletePhoto } from './api.js';
import { thumbSrc, initAssets } from './assets.js';

const content = document.getElementById('content');

/* 自定义确认弹窗 */
function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    overlay.querySelector('.confirm-msg').textContent = msg;
    overlay.classList.add('show');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function cleanup(result) {
      overlay.classList.remove('show');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

async function init() {
  await initAssets();
  let data;
  try {
    data = await findDuplicates();
  } catch (e) {
    content.innerHTML = '<div class="empty-state"><p>加载失败，请刷新重试</p></div>';
    return;
  }

  if (!data || data.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">✓</div>
        <p>没有发现重复照片</p>
      </div>`;
    return;
  }

  const totalGroups = data.reduce((s, d) => s + d.groups.length, 0);
  const totalDupes = data.reduce((s, d) => s + d.groups.reduce((g, grp) => g + grp.length - 1, 0), 0);

  let html = `<p class="summary">发现 ${totalGroups} 组重复，共 ${totalDupes} 张可清理。点击选择每组中要保留的照片。</p>`;

  data.forEach(section => {
    html += `<div class="series-section"><h2>${section.series_name}</h2>`;
    section.groups.forEach((group, gi) => {
      const exif = group[0].exif || {};
      const exifStr = [exif.camera, exif.focal_length, exif.aperture, exif.shutter_speed, exif.iso].filter(Boolean).join('  ·  ');
      const dims = exif.width && exif.height ? `${exif.width}×${exif.height}` : '';
      const groupId = `${section.series}-${gi}`;

      html += `<div class="dup-group" id="group-${groupId}">`;
      html += `<div class="dup-group-header">
        <span class="dup-label">${group.length} 张重复</span>
        <span class="dup-exif">${exifStr}${dims ? '  ·  ' + dims : ''}</span>
      </div>`;
      html += `<div class="dup-items">`;
      group.forEach(photo => {
        const src = thumbSrc(photo);
        html += `<div class="dup-item" data-id="${photo.id}" data-group="${groupId}" onclick="selectItem(this)">
          <img src="${src}" alt="${photo.title}" loading="lazy">
          <div class="item-info">
            <div class="item-title">${photo.title || photo.original_name}</div>
            <div class="item-meta">${photo.date_taken || ''}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
      html += `<div class="dup-actions">
        <button class="btn-delete-others" data-group="${groupId}" disabled onclick="deleteOthers('${groupId}')">删除其余</button>
        <span class="dup-hint">先点选要保留的一张</span>
      </div>`;
      html += `</div>`;
    });
    html += `</div>`;
  });

  content.innerHTML = html;
}

function selectItem(el) {
  const groupId = el.dataset.group;
  const wasSelected = el.classList.contains('selected');
  document.querySelectorAll(`.dup-item[data-group="${groupId}"]`).forEach(item => {
    item.classList.remove('selected');
  });
  if (!wasSelected) {
    el.classList.add('selected');
    const btn = document.querySelector(`.btn-delete-others[data-group="${groupId}"]`);
    if (btn) btn.disabled = false;
  } else {
    const btn = document.querySelector(`.btn-delete-others[data-group="${groupId}"]`);
    if (btn) btn.disabled = true;
  }
  updateBatchBar();
}

function updateBatchBar() {
  const bar = document.getElementById('batch-bar');
  const selected = document.querySelectorAll('.dup-group:not(.resolved) .dup-item.selected');
  const count = new Set(Array.from(selected).map(el => el.dataset.group)).size;
  if (count > 0) {
    bar.classList.add('visible');
    bar.querySelector('.batch-info').textContent = `已选择 ${count} 组`;
    bar.querySelector('.btn-batch').disabled = false;
  } else {
    bar.classList.remove('visible');
    bar.querySelector('.btn-batch').disabled = true;
  }
}

async function batchDelete() {
  const groups = document.querySelectorAll('.dup-group:not(.resolved)');
  const toDelete = [];
  groups.forEach(g => {
    const sel = g.querySelector('.dup-item.selected');
    if (!sel) return;
    g.querySelectorAll('.dup-item:not(.selected)').forEach(item => {
      toDelete.push({ id: item.dataset.id, group: g });
    });
  });
  if (toDelete.length === 0) return;
  if (!await showConfirm(`确认删除 ${toDelete.length} 张重复照片？此操作不可撤销。`)) return;

  let failed = 0;
  for (const { id } of toDelete) {
    try {
      await deletePhoto(id);
    } catch (e) { failed++; }
  }

  if (failed > 0) {
    alert(`${failed} 张删除失败`);
  } else {
    showToast(`已清理 ${toDelete.length} 张重复照片`);
  }
  updateBatchBar();
  init();
}

async function deleteOthers(groupId) {
  const groupEl = document.getElementById('group-' + groupId);
  const selected = groupEl.querySelector('.dup-item.selected');
  if (!selected) return;

  const others = groupEl.querySelectorAll('.dup-item:not(.selected)');
  const ids = Array.from(others).map(el => el.dataset.id);

  if (!await showConfirm(`确认删除 ${ids.length} 张重复照片？此操作不可撤销。`)) return;

  let failed = 0;
  for (const id of ids) {
    try {
      await deletePhoto(id);
    } catch (e) { failed++; }
  }

  if (failed > 0) {
    alert(`${failed} 张删除失败，请重试`);
  } else {
    showToast(`已清理 ${ids.length} 张重复照片`);
    init();
  }
}

/* 内联 onclick 依赖全局函数：ES 模块作用域下需显式挂到 window */
window.selectItem = selectItem;
window.deleteOthers = deleteOthers;
window.batchDelete = batchDelete;

init();
