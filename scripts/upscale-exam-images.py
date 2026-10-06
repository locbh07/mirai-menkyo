"""Create a non-destructive, deduplicated Waifu2x image comparison batch."""

import argparse
import hashlib
import html
import json
import subprocess
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "karimen-honmen-vi"


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def collect_images():
    data = json.loads((SOURCE / "all.json").read_text(encoding="utf-8"))
    images, skipped = {}, []
    for exam in data["exam_sets"]:
        for question in exam["questions"]:
            for relative in question.get("image_paths", []):
                path = (SOURCE / relative).resolve()
                if not path.is_relative_to(SOURCE.resolve()):
                    raise ValueError(f"Image escapes source directory: {relative}")
                try:
                    sha = digest(path)
                    if sha in images:
                        images[sha]["references"].append(question["source_id"])
                        continue
                    with Image.open(path) as image:
                        if getattr(image, "n_frames", 1) > 1:
                            skipped.append({"path": relative, "reason": "Animated image"})
                            continue
                        size = image.size
                    images[sha] = {
                        "path": relative, "sha256": sha, "size": size,
                        "type": exam["exam_type"],
                        "compound": bool(question.get("choices")),
                        "references": [question["source_id"]],
                    }
                except (OSError, ValueError) as error:
                    skipped.append({"path": relative, "reason": str(error)})
    return list(images.values()), skipped


def choose_samples(images, limit):
    # Include the reported blurry image and both simple diagrams and road scenes.
    preferred = [
        next((item for item in images if "C015-2.gif" in item["path"]), None),
        next((item for item in images if item["compound"]), None),
    ]
    for kind in ("karimen", "honmen", "gentsuki"):
        for extension in (".gif", ".png"):
            preferred.append(next((item for item in images if item["type"] == kind and Path(item["path"]).suffix.lower() == extension), None))
    selected, seen = [], set()
    for item in [*preferred, *images]:
        if item and item["sha256"] not in seen:
            selected.append(item)
            seen.add(item["sha256"])
            if len(selected) >= limit:
                break
    return selected


def write_comparison(output, report):
    rows = []
    for item in report["images"]:
        figures = []
        versions = [("Original", item["original"], item["size"], None, False)]
        versions.extend((f"Waifu2x {scale}x", result["path"], result["size"], result["seconds"], result["cached"]) for scale, result in item["outputs"].items())
        for label, file, size, seconds, cached in versions:
            timing = " &middot; cached" if cached else f" &middot; {seconds:.3f}s" if seconds is not None else ""
            figures.append(f'<figure><figcaption>{label} &middot; {size[0]} x {size[1]} px{timing}</figcaption><div class="canvas"><img src="{html.escape(file, quote=True)}" alt="{html.escape(item["references"][0], quote=True)}"></div></figure>')
        rows.append(f'<section><h2>{html.escape(item["references"][0])}</h2><p>{html.escape(item["path"])} &middot; {len(item["references"])} references</p><div class="versions">{"".join(figures)}</div></section>')
    page = f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Menkyo Image Comparison</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;padding:24px;background:#f2f2f7;color:#1c1c1e;font:16px/1.5 system-ui,sans-serif;letter-spacing:0}}
