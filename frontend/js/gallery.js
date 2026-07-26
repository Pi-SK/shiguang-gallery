/* ═══════════════════════════════════════════
   gallery.js — 画廊展示页逻辑
   后端调用统一走 api.js 防腐层，图片地址走 assets.js。
   ═══════════════════════════════════════════ */

import { listPhotos, listSeries, getSettings, updateSettings } from './api.js';
import { photoSrc } from './assets.js';

/* ═══════════════════════════════════════════
   状态
   ═══════════════════════════════════════════ */
let currentSeries = "featured";
let currentList = [];
let currentIndex = 0;
let isTransitioning = false;
let navTimer = null;
let entered = false;
let exifOpen = false;
let cardsMode = false;
let namingActive = false; // 首启落款页显示中，屏蔽进入画廊

const SERIES_META = {
  featured: { name: "精选" },
};
let seriesList = []; // 动态系列列表（排除 uncategorized）

/* DOM */
const cover = document.getElementById("cover");
const coverImg = document.getElementById("cover-img");
const nav = document.getElementById("nav");
const slideshow = document.getElementById("slideshow");
const mainPhoto = document.getElementById("main-photo");
const photoInfo = document.getElementById("photo-info");
const photoCounter = document.getElementById("photo-counter");
const seriesTitle = document.getElementById("series-title");
const arrowLeft = document.getElementById("arrow-left");
const arrowRight = document.getElementById("arrow-right");
const emptyMsg = document.getElementById("empty-msg");
const exifPanel = document.getElementById("exif-panel");
const seriesEmpty = document.getElementById("series-empty");
const stagePlaceholder = document.querySelector(
  "#photo-stage .placeholder",
);
const scrollDownBtn = document.getElementById("scroll-down-btn");
const noFeaturedHint = document.getElementById("no-featured-hint");
const cardsLayer = document.getElementById("cards-layer");
const cardsContainer = document.getElementById("cards-container");
const cardsSeriesName = document.querySelector(".cards-series-name");
const sortSelect = document.getElementById("sort-select");
const backBtn = document.getElementById("back-to-slideshow");
const cardsPrev = document.getElementById("cards-prev");
const cardsNext = document.getElementById("cards-next");
const cardsCounter = document.getElementById("cards-counter");

/* ═══════════════════════════════════════════
   工具
   ═══════════════════════════════════════════ */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ═══════════════════════════════════════════
   动态加载系列
   ═══════════════════════════════════════════ */
async function loadSeries() {
  try {
    const list = await listSeries();
    seriesList = list.filter((s) => s.id !== "uncategorized");
    seriesList.forEach((s) => {
      SERIES_META[s.id] = { name: s.name };
    });
    renderNavButtons();
  } catch (e) {}
}

function renderNavButtons() {
  const navSeries = document.querySelector(".nav-series");
  const adminIcon = navSeries.querySelector(".admin-icon");
  // 移除旧的动态按钮
  navSeries.querySelectorAll("button[data-series]:not([data-series='featured'])").forEach((b) => b.remove());
  // 在 admin icon 之前插入
  seriesList.forEach((s) => {
    const btn = document.createElement("button");
    btn.dataset.series = s.id;
    btn.textContent = s.name;
    navSeries.insertBefore(btn, adminIcon);
  });
}

/* ═══════════════════════════════════════════
   署名（首启落款页 + 封面副标题）
   ═══════════════════════════════════════════ */
const namingLayer = document.getElementById("naming");
const namingFrame = document.querySelector(".naming-frame");
const namingInput = document.getElementById("naming-input");
const namingConfirm = document.getElementById("naming-confirm");
const namingSkip = document.getElementById("naming-skip");
const coverSubtitle = document.getElementById("cover-subtitle");

function applySignature(name) {
  coverSubtitle.textContent = name ? `Photography by ${name}` : "Photography";
}

function closeNaming() {
  namingActive = false;
  namingLayer.classList.add("hidden");
  // 淡出结束后彻底移除，避免遮挡封面点击
  setTimeout(() => namingLayer.classList.remove("active"), 1000);
}

async function submitNaming() {
  const name = namingInput.value.trim();
  if (!name) {
    // 空输入：画框轻微摇头提示
    namingFrame.classList.remove("shake");
    void namingFrame.offsetWidth;
    namingFrame.classList.add("shake");
    namingInput.focus();
    return;
  }
  try {
    await updateSettings({ photographer_name: name });
  } catch (e) {}
  applySignature(name);
  closeNaming();
}

