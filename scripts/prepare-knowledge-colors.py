"""Render reviewed official vector signs; never recolor the original manual."""

import hashlib
import json
import shutil
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/knowledge-ja"
URL = "https://www.mlit.go.jp/road/sign/sign/douro/ichiran.pdf"
SOURCE_SHA256 = "ea44489d2449ec7577efe8d31f8f939db79184602078695936d4664408d81853"

# (original image ID, national sign code, poster region, row, column).
# The manual's numbered examples are not national sign codes. Numeric,
# text-heavy, combined and direction-variant signs require separate review.
MATCHES = [
    ("p097-image00", "301", "reg", 0, 0),
    ("p097-image01", "302", "reg", 0, 1),
    ("p097-image02", "303", "reg", 0, 2),
    ("p097-image03", "304", "reg", 0, 3),
    ("p097-image04", "305", "reg", 0, 4),
    ("p097-image06", "306", "reg", 0, 5),
    ("p098-image00", "307", "reg", 0, 6),
    ("p098-image01", "308", "reg", 0, 7),
    ("p098-image02", "309", "reg", 0, 8),
    ("p098-image03", "310", "reg", 0, 9),
    ("p098-image04", "310の2", "reg", 0, 10),
    ("p098-image05", "310の3", "reg", 0, 11),
    ("p099-image00", "312", "reg", 1, 6),
    ("p099-image01", "313", "reg", 1, 7),
    ("p099-image02", "314", "reg", 1, 8),
    ("p099-image04", "315", "reg", 1, 9),
    ("p099-image05", "316", "reg", 1, 10),
    ("p100-image01", "319", "reg", 2, 0),
    ("p101-image01", "325", "reg", 2, 6),
    ("p101-image02", "325の2", "reg", 2, 7),
    ("p101-image03", "325の3", "reg", 2, 8),
    ("p102-image00", "325の4", "reg", 2, 9),
    ("p102-image01", "325の5-A", "reg", 2, 10),
    ("p102-image02", "325の5-B", "reg", 2, 11),
    ("p102-image03", "325の5-C", "reg", 3, 0),
    ("p102-image04", "325の6", "reg", 3, 1),
    ("p102-image05", "325の7", "reg", 3, 2),
    ("p104-image02", "327の8", "reg", 4, 6),
    ("p104-image03", "327の9", "reg", 4, 7),
    ("p104-image04", "327の10", "reg", 4, 8),
    ("p104-image05", "327の11", "reg", 4, 9),
    ("p105-image00", "327の12", "reg", 4, 10),
    ("p105-image01", "327の13", "reg", 4, 11),
    ("p105-image02", "328", "reg", 5, 0),
    ("p107-image01", "401", "instruction", 0, 0),
    ("p107-image02", "402", "instruction", 0, 1),
    ("p107-image04", "403", "instruction", 0, 2),
    ("p108-image01", "404", "instruction", 1, 0),
    ("p108-image02", "405", "instruction", 1, 1),
    ("p108-image03", "406", "instruction", 1, 2),
    ("p108-image04", "406の2", "instruction", 2, 0),
    ("p108-image06", "407の2", "instruction", 3, 0),
    ("p108-image07", "407の3", "instruction", 3, 1),
    ("p109-image00", "408", "instruction", 3, 2),
    ("p123-image04", "201-A", "warning", 0, 0),
    ("p123-image05", "201-B", "warning", 0, 1),
    ("p123-image06", "201-C", "warning", 0, 2),
    ("p124-image00", "201-D", "warning", 0, 3),
    ("p124-image01", "201の2", "warning", 0, 4),
    ("p124-image02", "202", "warning", 1, 0),
    ("p124-image03", "203", "warning", 1, 1),
    ("p124-image04", "204", "warning", 1, 2),
    ("p124-image05", "205", "warning", 1, 3),
    ("p124-image06", "206", "warning", 1, 4),
    ("p125-image01", "208", "warning", 2, 2),
    ("p125-image02", "208の2", "warning", 2, 3),
    ("p125-image03", "209", "warning", 2, 4),
    ("p125-image04", "209の2", "warning", 3, 0),
    ("p125-image05", "209の3", "warning", 3, 1),
    ("p125-image06", "210", "warning", 3, 2),
    ("p125-image07", "211", "warning", 3, 3),
    ("p126-image00", "212", "warning", 3, 4),
    ("p126-image01", "212の2", "warning", 4, 0),
    ("p126-image04", "213", "warning", 4, 3),
    ("p126-image05", "214", "warning", 4, 4),
    ("p126-image06", "214の2", "warning", 5, 0),
    ("p126-image07", "215", "warning", 5, 1),
]


