/* ═══════════════════════════════════════════
   titlebar.js — 自定义标题栏（仅 Tauri 环境注入）
   decorations:false 后替代原生窗框：
   drag-region 拖动 + 双击最大化。
   Windows：右侧最小化/最大化/关闭三键；
   macOS：左上角红绿灯样式（红关/黄最小化/绿最大化）。
   浏览器调试时本模块静默跳过，页面零感知。
   ═══════════════════════════════════════════ */

const TAURI = typeof window !== 'undefined' && window.__TAURI__ ? window.__TAURI__ : null;

if (TAURI) {
  const win = TAURI.window.getCurrentWindow();
  const IS_MAC = /Macintosh|Mac OS X/.test(navigator.userAgent);

  // 样式按需注入，避免浏览器模式多一次无用请求
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/titlebar.css';
  document.head.appendChild(link);

  const bar = document.createElement('div');
  bar.id = 'titlebar';
  bar.setAttribute('data-tauri-drag-region', '');

  const btnClose = `
    <button id="titlebar-close" class="titlebar-btn" title="关闭" aria-label="关闭">
      <svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/></svg>
    </button>`;
  const btnMin = `
    <button id="titlebar-min" class="titlebar-btn" title="最小化" aria-label="最小化">
      <svg viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5"/></svg>
    </button>`;
  const btnMax = `
    <button id="titlebar-max" class="titlebar-btn" title="最大化" aria-label="最大化">
      <svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>
    </button>`;
  const titleHtml = `<span class="titlebar-title">拾光 · 画廊</span>`;

  if (IS_MAC) {
    bar.classList.add('is-mac');
    // Mac 习惯：左上角红绿灯，顺序为 关闭/最小化/最大化
    bar.innerHTML = `<span class="titlebar-mac-btns">${btnClose}${btnMin}${btnMax}</span>${titleHtml}`;
  } else {
    bar.innerHTML = `${titleHtml}${btnMin}${btnMax}${btnClose}`;
  }
  document.body.prepend(bar);
  document.documentElement.classList.add('has-titlebar');

  /* 最大化状态同步：还原/最大化图标切换 */
  const btnMaxEl = bar.querySelector('#titlebar-max');
  async function syncMaxIcon() {
    const maximized = await win.isMaximized();
    btnMaxEl.innerHTML = maximized
      ? '<svg viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7"/><path d="M 2.5 2.5 V 0.5 H 9.5 V 7.5 H 7.5"/></svg>'
      : '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>';
    btnMaxEl.title = maximized ? '还原' : '最大化';
  }
  syncMaxIcon();
  win.onResized(syncMaxIcon);

  bar.querySelector('#titlebar-min').addEventListener('click', () => win.minimize());
  btnMaxEl.addEventListener('click', () => win.toggleMaximize());
  bar.querySelector('#titlebar-close').addEventListener('click', () => win.close());
}