main{{max-width:1440px;margin:auto}}h1{{font-size:28px}}h2{{font-size:20px;margin-bottom:6px}}p{{overflow-wrap:anywhere;color:#595963}}
section{{padding:24px 0;border-top:1px solid #ddd}}.versions{{display:grid;grid-template-columns:repeat({len(report["scales"]) + 1},minmax(0,1fr));gap:12px}}
figure{{min-width:0;margin:0;padding:12px;background:white;border:1px solid #ddd;border-radius:8px}}figcaption{{font-weight:600;margin-bottom:12px}}
.canvas{{display:flex;align-items:center;justify-content:center;height:360px;min-height:0;overflow:hidden;background:white}}img{{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;min-width:0;min-height:0}}
@media(max-width:720px){{body{{padding:16px}}.versions{{grid-template-columns:1fr}}}}
</style><main><h1>Menkyo Image Comparison</h1><p>{len(report["images"])} unique images &middot; noise {report["noise"]} &middot; source files unchanged &middot; not deployed</p>{"".join(rows)}</main></html>"""
    (output / "index.html").write_text(page, encoding="utf-8")
    (output / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", type=Path, help="Path to waifu2x-ncnn-vulkan.exe")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--limit", type=int, default=10, help="Number of unique sample images (default: 10)")
    group.add_argument("--all", action="store_true", help="Process all eligible unique images")
    parser.add_argument("--scales", type=int, choices=(2, 4), nargs="+", default=[2, 4])
    parser.add_argument("--noise", type=int, choices=(-1, 0, 1, 2, 3), default=0)
    parser.add_argument("--gpu", type=int, help="GPU index; -1 uses CPU; default is automatic")
    parser.add_argument("--max-edge", type=int, default=600, help="Skip originals larger than this (default: 600px)")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "upscale-preview")
    args = parser.parse_args()
    if args.limit < 1 or args.max_edge < 1:
        parser.error("--limit and --max-edge must be positive")
    tool = args.tool or next((ROOT / "tools" / "waifu2x").rglob("waifu2x-ncnn-vulkan.exe"), None)
    if not tool or not tool.is_file():
        parser.error("Install Waifu2x under tools/waifu2x or pass --tool. See README.md.")
    tool = tool.resolve()
    model = tool.parent / "models-cunet"
    if not model.is_dir():
        parser.error(f"Missing model directory: {model}")
    output = args.output.resolve()
    if output == ROOT or output.is_relative_to(SOURCE) or SOURCE.is_relative_to(output):
        parser.error("Output must be separate from original data and repository root")
    output.mkdir(parents=True, exist_ok=True)
    for folder in ("original", "upscaled"):
        (output / folder).mkdir(exist_ok=True)
    scales = list(dict.fromkeys(args.scales))
    settings = {
        "tool_sha256": digest(tool), "noise": args.noise, "scales": scales,
        "models": {path.name: digest(path) for path in sorted(model.iterdir()) if path.is_file()},
    }
    settings_id = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()[:12]
    previous_hashes = {}
    try:
        previous = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        previous_hashes = {
            result["path"]: result["sha256"]
            for item in previous.get("images", []) for result in item.get("outputs", {}).values()
        }
    except (OSError, ValueError):
        pass
    images, skipped = collect_images()
    eligible = [item for item in images if max(item["size"]) <= args.max_edge]
    selected = eligible if args.all else choose_samples(eligible, args.limit)
    if not selected:
        parser.error("No eligible images")
    report = {
        "engine": "waifu2x-ncnn-vulkan", "settings": settings, "noise": args.noise,
        "scales": scales, "unique_images": len(images), "eligible_images": len(eligible),
        "images": [], "skipped": skipped,
    }
    batch_start = time.perf_counter()
    for index, item in enumerate(selected, 1):
        source = SOURCE / item["path"]
        original = output / "original" / f'{item["sha256"]}.png'
        with Image.open(source) as image:
            rgba = image.convert("RGBA")
            transparent = rgba.getchannel("A").getextrema()[0] < 255
            rgba.save(original)
        entry = {**item, "original": original.relative_to(output).as_posix(), "outputs": {}}
        for scale in scales:
            destination = output / "upscaled" / f'{item["sha256"]}-{settings_id}-{scale}x.png'
            expected = tuple(edge * scale for edge in item["size"])
            cached = False
            if destination.is_file():
                try:
                    with Image.open(destination) as image:
                        image.load()
                        cached = image.size == expected and digest(destination) == previous_hashes.get(destination.relative_to(output).as_posix())
                except (OSError, ValueError):
                    pass
            start = time.perf_counter()
            if not cached:
                command = [str(tool), "-i", str(original), "-o", str(destination), "-s", str(scale), "-n", str(args.noise), "-m", str(model), "-f", "png"]
                if args.gpu is not None:
                    command.extend(["-g", str(args.gpu)])
                result = subprocess.run(command, cwd=tool.parent, capture_output=True, text=True, errors="replace", timeout=180)
                if result.returncode != 0:
                    raise RuntimeError(f"Waifu2x failed ({result.returncode}) for {item['path']}: {result.stderr[-3000:]}")
            seconds = time.perf_counter() - start
            with Image.open(destination) as image:
                if image.size != expected:
                    raise RuntimeError(f"Unexpected output dimensions for {destination}")
                if transparent and ("A" not in image.getbands() or image.getchannel("A").getextrema()[0] == 255):
                    raise RuntimeError(f"Transparency lost for {destination}")
                size = image.size
            if digest(source) != item["sha256"]:
                raise RuntimeError(f"Source image changed while processing: {source}")
            entry["outputs"][str(scale)] = {
                "path": destination.relative_to(output).as_posix(), "size": size,
                "seconds": round(seconds, 4), "cached": cached,
                "bytes": destination.stat().st_size, "sha256": digest(destination),
            }
            print(f"[{index}/{len(selected)}] {item['references'][0]} {scale}x: {size[0]}x{size[1]}, {seconds:.3f}s{' (cached)' if cached else ''}", flush=True)
        report["images"].append(entry)
        report["seconds"] = round(time.perf_counter() - batch_start, 3)
        write_comparison(output, report)
    print(f"Comparison: {output / 'index.html'}", flush=True)
    print(f"Batch: {report['seconds']}s. Original data unchanged.", flush=True)


if __name__ == "__main__":
    main()
