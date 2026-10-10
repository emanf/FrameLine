"""Reproducible CPU benchmarks; hashes guard against changes to image results."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from time import perf_counter
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from engine import apply_image_outline
from refine_edges import refine_cutout


def fixture():
    image = Image.new("RGBA", (600, 800))
    draw = ImageDraw.Draw(image)
    points = [(120 + (y % 13), y) for y in range(80, 720)]
    points += [(480 - (y % 17), y) for y in range(719, 79, -1)]
    draw.polygon(points, fill=(55, 105, 160, 210))
    draw.ellipse((190, 150, 410, 450), fill=(240, 70, 20, 255))
    draw.ellipse((250, 510, 335, 610), fill=(20, 180, 85, 100))
    draw.ellipse((280, 260, 335, 320), fill=(0, 0, 0, 0))
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args()
    image = fixture()
    cases = [
        ("outline-large", lambda: apply_image_outline(image, {"size": 100, "position": "center", "softness": 3, "opacity": .6})),
        ("refine-default", lambda: refine_cutout(image, {"clean": 10, "repair": 60, "smooth": 25, "shrink": 0, "width": 2})),
        ("refine-wide", lambda: refine_cutout(image, {"clean": 10, "repair": 60, "smooth": 25, "shrink": 0, "width": 16})),
    ]
    results = {}
    for name, operation in cases:
        start = perf_counter()
        result = operation()
        entry = {"seconds": round(perf_counter() - start, 4), "size": list(result.size),
                 "sha256": hashlib.sha256(result.tobytes()).hexdigest()}
        start = perf_counter()
        repeated = operation()
        entry["repeat_seconds"] = round(perf_counter() - start, 4)
        assert hashlib.sha256(repeated.tobytes()).hexdigest() == entry["sha256"], "Cached output changed pixels"
        results[name] = entry
        print(name, json.dumps(entry), flush=True)
    if args.output:
        Path(args.output).write_text(json.dumps(results, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
