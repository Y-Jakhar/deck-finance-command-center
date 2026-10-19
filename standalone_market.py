"""Minimal shell when the optional Go-Terminal market application is absent.

No prices or market calculations are synthesized here. The UI and Deck's
independent workspaces can start while market API calls report unavailability.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles


def create_standalone_app(frontend_dist: Path) -> FastAPI:
    app = FastAPI(title="Finance Command Center — standalone")

    @app.get("/api/v1/{path:path}")
    def market_unavailable(path: str):
        raise HTTPException(503, "Market integration unavailable; configure an authorized Go-Terminal checkout")

    assets = frontend_dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        index = frontend_dist / "index.html"
        if index.is_file():
            return FileResponse(index)
        return HTMLResponse(
            "<h1>Finance Command Center</h1><p>Build the frontend with npm ci and npm run build.</p>",
            status_code=503,
        )

    return app
