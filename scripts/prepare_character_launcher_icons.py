#!/usr/bin/env python3
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "public" / "danduli-stickers-v3-clean.webp"
OUT_DIR = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable"
GRID = 4
CANVAS = 512
ART_MAX = 424
ICONS = {
    "danduli_character_love.webp": (3, 3),
    "danduli_character_date.webp": (2, 2),
}

def crop_cell(sheet: Image.Image, row: int, col: int) -> Image.Image:
    width, height = sheet.size
    left = round(col * width / GRID)
    right = round((col + 1) * width / GRID)
    top = round(row * height / GRID)
    bottom = round((row + 1) * height / GRID)
    return sheet.crop((left, top, right, bottom)).convert("RGBA")

def transparent_art(cell: Image.Image) -> Image.Image:
    alpha = cell.getchannel("A")
    lo, hi = alpha.getextrema()
    if lo == 255 and hi == 255:
        raise RuntimeError("Clean DANDULI sticker sheet lost transparency")
    mask = alpha.point(lambda value: 255 if value > 8 else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise RuntimeError("Character cell has no visible pixels")
    return cell.crop(bbox)

def launcher_canvas(art: Image.Image) -> Image.Image:
    scale = min(ART_MAX / art.width, ART_MAX / art.height)
    size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    resized = art.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - resized.width) // 2
    y = (CANVAS - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas

def main() -> None:
    if not SHEET.exists():
        raise FileNotFoundError(SHEET)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEET).convert("RGBA")
    for filename, (row, col) in ICONS.items():
        canvas = launcher_canvas(transparent_art(crop_cell(sheet, row, col)))
        if canvas.getpixel((0, 0))[3] != 0:
            raise RuntimeError(f"{filename}: launcher corner is not transparent")
        output = OUT_DIR / filename
        canvas.save(output, "WEBP", lossless=True, quality=100, method=6)
        print(f"Prepared transparent launcher icon: {output.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