async function initSignature() {
  let name = "";
  try {
    const s = await getSettings();
    name = (s && s.photographer_name) || "";
  } catch (e) {}
  applySignature(name);

  // 编辑模式：管理页"署名设置"跳转 /?naming=1 直接进入落款页
  const editMode = new URLSearchParams(location.search).has("naming");
  if (editMode) {
    // 清理地址栏参数，刷新后不再强制进入
    history.replaceState(null, "", location.pathname);
  }

  if (!name || editMode) {
    namingActive = true;
    namingInput.value = name; // 编辑时预填现有署名
    namingSkip.textContent = name ? "保留原署名" : "暂不署名";
    namingLayer.classList.add("active");
    setTimeout(() => namingInput.focus(), 600);
  }
}

namingConfirm.addEventListener("click", submitNaming);
namingSkip.addEventListener("click", closeNaming);
namingInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitNaming();
});

initSignature();

/* ═══════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════ */
async function init() {
  await loadSeries();

  let photos = [];
  try {
    photos = await listPhotos({ featured: true });
  } catch (e) {}

  if (photos.length === 0) {
    try {
      photos = await listPhotos();
      currentSeries = "all";
    } catch (e) {}
  }

  if (photos.length === 0) {
    cover.classList.add("hidden");
    emptyMsg.style.display = "flex";
    return;
  }

  currentList = shuffle([...photos]);
  const coverPhoto = photos[Math.floor(Math.random() * photos.length)];
  coverImg.src = photoSrc(coverPhoto);
}

init();

/* ═══════════════════════════════════════════
   进入 / 退出画廊
   ═══════════════════════════════════════════ */
function enterGallery() {
  if (entered || currentList.length === 0) return;
  entered = true;
  cover.classList.add("hidden");
  slideshow.classList.add("active");
  showPhoto(0);
  showNav();
  scheduleNavHide();
}

function exitToCover() {
  if (!entered) return;
  if (cardsMode) exitCardsMode();
  entered = false;
  clearTimeout(navTimer);
  hideNav();
  slideshow.classList.remove("active");
  photoInfo.classList.remove("visible");
  photoCounter.classList.remove("visible");
  scrollDownBtn.classList.remove("visible");
  noFeaturedHint.classList.remove("visible");
  closeExif();
  document.body.style.cursor = "default";
  cover.classList.remove("hidden");
}

cover.addEventListener("click", enterGallery);
document.addEventListener("keydown", (e) => {
  if (namingActive) return; // 落款页显示中，键盘不触发进入
  if (!entered && e.key !== "F5" && e.key !== "F12") enterGallery();
});

/* ═══════════════════════════════════════════
   幻灯片
   ═══════════════════════════════════════════ */
function showPhoto(index) {
  if (isTransitioning || currentList.length === 0) return;
  isTransitioning = true;

  currentIndex =
    ((index % currentList.length) + currentList.length) %
    currentList.length;
  const photo = currentList[currentIndex];

  mainPhoto.classList.remove("loaded");
  photoInfo.classList.remove("visible");
  photoCounter.classList.remove("visible");
  closeExif();

  const img = new Image();
  img.onload = () => {
    // 无过渡地重置到干净起点（opacity:0 / scale(1)），再触发过渡：
    // 否则缓存命中或上一次过渡未完成时，起点已接近 scale(1.02)/opacity1，
    // 导致本次缩放+淡入动画几乎不可见（这正是动画“经常不出现”的根因）。
    mainPhoto.style.transition = "none";
    mainPhoto.classList.remove("loaded", "blank");
    mainPhoto.src = photoSrc(photo);
    mainPhoto.alt =
      photo.title + (photo.location ? "，" + photo.location : "");
    void mainPhoto.offsetWidth; // 强制回流，提交无过渡的起始态
    requestAnimationFrame(() => {
      mainPhoto.style.transition = ""; // 恢复 CSS 过渡
      mainPhoto.classList.add("loaded"); // 触发 opacity + scale 过渡
      updateInfo(photo);
      isTransitioning = false;
    });
    preloadAdjacent();
  };
  img.onerror = () => {
    mainPhoto.style.transition = "none";
    mainPhoto.classList.remove("loaded", "blank");
    mainPhoto.src = photoSrc(photo);
    void mainPhoto.offsetWidth;
    requestAnimationFrame(() => {
      mainPhoto.style.transition = "";
      mainPhoto.classList.add("loaded");
      updateInfo(photo);
      isTransitioning = false;
    });
  };
  img.src = photoSrc(photo);
}

