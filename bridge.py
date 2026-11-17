"""Localhost-only, manually-triggered collector for the browser extension.

Launch with "python bridge.py". Nothing collects while idle. Chrome connects
to this bridge with a pairing token; Reddit OAuth credentials remain on this
computer and are never exposed to the browser extension.
"""
from __future__ import annotations

import csv
import io
import os
import re
import secrets
import threading
from collections import Counter, deque
from typing import Literal

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from reddit_core import THEMES, add_labels, make_reddit, markdown_report, scrape_post

load_dotenv()
PAIRING_TOKEN = os.getenv("REDDIT_BRIDGE_TOKEN", "").strip() or secrets.token_urlsafe(24)
POST_ID = re.compile(r"^[a-z0-9]{3,12}$", flags=re.I)
COLUMNS = [
    "post_id", "post_title", "subreddit", "post_url", "reported_comment_count",
    "comment_id", "author", "parent_id", "comment", "score", "created_utc",
    "comment_url", "themes", "theme_count"
]
ALLOWED_SORTS = ("top", "best", "new", "controversial", "old")


class CollectPost(BaseModel):
    post_id: str = Field(min_length=3, max_length=12)
    max_comments: int = Field(default=1000, ge=1, le=5000)
    more_requests: int = Field(default=12, ge=0, le=64)
    sort: Literal["top", "best", "new", "controversial", "old"] = "top"


class Collector:
    """In-memory queue; at most one manually-started worker per app instance."""

    def __init__(self, client_factory=None, scraper=None):
        self.client_factory = client_factory or self._reddit_client
        self.scraper = scraper or scrape_post
        self.lock = threading.RLock()
        self.pending = deque()
        self.seen = set()
        self.failed_ids = set()
        self.rows = []
        self.events = []
        self.running = False
        self.stopped = False
        self.current = None
        self.completed = 0
        self.failed = 0
        self.generation = 0

    @staticmethod
    def _reddit_client():
        return make_reddit(
            os.getenv("REDDIT_CLIENT_ID", "").strip(),
            os.getenv("REDDIT_CLIENT_SECRET", "").strip(),
            os.getenv("REDDIT_USER_AGENT", "").strip()
        )

    def _event(self, message):
        self.events.append(str(message)[:350])
        self.events = self.events[-80:]

    def queue_post(self, item: CollectPost):
        post_id = item.post_id.lower()
        if not POST_ID.fullmatch(post_id):
            raise ValueError("Invalid Reddit post ID.")
        with self.lock:
            if post_id in self.seen:
                if post_id in self.failed_ids:
                    self.failed_ids.remove(post_id)
                else:
                    return {"queued": False, "reason": "already-added", **self._status()}
            if len(self.seen) >= 250:
                raise ValueError("Session limit: clear the results before adding more than 250 threads.")
            self.seen.add(post_id)
            self.pending.append(item.model_copy(update={"post_id": post_id}))
            self.stopped = False
            self._event(f"Queued r/.../comments/{post_id}")
            if not self.running:
                self.running = True
                generation = self.generation
                threading.Thread(target=self._run, args=(generation,), daemon=True).start()
            return {"queued": True, **self._status()}

    def _run(self, generation):
        try:
            client = self.client_factory()
        except Exception as exc:
            with self.lock:
                if self.generation == generation:
                    self.failed += len(self.pending)
                    self.failed_ids.update(item.post_id for item in self.pending)
                    self._event(f"Cannot start Reddit API: {str(exc)[:150]}")
                    self.pending.clear()
                    self.running = False
                    self.current = None
            return
        while True:
            with self.lock:
                if self.generation != generation:
                    return
                if self.stopped or not self.pending:
                    self.running = False
                    self.current = None
                    return
                item = self.pending.popleft()
                self.current = item.post_id
                self._event(f"Reading {item.post_id} ...")
            try:
                _, comments = self.scraper(
                    client, item.post_id, item.max_comments,
                    item.more_requests, item.sort
                )
            except Exception as exc:
                with self.lock:
                    if self.generation != generation:
                        return
                    self.failed += 1
                    self.failed_ids.add(item.post_id)
                    self._event(f"Error on {item.post_id}: {str(exc)[:180]}")
            else:
                with self.lock:
                    if self.generation != generation:
                        return
                    self.rows.extend(comments)
                    self.completed += 1
                    self._event(f"Done {item.post_id}: {len(comments)} comments")

    def _status(self):
        themes = Counter()
        for row in self.rows:
            for name, regex in THEMES.items():
                if regex.search(str(row.get("comment", ""))):
                    themes[name] += 1
        return {
            "running": self.running, "stopped": self.stopped,
            "queued": len(self.pending), "selected": len(self.seen),
            "completed": self.completed, "failed": self.failed,
            "current": self.current, "comments": len(self.rows),
            "themes": dict(themes), "events": self.events[-30:],
        }

    def status(self):
        with self.lock:
            return self._status()

    def latest_rows(self, limit=120):
        with self.lock:
            return add_labels(list(reversed(self.rows[-limit:])))

    def snapshot(self):
        with self.lock:
            return list(self.rows)

    def stop(self):
        with self.lock:
            self.stopped = True
            for item in self.pending:
                self.seen.discard(item.post_id)
            self.pending.clear()
            self._event("Stopped: no new threads will be started.")
            return self._status()

    def clear(self):
        with self.lock:
            # Invalidate in-flight results; the previous worker stops after its
            # current request. Do not launch another worker until it exits.
            self.generation += 1
            self.pending.clear()
            self.seen.clear()
            self.failed_ids.clear()
            self.rows.clear()
            self.events.clear()
            self.stopped = True
            self.running = False
            self.current = None
            self.completed = 0
            self.failed = 0
            self._event("Session cleared")
            return self._status()


