from base64 import b64encode
from hashlib import sha256
from io import BytesIO

from PIL import Image

from src.preprocessing.pipeline import ImageAsset
from src.utils.config import Settings


def encode_for_api(rgb, settings: Settings):
    im = Image.fromarray(rgb)
    im.thumbnail((settings.max_image_side, settings.max_image_side), Image.Resampling.LANCZOS)
    out = BytesIO()
    im.save(out, format="PNG")
    data, mime = out.getvalue(), "image/png"
    # PNG keeps line art intact if small enough. Otherwise reduce cautiously.
    if len(data) > settings.max_image_bytes:
        mime = "image/jpeg"
        for _ in range(8):
            out = BytesIO()
            im.save(out, format="JPEG", quality=92, subsampling=0)
            data = out.getvalue()
            if len(data) <= settings.max_image_bytes:
                break
            im = im.resize((int(im.width * 0.85), int(im.height * 0.85)), Image.Resampling.LANCZOS)
        else:
            raise ValueError("图片压缩后仍过大，请手动裁切或减少图片")
    return data, mime, im.size


def image_content(assets: list[ImageAsset], settings: Settings, variants: str = "both"):
    if variants not in {"original", "enhanced", "both"}:
        raise ValueError("未知模型输入图像模式")
    content, manifest = [], []
    total = 0
    for asset in assets:
        views = [("original", asset.original), ("enhanced", asset.enhanced)]
        if variants != "both":
            views = [(name, rgb) for name, rgb in views if name == variants]
        for variant, rgb in views:
            data, mime, (width, height) = encode_for_api(rgb, settings)
            encoded = b64encode(data).decode("ascii")
            total += len(encoded)
            if total > settings.max_request_bytes:
                raise ValueError("本次图像总量超过请求预算，请减少图片、分辨率或输入版本")
            content.extend([
                {"type": "text", "text": f"role={asset.role}; image_id={asset.image_id}; variant={variant}"},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
            ])
            manifest.append({"role": asset.role, "image_id": asset.image_id, "variant": variant,
                             "mime": mime, "bytes": len(data), "width": width, "height": height,
                             "source_sha256": asset.quality.source_sha256,
                             "sha256": sha256(data).hexdigest()})
    return content, manifest
