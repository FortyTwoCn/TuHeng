from io import BytesIO

import cv2
import numpy as np
import pytest
from PIL import Image, ImageDraw

from src.preprocessing.pipeline import (
    ImageInputError,
    PreprocessOptions,
    decode_image,
    png_bytes,
    process_image,
    warp_quad,
)
from tests.conftest import ROOT


def test_opencv_perspective_correction():
    paper = np.full((300, 400, 3), 255, np.uint8)
    cv2.line(paper, (100, 40), (100, 260), (0, 0, 0), 3)
    cv2.line(paper, (30, 150), (370, 150), (0, 0, 0), 3)
    src = np.array([[0, 0], [399, 0], [399, 299], [0, 299]], np.float32)
    dst = np.array([[80, 30], [495, 75], [455, 425], [25, 365]], np.float32)
    warped = cv2.warpPerspective(paper, cv2.getPerspectiveTransform(src, dst), (550, 450), borderValue=(50, 50, 50))
    corrected = warp_quad(warped, dst)
    normalized = cv2.resize(corrected, (400, 300))
    # Known cross recovered near its geometrically expected location.
    assert normalized[130:170, 98:103].mean() < 90
    assert normalized[148:153, 60:340].mean() < 90
    assert np.abs(normalized.astype(float) - paper).mean() < 8


def test_auto_perspective_detects_large_paper():
    data = (ROOT / "sample_data/perspective_photo.png").read_bytes()
    result = process_image(data, "student", "s", PreprocessOptions(auto_deskew=False))
    assert result.quality.perspective_status == "auto_corrected"
    assert result.corrected.shape[0] < result.original.shape[0]
    assert result.corrected.shape[1] < result.original.shape[1]
    assert result.source_bytes == data


@pytest.mark.parametrize("crop", [(100, 100, 20, 20), (-1, 0, 100, 100), (0, 0, 9999, 9999), (0, 0, 2, 2)])
def test_crop_failure_falls_back_to_original(crop):
    im = np.full((160, 200, 3), 245, np.uint8)
    result = process_image(png_bytes(im), "student", "s", PreprocessOptions(crop=crop, auto_deskew=False))
    assert result.quality.perspective_status == "fallback_original"
    assert result.quality.failure_reason
    assert np.array_equal(result.original, result.corrected)


def test_no_border_keeps_complete_drawing():
    im = Image.new("RGB", (400, 300), "white")
    draw = ImageDraw.Draw(im)
    draw.rectangle((80, 70, 320, 230), outline="black", width=1)
    draw.line((2, 20, 398, 20), fill=(180, 180, 180), width=1)
    result = process_image(png_bytes(np.array(im)), "student", "s", PreprocessOptions(auto_deskew=False))
    assert result.quality.perspective_status == "fallback_original"
    assert np.array_equal(result.corrected, result.original)


def test_thin_dashed_and_dash_dot_lines_are_preserved():
    im = Image.new("RGB", (420, 260), "white")
    d = ImageDraw.Draw(im)
    d.line((5, 25, 414, 25), fill=(190, 190, 190), width=1)
    d.line((30, 6, 30, 254), fill=(145, 145, 145), width=1)
    for x in range(8, 400, 20):
        d.line((x, 100, x+9, 100), fill=(175, 175, 175), width=1)
        d.line((x, 160, x+8, 160), fill=(200, 200, 200), width=1)
        d.point((x+13, 160), fill=(200, 200, 200))
    original = np.array(im)
    result = process_image(png_bytes(original), "student", "s",
                           PreprocessOptions(auto_perspective=False, auto_deskew=False))
    strokes = original[:, :, 0] < 220
    assert np.mean(result.enhanced[:, :, 0][strokes] <= original[:, :, 0][strokes] + 10) > 0.99
    assert result.quality.thin_line_retention_reference > 0.99
    assert np.array_equal(original, result.original)


def test_invalid_manual_quad_falls_back():
    image = np.full((200, 200, 3), 255, np.uint8)
    corners = ((10.0, 10.0), (11.0, 10.0), (12.0, 10.0), (10.0, 10.0))
    result = process_image(png_bytes(image), "student", "s", PreprocessOptions(corners=corners, auto_deskew=False))
    assert result.quality.perspective_status == "fallback_original"
    assert np.array_equal(result.corrected, image)


def test_manual_crop_and_rotation():
    image = np.full((200, 300, 3), 255, np.uint8)
    result = process_image(png_bytes(image), "question", "q", PreprocessOptions(crop=(10, 20, 210, 170), rotation=90, auto_deskew=False))
    assert result.corrected.shape[:2] == (200, 150)
    assert result.quality.perspective_status == "manual_crop"


@pytest.mark.parametrize("data", [b"", b"not an image", b"%PDF-1.5"])
def test_invalid_input(data):
    with pytest.raises(ImageInputError):
        decode_image(data)


def test_mime_is_checked_by_content_and_transparency_is_white():
    image = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
    buffer = BytesIO()
    image.save(buffer, "PNG")
    rgb, _ = decode_image(buffer.getvalue())
    assert rgb.min() == 255
    buffer = BytesIO()
    image.convert("RGB").save(buffer, "GIF")
    with pytest.raises(ImageInputError):
        decode_image(buffer.getvalue())


def test_exif_orientation():
    image = Image.new("RGB", (100, 60), "white")
    exif = Image.Exif()
    exif[274] = 6
    buffer = BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    rgb, rotated = decode_image(buffer.getvalue())
    assert rotated and rgb.shape[:2] == (100, 60)
