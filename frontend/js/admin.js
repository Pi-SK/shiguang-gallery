/* ═══════════════════════════════════════════
   admin.js — 作品管理页逻辑
   后端调用统一走 api.js 防腐层，图片地址走 assets.js。
   ═══════════════════════════════════════════ */

import {
  listPhotos, uploadPhotos, updatePhoto, deletePhoto, reorderPhotos,
  listSeries, createSeries, renameSeries, deleteSeries,
  setLibraryDir, isTauri,
} from './api.js';
import { thumbSrc, initAssets } from './assets.js';

/* ═══════════════════════════════════════════
   状态
   ═══════════════════════════════════════════ */
let pendingUploads = [];  // 上传预览中的照片
let allPhotos = [];       // 已入库的全部照片
let currentManageSeries = 'shanchuan';

let SERIES = [];  // 从 API 动态加载

/* DOM */
const fabUpload = document.getElementById('btn-upload-fab');
const uploadOverlay = document.getElementById('upload-overlay');
const uploadPanel = document.getElementById('upload-panel');
const dropZone = document.getElementById('drop-zone');
const previewGrid = document.getElementById('preview-grid');
const confirmBar = document.getElementById('confirm-bar');
const featuredList = document.getElementById('featured-list');
const allList = document.getElementById('all-list');
const manageEmpty = document.getElementById('manage-empty');

/* ═══════════════════════════════════════════
   上传弹窗开关
   ═══════════════════════════════════════════ */
function openUploadModal() { uploadOverlay.classList.add('show'); }
function closeUploadModal() { uploadOverlay.classList.remove('show'); }

fabUpload.addEventListener('click', openUploadModal);

/* 点击遮罩关闭（排除从 panel 内部拖出的 mouseup） */
let panelMouseDown = false;
uploadPanel.addEventListener('mousedown', () => { panelMouseDown = true; });
uploadOverlay.addEventListener('click', (e) => {
  if (e.target === uploadOverlay && !panelMouseDown) closeUploadModal();
  panelMouseDown = false;
});

/* ═══════════════════════════════════════════
   拖拽 / 点击上传
   Tauri：HTML5 drop 拿不到本地路径，改用窗口级
   onDragDropEvent + dialog 多选，路径直传 Rust。
   ═══════════════════════════════════════════ */
const IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff'];
const IMG_RE = new RegExp(`\\.(${IMG_EXTS.join('|')})$`, 'i');

if (isTauri) {
  const webview = window.__TAURI__.webview.getCurrentWebview();
  webview.onDragDropEvent((event) => {
    // 仅上传弹窗打开时响应拖放
    if (!uploadOverlay.classList.contains('show')) return;
    const t = event.payload.type;
    if (t === 'enter' || t === 'over') {
      dropZone.classList.add('dragover');
    } else if (t === 'leave') {
      dropZone.classList.remove('dragover');
    } else if (t === 'drop') {
      dropZone.classList.remove('dragover');
      const paths = (event.payload.paths || []).filter(p => IMG_RE.test(p));
      if (paths.length) doUpload(paths);
    }
  });
} else {
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => IMG_RE.test(f.name));
    if (files.length) doUpload(files);
  });
}

