"""Conservative, non-generative image transforms; RGB arrays throughout."""
import warnings
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import Literal

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import Field

from src.schemas.models import ImageQuality, StrictModel

Role = Literal["question", "reference", "student"]
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 24_000_000


class ImageInputError(ValueError):
    pass


class PreprocessOptions(StrictModel):
    auto_perspective: bool = True
    auto_deskew: bool = True
    rotation: Literal[0, 90, 180, 270] = 0
    # Coordinates are in the EXIF-oriented original image, before any other operation.
    crop: tuple[int, int, int, int] | None = None
    corners: tuple[tuple[float, float], tuple[float, float], tuple[float, float], tuple[float, float]] | None = None
    clahe: bool = True
    denoise: bool = True
    sharpen: float = Field(default=0.25, ge=0, le=1.5)
    brightness: float = Field(default=1.0, ge=0.7, le=1.3)


@dataclass
class ImageAsset:
    image_id: str
    role: Role
    source_bytes: bytes
    original: np.ndarray
    corrected: np.ndarray
    enhanced: np.ndarray
    quality: ImageQuality

    @property
    def fingerprint(self):
        h = sha256(self.role.encode() + self.source_bytes)
        h.update(self.corrected.tobytes())
        h.update(self.enhanced.tobytes())
        return h.hexdigest()


def decode_image(data: bytes) -> tuple[np.ndarray, bool]:
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise ImageInputError("图片为空或超过 20 MiB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as im:
                if im.format not in {"PNG", "JPEG"}:
                    raise ImageInputError("仅支持真实的 JPG/JPEG/PNG 图片")
                if im.width * im.height > MAX_PIXELS or min(im.size) < 32:
                    raise ImageInputError("图片尺寸必须至少 32×32，且不超过 2400 万像素")
                orientation = im.getexif().get(274, 1)
                oriented = ImageOps.exif_transpose(im).convert("RGBA")
                white = Image.new("RGBA", oriented.size, "white")
                white.alpha_composite(oriented)
                return np.array(white.convert("RGB")), orientation != 1
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ImageInputError(f"图片解码失败：{type(exc).__name__}") from exc


def order_quad(points):
    pts = np.asarray(points, np.float32).reshape(4, 2)
    center = pts.mean(axis=0)
    pts = pts[np.argsort(np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0]))]
    return np.roll(pts, -np.argmin(pts.sum(axis=1)), axis=0)


def validate_quad(points, shape):
    pts = order_quad(points)
    h, w = shape[:2]
    if not np.isfinite(pts).all() or (pts < 0).any() or (pts[:, 0] >= w).any() or (pts[:, 1] >= h).any():
        raise ValueError("四角坐标越界")
    if not cv2.isContourConvex(pts.astype(np.int32)) or abs(cv2.contourArea(pts)) < 0.05 * h * w:
        raise ValueError("四角不构成足够大的凸四边形")
    if np.min(np.linalg.norm(pts - np.roll(pts, 1, axis=0), axis=1)) < 25:
        raise ValueError("四边形边长过短")
    return pts


def warp_quad(rgb, points):
    tl, tr, br, bl = validate_quad(points, rgb.shape)
    w = round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    h = round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    dest = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], np.float32)
    transform = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl]), dest)
    return cv2.warpPerspective(rgb, transform, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


def detect_paper(rgb):
    """Require a large convex border, bright interior and supporting contrast.

    No content bounding-box crop: a small drawing rectangle is never sufficient.
    """
    h, w = rgb.shape[:2]
    scale = min(1.0, 1200 / max(h, w))
    small = cv2.resize(rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 35, 110)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:30]:
        quad = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        if len(quad) != 4 or not cv2.isContourConvex(quad):
            continue
        ratio = abs(cv2.contourArea(quad)) / gray.size
        if not 0.42 <= ratio <= 0.985:
            continue
        mask = np.zeros_like(gray)
        cv2.fillConvexPoly(mask, quad.reshape(4, 2), 255)
        # Erode only the detection mask; never erode drawing pixels.
        inside = cv2.erode(mask, np.ones((7, 7), np.uint8)) > 0
        outside = cv2.dilate(mask, np.ones((15, 15), np.uint8)) == 0
        if not outside.any() or gray[inside].mean() < 130:
            continue
        if gray[inside].mean() - gray[outside].mean() < 15:
            continue
        pts = order_quad(quad.reshape(4, 2) / scale)
        try:
            return validate_quad(pts, rgb.shape), None
        except ValueError:
            continue
    return None, "未发现同时满足面积、凸性和内外亮度差的可靠纸张外框；保留原图，可手动裁切/选四角"


