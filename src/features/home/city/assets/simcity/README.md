# SimCity 3000 city sprites

Original game art: **Maxis / Electronic Arts and respective rights holders**.
The user supplied this pack and authorized local use. The supplied pack offers **no open-content license for the game art**; these are not open-source art assets. Extractor code licensing is separate from game-art rights.

Imported from the SimCity 3000 Unlimited Linux demo pack. `provenance.json` preserves its source links, hashes, original rights text and README.

The five original zoom-2 PNG sheets are copied byte for byte, without resizing, trimming, repacking or invented art. Tiles are 32 × 16 native pixels. Use nearest-neighbor sampling.

`catalog.json` contains all residential, commercial and industrial designs, zone-named construction and abandoned variants, and six small civic park lots. Generic rubble, ashes, abandoned lots and seaports have no catalog entries; unused art remains in the original sheets. Lot arrays are source X/Z tile sizes. Frames contain a zero-based sheet index and native pixel crop x/y/w/h. Four frames per design are ordered by source view 0, 1, 2, 3; compass directions are unverified. A bottom-center anchor is a placement convenience, not an engine origin.

Reproduce from the frontend repository root with Python 3 (standard library only), then the repository's installed Prettier to produce the checked-in metadata:

```sh
python3 scripts/import-city-sprites.py /path/to/simcity-3000-city-buildings.zip
pnpm exec prettier --write --config .prettierrc.json src/features/home/city/assets/simcity/catalog.json src/features/home/city/assets/simcity/provenance.json src/features/home/city/assets/simcity/README.md
```

Use `--out /path/to/output` for an isolated reproduction, then run the same Prettier command with those three paths under that output directory, retaining `--config .prettierrc.json`. Compare all eight output files byte for byte. Prettier formats only metadata and documentation; original PNG hashes stay unchanged. The importer validates source metadata agreement, sheet hashes and dimensions, crop bounds, four views per design, source lot dimensions, and every zone/condition combination before writing. Its JSON result records coverage, dimensions, byte size and output hashes before the formatting step.