/* 从照片数据提取完整 EXIF 行（标签/值），幻灯片与卡片模式共用，保证一致 */
function buildExifRows(photo) {
  const exif = photo.exif || {};
  const rows = [];
  if (exif.camera) rows.push(["相机", exif.camera]);
  if (exif.lens) rows.push(["镜头", exif.lens]);
  if (exif.focal_length) rows.push(["焦距", exif.focal_length]);
  if (exif.aperture) rows.push(["光圈", exif.aperture]);
  if (exif.shutter_speed) rows.push(["快门", exif.shutter_speed]);
  if (exif.iso) rows.push(["感光度", exif.iso]);
  if (photo.date_taken) rows.push(["拍摄时间", photo.date_taken]);
  return rows;
}

function updateInfo(photo) {
  photoInfo.querySelector(".photo-title").textContent = photo.title;
  photoInfo.querySelector(".photo-location").textContent =
    photo.location || "";

  const rows = buildExifRows(photo);

  const hint = photoInfo.querySelector(".exif-hint");
  if (rows.length > 0) {
    hint.style.display = "block";
    exifPanel.innerHTML = rows
      .map(
        ([l, v]) =>
          `<span class="exif-label">${l}</span><span class="exif-value">${v}</span>`,
      )
      .join("");
  } else {
    hint.style.display = "none";
    exifPanel.innerHTML = "";
  }

  photoInfo.classList.add("visible");
  photoCounter.textContent =
    currentIndex + 1 + " / " + currentList.length;
  photoCounter.classList.add("visible");
}

function preloadAdjacent() {
  if (currentList.length <= 1) return;
  const prevIdx =
    (currentIndex - 1 + currentList.length) % currentList.length;
  const nextIdx = (currentIndex + 1) % currentList.length;
  new Image().src = photoSrc(currentList[prevIdx]);
  new Image().src = photoSrc(currentList[nextIdx]);
}

function goNext() {
  showPhoto(currentIndex + 1);
}
function goPrev() {
  showPhoto(currentIndex - 1);
}

/* ═══════════════════════════════════════════
   EXIF
   ═══════════════════════════════════════════ */
photoInfo.addEventListener("click", () => {
  if (exifPanel.innerHTML === "") return;
  exifOpen = !exifOpen;
  exifPanel.classList.toggle("open", exifOpen);
  photoInfo.querySelector(".exif-hint").textContent = exifOpen
    ? "点击收起"
    : "点击展开拍摄参数";
});

function closeExif() {
  exifOpen = false;
  exifPanel.classList.remove("open");
  const hint = photoInfo.querySelector(".exif-hint");
  if (hint) hint.textContent = "点击展开拍摄参数";
}

/* ═══════════════════════════════════════════
   卡片模式
   ═══════════════════════════════════════════ */
async function enterCardsMode(sort) {
  cardsMode = true;
  let photos = [];
  try {
    photos = await listPhotos({
      series: currentSeries,
      sort: sort && sort !== "order" ? sort : undefined,
    });
  } catch (e) {}

  cardsSeriesName.textContent = SERIES_META[currentSeries]?.name || "";
  renderCards(photos);
  requestAnimationFrame(updateCardsCounter);

  photoInfo.classList.remove("visible");
  photoCounter.classList.remove("visible");
  scrollDownBtn.classList.remove("visible");
  noFeaturedHint.classList.remove("visible");
  closeExif();
  slideshow.classList.add("blurred");
  cardsLayer.classList.add("active");
  updateArrows();
}

function exitCardsMode() {
  cardsMode = false;
  cardsLayer.classList.remove("active");
  slideshow.classList.remove("blurred");
  cardsContainer.scrollLeft = 0;
  // 无精选（currentList 为空）时彻底隐藏主图，
  // 防止退出卡片模式后露出上一主题的残留照片
  mainPhoto.classList.toggle("blank", currentList.length === 0);
  if (currentList.length > 0) {
    photoInfo.classList.add("visible");
    photoCounter.classList.add("visible");
  }
  if (currentSeries !== "featured") {
    scrollDownBtn.classList.add("visible");
    if (currentList.length === 0) {
      noFeaturedHint.classList.add("visible");
    }
  }
  updateArrows();
}

