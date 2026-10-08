"""Verify imported characters and illustration placements against the untouched PDF."""

import collections
import hashlib
import json
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "knowledge-ja"
dataset = json.loads((DATA / "lessons.json").read_text(encoding="utf-8"))
original = (DATA / "source.pdf").read_bytes()
assert hashlib.sha256(original).hexdigest() == dataset["source"]["sha256"]
document = fitz.open(stream=original, filetype="pdf")
assert len(document) == dataset["source"]["pages"] == 148
assert dataset["source"]["newerAmendmentsApplied"] is False
expected, footer_ids, original_images, geometry = {}, set(), {}, {}
for page_index, page in enumerate(document):
    index = 0
    for block in page.get_text("rawdict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                for char in span["chars"]:
                    identity = f"p{page_index + 1:03d}-c{index:05d}"
                    index += 1
                    if char["bbox"][1] > 780:
                        footer_ids.add(identity)
                    else:
                        expected[identity] = char["c"]
                        geometry[identity] = {"page": page_index + 1, "x": char["bbox"][0],
                                              "y": char["origin"][1], "bbox": char["bbox"], "size": span["size"]}
    for image_index, image in enumerate(page.get_image_info(xrefs=True)):
        pixmap = fitz.Pixmap(document, image["xref"])
        original_images[f"p{page_index + 1:03d}-image{image_index:02d}"] = {
            "sha256": hashlib.sha256(pixmap.tobytes("png")).hexdigest(), "bbox": list(image["bbox"]),
            "page": page_index + 1, "size": (pixmap.width, pixmap.height),
        }

actual, images, pages, table_count, ruby_count = {}, [], set(), 0, 0
fragments, all_paragraphs, logical_tables = {}, [], []


def check_paragraph(block):
    global ruby_count
    assert block["text"] == "".join(run["text"] for run in block["runs"])
    all_paragraphs.append(block)
    base_ids = [identity for run in block["runs"] for identity in run["ids"]]
    lines = block["source"]["lines"]
    assert base_ids == [identity for line in lines for identity in line["ids"]], "Paragraph reading order changed"
    previous_line = None
    for line in lines:
        coords = [geometry[identity] for identity in line["ids"]]
        assert all(item["page"] == line["page"] and abs(item["y"] - line["y"]) < .11 for item in coords)
        assert [item["x"] for item in coords] == sorted(item["x"] for item in coords), "Line not read left-to-right"
        key = (line["page"], line["y"])
        assert previous_line is None or key > previous_line, "Lines/pages read out of order"
        previous_line = key
    for run in block["runs"]:
        for text, ids in [(run["text"], run["ids"]), (run.get("reading", ""), run.get("readingIds", []))]:
            assert len(text) == len(ids)
            for identity, char in zip(ids, text):
                assert identity not in actual, f"Repeated source character {identity}"
                assert expected[identity] == char, f"Changed source character {identity}"
                actual[identity] = char
        if run.get("reading"):
            ruby_count += 1
            assert run["reading"] != "\u3051\u3093\u3051\u3093", "Two separate furigana annotations were merged"


def check_image(image, cell=None):
    original = original_images[image["id"]]
    assert image["sourcePage"] == original["page"]
    assert image["bbox"] == original["bbox"]
    assert (image["width"], image["height"]) == original["size"]
    assert Path(image["path"]).stem == original["sha256"]
    if cell:
        rect = fitz.Rect(image["bbox"])
        assert fitz.Rect(cell["bbox"]).contains((rect.tl + rect.br) / 2), "Image associated with the wrong table cell"
    images.append(image["id"])


article_ids, block_ids = [], []
for article in dataset["articles"]:
    assert article["locale"] == "ja" and article["format"] == "pdf-lessons-v1"
    assert article["title"].strip()
    article_ids.append(article["id"])
    for block in article["blocks"]:
        block_ids.append(block["id"])
        pages.add(block["source"]["page"])
        pages.update(source["page"] for source in block["source"].get("continuations", []))
        if block["kind"] == "text":
            check_paragraph(block)
        elif block["kind"] == "figure":
            check_image(block["image"])
        elif block["kind"] == "table":
            table_count += 1
            logical_tables.append(block)
            original_cells = {}
            for fragment in block["fragments"]:
                assert fragment["fragmentId"] not in fragments
                fragments[fragment["fragmentId"]] = fragment
                for cell in fragment["cells"]:
                    original_cells[cell["id"]] = cell
                    for paragraph in cell["paragraphs"]:
                        for line in paragraph["source"]["lines"]:
                            for identity in line["ids"]:
                                rect = fitz.Rect(geometry[identity]["bbox"])
                                assert fitz.Rect(cell["bbox"]).contains((rect.tl + rect.br) / 2), "Text in wrong source cell"
            assert collections.Counter(part for cell in block["cells"] for part in cell["parts"]) == collections.Counter(original_cells.keys()), "Regrouped cell missing/duplicated"
            occupied = set()
            for cell in block["cells"]:
                assert cell["rowspan"] > 0 and cell["colspan"] > 0
                for row in range(cell["row"], cell["row"] + cell["rowspan"]):
                    for column in range(cell["column"], cell["column"] + cell["colspan"]):
                        assert row < block["rows"] and column < block["columns"]
                        assert (row, column) not in occupied, "Overlapping imported cells"
                        occupied.add((row, column))
                for paragraph in cell["paragraphs"]:
                    check_paragraph(paragraph)
                ids = lambda c: [identity for p in c["paragraphs"] for run in p["runs"] for identity in run["ids"] + run.get("readingIds", [])]
                assert collections.Counter(ids(cell)) == collections.Counter(identity for part in cell["parts"] for identity in ids(original_cells[part])), "Incorrect cell continuation"
                positions = []
                content_items = []
                for entry in cell["content"]:
                    content_items.append((entry["kind"], entry["index"]))
                    if entry["kind"] == "text":
                        line = cell["paragraphs"][entry["index"]]["source"]["lines"][0]
                        positions.append((line["page"], line["bbox"][1], line["bbox"][0]))
                    else:
                        image = cell["images"][entry["index"]]
                        positions.append((image["sourcePage"], image["bbox"][1], image["bbox"][0]))
                assert positions == sorted(positions), "Text and illustrations not interleaved in source order"
                assert set(content_items) == ({("text", i) for i in range(len(cell["paragraphs"]))} | {("image", i) for i in range(len(cell["images"]))}) and len(set(content_items)) == len(content_items)
                if cell.get("reference"):
                    parent = next(c for c in block["cells"] if c["id"] == cell["reference"])
                    assert parent["column"] == cell["column"] and parent["row"] < cell["row"] and not parent.get("reference"), "Wrong ditto relationship"
                    assert "".join(p["text"] for p in cell["paragraphs"]).strip() == "\u540c\u4e0a"
                for image in cell["images"]:
                    original_cell = next(c for c in original_cells.values() if any(i["id"] == image["id"] for i in c["images"]))
                    check_image(image, original_cell)
            assert len(occupied) == block["rows"] * block["columns"], "Missing table cell"
        else:
            raise AssertionError(f"Unsupported content {block['kind']}")

assert len(set(article_ids)) == len(article_ids)
assert len(set(block_ids)) == len(block_ids)
assert pages == set(range(1, 149))
assert actual == expected
assert len(actual) == dataset["coverage"]["characters"]
assert hashlib.sha256("".join(actual[key] for key in sorted(actual)).encode("utf-8")).hexdigest() == dataset["coverage"]["characterDigest"]
assert len(footer_ids) == dataset["coverage"]["pageFooterCharacters"]
assert collections.Counter(images) == collections.Counter(original_images.keys())
assert len(images) == dataset["coverage"]["figures"] == 277
assert len(fragments) == dataset["coverage"]["tables"] == 87
assert table_count == dataset["coverage"]["logicalTables"] == 34

# Independent regression cases: hanging paragraphs, page-split headings,
# shared loading rules, separate numbered illustrations and paired columns.
paragraph = next(p for p in all_paragraphs if p["source"]["page"] == 10 and p["text"].startswith("\u79fb\u52d5\u7528\u5c0f\u578b\u8eca\u306f"))
assert "\u79fb\u52d5\u7528\u5c0f\u578b\u8eca\u306f\u3001\u52aa\u3081\u3066" in paragraph["text"] and "\u306a\u304a\u3001" not in paragraph["text"]
assert any(p.get("note") and len(p["source"]["lines"]) == 2 and p["source"]["page"] == 10 for p in all_paragraphs)
highway = next(b for b in logical_tables if b["source"]["page"] == 71)
assert "\u6700\u9ad8\u901f\u5ea6\uff08\u30ad\u30ed\u30e1\u30fc\u30c8\u30eb\u6bce\u6642\uff09" in highway["cells"][1]["paragraphs"][0]["text"]
loading = next(b for b in logical_tables if b["fragmentId"] == "p036-table01")
assert any(c["column"] == 1 and c["rowspan"] == 2 and "\u81ea\u52d5\u8eca\u691c\u67fb\u8a3c\u304b" in "".join(p["text"] for p in c["paragraphs"]) for c in loading["cells"])
regulatory = next(b for b in logical_tables if b["fragmentId"] == "p097-table00")
motorcycle = next(c for c in regulatory["cells"] if any(i["id"] == "p098-image00" for i in c["images"]))
assert "\u4e8c\u8f2a\u306e\u81ea\u52d5\u8eca" in "".join(p["text"] for p in motorcycle["paragraphs"])
markings = next(b for b in logical_tables if b["fragmentId"] == "p127-table00")
parking = next(c for c in markings["cells"] if any(i["id"] == "p128-image02" for i in c["images"]))
assert "\u99d0\u505c\u8eca\u7981\u6b62" in "".join(p["text"] for p in parking["paragraphs"])
assert [i["id"] for i in parking["images"]] == ["p128-image02"]
assert next(b for b in logical_tables if b["fragmentId"] == "p139-table01")["layout"] == "grid"
for filename, info in dataset["assets"].items():
    raw = (DATA / "assets" / filename).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == info["sha256"]
    pixmap = fitz.Pixmap(raw)
    assert (pixmap.width, pixmap.height) == (info["width"], info["height"])
colors = json.loads((DATA / "color-manifest.json").read_text(encoding="utf-8"))
assert hashlib.sha256((DATA / "color-source.pdf").read_bytes()).hexdigest() == colors["source"]["sha256"]
assert len(colors["images"]) == len({item["imageId"] for item in colors["images"]}) == 67
for item in colors["images"]:
    assert item["originalSha256"] == original_images[item["imageId"]]["sha256"]
    raw = (ROOT / "data" / item["path"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == item["sha256"]
    pixmap = fitz.Pixmap(raw)
    assert (pixmap.width, pixmap.height) == (item["width"], item["height"])
    pixels = memoryview(pixmap.samples)
    colored = sum(max(pixels[i:i+3]) - min(pixels[i:i+3]) > 35 for i in range(0, len(pixels), pixmap.n))
    assert colored > pixmap.width * pixmap.height * .08, "Blank/monochrome color replacement"
assert not any(item["imageId"] in ["p097-image05", "p098-image06", "p106-image03", "p107-image00", "p125-image00", "p126-image02", "p126-image03"] for item in colors["images"]), "Unreviewed numeric/combined variant replaced"
print(f"Verified {len(article_ids)} lessons: {len(actual)} unchanged characters, ordered source lines, {ruby_count} furigana annotations, 277 original illustrations, 87 source grids regrouped into {table_count} complete logical tables, ditto references, cross-page regressions and 67 nonblank official color references. No translation or newer amendment applied.")
