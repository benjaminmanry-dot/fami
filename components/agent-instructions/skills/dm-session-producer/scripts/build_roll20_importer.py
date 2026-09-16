from __future__ import annotations

import argparse
import json
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
TEMPLATE = SKILL_DIR / "scripts" / "roll20_mod_importer_template.js"


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed a Roll20 import manifest into the DM Session Importer Mod script.")
    parser.add_argument("manifest", type=Path, help="Path to roll20_import_manifest.json")
    parser.add_argument("output", type=Path, help="Output .js file for Roll20 Mods/API")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    manifest_json = json.dumps(manifest, indent=2, ensure_ascii=False)
    script = TEMPLATE.read_text(encoding="utf-8").replace("__DM_IMPORT_MANIFEST_JSON__", manifest_json)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(script, encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