function renderCards(photos) {
  cardsContainer.innerHTML = "";
  photos.forEach((photo, i) => {
    const exif = photo.exif || {};
    const exifParts = [
      exif.focal_length,
      exif.aperture,
      exif.shutter_speed,
      exif.iso,
    ].filter(Boolean);

    const rows = buildExifRows(photo);
    const hasExif = rows.length > 0;
    const summaryText = exifParts.join("  ") || (hasExif ? "拍摄参数" : "");
    const chevron = `<svg class="exif-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>`;
    const panelHTML = hasExif
      ? `<div class="card-exif-panel">${rows
          .map(
            ([l, v]) =>
              `<span class="exif-label">${l}</span><span class="exif-value">${v}</span>`,
          )
          .join("")}</div>`
      : "";
    const summaryHTML = hasExif
      ? `<span class="card-exif" role="button" tabindex="0" aria-expanded="false" aria-label="展开拍摄参数">${summaryText}${chevron}</span>`
      : "";

    const tilt = (Math.random() * 5 - 2.5).toFixed(1);
    const card = document.createElement("article");
    card.className = "stack-card";
    card.style.setProperty("--tilt", tilt + "deg");
    card.innerHTML = `
      <div class="card-media">
        <img class="card-image" src="${photoSrc(photo)}" alt="${photo.title}" loading="lazy">
        ${panelHTML}
      </div>
      <div class="card-info">
        <div>
          <span class="card-title">${photo.title}</span>
          ${photo.location ? `<span class="card-location"> · ${photo.location}</span>` : ""}
        </div>
        ${summaryHTML}
      </div>
    `;
    cardsContainer.appendChild(card);
  });
}

scrollDownBtn.addEventListener("click", () => {
  if (!cardsMode) enterCardsMode("order");
});

backBtn.addEventListener("click", exitCardsMode);

sortSelect.addEventListener("change", () => {
  if (cardsMode) enterCardsMode(sortSelect.value);
});

/* ── 卡片模式：鼠标拖拽横向滚动 ── */
let isDragging = false;
let dragStartX = 0;
let dragScrollLeft = 0;
let dragMoved = false;

cardsContainer.addEventListener("mousedown", (e) => {
  isDragging = true;
  dragMoved = false;
  dragStartX = e.pageX;
  dragScrollLeft = cardsContainer.scrollLeft;
  cardsContainer.classList.add("grabbing");
  /* 关闭 smooth + snap，保证 1:1 跟手 */
  cardsContainer.style.scrollBehavior = "auto";
  cardsContainer.style.scrollSnapType = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  if (Math.abs(e.pageX - dragStartX) > 4) dragMoved = true;
  cardsContainer.scrollLeft = dragScrollLeft - (e.pageX - dragStartX);
});

document.addEventListener("mouseup", () => {
  if (!isDragging) return;
  isDragging = false;
  cardsContainer.classList.remove("grabbing");
  /* 恢复 smooth + snap，自动吸附到最近卡片 */
  cardsContainer.style.scrollBehavior = "smooth";
  cardsContainer.style.scrollSnapType = "x mandatory";
});

/* ── 卡片模式：底部按钮 + 计数器 ── */
function scrollToCard(index) {
  const cards = cardsContainer.querySelectorAll(".stack-card");
  if (index < 0 || index >= cards.length) return;
  const card = cards[index];
  const target =
    card.offsetLeft + card.offsetWidth / 2 - cardsContainer.offsetWidth / 2;
  cardsContainer.scrollTo({ left: target, behavior: "smooth" });
}

function getCurrentCardIndex() {
  const cards = cardsContainer.querySelectorAll(".stack-card");
  if (cards.length === 0) return 0;

  /* 容器两侧留白 + scroll-snap-align:center 下，首/末卡片无法真正
     滚到正中（居中所需的 scrollLeft 会被钳制到 0 或 maxScroll）。
     此时纯「离视口中心最近」判断会误选到中间的卡片——尤其首张竖屏、
     次张横屏时，横屏卡片中心反而更靠近视口中心。故先钳制两端： */
  const maxScroll =
    cardsContainer.scrollWidth - cardsContainer.clientWidth;
  if (cardsContainer.scrollLeft <= 2) return 0;
  if (maxScroll > 0 && cardsContainer.scrollLeft >= maxScroll - 2)
    return cards.length - 1;

  const center =
    cardsContainer.scrollLeft + cardsContainer.offsetWidth / 2;
  let closest = 0,
    minDist = Infinity;
  cards.forEach((card, i) => {
    const d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
    if (d < minDist) {
      minDist = d;
      closest = i;
    }
  });
  return closest;
}

