"""
拾光 · 摄影画廊 — FastAPI 后端
提供照片管理 API（含 EXIF 解析）+ 静态文件服务

[DEPRECATED] 应用已迁移至 Tauri（src-tauri/，Rust 后端），本文件仅作参考保留：
- 生产入口：src-tauri（cargo tauri build 打包 NSIS 安装包）
- 本文件仍可用 `uvicorn main:app` 启动，供浏览器模式快速调试前端（frontend/）
"""

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
from pydantic import BaseModel

# ─── 路径配置 ───────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
ASSETS_DIR = BASE_DIR / "assets"
THUMBS_DIR = ASSETS_DIR / "thumbs"
DATA_DIR = BASE_DIR / "data"
# 阶段 1 起页面改由 frontend/ 提供（旧 static/ 保留作回退基线）
FRONTEND_DIR = BASE_DIR / "frontend"
PHOTOS_JSON = DATA_DIR / "photos.json"
SERIES_JSON = DATA_DIR / "series.json"
SETTINGS_JSON = DATA_DIR / "settings.json"

ASSETS_DIR.mkdir(exist_ok=True)
THUMBS_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)


# ─── 数据读写 ───────────────────────────────────────────

def load_photos() -> list[dict]:
    if not PHOTOS_JSON.exists():
        return []
    with open(PHOTOS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def save_photos(photos: list[dict]) -> None:
    with open(PHOTOS_JSON, "w", encoding="utf-8") as f:
        json.dump(photos, f, ensure_ascii=False, indent=2)


def load_series() -> list[dict]:
    if not SERIES_JSON.exists():
        return []
    with open(SERIES_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def save_series(series: list[dict]) -> None:
    with open(SERIES_JSON, "w", encoding="utf-8") as f:
        json.dump(series, f, ensure_ascii=False, indent=2)


DEFAULT_SETTINGS = {"photographer_name": ""}


def load_settings() -> dict:
    """读取应用设置；缺失字段回填默认值"""
    if not SETTINGS_JSON.exists():
        return dict(DEFAULT_SETTINGS)
    with open(SETTINGS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {**DEFAULT_SETTINGS, **data}


def save_settings(settings: dict) -> None:
    with open(SETTINGS_JSON, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


# ─── EXIF 解析 ──────────────────────────────────────────

def parse_exif(file_path: Path) -> dict:
    """从图片文件中解析 EXIF 元数据，返回结构化字典"""
    result = {
        "camera": "",
        "lens": "",
        "focal_length": "",
        "aperture": "",
        "shutter_speed": "",
        "iso": "",
        "date_taken": "",
        "width": 0,
        "height": 0,
    }

    try:
        with Image.open(file_path) as img:
            result["width"] = img.width
            result["height"] = img.height

            exif_data = img._getexif()
            if not exif_data:
                return result

            # 将 TAG ID 转为可读名称
            decoded = {}
            for tag_id, value in exif_data.items():
                tag_name = TAGS.get(tag_id, tag_id)
                decoded[tag_name] = value

            # 相机品牌 + 型号
            make = str(decoded.get("Make", "")).strip()
            model = str(decoded.get("Model", "")).strip()
            if make and model:
                result["camera"] = f"{make} {model}"
            elif model:
                result["camera"] = model

            # 镜头（部分固件会在字符串末尾填充 \x00，需清理）
            lens = decoded.get("LensModel", "")
            if lens:
                result["lens"] = str(lens).replace("\x00", "").strip()

            # 焦距
            focal = decoded.get("FocalLength")
            if focal:
                try:
                    result["focal_length"] = f"{int(focal)}mm"
                except (ValueError, TypeError):
                    pass

            # 光圈
            aperture = decoded.get("FNumber")
            if aperture:
                try:
                    result["aperture"] = f"f/{float(aperture):.1f}"
                except (ValueError, TypeError):
                    pass

            # 快门速度
            shutter = decoded.get("ExposureTime")
            if shutter:
                try:
                    val = float(shutter)
                    if val < 1:
                        result["shutter_speed"] = f"1/{int(1/val)}s"
                    else:
                        result["shutter_speed"] = f"{val:.1f}s"
                except (ValueError, TypeError, ZeroDivisionError):
                    pass

            # ISO
            iso = decoded.get("ISOSpeedRatings")
            if iso:
                result["iso"] = f"ISO {iso}"

            # 拍摄日期
            date_str = decoded.get("DateTimeOriginal") or decoded.get("DateTime", "")
            if date_str:
                try:
                    dt = datetime.strptime(str(date_str), "%Y:%m:%d %H:%M:%S")
                    result["date_taken"] = dt.strftime("%Y-%m-%d %H:%M")
                except ValueError:
                    result["date_taken"] = str(date_str)

    except Exception:
        pass  # EXIF 解析失败不影响上传

    return result


# ─── 缩略图生成 ─────────────────────────────────────────

def generate_thumbnail(file_path: Path, photo_id: str) -> str:
    """生成 800px 长边缩略图，返回缩略图文件名"""
    thumb_name = f"{photo_id}_thumb.jpg"
    thumb_path = THUMBS_DIR / thumb_name
    try:
        with Image.open(file_path) as img:
            img.thumbnail((800, 800), Image.LANCZOS)
            # 转 RGB（处理 RGBA/P 模式）
            if img.mode not in ("RGB",):
                img = img.convert("RGB")
            img.save(thumb_path, "JPEG", quality=82, optimize=True)
    except Exception:
        return ""
    return thumb_name


# ─── 请求模型 ───────────────────────────────────────────

class PhotoUpdate(BaseModel):
    title: Optional[str] = None
    location: Optional[str] = None
    series: Optional[str] = None
    featured: Optional[bool] = None
    date_taken: Optional[str] = None
    exif: Optional[dict] = None


class ReorderRequest(BaseModel):
    ids: list[str]


class UploadConfirm(BaseModel):
    """确认上传：前端预览后提交最终元数据"""
    items: list[dict]  # [{temp_id, title, location, series, featured}]


class SeriesCreate(BaseModel):
    name: str


class SeriesRename(BaseModel):
    name: str


class SettingsUpdate(BaseModel):
    photographer_name: Optional[str] = None


# ─── FastAPI 应用 ───────────────────────────────────────

app = FastAPI(title="拾光 · 摄影画廊", version="2.0.0")
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")


# ─── 页面路由 ───────────────────────────────────────────

@app.get("/")
async def root():
    return RedirectResponse(url="/gallery")


@app.get("/gallery")
@app.get("/gallery.html")
async def index():
    return FileResponse(str(FRONTEND_DIR / "gallery.html"))


@app.get("/admin")
@app.get("/admin.html")
async def admin_page():
    return FileResponse(str(FRONTEND_DIR / "admin.html"))


@app.get("/admin/dedup")
async def dedup_redirect():
    # 旧路径重定向：相对资源引用需在根路径下解析
    return RedirectResponse(url="/dedup.html")


@app.get("/dedup.html")
async def dedup_page():
    return FileResponse(str(FRONTEND_DIR / "dedup.html"))


# ─── API ────────────────────────────────────────────────

@app.get("/api/duplicates")
async def find_duplicates():
    """基于 EXIF + 文件大小 + 尺寸比例检测重复照片，返回按系列分组的重复组"""
    photos = load_photos()
    series_list = load_series()
    series_names = {s["id"]: s["name"] for s in series_list}

    # 构建指纹 → 照片列表
    groups: dict[str, list[dict]] = {}
    for p in photos:
        exif = p.get("exif", {})
        # 文件大小（字节）
        file_path = ASSETS_DIR / p["filename"]
        file_size = file_path.stat().st_size if file_path.exists() else 0
        # 指纹：全部 EXIF 字段 + 文件大小
        fingerprint = "|".join([
            str(exif.get("camera", "")),
            str(exif.get("lens", "")),
            str(exif.get("focal_length", "")),
            str(exif.get("aperture", "")),
            str(exif.get("shutter_speed", "")),
            str(exif.get("iso", "")),
            str(exif.get("date_taken", "")),
            str(exif.get("width", 0)),
            str(exif.get("height", 0)),
            str(file_size),
        ])
        groups.setdefault(fingerprint, []).append(p)

    # 只保留有重复的组，按系列归类
    result: dict[str, list[list[dict]]] = {}
    for members in groups.values():
        if len(members) < 2:
            continue
        series_id = members[0].get("series", "uncategorized")
        result.setdefault(series_id, []).append(members)

    # 转为前端友好的结构
    output = []
    for series_id, dup_groups in result.items():
        output.append({
            "series": series_id,
            "series_name": series_names.get(series_id, series_id),
            "groups": dup_groups,
        })
    return output

@app.get("/api/photos")
async def list_photos(
    series: Optional[str] = None,
    featured: Optional[bool] = None,
    sort: Optional[str] = None,  # "date" | "filename" | "order"
):
    """
    获取照片列表。
    - series: 按系列筛选
    - featured: 只返回精选
    - sort: 排序方式（date=拍摄日期倒序, filename=文件名, order=手动排序即默认）
    """
    photos = load_photos()

    if series and series != "all":
        photos = [p for p in photos if p.get("series") == series]

    if featured is not None:
        photos = [p for p in photos if p.get("featured", False) == featured]

    if sort == "date":
        photos.sort(key=lambda p: p.get("date_taken", "") or "", reverse=True)
    elif sort == "filename":
        photos.sort(key=lambda p: p.get("original_name", "") or p.get("filename", ""))

    return photos


@app.post("/api/photos/upload", status_code=201)
async def upload_photos(files: list[UploadFile] = File(...)):
    """
    上传照片：保存文件 + 解析 EXIF，照片直接入库，返回带预览信息的列表。
    前端展示预览后：确认时调用 PATCH /api/photos/{id} 回写编辑后的元数据；
    取消时调用 DELETE /api/photos/{id} 移除已上传的文件与记录。
    """
    results = []

    for file in files:
        suffix = Path(file.filename).suffix.lower()
        if suffix not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff"):
            raise HTTPException(400, f"不支持的文件格式: {file.filename}")

        photo_id = uuid.uuid4().hex[:10]
        safe_name = f"{photo_id}{suffix}"
        dest = ASSETS_DIR / safe_name

        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # 解析 EXIF
        exif = parse_exif(dest)

        # 生成缩略图
        thumb_name = generate_thumbnail(dest, photo_id)

        original_stem = Path(file.filename).stem.replace("-", " ").replace("_", " ")
        photo = {
            "id": photo_id,
            "filename": safe_name,
            "thumb": thumb_name,
            "original_name": file.filename,
            "title": original_stem,
            "location": "",
            "series": "shanchuan",
            "featured": False,
            "date_taken": exif.get("date_taken", ""),
            "exif": exif,
        }
        results.append(photo)

    # 直接入库，前端确认时 PATCH 回写元数据；取消则 DELETE 移除
    photos = load_photos()
    photos.extend(results)
    save_photos(photos)

    return results


@app.patch("/api/photos/{photo_id}")
async def update_photo(photo_id: str, body: PhotoUpdate):
    """更新照片元数据"""
    photos = load_photos()
    target = next((p for p in photos if p["id"] == photo_id), None)
    if not target:
        raise HTTPException(404, "照片不存在")

    if body.title is not None:
        target["title"] = body.title
    if body.location is not None:
        target["location"] = body.location
    if body.series is not None:
        valid_ids = {s["id"] for s in load_series()} | {"uncategorized"}
        if body.series not in valid_ids:
            raise HTTPException(400, "无效的系列值")
        target["series"] = body.series
    if body.featured is not None:
        target["featured"] = body.featured
    if body.date_taken is not None:
        target["date_taken"] = body.date_taken
    if body.exif is not None:
        if "exif" not in target:
            target["exif"] = {}
        target["exif"].update(body.exif)

    save_photos(photos)
    return target


@app.delete("/api/photos/{photo_id}")
async def delete_photo(photo_id: str):
    """删除照片（文件 + 元数据）"""
    photos = load_photos()
    target = next((p for p in photos if p["id"] == photo_id), None)
    if not target:
        raise HTTPException(404, "照片不存在")

    file_path = ASSETS_DIR / target["filename"]
    if file_path.exists():
        file_path.unlink()

    # 删除缩略图
    thumb = target.get("thumb", "")
    if thumb:
        thumb_path = THUMBS_DIR / thumb
        if thumb_path.exists():
            thumb_path.unlink()

    photos = [p for p in photos if p["id"] != photo_id]
    save_photos(photos)
    return {"ok": True, "deleted": photo_id}


@app.put("/api/photos/order")
async def reorder_photos(body: ReorderRequest):
    """重排精选照片顺序（仅影响 featured 照片的展示顺序）"""
    photos = load_photos()
    photo_map = {p["id"]: p for p in photos}

    for pid in body.ids:
        if pid not in photo_map:
            raise HTTPException(400, f"无效的照片 ID: {pid}")

    # 按新顺序重建：先放排序后的精选，再放其余
    reordered = [photo_map[pid] for pid in body.ids]
    remaining = [p for p in photos if p["id"] not in set(body.ids)]
    reordered.extend(remaining)

    save_photos(reordered)
    return reordered


@app.post("/api/photos/regenerate-thumbs")
async def regenerate_thumbs():
    """为缺少缩略图的已有照片补生成"""
    photos = load_photos()
    count = 0
    for p in photos:
        thumb = p.get("thumb", "")
        thumb_path = THUMBS_DIR / thumb if thumb else None
        if not thumb or not thumb_path.exists():
            src = ASSETS_DIR / p["filename"]
            if src.exists():
                p["thumb"] = generate_thumbnail(src, p["id"])
                count += 1
    save_photos(photos)
    return {"regenerated": count}


# ─── 设置 API ──────────────────────────────────────────

@app.get("/api/settings")
async def get_settings():
    """获取应用设置（摄影师署名等）"""
    return load_settings()


@app.patch("/api/settings")
async def update_settings(body: SettingsUpdate):
    """更新应用设置（部分字段）"""
    settings = load_settings()
    if body.photographer_name is not None:
        name = body.photographer_name.strip()
        if len(name) > 30:
            raise HTTPException(400, "署名不能超过 30 个字符")
        settings["photographer_name"] = name
    save_settings(settings)
    return settings


# ─── 系列管理 API ──────────────────────────────────────

@app.get("/api/series")
async def list_series():
    """获取所有系列（不含 uncategorized）"""
    return load_series()


@app.post("/api/series", status_code=201)
async def create_series(body: SeriesCreate):
    """新增系列"""
    series = load_series()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "系列名称不能为空")
    if any(s["name"] == name for s in series):
        raise HTTPException(400, "系列名称已存在")
    new_id = uuid.uuid4().hex[:8]
    entry = {"id": new_id, "name": name}
    series.append(entry)
    save_series(series)
    return entry


@app.patch("/api/series/{series_id}")
async def rename_series(series_id: str, body: SeriesRename):
    """重命名系列（不影响照片归属）"""
    series = load_series()
    target = next((s for s in series if s["id"] == series_id), None)
    if not target:
        raise HTTPException(404, "系列不存在")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "系列名称不能为空")
    if any(s["name"] == name and s["id"] != series_id for s in series):
        raise HTTPException(400, "系列名称已存在")
    target["name"] = name
    save_series(series)
    return target


@app.delete("/api/series/{series_id}")
async def delete_series(series_id: str):
    """删除系列，其下照片归入 uncategorized"""
    series = load_series()
    target = next((s for s in series if s["id"] == series_id), None)
    if not target:
        raise HTTPException(404, "系列不存在")
    photos = load_photos()
    moved = 0
    for p in photos:
        if p.get("series") == series_id:
            p["series"] = "uncategorized"
            moved += 1
    save_photos(photos)
    series = [s for s in series if s["id"] != series_id]
    save_series(series)
    return {"ok": True, "deleted": series_id, "photos_moved": moved}


# ─── 启动入口 ───────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