collector = Collector()
app = FastAPI(
    title="Reddit Research Local Bridge",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def pair_required(request: Request, call_next):
    # No permissive CORS. Browser extension pages have explicit localhost
    # permission; regular web pages can't use the bridge cross-origin.
    host = request.headers.get("host", "").split(":")[0].lower()
    if host not in ("127.0.0.1", "localhost"):
        return Response("Invalid host", status_code=403)
    supplied = request.headers.get("x-research-token", "")
    if not secrets.compare_digest(supplied, PAIRING_TOKEN):
        return Response("Invalid pairing token", status_code=401)
    return await call_next(request)


@app.get("/api/ping")
def ping():
    configured = all(
        os.getenv(key, "").strip()
        for key in ("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT")
    )
    return {
        "connected": True,
        "reddit_credentials_configured": bool(configured),
        "manual_only": True,
        "ai_calls": 0,
    }


@app.get("/api/state")
def state():
    return collector.status()


@app.post("/api/queue")
def queue(item: CollectPost):
    if not all(
        os.getenv(key, "").strip()
        for key in ("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT")
    ):
        raise HTTPException(503, "Set approved Reddit OAuth credentials in .env first.")
    try:
        return collector.queue_post(item)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/rows")
def rows(limit: int = Query(default=120, ge=1, le=500)):
    return {"rows": collector.latest_rows(limit=limit)}


@app.post("/api/stop")
def stop():
    return collector.stop()


@app.post("/api/clear")
def clear():
    return collector.clear()


def sanitize_csv(value):
    # Prevent spreadsheet formula injection when opening scraped text in Excel.
    s = "" if value is None else str(value)
    return "'" + s if s.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else s


@app.get("/api/export/{kind}")
def export(kind: Literal["csv", "json", "markdown", "txt"]):
    from json import dumps

    rows = add_labels(collector.snapshot())
    content_type = "text/plain; charset=utf-8"
    if kind == "csv":
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: sanitize_csv(row.get(key)) for key in COLUMNS})
        body = "\ufeff" + buffer.getvalue()
        filename = "reddit-comments.csv"
        content_type = "text/csv; charset=utf-8"
    elif kind == "json":
        body = dumps(rows, indent=2, ensure_ascii=False)
        filename = "reddit-comments.json"
        content_type = "application/json; charset=utf-8"
    elif kind == "markdown":
        body = markdown_report(rows)
        filename = "reddit-research.md"
        content_type = "text/markdown; charset=utf-8"
    else:
        body = "\n\n".join(
            f"[{row.get('subreddit', '')}] {row.get('post_title', '')}\n"
            f"{row.get('comment_url', '')}\n{row.get('comment', '')}"
            for row in rows
        )
        filename = "reddit-comments.txt"
    return Response(
        content=body,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"',
                 "Cache-Control": "no-store"}
    )


if __name__ == "__main__":
    print("\n" + "=" * 58, flush=True)
    print(" REDDIT RESEARCH — LOCAL BROWSER BRIDGE", flush=True)
    print(" Pairing code (paste into the Chrome extension):", flush=True)
    print(f" {PAIRING_TOKEN}", flush=True)
    print(" URL: http://127.0.0.1:8765", flush=True)
    print(" All collection is manually triggered. No AI API usage.", flush=True)
    print("=" * 58 + "\n", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