function updateCardsCounter() {
  const cards = cardsContainer.querySelectorAll(".stack-card");
  const total = cards.length;
  if (total === 0) {
    cardsCounter.textContent = "0 / 0";
    cardsPrev.disabled = true;
    cardsNext.disabled = true;
    return;
  }
  const idx = getCurrentCardIndex();
  cardsCounter.textContent = idx + 1 + " / " + total;
  cardsPrev.disabled = idx <= 0;
  cardsNext.disabled = idx >= total - 1;
}

cardsPrev.addEventListener("click", () => {
  scrollToCard(getCurrentCardIndex() - 1);
});
cardsNext.addEventListener("click", () => {
  scrollToCard(getCurrentCardIndex() + 1);
});

cardsContainer.addEventListener("scroll", updateCardsCounter);

/* ── 卡片模式：点击 EXIF 摘要 → 向上浮出完整 EXIF 面板（单开） ── */
function toggleCardExif(summary) {
  const card = summary.closest(".stack-card");
  const panel = card && card.querySelector(".card-exif-panel");
  if (!panel) return;
  const willOpen = !panel.classList.contains("open");
  // 单开：展开一张时收起其他已展开的面板
  if (willOpen) {
    cardsContainer
      .querySelectorAll(".card-exif-panel.open")
      .forEach((p) => {
        p.classList.remove("open");
        const t = p
          .closest(".stack-card")
          .querySelector(".card-exif");
        if (t) {
          t.classList.remove("open");
          t.setAttribute("aria-expanded", "false");
        }
      });
  }
  panel.classList.toggle("open", willOpen);
  summary.classList.toggle("open", willOpen);
  summary.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

cardsContainer.addEventListener("click", (e) => {
  const summary = e.target.closest(".card-exif");
  if (!summary) return;
  if (dragMoved) return; // 刚刚是拖拽滚动，非点击
  e.stopPropagation();
  toggleCardExif(summary);
});

cardsContainer.addEventListener("keydown", (e) => {
  const summary = e.target.closest(".card-exif");
  if (!summary) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleCardExif(summary);
  }
});

/* ═══════════════════════════════════════════
   系列切换
   ═══════════════════════════════════════════ */
async function switchSeries(series) {
  if (series === currentSeries) return;
  if (cardsMode) exitCardsMode();

  currentSeries = series;
  sortSelect.value = "order";

  // 立即隐藏当前照片，防止切换时闪现旧系列内容
  mainPhoto.classList.remove("loaded");
  mainPhoto.classList.add("blank");
  photoInfo.classList.remove("visible");
  photoCounter.classList.remove("visible");
  scrollDownBtn.classList.remove("visible");
  noFeaturedHint.classList.remove("visible");
  closeExif();

  nav.querySelectorAll(".nav-series button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.series === series);
  });

  const meta = SERIES_META[series] || { name: "全部" };
  seriesTitle.querySelector("h2").textContent = meta.name;

  let photos = [];
  if (series === "featured") {
    try {
      photos = await listPhotos({ featured: true });
    } catch (e) {}
    photos = shuffle(photos);
    seriesTitle.querySelector(".series-count").textContent =
      photos.length > 0 ? photos.length + " 幅作品" : "";
  } else {
    try {
      photos = await listPhotos({ series, featured: true });
    } catch (e) {}
    seriesTitle.querySelector(".series-count").textContent =
      photos.length > 0 ? photos.length + " 幅精选" : "";
  }

  seriesTitle.classList.add("visible");

  setTimeout(() => {
    seriesTitle.classList.remove("visible");
    noFeaturedHint.classList.remove("visible");
    currentIndex = 0;
    isTransitioning = false;

    if (photos.length === 0 && series !== "featured") {
      checkSeriesEmpty(series);
    } else if (photos.length === 0) {
      currentList = [];
      mainPhoto.classList.remove("loaded");
      mainPhoto.classList.add("blank");
      photoInfo.classList.remove("visible");
      photoCounter.classList.remove("visible");
      scrollDownBtn.classList.remove("visible");
      closeExif();
    } else {
      seriesEmpty.classList.remove("visible");
      stagePlaceholder.style.display = "";
      currentList = photos;
      showPhoto(0);
      scrollDownBtn.classList.toggle("visible", series !== "featured");
    }
    updateArrows();
  }, 1200);
}

