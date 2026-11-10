# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Embed a folder of labelled gown photos for GroupingEvalTest (Story 10.1). Operator-run, not CI.

Usage:
  KLEI_EMBED_URL=https://host/v1 KLEI_EMBED_KEY=... KLEI_EMBED_MODEL=dinov2-base \\
    uv run infra/eval/embed.py <folder> --out /path/outside/the/repo/gowns.vectors.json
Folder layout: <gown-label>/<photo>.jpg|png|webp. The folder name is the ground-truth label.
Then: cd backend && ./mvnw -pl app -am test -Dtest=GroupingEvalTest -Deval.vectors=/path/outside/the/repo/gowns.vectors.json

Reads only the embeddings address and key, never the chat gateway's. The key is never written to the output.
shortcut: Pillow resizes to a 480 px JPEG, which differs slightly from ThumbnailService; good enough to rank thresholds,
upgrade by calling the backend thumbnail endpoint.
"""
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

EXT = {".jpg", ".jpeg", ".png", ".webp"}
SIZE = 480


def die(msg):
    print(f"embed.py: {msg}", file=sys.stderr)
    sys.exit(1)


def thumb(path):
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((SIZE, SIZE))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return buf.getvalue()


def endpoint(base):
    base = base.rstrip("/")
    return base + ("/embeddings" if base.endswith("/v1") else "/v1/embeddings")


def embed(url, key, model, jpeg):
    body = json.dumps({"model": model, "input": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)["data"][0]["embedding"]
    except urllib.error.HTTPError as e:
        die(f"provider answered HTTP {e.code}")
    except (urllib.error.URLError, KeyError, IndexError, ValueError) as e:
        die(f"provider call failed ({type(e).__name__})")


def main(argv):
    if len(argv) != 4 or argv[2] != "--out":
        die("usage: embed.py <folder> --out <vectors.json>")
    folder, out = Path(argv[1]), Path(argv[3])
    env = {k: os.environ.get(k, "") for k in ("KLEI_EMBED_URL", "KLEI_EMBED_KEY", "KLEI_EMBED_MODEL")}
    missing = [k for k, v in env.items() if not v]
    if missing:
        die("missing environment variable " + ", ".join(missing))
    labels = sorted(d for d in folder.iterdir() if d.is_dir()) if folder.is_dir() else die(f"{folder} is not a folder")
    labels = [d for d in labels if any(f.suffix.lower() in EXT for f in d.iterdir())]
    if len(labels) < 2:
        die("need at least two label folders that hold photos")
    repo = Path(__file__).resolve().parents[2]
    if repo in out.resolve().parents:
        die("--out must be outside the repository so photos and vectors are never committed")

    url, items = endpoint(env["KLEI_EMBED_URL"]), []
    for d in labels:
        for f in sorted(d.iterdir()):
            if f.suffix.lower() in EXT:
                items.append({"label": d.name, "file": f.name, "vector": embed(url, env["KLEI_EMBED_KEY"], env["KLEI_EMBED_MODEL"], thumb(f))})
    dims = {len(i["vector"]) for i in items}
    if len(dims) != 1:
        die("provider returned vectors of different sizes")
    out.write_text(json.dumps({"model": env["KLEI_EMBED_MODEL"], "dim": dims.pop(), "items": items}))
    print(f"wrote {len(items)} vectors for {len(labels)} gowns to {out}")


if __name__ == "__main__":
    main(sys.argv)
