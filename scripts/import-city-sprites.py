#!/usr/bin/env python3
"""Import original native zoom-2 atlases from the supplied SimCity pack."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import zipfile


ZONES = ("residential", "commercial", "industrial")
CONDITIONS = ("developed", "construction", "dilapidated")
PARK_NAMES = {
    "Gazebo", "Parque Aire Fresco", "Parque Hermosas Flores",
    "Small Park", "Playground", "The Pond",
}
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "src/features/home/city/assets/simcity"
)


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def import_pack(archive_path, output):
    files = {}
    with zipfile.ZipFile(archive_path) as archive:
        manifests = [n for n in archive.namelist() if PurePosixPath(n).name == "manifest.json"]
        require(len(manifests) == 1, "Expected exactly one manifest.json")
        root = str(PurePosixPath(manifests[0]).parent)
        prefix = "" if root == "." else root + "/"

        def read(name):
            return archive.read(prefix + name)

        manifest_data = read("manifest.json")
        catalog_data = read("catalog.json")
        sources_data = read("sources.json")
        original_readme = read("README.txt").decode()
        manifest = json.loads(manifest_data)
        source_catalog = json.loads(catalog_data)
        require(manifest["schemaVersion"] == 1, "Unsupported source schema")
        require(manifest["buildings"] == source_catalog["buildings"], "Source catalogs disagree")
        for key in ("trimmed", "resampled", "rotatedInAtlas"):
            require(manifest["representation"][key] is False, f"Unexpected {key} sprites")

        selected = []
        for building in source_catalog["buildings"]:
            category, name = building["category"], building["name"]
            if category in ZONES:
                selected.append((building, category, "developed"))
            elif category == "construction":
                for zone in ZONES:
                    if name == f"{zone.title()} Construction":
                        selected.append((building, zone, "construction"))
                    elif name == f"Abandoned {zone.title()} Building":
                        selected.append((building, zone, "dilapidated"))
            elif category == "civic" and name in PARK_NAMES:
                selected.append((building, None, None))

        frame_sets = {}
        used_sheets = set()
        for building, _, _ in selected:
            building_id = building["id"]
            require(building_id not in frame_sets, f"Duplicate design: {building_id}")
            frames = []
            for rotation in range(4):
                frame = manifest["frames"][f"{building_id}-z2-r{rotation}"]
                require(
                    frame["buildingId"] == building_id
                    and frame["zoom"] == 2 and frame["rotation"] == rotation,
                    f"Incorrect view: {building_id} r{rotation}",
                )
                frames.append(frame)
                used_sheets.add(frame["sheet"])
            frame_sets[building_id] = frames

        sheets = []
        sheet_indices = {}
        sheet_provenance = []
        for sheet in manifest["sheets"]:
            if sheet["file"] not in used_sheets:
                continue
            require(sheet["zoom"] == 2 and sheet["nativeTileWidth"] == 32
                    and sheet["nativeTileHeight"] == 16, "Unexpected native zoom dimensions")
            data = read(sheet["file"])
            require(data[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", "Invalid PNG header")
            dimensions = struct.unpack(">II", data[16:24])
            require(dimensions == (sheet["width"], sheet["height"]), "PNG dimensions disagree")
            require(sha256(data) == sheet["sha256"], f"Sheet hash mismatch: {sheet['file']}")
            name = PurePosixPath(sheet["file"]).name
            require(name not in files, f"Duplicate sheet filename: {name}")
            files[name] = data
            sheet_indices[sheet["file"]] = len(sheets)
            sheets.append({"file": name, "width": dimensions[0], "height": dimensions[1]})
            sheet_provenance.append({
                "file": name, "sourceFile": sheet["file"], "sha256": sha256(data),
                "bytes": len(data),
            })
        require(set(sheet_indices) == used_sheets, "Missing referenced atlas sheet")

        buildings, parks = [], []
        for building, zone, condition in selected:
            lot = [building["footprint"]["x"], building["footprint"]["y"]]
            require(all(type(v) is int and v > 0 for v in lot), "Invalid lot dimensions")
            require(lot == [building["sourceCellSize"][0], building["sourceCellSize"][2]],
                    "Lot differs from original X/Z CellSize")
            frames = []
            for source_frame in frame_sets[building["id"]]:
                index = sheet_indices[source_frame["sheet"]]
                rectangle = source_frame["frame"]
                x, y, w, h = (rectangle[k] for k in ("x", "y", "w", "h"))
                require(all(type(v) is int for v in (x, y, w, h)), "Noninteger atlas rectangle")
                require(x >= 0 and y >= 0 and w > 0 and h > 0
                        and x + w <= sheets[index]["width"]
                        and y + h <= sheets[index]["height"], "Atlas rectangle out of bounds")
                frames.append({"sheet": index, "x": x, "y": y, "w": w, "h": h})
            entry = {"id": building["id"], "name": building["name"]}
            if zone:
                entry.update(zone=zone, condition=condition)
            entry.update(lot=lot, frames=frames)
            (buildings if zone else parks).append(entry)

        coverage = Counter((b["zone"], b["condition"]) for b in buildings)
        require(all(coverage[(z, c)] > 0 for z in ZONES for c in CONDITIONS),
                "Missing zone/condition combination")
        require({p["name"] for p in parks} == PARK_NAMES, "Missing selected civic park")
        catalog = {"tileWidth": 32, "sheets": sheets, "buildings": buildings, "parks": parks}
        files["catalog.json"] = json_bytes(catalog)
        files["provenance.json"] = json_bytes({
            "sourceArchive": {"file": archive_path.name,
                              "sha256": sha256(archive_path.read_bytes())},
            "collectedOn": manifest["collectedOn"],
            "sources": json.loads(sources_data),
            "sourceFiles": [{"file": name, "sha256": sha256(data)} for name, data in (
                ("manifest.json", manifest_data), ("catalog.json", catalog_data),
                ("sources.json", sources_data), ("README.txt", original_readme.encode()),
            )],
            "sheets": sheet_provenance,
            "originalArtRights": manifest["artRights"],
            "originalReadme": original_readme,
            "representation": manifest["representation"],
            "import": {"zoom": 2, "rotations": [0, 1, 2, 3],
                       "sheetBytesUnchanged": True,
                       "selection": "All three zone categories; zone-named construction and abandoned designs; six small civic park lots."},
        })
        files["README.md"] = (
            "# SimCity 3000 city sprites\n\n"
            "Original game art: **Maxis / Electronic Arts and respective rights holders**.\n"
            "The user supplied this pack and authorized local use. The supplied pack offers "
            "**no open-content license for the game art**; these are not open-source art assets. "
            "Extractor code licensing is separate from game-art rights.\n\n"
            "Imported from the SimCity 3000 Unlimited Linux demo pack. `provenance.json` "
            "preserves its source links, hashes, original rights text and README.\n\n"
            "The five original zoom-2 PNG sheets are copied byte for byte, without resizing, "
            "trimming, repacking or invented art. Tiles are 32 × 16 native pixels. "
            "Use nearest-neighbor sampling.\n\n"
            "`catalog.json` contains all residential, commercial and industrial designs, "
            "zone-named construction and abandoned variants, and six small civic park lots. "
            "Generic rubble, ashes, abandoned lots and seaports have no catalog entries; "
            "unused art remains in the original sheets. Lot arrays are source X/Z tile sizes. "
            "Frames contain a zero-based sheet index and native pixel crop x/y/w/h. "
            "Four frames per design are ordered by source view 0, 1, 2, 3; compass directions "
            "are unverified. A bottom-center anchor is a placement convenience, not an engine origin.\n\n"
            "Reproduce from the frontend repository root with Python 3 (standard library only), "
            "then the repository's installed Prettier to produce the checked-in metadata:\n\n"
            "```sh\npython3 scripts/import-city-sprites.py /path/to/simcity-3000-city-buildings.zip\n"
            "pnpm exec prettier --write --config .prettierrc.json "
            "src/features/home/city/assets/simcity/catalog.json "
            "src/features/home/city/assets/simcity/provenance.json "
            "src/features/home/city/assets/simcity/README.md\n```\n\n"
            "Use `--out /path/to/output` for an isolated reproduction, then run the same "
            "Prettier command with those three paths under that output directory, retaining "
            "`--config .prettierrc.json`. Compare all eight output files byte for byte. "
            "Prettier formats only metadata and documentation; original PNG hashes stay unchanged. "
            "The importer validates "
            "source metadata agreement, sheet hashes and dimensions, crop bounds, four views "
            "per design, source lot dimensions, and every zone/condition combination before "
            "writing. Its JSON result records coverage, dimensions, byte size and output hashes "
            "before the formatting step.\n"
        ).encode()

    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (output / name).write_bytes(data)
    return {
        "buildings": len(buildings), "parks": len(parks),
        "frames": 4 * (len(buildings) + len(parks)),
        "coverage": {z: {c: coverage[(z, c)] for c in CONDITIONS} for z in ZONES},
        "sheets": sheets, "totalBytes": sum(map(len, files.values())),
        "outputSha256": {name: sha256(data) for name, data in files.items()},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        print(json.dumps(import_pack(args.archive, args.out), indent=2))
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Sprite import failed: {error}\n")


if __name__ == "__main__":
    main()
