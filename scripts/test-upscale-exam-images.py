import importlib.util
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("upscale", Path(__file__).with_name("upscale-exam-images.py"))
upscale = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upscale)


class ContentValidationTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.new("RGB", (80, 64), (40, 90, 170))
        draw = ImageDraw.Draw(self.source)
        draw.rectangle((10, 10, 35, 50), fill=(230, 40, 30))
        draw.line((5, 60, 75, 5), fill=(0, 0, 0), width=3)

    def test_accepts_complete_opaque_image(self):
        candidate = self.source.resize((320, 256), Image.Resampling.LANCZOS)
        metrics = upscale.validate_upscale(self.source, candidate, 4)
        self.assertEqual(metrics["alpha_max_error"], 0)

    def test_rejects_blank_image(self):
        with self.assertRaisesRegex(ValueError, "blank"):
            upscale.validate_upscale(self.source, Image.new("RGB", (320, 256), "white"), 4)

    def test_rejects_invisible_opaque_image(self):
        candidate = self.source.resize((320, 256)).convert("RGBA")
        candidate.putalpha(0)
        with self.assertRaisesRegex(ValueError, "Alpha"):
            upscale.validate_upscale(self.source, candidate, 4)

    def test_rejects_only_last_strip_visible(self):
        candidate = self.source.resize((320, 256)).convert("RGBA")
        alpha = Image.new("L", candidate.size, 0)
        ImageDraw.Draw(alpha).rectangle((280, 0, 319, 255), fill=255)
        candidate.putalpha(alpha)
        with self.assertRaisesRegex(ValueError, "Alpha"):
            upscale.validate_upscale(self.source, candidate, 4)

    def test_rejects_local_missing_region(self):
        source = Image.new("RGB", (80, 64), "white")
        ImageDraw.Draw(source).rectangle((0, 0, 9, 7), fill="black")
        candidate = source.resize((320, 256), Image.Resampling.NEAREST)
        ImageDraw.Draw(candidate).rectangle((0, 0, 39, 31), fill="white")
        # Keep another tiny mark: this must be caught by per-region checks.
        ImageDraw.Draw(candidate).rectangle((310, 246, 319, 255), fill="black")
        with self.assertRaisesRegex(ValueError, "region"):
            upscale.validate_upscale(source, candidate, 4)

    def test_preserves_transparent_mask(self):
        source = self.source.convert("RGBA")
        alpha = Image.new("L", source.size, 0)
        ImageDraw.Draw(alpha).rectangle((8, 8, 70, 55), fill=255)
        source.putalpha(alpha)
        rgb = upscale.white_rgb(source).resize((320, 256), Image.Resampling.LANCZOS)
        candidate = upscale.restore_alpha(source, rgb, 4)
        self.assertEqual(candidate.getchannel("A").tobytes(), alpha.resize(candidate.size, Image.Resampling.LANCZOS).tobytes())
        upscale.validate_upscale(source, candidate, 4)

    def test_rejects_invisible_transparent_content(self):
        source = self.source.convert("RGBA")
        source.putalpha(200)
        candidate = source.resize((320, 256))
        candidate.putalpha(0)
        with self.assertRaisesRegex(ValueError, "Alpha"):
            upscale.validate_upscale(source, candidate, 4)

    def test_accepts_original_blank_image(self):
        source = Image.new("RGB", (80, 64), "white")
        upscale.validate_upscale(source, source.resize((320, 256)), 4)

    def test_rejects_wrong_dimensions(self):
        with self.assertRaisesRegex(ValueError, "dimensions"):
            upscale.validate_upscale(self.source, self.source.copy(), 4)


if __name__ == "__main__":
    unittest.main()
