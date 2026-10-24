"""Export the FastAPI OpenAPI contract to backend/openapi.json.

Run from the ``backend`` directory:

    python -m scripts.export_openapi

Importing the app does not require a database connection (tables are only
created during the lifespan startup, which this script does not run), but to
be safe we point it at a throwaway DB/model path so nothing production-related
is touched.
"""

from __future__ import annotations

import json
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./_openapi_export_tmp.db")
os.environ.setdefault("ANOMALY_MODEL_PATH", "./_openapi_export_tmp.joblib")


def main() -> int:
    from app.main import app

    schema = app.openapi()
    out_path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                            "openapi.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(schema, fh, indent=2, sort_keys=False)
        fh.write("\n")
    print(f"Wrote {out_path}")
    print(f"  title={schema['info']['title']} version={schema['info']['version']}")
    print(f"  paths={len(schema['paths'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
