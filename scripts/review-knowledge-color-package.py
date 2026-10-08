"""Re-extract selected references from the pinned official vector poster."""

import hashlib
import json
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/incoming/reviewed-colors"
OUTPUT.mkdir(exist_ok=True)
SOURCE = ROOT / "data/knowledge-ja/color-source.pdf"
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == "ea44489d2449ec7577efe8d31f8f939db79184602078695936d4664408d81853"
page = fitz.open(SOURCE)[0]
drawings = page.get_drawings()
windows = {
    "p112-image10": [44, 85, 103, 135],
    "p113-image02": [320, 85, 372, 146],
    "p113-image03": [380, 85, 441, 146],
    "p113-image04": [449, 85, 502, 146],
    "p113-image06": [761, 85, 839, 146],
    "p115-image03": [929, 153, 1000, 207],
    "p115-image05": [1090, 153, 1152, 210],
    "p116-image01": [245, 219, 304, 283],
    "p116-image06": [795, 219, 869, 283],
    "p120-image00": [45, 362, 103, 409],
    "p120-image01": [104, 362, 160, 409],
    "p120-image02": [164, 362, 218, 409],
    "p120-image03": [218, 362, 273, 409],
    "p120-image04": [278, 362, 333, 409],
    "p120-image05": [334, 362, 396, 409],
    "p121-image01": [629, 360, 688, 415],
    "p121-image02": [690, 358, 748, 413],
}
rects = {"p118-image01": [409.9, 296.7, 436.4, 336.7],
         "p119-image01": [741.3, 291.6, 787.6, 309.0],
         "p115-image06": [53.2, 228.4, 102.3, 264.5],
         "p115-image07": [115.1, 228.4, 171.5, 264.5],
         "p116-image00": [190.0, 228.4, 239.1, 268.5]}
for identity, window in windows.items():
    region = fitz.Rect(window)
    candidates = [drawing["rect"] for drawing in drawings if region.contains(drawing["rect"])
                  and drawing["rect"].width > 15 and drawing["rect"].height > 10
                  and drawing["rect"].get_area() > 300]
    assert candidates, identity
    rect = fitz.Rect(max(candidates, key=lambda rect: rect.get_area()))
    # Some examples have separate adjoining header/arrow panels. Include all
    # touching panels, not only the largest rectangle (which loses labels).
    while True:
        before = tuple(rect)
        for candidate in candidates:
            if (rect + (-1, -1, 1, 1)).intersects(candidate):
                rect |= candidate
        if tuple(rect) == before:
            break
    rects[identity] = list(rect + (-.3, -.3, .3, .3))
records = []
incoming = json.loads((ROOT / "output/incoming/mirai-menkyo-locale-package/data/knowledge-ja/color-applied-manifest.json").read_text(encoding="utf8"))
assert set(rects).issubset({image["imageId"] for image in incoming["images"]})
for identity, rect in rects.items():
    pixmap = page.get_pixmap(matrix=fitz.Matrix(14, 14), clip=fitz.Rect(rect), alpha=False)
    raw = pixmap.tobytes("png")
    sha256 = hashlib.sha256(raw).hexdigest()
    (OUTPUT / f"{sha256}.png").write_bytes(raw)
    records.append({"imageId": identity, "path": f"knowledge-ja/colors/{sha256}.png", "sha256": sha256,
                    "width": pixmap.width, "height": pixmap.height, "crop": rect,
                    "sourceUrl": "https://www.mlit.go.jp/road/sign/sign/douro/ichiran.pdf",
                    "rightsUrl": "https://www.mlit.go.jp/road/soudan/soudan_04a_04.html"})
(OUTPUT / "manifest.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf8")
print(f"Rendered {len(records)} clean source crops for visual review; not applied automatically.")