def crop(region, row, column):
    if region == "warning":
        x, y = 65.74 + column * 42.216, 494.68 + row * 57.66
        return fitz.Rect(x - 18.5, y - 18.5, x + 18.5, y + 18.5)
    if region == "instruction":
        x, y = 870 + column * 42.99, 494.19 + row * 58.22
        return fitz.Rect(x - 18.4, y - 18.4, x + 18.4, y + 18.4)
    x = [284.515, 333.345, 382.245, 431.455, 480.045, 528.945,
         577.84, 626.715, 675.635, 724.575, 773.475, 822.63][column]
    if row == 4 and column in [6, 7]:
        return fitz.Rect(x - 18.4, 708.5, x + 18.4, 744.8)
    y = [493.75, 551.87, 610.27, 668.65, 725.6, 785.185][row]
    return fitz.Rect(x - 18.6, y - 18.6, x + 18.6, y + 18.6)


def prepare():
    source = DATA / "color-source.pdf"
    if not source.exists():
        cached = ROOT / "output/pdf-research/mlit-color-signs.pdf"
        if not cached.exists():
            raise ValueError(f"Download {URL} to {source} first; imports do not fetch changing sources implicitly.")
        shutil.copyfile(cached, source)
    raw = source.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SOURCE_SHA256, "Unreviewed color source PDF"
    doc = fitz.open(stream=raw, filetype="pdf")
    assert len(doc) == 1
    lessons = json.loads((DATA / "lessons.json").read_text(encoding="utf-8"))
    images = {image["id"]: (image, cell) for article in lessons["articles"] for block in article["blocks"]
              if block["kind"] == "table" for cell in block["cells"] for image in cell["images"]}
    target = DATA / "colors"
    target.mkdir(exist_ok=True)
    records = []
    sheet = Image.new("RGB", (900, ((len(MATCHES) + 3) // 4) * 145), "white")
    draw = ImageDraw.Draw(sheet)
    for index, (identity, code, region, row, column) in enumerate(MATCHES):
        image, cell = images[identity]
        rect = crop(region, row, column)
        pixmap = doc[0].get_pixmap(matrix=fitz.Matrix(14, 14), clip=rect, alpha=False)
        data = pixmap.tobytes("png")
        sha = hashlib.sha256(data).hexdigest()
        (target / f"{sha}.png").write_bytes(data)
        records.append({"imageId": identity, "originalSha256": Path(image["path"]).stem,
                        "name": "".join(p["text"] for p in cell["paragraphs"]).strip(),
                        "code": code, "crop": list(rect), "path": f"knowledge-ja/colors/{sha}.png",
                        "sha256": sha, "width": pixmap.width, "height": pixmap.height})
        x, y = index % 4 * 225, index // 4 * 145
        draw.text((x + 4, y + 2), f"{identity} / {code}", fill="black")
        for offset, file in [(3, ROOT / "data" / image["path"]), (115, target / f"{sha}.png")]:
            thumb = Image.open(file).convert("RGB")
            thumb.thumbnail((105, 110))
            sheet.paste(thumb, (x + offset + (105 - thumb.width) // 2, y + 22))
    sheet.save(ROOT / "output/pdf-research/color-contact-sheet.png")
    manifest = {"version": 1, "source": {"url": URL, "sha256": hashlib.sha256(raw).hexdigest(),
        "publisher": "MLIT", "rightsUrl": "https://www.mlit.go.jp/road/soudan/soudan_04a_04.html",
        "method": "Official reference illustrations of the reviewed same sign type/direction; not recolored PDF originals. Unmatched numeric/combined/unreviewed variants remain original."}, "images": records}
    (DATA / "color-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(records)} official color sign illustrations and a review contact sheet.")


if __name__ == "__main__":
    prepare()