def deskew(rgb):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    scale = min(1.0, 1600 / max(gray.shape))
    gray = cv2.resize(gray, None, fx=scale, fy=scale)
    lines = cv2.HoughLinesP(cv2.Canny(gray, 50, 150), 1, np.pi / 1800, 80,
                            minLineLength=max(40, gray.shape[1] // 5), maxLineGap=12)
    if lines is None:
        return rgb.copy(), "方向不确定；未自动旋转，可手动旋转 90/180/270°"
    angles = []
    for x1, y1, x2, y2 in lines[:, 0]:
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(angle) < 6:
            angles.append(angle)
    if len(angles) < 6 or np.std(angles) > 0.5:
        return rgb.copy(), "水平线证据不足或方向分散；未自动旋转"
    angle = float(np.median(angles))
    if abs(angle) < 0.35:
        return rgb.copy(), "水平倾斜小于 0.35°；上下方向仍需用户确认"
    h, w = rgb.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1)
    cosine, sine = abs(matrix[0, 0]), abs(matrix[0, 1])
    nw, nh = int(h * sine + w * cosine), int(h * cosine + w * sine)
    matrix[0, 2] += (nw - w) / 2
    matrix[1, 2] += (nh - h) / 2
    return cv2.warpAffine(rgb, matrix, (nw, nh), flags=cv2.INTER_CUBIC,
                          borderValue=(255, 255, 255)), f"按一致水平线轻度纠偏 {angle:.2f}°；上下方向需确认"


def enhance(rgb, opts):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    work = rgb.copy()
    if opts.clahe:
        lab = cv2.cvtColor(work, cv2.COLOR_RGB2LAB)
        lab[:, :, 0] = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(lab[:, :, 0])
        work = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    if opts.denoise:
        # Gentle bilateral blend, avoiding median filters and morphology on lines.
        filtered = cv2.bilateralFilter(work, 3, 12, 12)
        work = cv2.addWeighted(work, 0.8, filtered, 0.2, 0)
    if opts.sharpen:
        blur = cv2.GaussianBlur(work, (0, 0), 0.8)
        work = cv2.addWeighted(work, 1 + opts.sharpen, blur, -opts.sharpen, 0)
    work = np.clip(work.astype(np.float32) * opts.brightness, 0, 255).astype(np.uint8)
    # Preserve faint/dark strokes pointwise. This does not create any new geometry.
    background = cv2.GaussianBlur(gray, (0, 0), 5)
    stroke = gray.astype(np.int16) < background.astype(np.int16) - 8
    work[stroke] = np.minimum(work[stroke], rgb[stroke])
    after = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY)
    retention = float(np.mean(after[stroke] <= gray[stroke] + 15)) if stroke.any() else 1.0
    return work, retention


def process_image(data: bytes, role: Role, image_id: str, options: PreprocessOptions | None = None):
    if role not in {"question", "reference", "student"}:
        raise ImageInputError("未知图片角色")
    opts = options or PreprocessOptions()
    original, exif_rotated = decode_image(data)
    corrected = original.copy()
    logs, notes = [], []
    status, failure = "disabled", None
    try:
        if opts.crop is not None and opts.corners is not None:
            raise ValueError("裁切与选四角不能同时使用")
        if opts.corners is not None:
            corrected = warp_quad(original, opts.corners)
            status = "manual_four_corners"
        elif opts.crop is not None:
            left, top, right, bottom = opts.crop
            h, w = original.shape[:2]
            if not (0 <= left < right <= w and 0 <= top < bottom <= h and right-left >= 32 and bottom-top >= 32):
                raise ValueError("裁切坐标无效，必须位于原图内且至少 32×32")
            corrected = original[top:bottom, left:right].copy()
            status = "manual_crop"
        elif opts.auto_perspective:
            points, failure = detect_paper(original)
            if points is not None:
                corrected = warp_quad(original, points)
                status = "auto_corrected"
                notes.append("自动纸张边框仍需核对；若边缘标注丢失请关闭自动透视")
            else:
                status = "fallback_original"
    except (ValueError, cv2.error) as exc:
        corrected = original.copy()
        status, failure = "fallback_original", str(exc)
    logs.append(f"透视/裁切状态：{status}")
    if failure:
        logs.append(failure)
    if opts.rotation:
        corrected = np.rot90(corrected, -(opts.rotation // 90)).copy()
        logs.append(f"手动顺时针旋转 {opts.rotation}°")
    orientation = "仅执行 EXIF 方向校正；绘图上下方向不确定" if exif_rotated else "无可靠 EXIF 方向；绘图上下方向不确定"
    if opts.auto_deskew:
        corrected, orientation_note = deskew(corrected)
        orientation += "; " + orientation_note
    logs.append(orientation)
    enhanced, retention = enhance(corrected, opts)
    gray = cv2.cvtColor(original, cv2.COLOR_RGB2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if sharpness < 45:
        notes.append("清晰度参考值较低；该阈值非识别准确率，请检查细线与标注")
    if np.std(gray) < 10:
        notes.append("图像对比度很低或内容接近空白")
    if retention < 0.98:
        notes.append("增强可能损伤细线，建议使用原图与增强图共同判断")
    notes.append("细线指标只比较矫正图与增强图，无法保证透视、压缩及缩放后的细线均保留")
    logs.append(f"CLAHE={opts.clahe}; 轻去噪={opts.denoise}; 锐化={opts.sharpen}; 亮度={opts.brightness}")
    logs.append("锐化不恢复真实细节；未使用生成式修复、图线擦除或自动内容裁边")
    quality = ImageQuality(
        image_id=image_id, role=role, source_sha256=sha256(data).hexdigest(),
        original_width=original.shape[1], original_height=original.shape[0],
        processed_width=enhanced.shape[1], processed_height=enhanced.shape[0], sharpness_reference=sharpness,
        mean_brightness=float(gray.mean()), perspective_status=status, failure_reason=failure,
        orientation_status=orientation, thin_line_retention_reference=retention, warnings=notes, logs=logs,
    )
    return ImageAsset(image_id, role, data, original, corrected, enhanced, quality)


def png_bytes(rgb):
    out = BytesIO()
    Image.fromarray(rgb).save(out, format="PNG")
    return out.getvalue()
