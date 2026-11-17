"""Reddit OAuth collection and transparent, offline comment theme tagging.

Nothing in this module runs on a schedule or calls a paid AI service.
Only use Reddit API credentials approved for your intended use.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import praw

LINK_PATTERN = re.compile(r"https?://[^\s<>'\"]+", re.IGNORECASE)
POST_ID_PATTERN = re.compile(r"/comments/([a-z0-9]+)(?:/|$)", re.IGNORECASE)
SHORT_ID_PATTERN = re.compile(r"^/([a-z0-9]+)(?:/|$)", re.IGNORECASE)

THEMES = {
    "Pain and frustration": re.compile(
        r"\b(?:pain|painful|hurt|hurts|struggl\w*|frustrat\w*|annoy\w*|exhaust\w*|"
        r"stress\w*|worr\w*|scared|afraid|hate|problem|issue|tired of)\b", re.I
    ),
    "Desired outcome": re.compile(
        r"\b(?:i want|i wish|i hope|wish i|hope to|need to|looking for|goal|"
        r"would love|trying to|i just want|better way|finally able)\b", re.I
    ),
    "Doubt and objections": re.compile(
        r"\b(?:skeptic\w*|doubt\w*|scam|fake|not worth|doesn.t work|"
        r"didn.t work|too good to be true|trust|proof|evidence|"
        r"waste of money|rip.?off|concern\w*)\b", re.I
    ),
    "Experience and triggers": re.compile(
        r"\b(?:after i|after my|since i|since my|when i|when my|"
        r"because i|because my|started when|happened to me|"
        r"last year|years ago|months ago|one day)\b", re.I
    ),
    "Past solutions and workarounds": re.compile(
        r"\b(?:i tried|i.ve tried|tried using|i use|i used|"
        r"switched to|stopped using|recommend\w*|"
        r"alternative|workaround|what worked)\b", re.I
    ),
    "Price and access barriers": re.compile(
        r"\b(?:expensive|too much money|afford|price|costs?|"
        r"cheap\w*|budget|shipping|available|out of stock|"
        r"subscription|waiting list)\b", re.I
    ),
}


def thread_ids_from_text(text: str) -> list[str]:
    """Accept multiple Reddit post URLs; reject unrelated URLs and duplicates."""
    seen: set[str] = set()
    ids: list[str] = []
    for match in LINK_PATTERN.finditer(text or ""):
        url = match.group().rstrip(".,;:!?)\u005d}")
        try:
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
            if host == "redd.it" or host.endswith(".redd.it"):
                id_match = SHORT_ID_PATTERN.match(parsed.path)
            elif host == "reddit.com" or host.endswith(".reddit.com"):
                id_match = POST_ID_PATTERN.search(parsed.path)
            else:
                continue
            if not id_match:
                continue
            post_id = id_match.group(1).lower()
            if post_id not in seen:
                ids.append(post_id)
                seen.add(post_id)
        except ValueError:
            continue
    return ids


def make_reddit(client_id: str, client_secret: str, user_agent: str) -> praw.Reddit:
    """Create a read-only OAuth client; PRAW handles server rate limits."""
    if not client_id or not client_secret or not user_agent:
        raise ValueError("Reddit API credentials and a descriptive user agent are required.")
    reddit = praw.Reddit(
        client_id=client_id,
        client_secret=client_secret,
        user_agent=user_agent,
        ratelimit_seconds=60,
    )
    reddit.read_only = True
    return reddit


def utc_time(unix_seconds: float) -> str:
    return datetime.fromtimestamp(unix_seconds, timezone.utc).isoformat(timespec="seconds")


def search_posts(
    reddit: praw.Reddit,
    query: str,
    subreddit_name: str = "all",
    sort: str = "relevance",
    time_filter: str = "all",
    limit: int = 50,
) -> list[dict]:
    if not query.strip():
        raise ValueError("Enter a search phrase.")
    subreddit_name = subreddit_name.strip().replace("r/", "").strip("/") or "all"
    # Simple subreddit names only, to prevent malformed search scopes.
    if not re.fullmatch(r"[A-Za-z0-9_+]{1,100}", subreddit_name):
        raise ValueError("Enter a subreddit name such as skincare, or all.")
    posts = reddit.subreddit(subreddit_name).search(
        query.strip(), sort=sort, time_filter=time_filter, limit=limit
    )
    rows = []
    for post in posts:
        rows.append({
            "selected": False,
            "title": str(post.title),
            "subreddit": str(post.subreddit),
            "comments": int(post.num_comments),
            "score": int(post.score),
            "created_utc": utc_time(post.created_utc),
            "url": "https://www.reddit.com" + post.permalink,
            "post_id": post.id,
        })
    return rows


def scrape_post(
    reddit: praw.Reddit,
    post_id: str,
    max_comments: int = 1000,
    more_requests: int = 12,
    comment_sort: str = "top",
) -> tuple[dict, list[dict]]:
    """Retrieve available comments without circumventing Reddit API limits.

    Setting more_requests=0 only gets the initially loaded comment tree.
    The maximum number returned is a cap, not a guaranteed result count.
    """
    if not re.fullmatch(r"[a-z0-9]{3,12}", post_id, re.I):
        raise ValueError("Invalid Reddit post ID.")
    post = reddit.submission(id=post_id)
    post.comment_sort = comment_sort
    title = str(post.title)
    info = {
        "post_id": post.id,
        "post_title": title,
        "subreddit": str(post.subreddit),
        "post_url": "https://www.reddit.com" + post.permalink,
        "reported_comment_count": int(post.num_comments),
    }
    post.comments.replace_more(limit=more_requests, threshold=0)
    rows: list[dict] = []
    for comment in post.comments.list():
        body = getattr(comment, "body", "")
        if not isinstance(body, str) or body.strip().lower() in (
            "", "[removed]", "[deleted]"
        ):
            continue
        rows.append({
            **info,
            "comment_id": str(comment.id),
            "parent_id": str(getattr(comment, "parent_id", "")),
            "comment": body.strip(),
            "score": int(getattr(comment, "score", 0) or 0),
            "created_utc": utc_time(comment.created_utc),
            "comment_url": "https://www.reddit.com" + comment.permalink,
        })
        if len(rows) >= max_comments:
            break
    return info, rows


def classify_comment(body: str) -> list[str]:
    """Simple reproducible keyword matching; NOT a claim about real beliefs."""
    return [name for name, pattern in THEMES.items() if pattern.search(body or "")]


def add_labels(rows: list[dict]) -> list[dict]:
    labeled: list[dict] = []
    for row in rows:
        matches = classify_comment(str(row.get("comment", "")))
        labeled.append({
            **row,
            "themes": " | ".join(matches) if matches else "Uncategorized",
            "theme_count": len(matches),
        })
    return labeled


def markdown_report(rows: list[dict]) -> str:
    from collections import Counter

    by_theme = Counter()
    for row in rows:
        for theme in classify_comment(str(row.get("comment", ""))):
            by_theme[theme] += 1
    out = [
        "# Reddit comment research",
        "",
        f"Comments exported: {len(rows)}",
        f"Unique posts: {len({row.get('post_id') for row in rows})}",
        "",
        "## Keyword-matched themes",
        "",
    ]
    for name in THEMES:
        out.append(f"- {name}: {by_theme[name]} matching comments")
    out += [
        "",
        "These are overlapping keyword matches, not verified personal beliefs.",
        "Read the original linked comments before forming hypotheses or ad angles.",
        "This tool uses no AI inference.",
        "",
        "## Example comments",
        "",
    ]
    for row in sorted(rows, key=lambda r: int(r.get("score", 0)), reverse=True)[:15]:
        snippet = " ".join(str(row.get("comment", "")).split())[:230]
        out += [
            f"- [{row.get('post_title', 'Thread')}]({row.get('comment_url', '')})",
            f"  - {snippet}",
        ]
    return "\n".join(out) + "\n"
