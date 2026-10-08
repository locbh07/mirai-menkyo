"""Import the supplied Japanese manual without translating or updating its rules."""

import argparse
import collections
import copy
import hashlib
import json
import re
import shutil
import unicodedata
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "knowledge-ja"
CHAPTER = re.compile(r"^\u7b2c(\d+)\u7ae0\s+")
SECTION = re.compile(r"^\u7b2c(\d+)\u7bc0\s+")
APPENDIX = re.compile(r"^\u4ed8\u8868\s*(\d+)\s+")
LEADER = re.compile(r"^(?:\d+[\s\uff0e.]|[\uff08(]\d+[\uff09)]|[\u30a2-\u30f3]\s|\u6ce8\d+)")
SOURCE_URL = "https://www.npa.go.jp/bureau/traffic/20241113kyousoku.pdf"
SOURCE_SHA256 = "bf2f0c9d9f56bb487729ad344b1552f204ca0bd250a20020c0e106b72fec8027"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def normalized(text):
    return unicodedata.normalize("NFKC", text).strip()


def center(box):
    return fitz.Point((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)


def bounds(items):
    result = fitz.Rect(items[0]["bbox"])
    for item in items[1:]:
        result |= fitz.Rect(item["bbox"])
    return [round(value, 2) for value in result]


def lines_from_chars(chars):
    rows = collections.defaultdict(list)
    for char in chars:
        rows[round(char["y"], 1)].append(char)
    base_rows, ruby_rows = [], []
    for y, items in sorted(rows.items()):
        items.sort(key=lambda char: char["bbox"][0])
        if all(char["size"] < 7 for char in items):
            clusters = []
            for char in items:
                if not clusters or char["bbox"][0] - clusters[-1][-1]["bbox"][2] > char["size"]:
                    clusters.append([])
                clusters[-1].append(char)
            ruby_rows.extend((y, cluster) for cluster in clusters)
        else:
            base_rows.append((y, items))
    ruby_by_id = {}
    unmatched = []
    for y, ruby in ruby_rows:
        box = fitz.Rect(bounds(ruby))
        candidates = [(base_y, base) for base_y, base in base_rows if 0 < base_y - y < 12
                      and fitz.Rect(bounds(base)).x0 <= box.x1 and fitz.Rect(bounds(base)).x1 >= box.x0]
        if not candidates:
            unmatched.append((y, ruby))
            continue
        _, base = min(candidates, key=lambda row: row[0] - y)
        anchor = min(base, key=lambda char: abs(center(char["bbox"]).x - box.x0))
        ruby_by_id.setdefault(anchor["id"], []).extend(ruby)
    result = []
    for y, items in sorted(base_rows + unmatched):
        runs = []
        for char in items:
            reading = ruby_by_id.get(char["id"], [])
            run = {"text": char["text"], "ids": [char["id"]]}
            if reading:
                run.update(reading="".join(item["text"] for item in reading), readingIds=[item["id"] for item in reading])
            if runs and not reading and "reading" not in runs[-1]:
                runs[-1]["text"] += run["text"]
                runs[-1]["ids"].extend(run["ids"])
            else:
                runs.append(run)
        text = "".join(run["text"] for run in runs)
        result.append({"text": text, "runs": runs, "bbox": bounds(items), "y": y,
                       "ids": [char["id"] for char in items],
                       "size": max(char["size"] for char in items)})
    return result


def paragraphs(lines, page, in_cell=False):
    result = []
    for line in lines:
        text = line["text"].strip()
        norm = normalized(text)
        heading = bool(CHAPTER.match(norm) or SECTION.match(norm) or APPENDIX.match(norm)
                       or re.sub(r"\s", "", norm) in ["\u7528\u8a9e\u306e\u307e\u3068\u3081", "\u9644\u5247"])
        if re.match(r"^[\u30a2-\u30aa]\s+(?:\u898f\u5236|\u6307\u793a|\u88dc\u52a9|\u6848\u5185|\u8b66\u6212)\u6a19[\u8b58\u793a]$", text):
            heading = True
        note = text.startswith("\uff08") and any(word in text for word in ["\u6539\u6b63", "\u516c\u5b89\u544a", "\u8ffd\u52a0"])
        subheading = bool(not in_cell and re.match(r"^\d+\s+", norm) and len(text) < 48
                          and not text.endswith(("\u3002", "\u3001")))
        tag = "h2" if heading else "h3" if subheading else "p"
        start = heading or subheading or note or LEADER.match(norm) or re.match(r"^\u9644\s*\u5247", norm)
        previous = result[-1] if result else None
        last_line = previous["source"]["lines"][-1] if previous else None
        # In this manual, body paragraphs use a one-em first-line indent; list
        # continuations use a hanging indent. A full line ending in a sentence
        # stop is not necessarily the end of its paragraph.
        geometry_continues = bool(last_line and line["y"] - last_line["y"] <= 25
                                  and (in_cell or line["bbox"][0] <= last_line["bbox"][0] + 1
                                       or LEADER.match(normalized(previous["text"]))))
        full_line = bool(last_line and (in_cell or last_line["bbox"][2] >= 499))
        note_continues = bool(previous and previous.get("note") and not previous["text"].rstrip().endswith(("\uff09", ")")))
        continues = geometry_continues and (full_line or note_continues or
                    not previous["text"].rstrip().endswith(("\u3002", "\uff09", ")")))
        line_source = {"page": page, "bbox": line["bbox"], "y": line["y"], "ids": line["ids"]}
        if previous and not start and previous["tag"] == "p" and continues:
            previous["runs"].extend(line["runs"])
            previous["text"] += line["text"]
            previous["source"]["bbox"] = bounds([{"bbox": previous["source"]["bbox"]}, line])
            previous["source"]["lines"].append(line_source)
        else:
            result.append({"kind": "text", "tag": tag, "text": line["text"], "runs": line["runs"],
                           "note": note, "source": {"page": page, "bbox": line["bbox"], "lines": [line_source]}})
    return result


def grid_points(values):
    groups = []
    for value in sorted(values):
        if groups and abs(value - groups[-1][-1]) < 1:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [sum(group) / len(group) for group in groups]


def run_ids(block):
    if block["kind"] == "text":
        for run in block["runs"]:
            yield from run["ids"]
            yield from run.get("readingIds", [])
    elif block["kind"] == "table":
        for cell in block["cells"]:
            for paragraph in cell["paragraphs"]:
                yield from run_ids(paragraph)


def join_tables(blocks):
    # Reviewed against this exact PDF. Never infer a relationship merely from
    # matching column counts: p52, p107, p139 and p141 start different tables.
    relationships = {
        "p033-table00": ("p032-table00", True, [0, 1, 2, 3]),
        "p034-table00": ("p033-table00", True, [0, 1, 2, 3]),
        "p035-table00": ("p034-table00", True, [0, 1, 2, 3]),
        "p036-table00": ("p035-table00", False, [0]),
        "p037-table00": ("p036-table01", False, [1, 2, 3, 4]),
        "p038-table00": ("p037-table00", True, [0, 1, 2, 3, 4]),
        "p052-table00": ("p051-table00", True, [0, 1, 2]),
        "p072-table00": ("p071-table00", True, [0, 1, 2]),
        "p093-table00": ("p092-table00", True, [0, 1]),
        "p095-table00": ("p094-table01", False, []),
        "p140-table00": ("p139-table02", False, []),
        "p141-table00": ("p140-table00", False, []),
    }
    # A blank number at the top denotes the unfinished numbered item on the
    # preceding page; a nonblank number starts a new row, not a new table.
    ranges = [(98, 107, 4), (108, 109, 4), (110, 112, 4),
              (113, 123, 3), (124, 126, 3), (128, 135, 4), (136, 139, 4)]
    table_by_page = {block["fragmentId"]: block for block in blocks if block["kind"] == "table"}
    for first, last, columns in ranges:
        for page in range(first, last + 1):
            key = f"p{page:03d}-table00"
            previous_key = f"p{page - 1:03d}-table00"
            if page in [108, 110, 113, 124, 136]:
                previous_key = f"p{page - 1:03d}-table01"
            if key not in table_by_page or previous_key not in table_by_page:
                continue
            current = table_by_page[key]
            assert current["columns"] == table_by_page[previous_key]["columns"] == columns
            number = next(cell for cell in current["cells"] if cell["row"] == 0 and cell["column"] == 1)
            shared_row = not "".join(p["text"] for p in number["paragraphs"]).strip()
            merge_columns = list(range(columns)) if shared_row else []
            if 110 <= page <= 112 and 3 not in merge_columns:
                merge_columns.append(3)
            relationships[key] = (previous_key, shared_row, merge_columns)

    result = []
    for block in blocks:
        if block["kind"] != "table":
            result.append(block)
            continue
        fragment = copy.deepcopy(block)
        relation = relationships.get(block["fragmentId"])
        previous = result[-1] if result else None
        if relation:
            expected, shared_row, columns = relation
            assert previous and previous["kind"] == "table" and previous["fragments"][-1]["fragmentId"] == expected, relation
            assert previous["columns"] == block["columns"]
            offset = previous["rows"] - int(shared_row)
            for cell in block["cells"]:
                if cell["row"] == 0 and cell["column"] in columns:
                    parent = next(c for c in previous["cells"] if c["column"] == cell["column"]
                                  and c["row"] + c["rowspan"] == previous["rows"])
                    parent["rowspan"] += cell["rowspan"] - int(shared_row)
                    parent["parts"].append(cell["id"])
                    for paragraph in cell["paragraphs"]:
                        before = parent["paragraphs"][-1] if parent["paragraphs"] else None
                        if before and before["source"]["lines"][-1]["page"] < paragraph["source"]["lines"][0]["page"] \
                                and not before["text"].rstrip().endswith(("\u3002", "\uff09", ")")) \
                                and not LEADER.match(normalized(paragraph["text"])):
                            before["text"] += paragraph["text"]
                            before["runs"].extend(paragraph["runs"])
                            before["source"]["lines"].extend(paragraph["source"]["lines"])
                            before["source"].setdefault("continuations", []).append(paragraph["source"])
                        else:
                            parent["paragraphs"].append(paragraph)
                    parent["images"].extend(cell["images"])
                else:
                    previous["cells"].append({**cell, "row": cell["row"] + offset, "parts": [cell["id"]]})
            previous["rows"] += block["rows"] - int(shared_row)
            previous["fragments"].append(fragment)
            previous["source"].setdefault("continuations", []).append(block["source"])
            fragment["join"] = {"previous": expected, "sharedRow": shared_row, "columns": columns}
        else:
            block["fragments"] = [fragment]
            for cell in block["cells"]:
                cell["parts"] = [cell["id"]]
            result.append(block)
    for block in result:
        if block["kind"] != "table":
            continue
        block["cells"].sort(key=lambda cell: (cell["row"], cell["column"]))
        block["facsimiles"] = [{**fragment["facsimile"], "page": fragment["source"]["page"]} for fragment in block["fragments"]]
        header = ["".join(p["text"] for p in cell["paragraphs"]).strip() for cell in block["cells"] if cell["row"] == 0]
        block["hasHeader"] = bool(header and any(word in header for word in ["\u7a2e\u985e", "\u756a\u53f7", "\u70b9\u691c\u7b87\u6240", "\u7565\u79f0", "\u8eca\u306e\u7a2e\u985e", "\u4fe1\u53f7\u306e\u7a2e\u985e", "\u624b\u4fe1\u53f7\u306e\u7a2e\u985e", "\u81ea\u52d5\u8eca\u306e\u7a2e\u985e", "\u5408\u56f3\u3092\u884c\u3046\u5834\u5408", "\u514d\u8a31\u306e\u7a2e\u985e", "\u706f\u706b\u306b\u3088\u308b\u4fe1\u53f7\u306e\u7a2e\u985e"]))
        block["layout"] = "signs" if header == ["\u7a2e\u985e", "\u756a\u53f7", "\u8868\u793a\u3059\u308b\u610f\u5473", "\u8272"] or header == ["\u7a2e\u985e", "\u756a\u53f7", "\u610f\u5473", "\u8272"] else "grid"
        previous_by_column = {}
        for cell in block["cells"]:
            entries = [(p["source"]["lines"][0]["page"], p["source"]["lines"][0]["bbox"][1], p["source"]["lines"][0]["bbox"][0], {"kind": "text", "index": index})
                       for index, p in enumerate(cell["paragraphs"])]
            entries.extend((image["sourcePage"], image["bbox"][1], image["bbox"][0], {"kind": "image", "index": index})
                           for index, image in enumerate(cell["images"]))
            cell["content"] = [entry[3] for entry in sorted(entries, key=lambda entry: entry[:3])]
            text = "".join(p["text"] for p in cell["paragraphs"]).strip()
            if text == "\u540c\u4e0a" and cell["column"] in previous_by_column:
                parent = previous_by_column[cell["column"]]
                cell["reference"] = parent["id"]
            elif text and cell["row"] > 0:
                previous_by_column[cell["column"]] = cell
    return result


def import_document(source, output):
    raw = source.read_bytes()
    if digest(raw) != SOURCE_SHA256:
        raise ValueError("This importer is scoped to the supplied 2024 manual; review source/version metadata before importing a different PDF.")
    document = fitz.open(stream=raw, filetype="pdf")
    assets = output / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    asset_records = {}

    def save_image(bytes_, width, height):
        identity = digest(bytes_)
        file = f"{identity}.png"
        (assets / file).write_bytes(bytes_)
        asset_records[file] = {"sha256": identity, "width": width, "height": height, "bytes": len(bytes_)}
        return {"path": f"knowledge-ja/assets/{file}", "width": width, "height": height}

    expected_chars, included_chars, footer_chars = {}, [], []
    all_figures, events = [], []
    for page_index, page in enumerate(document):
        page_number = page_index + 1
        chars = []
        for block in page.get_text("rawdict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    for item in span["chars"]:
                        identity = f"p{page_number:03d}-c{len(chars):05d}"
                        chars.append({"id": identity, "text": item["c"], "bbox": list(item["bbox"]),
                                      "y": item["origin"][1], "size": span["size"]})
        for char in chars:
            expected_chars[char["id"]] = char["text"]
        footers = [char for char in chars if char["bbox"][1] > 780]
        footer_text = "".join(char["text"] for char in footers).strip()
        if footer_text != f"{page_number}/{len(document)}":
            raise ValueError(f"Unexpected footer on page {page_number}: {footer_text!r}")
        footer_chars.extend(char["id"] for char in footers)
        chars = [char for char in chars if char["id"] not in {item["id"] for item in footers}]
        figures = []
        for image_index, info in enumerate(page.get_image_info(xrefs=True)):
            if not info["xref"]:
                raise ValueError(f"Unresolved image on page {page_number}")
            pixmap = fitz.Pixmap(document, info["xref"])
            image = save_image(pixmap.tobytes("png"), pixmap.width, pixmap.height)
            image.update(id=f"p{page_number:03d}-image{image_index:02d}", bbox=list(info["bbox"]), sourcePage=page_number)
            figures.append(image)
            all_figures.append(image)
        consumed_chars, consumed_figures = set(), set()
        page_events = []
        for table_index, table in enumerate(page.find_tables().tables):
            cells = sorted(set(tuple(cell) for cell in table.cells if cell), key=lambda cell: (cell[1], cell[0]))
            xs = grid_points([value for cell in cells for value in [cell[0], cell[2]]])
            ys = grid_points([value for cell in cells for value in [cell[1], cell[3]]])
            column_at = lambda value: min(range(len(xs)), key=lambda index: abs(xs[index] - value))
            row_at = lambda value: min(range(len(ys)), key=lambda index: abs(ys[index] - value))
            parsed_cells = []
            for cell in cells:
                rect = fitz.Rect(cell)
                selected = [char for char in chars if char["id"] not in consumed_chars and rect.contains(center(char["bbox"]))]
                images = [image for image in figures if image["id"] not in consumed_figures and rect.contains(center(image["bbox"]))]
                consumed_chars.update(char["id"] for char in selected)
                consumed_figures.update(image["id"] for image in images)
                parsed_cells.append({"row": row_at(cell[1]), "column": column_at(cell[0]),
                                     "rowspan": row_at(cell[3]) - row_at(cell[1]), "colspan": column_at(cell[2]) - column_at(cell[0]),
                                     "paragraphs": paragraphs(lines_from_chars(selected), page_number, in_cell=True), "images": images,
                                     "bbox": [round(value, 2) for value in cell]})
            clip = fitz.Rect(table.bbox) + (-1, -1, 1, 1)
            preview = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
            facsimile = save_image(preview.tobytes("png"), preview.width, preview.height)
            fragment_id = f"p{page_number:03d}-table{table_index:02d}"
            # The left rule at y=331.8 is absent in the source on p128. The
            # numbered columns nevertheless unambiguously start item 4 here.
            if fragment_id == "p128-table00":
                cell = next(cell for cell in parsed_cells if cell["row"] == cell["column"] == 0)
                assert cell["rowspan"] == 2
                divider = next(cell["bbox"][1] for cell in parsed_cells if cell["row"] == 1)
                parsed_cells.remove(cell)
                for row, top, bottom in [(0, cell["bbox"][1], divider), (1, divider, cell["bbox"][3])]:
                    parsed_cells.append({**cell, "row": row, "rowspan": 1,
                        "paragraphs": [p for p in cell["paragraphs"] if top <= center(p["source"]["bbox"]).y < bottom],
                        "images": [image for image in cell["images"] if top <= center(image["bbox"]).y < bottom],
                        "bbox": [cell["bbox"][0], top, cell["bbox"][2], bottom]})
                parsed_cells.sort(key=lambda cell: (cell["row"], cell["column"]))
            for cell in parsed_cells:
                cell["id"] = f"{fragment_id}-r{cell['row']}-c{cell['column']}"
            page_events.append({"kind": "table", "id": fragment_id, "fragmentId": fragment_id, "cells": parsed_cells,
                                "rows": len(ys) - 1, "columns": len(xs) - 1, "facsimile": facsimile,
                                "source": {"page": page_number, "bbox": list(table.bbox)}})
        for block in paragraphs(lines_from_chars([char for char in chars if char["id"] not in consumed_chars]), page_number):
            page_events.append(block)
        for image in figures:
            if image["id"] not in consumed_figures:
                page_events.append({"kind": "figure", "image": image, "source": {"page": page_number, "bbox": image["bbox"]}})
        page_events.sort(key=lambda block: (block["source"]["bbox"][1], block["source"]["bbox"][0]))
        for block in page_events:
            included_chars.extend(run_ids(block))
        events.extend(page_events)
        print(f"Imported page {page_number}/{len(document)}", flush=True) if page_number % 25 == 0 else None

    expected_ids = set(expected_chars) - set(footer_chars)
    if set(included_chars) != expected_ids or len(included_chars) != len(expected_ids):
        raise ValueError(f"Character coverage failed: missing={len(expected_ids - set(included_chars))}, duplicates={len(included_chars) - len(set(included_chars))}")
    articles = []
    group = {"id": "front", "title": "\u524d\u6587\u30fb\u6539\u6b63\u5c65\u6b74\u30fb\u76ee\u6b21"}
    current = None
    body_started = False

    def article(title, key):
        record = {"id": f"ja-kyousoku-{key}", "locale": "ja", "slug": key, "title": title,
                  "group": dict(group), "format": "pdf-lessons-v1", "blocks": [], "tables": [], "images": []}
        articles.append(record)
        return record

    current = article(group["title"], "front")
    for block in events:
        page = block["source"]["page"]
        text = block.get("text", "").strip()
        norm = normalized(text)
        chapter, section, appendix = CHAPTER.match(norm), SECTION.match(norm), APPENDIX.match(norm)
        if chapter and page >= 5 and (body_started or int(chapter[1]) == 1):
            body_started = True
            group = {"id": f"chapter-{int(chapter[1]):02d}", "title": text}
            current = article(text, f"{group['id']}-intro")
        elif body_started and section and group["id"].startswith("chapter-"):
            current = article(text, f"{group['id']}-section-{int(section[1]):02d}")
        elif body_started and norm == "\u7528\u8a9e\u306e\u307e\u3068\u3081":
            group = {"id": "glossary", "title": text}
            current = article(text, "glossary")
        elif body_started and appendix:
            group = {"id": f"appendix-{appendix[1]}", "title": text}
            current = article(text, group["id"])
        elif group["id"] == "appendix-3" and re.match(r"^[\u30a2-\u30aa]\s+.*\u6a19[\u8b58\u793a]$", text):
            current = article(text, f"appendix-3-part-{len([item for item in articles if item['group']['id'] == 'appendix-3'])}")
        elif body_started and re.sub(r"\s", "", norm) == "\u9644\u5247" and page >= 143 and group["id"] != "amendments":
            group = {"id": "amendments", "title": "\u9644\u5247\u30fb\u65bd\u884c\u65e5"}
            current = article(group["title"], "amendments")
        block["id"] = f"{current['id']}-b{len(current['blocks']):04d}"
        current["blocks"].append(block)
    # Chapter introductions containing only a title/revision note belong to the first lesson.
    for index in range(len(articles) - 2, -1, -1):
        item, following = articles[index:index + 2]
        if item["slug"].endswith("-intro") and item["group"]["id"] == following["group"]["id"]:
            meaningful = [block for block in item["blocks"] if block["kind"] != "text" or (block["tag"] == "p" and not block.get("note"))]
            if not meaningful:
                following["blocks"] = item["blocks"] + following["blocks"]
                articles.pop(index)
    for item in articles:
        joined = []
        for block in item["blocks"]:
            previous = joined[-1] if joined else None
            if previous and previous["kind"] == block["kind"] == "text" and previous["tag"] == block["tag"] == "p" \
                    and previous["source"].get("continuations", [previous["source"]])[-1]["page"] != block["source"]["page"] \
                    and (not previous["text"].rstrip().endswith(("\u3002", "\uff09", ")")) \
                         or (previous["source"]["lines"][-1]["bbox"][2] >= 499 \
                             and abs(previous["source"]["lines"][-1]["bbox"][0] - block["source"]["lines"][0]["bbox"][0]) < 1)) \
                    and not LEADER.match(normalized(block["text"])) and not block.get("note"):
                previous["text"] += block["text"]
                previous["runs"].extend(block["runs"])
                previous["source"].setdefault("continuations", []).append(block["source"])
                previous["source"]["lines"].extend(block["source"]["lines"])
            else:
                joined.append(block)
        item["blocks"] = join_tables(joined)
        def text_in(block):
            if block["kind"] == "text":
                return block["text"]
            if block["kind"] == "table":
                return "\n".join(p["text"] for cell in block["cells"] for p in cell["paragraphs"])
            return ""
        item["text"] = "\n".join(text_in(block) for block in item["blocks"])
        pages = sorted({source["page"] for block in item["blocks"] for source in [block["source"], *block["source"].get("continuations", [])]})
        item["source"] = {"documentId": "npa-kyousoku-2024", "pages": pages, "firstPage": pages[0], "lastPage": pages[-1]}
    rendered_figures = [image["id"] for item in articles for block in item["blocks"]
                        for image in ([block["image"]] if block["kind"] == "figure" else [image for cell in block.get("cells", []) for image in cell["images"]])]
    if collections.Counter(rendered_figures) != collections.Counter(image["id"] for image in all_figures):
        raise ValueError("Image placement coverage failed")
    data = {"schemaVersion": 1, "source": {"id": "npa-kyousoku-2024", "title": "\u4ea4\u901a\u306e\u65b9\u6cd5\u306b\u95a2\u3059\u308b\u6559\u5247",
             "locale": "ja", "sha256": digest(raw), "pages": len(document), "url": SOURCE_URL,
             "revision": "2024-09-04", "newerAmendmentsApplied": False, "illustrations": "original-monochrome"},
            "coverage": {"characters": len(expected_ids), "nonWhitespaceCharacters": sum(not expected_chars[key].isspace() for key in expected_ids),
                         "pageFooterCharacters": len(footer_chars), "figures": len(all_figures),
                         "tables": sum(len(block["fragments"]) for item in articles for block in item["blocks"] if block["kind"] == "table"),
                         "logicalTables": sum(block["kind"] == "table" for item in articles for block in item["blocks"]),
                         "characterDigest": digest("".join(expected_chars[key] for key in sorted(expected_ids)).encode("utf-8"))},
            "assets": asset_records, "articles": articles}
    (output / "lessons.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if source.resolve() != (output / "source.pdf").resolve():
        shutil.copyfile(source, output / "source.pdf")
    print(f"Imported {len(articles)} lessons, {len(all_figures)} illustrations, {data['coverage']['tables']} tables; all {len(expected_ids)} source characters accounted for.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_OUTPUT / "source.pdf")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    import_document(args.source, args.output)