dropZone.addEventListener('click', async () => {
  if (isTauri) {
    let paths = null;
    try {
      paths = await window.__TAURI__.dialog.open({
        multiple: true,
        title: '选择照片',
        filters: [{ name: '图片', extensions: IMG_EXTS }],
      });
    } catch (e) {}
    if (paths && paths.length) doUpload(paths);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = 'image/*';
  input.onchange = () => { if (input.files.length) doUpload(Array.from(input.files)); };
  input.click();
});

/* ═══════════════════════════════════════════
   上传流程
   ═══════════════════════════════════════════ */
async function doUpload(files) {
  const parsingOverlay = document.getElementById('parsing-overlay');
  const parsingText = parsingOverlay.querySelector('.parsing-text');
  parsingText.textContent = `正在解析 ${files.length} 张照片…`;
  parsingOverlay.classList.add('show');
  try {
    const results = await uploadPhotos(files);
    pendingUploads = pendingUploads.concat(results);
    showToast(`已解析 ${results.length} 张`);
    renderPreviews();
  } catch (e) {
    showToast('上传失败: ' + e.message);
  } finally {
    parsingOverlay.classList.remove('show');
  }
}

function renderPreviews() {
  confirmBar.style.display = pendingUploads.length ? 'flex' : 'none';
  document.getElementById('bar-info').textContent = pendingUploads.length ? `待上传 ${pendingUploads.length} 张` : '';

  const cards = pendingUploads.map((photo, i) => {
    const exif = photo.exif || {};
    const exifParts = [exif.camera, exif.lens, exif.focal_length, exif.aperture, exif.shutter_speed, exif.iso, exif.date_taken].filter(Boolean);

    const card = document.createElement('div');
    card.className = 'preview-card';
    card.innerHTML = `
      <div class="thumb-wrap">
        <img src="${thumbSrc(photo)}" alt="">
        <button class="preview-remove" data-idx="${i}" title="移除这张">&times;</button>
      </div>
      <div class="card-body">
        <div class="exif-line" title="${escapeHtml(exifParts.join(' | '))}">${escapeHtml(exifParts.join(' · ') || '无 EXIF 信息')}</div>
        <input type="text" value="${escapeHtml(photo.title)}" placeholder="标题" data-idx="${i}" data-field="title">
        <input type="text" value="${escapeHtml(photo.location || '')}" placeholder="拍摄地点" data-idx="${i}" data-field="location">
        <select data-idx="${i}" data-field="series">
          ${SERIES.map(s => `<option value="${s.id}" ${photo.series === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <div class="card-footer-row">
          <div class="featured-toggle ${photo.featured ? 'on' : ''}" data-idx="${i}">
            <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
            设为精选
          </div>
          <div class="exif-toggle" data-idx="${i}"><svg class="exif-toggle-arrow" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg><span class="exif-toggle-label">编辑 EXIF</span></div>
        </div>
        <div class="exif-edit" id="exif-edit-${i}">
          <div class="exif-grid">
            <div class="exif-field"><label>相机</label><input type="text" value="${escapeHtml(exif.camera || '')}" data-idx="${i}" data-exif="camera"></div>
            <div class="exif-field"><label>镜头</label><input type="text" value="${escapeHtml(exif.lens || '')}" data-idx="${i}" data-exif="lens"></div>
            <div class="exif-field"><label>焦距</label><input type="text" value="${escapeHtml(exif.focal_length || '')}" data-idx="${i}" data-exif="focal_length"></div>
            <div class="exif-field"><label>光圈</label><input type="text" value="${escapeHtml(exif.aperture || '')}" data-idx="${i}" data-exif="aperture"></div>
            <div class="exif-field"><label>快门</label><input type="text" value="${escapeHtml(exif.shutter_speed || '')}" data-idx="${i}" data-exif="shutter_speed"></div>
            <div class="exif-field"><label>ISO</label><input type="text" value="${escapeHtml(exif.iso || '')}" data-idx="${i}" data-exif="iso"></div>
            <div class="exif-field"><label>拍摄日期</label><input type="text" value="${escapeHtml(photo.date_taken || '')}" data-idx="${i}" data-exif="date_taken"></div>
          </div>
        </div>
      </div>
    `;
    return card;
  });

  // 双列独立堆叠分配（与管理列表同方案）
  fillColumns(previewGrid, cards);

  // 单张移除
  previewGrid.querySelectorAll('.preview-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const photo = pendingUploads[idx];
      try { await deletePhoto(photo.id); } catch (_) {}
      pendingUploads.splice(idx, 1);
      renderPreviews();
    });
  });

  // 绑定编辑
  previewGrid.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.idx);
      const field = el.dataset.field;
      pendingUploads[idx][field] = el.value;
    });
  });

  // 精选星标切换
  previewGrid.querySelectorAll('.featured-toggle').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      const newState = !pendingUploads[idx].featured;
      pendingUploads[idx].featured = newState;
      el.classList.toggle('on', newState);
    });
  });

  // EXIF 折叠切换
  previewGrid.querySelectorAll('.exif-toggle').forEach(el => {
    el.addEventListener('click', () => {
      const idx = el.dataset.idx;
      const panel = document.getElementById('exif-edit-' + idx);
      const isOpen = panel.classList.toggle('open');
      el.classList.toggle('open', isOpen);
      el.querySelector('.exif-toggle-label').textContent = isOpen ? '收起 EXIF' : '编辑 EXIF';
    });
  });

  // EXIF 字段编辑
  previewGrid.querySelectorAll('[data-exif]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.idx);
      const field = el.dataset.exif;
      if (field === 'date_taken') {
        pendingUploads[idx].date_taken = el.value;
      } else {
        if (!pendingUploads[idx].exif) pendingUploads[idx].exif = {};
        pendingUploads[idx].exif[field] = el.value;
      }
    });
  });
}

/* 确认上传：将编辑后的元数据写回 */
document.getElementById('btn-confirm').addEventListener('click', async () => {
  for (const photo of pendingUploads) {
    await updatePhoto(photo.id, {
      title: photo.title,
      location: photo.location,
      series: photo.series,
      featured: photo.featured,
      date_taken: photo.date_taken || '',
      exif: photo.exif || {},
    });
  }
  showToast(`已确认 ${pendingUploads.length} 张照片`);
  pendingUploads = [];
  previewGrid.innerHTML = '';
  confirmBar.style.display = 'none';
  closeUploadModal();
  loadManage();
});

/* 取消上传：删除已上传的文件 */
document.getElementById('btn-cancel-upload').addEventListener('click', async () => {
  for (const photo of pendingUploads) {
    await deletePhoto(photo.id);
  }
  pendingUploads = [];
  previewGrid.innerHTML = '';
  confirmBar.style.display = 'none';
  closeUploadModal();
  showToast('已取消');
});

/* ═══════════════════════════════════════════
   系列管理（动态 tab）
   ═══════════════════════════════════════════ */
const seriesTabsEl = document.getElementById('series-tabs');
const btnAddSeries = document.getElementById('btn-add-series');

function renderSeriesTabs() {
  // 移除旧 tab（保留 add 按钮）
  seriesTabsEl.querySelectorAll('[data-series]').forEach(el => el.remove());

  SERIES.forEach(s => {
    const btn = document.createElement('button');
    btn.dataset.series = s.id;
    btn.innerHTML = `${escapeHtml(s.name)}<span class="tab-del" title="删除主题">×</span>`;
    if (s.id === currentManageSeries) btn.classList.add('active');

    btn.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-del')) return;
      seriesTabsEl.querySelectorAll('[data-series]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentManageSeries = s.id;
      loadManage();
    });

    // 双击重命名
    btn.addEventListener('dblclick', () => startRename(s, btn));

    // 删除
    btn.querySelector('.tab-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showConfirm(`确定删除主题「${s.name}」？该主题下的照片将移入未归类。`);
      if (!ok) return;
      await deleteSeries(s.id);
      SERIES = SERIES.filter(x => x.id !== s.id);
      if (currentManageSeries === s.id) currentManageSeries = SERIES[0]?.id || '';
      renderSeriesTabs();
      loadManage();
      showToast('主题已删除');
    });

    seriesTabsEl.insertBefore(btn, btnAddSeries);
  });
}

function startRename(s, btn) {
  const input = document.createElement('input');
  input.className = 'tab-rename';
  input.value = s.name;
  btn.replaceWith(input);
  input.focus();
  input.select();

  async function commit() {
    const name = input.value.trim();
    if (name && name !== s.name) {
      await renameSeries(s.id, name);
      s.name = name;
      showToast('已重命名');
    }
    input.remove();
    renderSeriesTabs();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = s.name; input.blur(); }
  });
}

btnAddSeries.addEventListener('click', async () => {
  const name = await showPrompt('新主题名称：');
  if (!name || !name.trim()) return;
  try {
    const entry = await createSeries(name.trim());
    SERIES.push(entry);
    currentManageSeries = entry.id;
    renderSeriesTabs();
    loadManage();
    showToast(`已创建主题「${entry.name}」`);
  } catch (e) { showToast(e.message || '创建失败'); }
});

async function loadManage() {
  try {
    allPhotos = await listPhotos({ series: currentManageSeries });
  } catch (e) { allPhotos = []; }
  renderManage();
}

// 将卡片按「左、右」交替分配到独立列容器：
// 展开 EXIF 只推动本列下方卡片，另一列保持紧凑不留白
function fillColumns(container, rows) {
  container.innerHTML = '';
  if (!rows.length) return; // 保持 :empty 状态（如 .preview-grid:empty 的隐藏逻辑）
  const colCount = window.matchMedia('(max-width: 700px)').matches ? 1 : 2;
  const cols = Array.from({ length: colCount }, () => {
    const col = document.createElement('div');
    col.className = 'list-col';
    container.appendChild(col);
    return col;
  });
  rows.forEach((row, i) => cols[i % colCount].appendChild(row));
}

function renderManage() {
  const featured = allPhotos.filter(p => p.featured);
  const rest = allPhotos;

  manageEmpty.style.display = allPhotos.length ? 'none' : 'block';
  document.getElementById('featured-empty').style.display = featured.length ? 'none' : 'block';

  // 精选列表（可拖拽排序）
  fillColumns(featuredList, featured.map((photo, index) => createRow(photo, index, true)));

  // 全部列表
  fillColumns(allList, rest.map((photo) => createRow(photo, -1, false)));
}

// 跨过 700px 断点时按新列数重新分配卡片（管理列表 + 上传预览）
window.matchMedia('(max-width: 700px)').addEventListener('change', () => {
  renderManage();
  renderPreviews();
});

/* ═══════════════════════════════════════════
   EXIF 展开/收起动画
   面板高度由 CSS grid-template-rows 0fr→1fr 过渡驱动，
   卡片高度真实连续生长；管理列表为行优先 Grid（非 columns），
   下方卡片与「全部作品」区块随布局逐帧自然跟随，无需 FLIP。
   快速连点时 CSS 过渡可从当前值平滑反向。
   ═══════════════════════════════════════════ */
function animateExifToggle(exifPanel, exifSummaryEl) {
  const willOpen = !exifPanel.classList.contains('open');
  exifPanel.classList.toggle('open', willOpen);
  exifSummaryEl.classList.toggle('open', willOpen);
}

function createRow(photo, featuredIdx, isFeaturedSection) {
  const row = document.createElement('div');
  row.className = 'photo-row' + (isFeaturedSection ? ' featured' : '');
  row.dataset.id = photo.id;

  if (isFeaturedSection) {
    row.draggable = true;
  }

  const exif = photo.exif || {};
  const exifSummary = [exif.aperture, exif.shutter_speed, exif.iso].filter(Boolean).join(' ');
  const rowUid = 'row-exif-' + photo.id;

  row.innerHTML = `
    <span class="order-num">${isFeaturedSection ? featuredIdx + 1 : ''}</span>
    <img class="thumb" src="${thumbSrc(photo)}" alt="" loading="lazy">
    <div class="inputs-wrap">
      <input type="text" value="${escapeHtml(photo.title)}" placeholder="标题" data-field="title">
      <input type="text" value="${escapeHtml(photo.location || '')}" placeholder="地点" data-field="location">
    </div>
    <div class="actions-wrap">
      <button class="star ${photo.featured ? 'on' : ''}" title="精选"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>
      <button class="move-series" title="移动主题"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8"/><path d="M2 13h10"/><path d="m5 10-3 3 3 3"/></svg></button>
      <button class="del" title="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/></svg></button>
    </div>
    <div class="exif-summary">
      <span class="exif-text">${escapeHtml(exifSummary) || '—'}<br>${photo.date_taken ? escapeHtml(photo.date_taken) : ''}</span>
      <span class="exif-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
    </div>
  `;

  // EXIF 折叠面板（嵌入行内，跨全列）
  const exifPanel = document.createElement('div');
  exifPanel.className = 'exif-edit';
  exifPanel.id = rowUid;
  exifPanel.innerHTML = `
    <div class="exif-grid">
      <div class="exif-field"><label>相机</label><input type="text" value="${escapeHtml(exif.camera || '')}" data-exif="camera"></div>
      <div class="exif-field"><label>镜头</label><input type="text" value="${escapeHtml(exif.lens || '')}" data-exif="lens"></div>
      <div class="exif-field"><label>焦距</label><input type="text" value="${escapeHtml(exif.focal_length || '')}" data-exif="focal_length"></div>
      <div class="exif-field"><label>光圈</label><input type="text" value="${escapeHtml(exif.aperture || '')}" data-exif="aperture"></div>
      <div class="exif-field"><label>快门</label><input type="text" value="${escapeHtml(exif.shutter_speed || '')}" data-exif="shutter_speed"></div>
      <div class="exif-field"><label>ISO</label><input type="text" value="${escapeHtml(exif.iso || '')}" data-exif="iso"></div>
      <div class="exif-field"><label>拍摄日期</label><input type="text" value="${escapeHtml(photo.date_taken || '')}" data-exif="date_taken"></div>
    </div>
  `;

  // EXIF 折叠切换（FLIP 平滑重排动画）
  const exifSummaryEl = row.querySelector('.exif-summary');
  exifSummaryEl.addEventListener('click', () => {
    animateExifToggle(exifPanel, exifSummaryEl);
  });

  // EXIF 字段编辑 → PATCH API
  exifPanel.querySelectorAll('[data-exif]').forEach(el => {
    el.addEventListener('change', async () => {
      const field = el.dataset.exif;
      if (field === 'date_taken') {
        photo.date_taken = el.value;
        await updatePhoto(photo.id, { date_taken: el.value });
      } else {
        if (!photo.exif) photo.exif = {};
        photo.exif[field] = el.value;
        await updatePhoto(photo.id, { exif: { [field]: el.value } });
      }
      showToast('EXIF 已保存');
    });
  });

  // 元数据编辑
  row.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('change', async () => {
      const field = el.dataset.field;
      photo[field] = el.value;
      await updatePhoto(photo.id, { [field]: el.value });
      showToast('已保存');
    });
  });

  // 精选切换
  row.querySelector('.star').addEventListener('click', async (e) => {
    const newState = !photo.featured;
    photo.featured = newState;
    e.currentTarget.classList.toggle('on', newState);
    await updatePhoto(photo.id, { featured: newState });
    renderManage();
    showToast(newState ? '已标记精选' : '已取消精选');
  });

  // 删除
  row.querySelector('.del').addEventListener('click', async () => {
    const ok = await showConfirm(`确定删除「${photo.title}」？文件将被移除。`);
    if (!ok) return;
    await deletePhoto(photo.id);
    allPhotos = allPhotos.filter(p => p.id !== photo.id);
    renderManage();
    showToast('已删除');
  });

  // 移动主题
  const moveBtn = row.querySelector('.move-series');
  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 关闭其他已打开的下拉
    document.querySelectorAll('.move-dropdown').forEach(d => d.remove());
    const rect = moveBtn.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'move-dropdown';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = Math.max(8, rect.right - 120) + 'px';
    SERIES.forEach(s => {
      const btn = document.createElement('button');
      btn.textContent = s.name;
      if (s.id === currentManageSeries) btn.classList.add('current');
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        dropdown.remove();
        if (s.id === currentManageSeries) return;
        await updatePhoto(photo.id, { series: s.id });
        allPhotos = allPhotos.filter(p => p.id !== photo.id);
        renderManage();
        showToast(`已移至「${s.name}」`);
      });
      dropdown.appendChild(btn);
    });
    document.body.appendChild(dropdown);
    // 点击外部关闭
    const closeDropdown = (ev) => {
      if (!dropdown.contains(ev.target) && ev.target !== moveBtn) { dropdown.remove(); document.removeEventListener('click', closeDropdown); }
    };
    setTimeout(() => document.addEventListener('click', closeDropdown), 0);
  });

  // 拖拽排序（仅精选区）
  if (isFeaturedSection) {
    row.addEventListener('dragstart', (e) => {
      row.classList.add('dragging');
      e.dataTransfer.setData('text/plain', photo.id);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      featuredList.querySelectorAll('.photo-row').forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const dragId = e.dataTransfer.getData('text/plain');
      if (dragId === photo.id) return;

      // 重排 allPhotos 中精选照片的顺序
      const featured = allPhotos.filter(p => p.featured);
      const fromIdx = featured.findIndex(p => p.id === dragId);
      const toIdx = featured.findIndex(p => p.id === photo.id);
      const [moved] = featured.splice(fromIdx, 1);
      featured.splice(toIdx, 0, moved);

      // 重建 allPhotos：精选按新顺序在前，非精选保持原序
      const nonFeatured = allPhotos.filter(p => !p.featured);
      allPhotos = [...featured, ...nonFeatured];
      renderManage();
      // 自动保存排序
      const featuredIds = featured.map(p => p.id);
      reorderPhotos(featuredIds).then(() => showToast('排序已保存')).catch(() => showToast('排序保存失败'));
    });
  }

  row.appendChild(exifPanel);
  const frag = document.createDocumentFragment();
  frag.appendChild(row);
  return frag;
}

/* ═══════════════════════════════════════════
   工具
   ═══════════════════════════════════════════ */
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

/* 自定义确认弹窗（替代原生 confirm） */
function showConfirm(msg) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const box = document.getElementById('modal-box');
    box.querySelector('.modal-msg').textContent = msg;
    overlay.classList.add('show');

    const confirmBtn = box.querySelector('.modal-confirm');
    const cancelBtn = box.querySelector('.modal-cancel');

    function cleanup(result) {
      overlay.classList.remove('show');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      resolve(result);
    }
    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
  });
}

/* 自定义输入弹窗（替代原生 prompt）；initial 为预填初值 */
function showPrompt(msg, placeholder, initial) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const box = document.getElementById('modal-box');
    const input = box.querySelector('.modal-input');
    const confirmBtn = box.querySelector('.modal-confirm');
    const cancelBtn = box.querySelector('.modal-cancel');

    box.querySelector('.modal-msg').textContent = msg;
    input.style.display = 'block';
    input.value = initial || '';
    input.placeholder = placeholder || '';
    confirmBtn.textContent = '确定';
    confirmBtn.style.background = 'rgba(255,255,255,0.12)';
    confirmBtn.style.borderColor = 'rgba(255,255,255,0.25)';
    overlay.classList.add('show');
    setTimeout(() => input.focus(), 50);

    function cleanup(result) {
      overlay.classList.remove('show');
      input.style.display = 'none';
      confirmBtn.textContent = '删除';
      confirmBtn.style.background = '';
      confirmBtn.style.borderColor = '';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      input.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onConfirm() { cleanup(input.value); }
    function onCancel() { cleanup(null); }
    function onOverlay(e) { if (e.target === overlay) cleanup(null); }
    function onKey(e) {
      if (e.key === 'Enter') cleanup(input.value);
      if (e.key === 'Escape') cleanup(null);
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    input.addEventListener('keydown', onKey);
  });
}

/* ═══════════════════════════════════════════
   署名设置：跳转画廊首启落款页（编辑模式）
   ═══════════════════════════════════════════ */
document.getElementById('btn-signature').addEventListener('click', () => {
  location.href = 'gallery.html?naming=1';
});

/* ═══════════════════════════════════════════
   更换库目录（仅 Tauri 环境显示）
   ═══════════════════════════════════════════ */
const btnLibrary = document.getElementById('btn-library');
if (isTauri) {
  btnLibrary.hidden = false;
  btnLibrary.addEventListener('click', async () => {
    let dir = null;
    try {
      dir = await window.__TAURI__.dialog.open({
        directory: true,
        title: '选择照片库目录',
      });
    } catch (e) {}
    if (!dir) return; // 用户取消
    try {
      await setLibraryDir(dir);
      location.reload(); // 切库后整页重载，重新拉取数据
    } catch (e) {
      alert(e.message);
    }
  });
}

/* ═══════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════ */
(async function init() {
  await initAssets();
  try {
    const data = await listSeries();
    SERIES = data.map(s => ({ id: s.id, name: s.name }));
  } catch (e) { SERIES = []; }
  if (SERIES.length) currentManageSeries = SERIES[0].id;
  renderSeriesTabs();
  loadManage();
})();