async function checkSeriesEmpty(series) {
  let allPhotos = [];
  try {
    allPhotos = await listPhotos({ series });
  } catch (e) {}

  if (allPhotos.length === 0) {
    currentList = [];
    mainPhoto.classList.remove("loaded");
    mainPhoto.classList.add("blank");
    photoInfo.classList.remove("visible");
    photoCounter.classList.remove("visible");
    scrollDownBtn.classList.remove("visible");
    closeExif();
    stagePlaceholder.style.display = "none";
    seriesEmpty.querySelector(".series-empty-name").textContent =
      SERIES_META[series]?.name || "";
    seriesEmpty.classList.add("visible");
  } else {
    seriesEmpty.classList.remove("visible");
    currentList = [];
    mainPhoto.classList.remove("loaded");
    mainPhoto.classList.add("blank");
    photoInfo.classList.remove("visible");
    photoCounter.classList.remove("visible");
    closeExif();
    enterCardsMode("order");
  }
}

nav.addEventListener("click", (e) => {
  const el = e.target.closest("[data-series]");
  if (el) switchSeries(el.dataset.series);
});

/* ═══════════════════════════════════════════
   导航显隐
   ═══════════════════════════════════════════ */
function showNav() {
  nav.classList.add("visible");
  document.body.style.cursor = "default";
  updateArrows();
}
function hideNav() {
  nav.classList.remove("visible");
  updateArrows();
}
/* 侧边上/下一张按钮：entered且非卡片模式、多于一张时“待命”（可交互）；
   桌面端仅悬停时浮现（CSS 控制），触摸端随导航栏(nav-on)浮现 */
function updateArrows() {
  const active = entered && !cardsMode && currentList.length > 1;
  const navVisible = nav.classList.contains("visible");
  arrowLeft.classList.toggle("armed", active);
  arrowRight.classList.toggle("armed", active);
  arrowLeft.classList.toggle("nav-on", active && navVisible);
  arrowRight.classList.toggle("nav-on", active && navVisible);
}
function scheduleNavHide() {
  clearTimeout(navTimer);
  navTimer = setTimeout(() => {
    if (!cardsMode) {
      hideNav();
      document.body.style.cursor = "none";
    }
  }, 3000);
}
document.addEventListener("mousemove", () => {
  if (!entered) return;
  showNav();
  document.body.style.cursor = "default";
  scheduleNavHide();
});

/* ═══════════════════════════════════════════
   键盘 / 箭头 / 触屏 / 滚轮
   ═══════════════════════════════════════════ */
document.addEventListener("keydown", (e) => {
  if (!entered) return;
  if (cardsMode) {
    if (e.key === "Escape") exitCardsMode();
    return;
  }
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      goNext();
      break;
    case "ArrowLeft":
    case "ArrowUp":
      goPrev();
      break;
    case "Escape":
      exitToCover();
      break;
    default:
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < seriesList.length) switchSeries(seriesList[idx].id);
      }
  }
});

arrowLeft.addEventListener("click", goPrev);
arrowRight.addEventListener("click", goNext);

let touchStartX = 0,
  touchStartY = 0;
document.addEventListener(
  "touchstart",
  (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    if (entered && !cardsMode) {
      showNav();
      scheduleNavHide();
    }
  },
  { passive: true },
);
document.addEventListener(
  "touchend",
  (e) => {
    if (!entered || cardsMode) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
      dx < 0 ? goNext() : goPrev();
  },
  { passive: true },
);

let wheelLock = false;
document.addEventListener(
  "wheel",
  (e) => {
    if (!entered || wheelLock) return;

    if (cardsMode) {
      /* 卡片模式：一个 notch 切一张卡片 */
      const cards = cardsContainer.querySelectorAll(".stack-card");
      if (cards.length === 0) return;
      wheelLock = true;
      const dir = e.deltaY > 0 || e.deltaX > 0 ? 1 : -1;
      scrollToCard(getCurrentCardIndex() + dir);
      setTimeout(() => { wheelLock = false; }, 600);
      return;
    }

    /* 幻灯片模式 */
    wheelLock = true;
    e.deltaY > 0 || e.deltaX > 0 ? goNext() : goPrev();
    setTimeout(() => { wheelLock = false; }, 900);
  },
  { passive: true },
);

/* 管理后台链接 */
document.querySelector(".admin-icon").addEventListener("click", (e) => {
  e.preventDefault();
  document.body.classList.add("page-leaving");
  setTimeout(() => {
    window.location.href = "/admin";
  }, 400);
});
