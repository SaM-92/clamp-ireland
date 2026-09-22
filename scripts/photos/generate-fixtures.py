"""Optional fixture regeneration: py -m pip install pillow pillow-heif."""
from pathlib import Path
from PIL import Image, ImageDraw
import pillow_heif

destination = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "photos"
destination.mkdir(parents=True, exist_ok=True)
image = Image.new("RGB", (96, 64), "#184080")
ImageDraw.Draw(image).rectangle((0, 0, 31, 63), fill="#df3827")
pillow_heif.from_pillow(image).save(destination / "synthetic.heic", quality=85)
image.save(destination / "animated.webp", save_all=True,
           append_images=[Image.new("RGB", image.size, "#49a244")], duration=100, loop=0)
large = Image.new("RGB", (8000, 8000), "#184080")
pillow_heif.from_pillow(large).save(destination / "64mp.heic", quality=50,
                                   enc_params={"preset": "ultrafast", "x265:pools": "1", "x265:frame-threads": "1"})
