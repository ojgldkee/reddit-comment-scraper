"""Interactive, manual Reddit comment research studio.

Only button clicks start API requests. No AI calls or scheduled tasks.
"""
from __future__ import annotations

import os

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from reddit_core import (
    THEMES,
    add_labels,
    make_reddit,
    markdown_report,
    scrape_post,
    search_posts,
    thread_ids_from_text,
)

load_dotenv()
st.set_page_config(
    page_title="Reddit Research Studio",
    page_icon="🔎",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    .block-container {max-width: 1230px; padding-top: 2rem;}
    h1 {font-weight: 800; letter-spacing: -.045em;}
    [data-testid="stMetricValue"] {font-size: 2rem;}
    div.stButton > button[kind="primary"] {
      border-radius: 11px; font-weight: 650; min-height: 44px;
    }
    .caption-pills {color:#96a2b7; font-size:.93rem; margin-bottom:1.5rem;}
    </style>
    """,
    unsafe_allow_html=True,
)


def credential(name: str) -> str:
    value = os.environ.get(name, "")
    if value:
        return value.strip()
    try:
        return str(st.secrets.get(name, "")).strip()
    except Exception:
        return ""


def get_client():
    return make_reddit(
        credential("REDDIT_CLIENT_ID"),
        credential("REDDIT_CLIENT_SECRET"),
        credential("REDDIT_USER_AGENT"),
    )


def has_credentials() -> bool:
    return all(
        credential(name)
        for name in ("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT")
    )


if "search_rows" not in st.session_state:
    st.session_state["search_rows"] = []
if "bulk_urls" not in st.session_state:
    st.session_state["bulk_urls"] = ""
if "comments_rows" not in st.session_state:
    st.session_state["comments_rows"] = []

with st.sidebar:
    st.title("Research controls")
    st.caption("Runs only when you press a button.")
    if has_credentials():
        st.success("Reddit OAuth keys configured")
    else:
        st.warning("API credentials not configured")
        st.caption("Copy .env.example to .env and add Reddit-approved OAuth credentials.")
    st.divider()
    st.subheader("Cost protection")
    st.write("AI calls: **0**")
    st.write("Scheduled jobs: **0**")
    st.write("External data service: **Reddit OAuth API**")
    st.caption("Reddit may impose access restrictions, rate limits, and fees under your approved agreement.")
    st.divider()
    st.caption("Research themes are keyword matches, not proven beliefs. Always review source links.")

st.title("Reddit Research Studio")
st.markdown(
    '<div class="caption-pills">Find conversations · Collect comments · Uncover recurring language · Export research</div>',
    unsafe_allow_html=True,
)
st.info(
    "Reddit API approval is required. This tool does not bypass restrictions. "
    "Use approved access for your purpose, including commercial research."
)

tab_find, tab_scrape, tab_themes = st.tabs(
    ["01 · Find threads", "02 · Scrape comments", "03 · Analyze themes"]
)

with tab_find:
    st.subheader("Find relevant Reddit discussions")
    st.caption("Search posts by the words your audience uses. Select as many links as you need.")
    with st.form("find_form"):
        c1, c2 = st.columns([3, 1])
        with c1:
            query = st.text_input("Search phrase", placeholder="e.g. knee pain, wasted money, what really worked")
        with c2:
            subreddit = st.text_input("Subreddit", value="all", help="Use all for the whole site, or a subreddit name.")
        c3, c4, c5 = st.columns(3)
        with c3:
            search_sort = st.selectbox("Sort", ["relevance", "top", "new", "comments"])
        with c4:
            time_filter = st.selectbox("Time range", ["all", "year", "month", "week", "day", "hour"])
        with c5:
            search_limit = st.slider("Max posts", 10, 100, 50, step=10)
        search_button = st.form_submit_button("Find threads", type="primary")
    if search_button:
        if not has_credentials():
            st.error("Add your approved Reddit API credentials before searching.")
        else:
            try:
                with st.spinner("Searching Reddit using OAuth..."):
                    st.session_state["search_rows"] = search_posts(
                        get_client(), query, subreddit, search_sort, time_filter, search_limit
                    )
                st.success(f"Found {len(st.session_state['search_rows'])} posts.")
            except Exception as exc:
                st.error(f"Reddit search failed: {exc}")

    rows = st.session_state["search_rows"]
    if rows:
        results = pd.DataFrame(rows)
        st.caption("Tick the posts you want. The source link can also be opened directly.")
        edited = st.data_editor(
            results,
            key="post_picker",
            use_container_width=True,
            hide_index=True,
            num_rows="fixed",
            disabled=[column for column in results.columns if column != "selected"],
            column_order=["selected", "title", "subreddit", "comments", "score", "url"],
            column_config={
                "selected": st.column_config.CheckboxColumn("Select", default=False),
                "title": st.column_config.TextColumn("Discussion", width="large"),
                "comments": st.column_config.NumberColumn("Comments"),
                "url": st.column_config.LinkColumn("Source link"),
            },
        )
        picked = edited.loc[edited["selected"], "url"].tolist()
        c1, c2 = st.columns([1, 3])
        with c1:
            if st.button(f"Queue {len(picked)} selected threads", type="primary", disabled=not picked):
                existing = st.session_state["bulk_urls"]
                combined = "\n".join([existing.strip(), *picked]).strip()
                st.session_state["bulk_urls"] = combined
                st.success("Added to the scrape queue. Open tab 02.")
        with c2:
            st.caption("Copy selected links from the box below or add them to the queue.")
        if picked:
            st.code("\n".join(picked), language=None)

with tab_scrape:
    st.subheader("Extract comments from multiple Reddit threads")
    st.caption(
        "Paste full post URLs, one per line. Reddit short links such as redd.it/POST_ID also work. "
        "Duplicate links are automatically removed."
    )
    urls = st.text_area(
        "Reddit thread URLs",
        key="bulk_urls",
        height=170,
        placeholder="https://www.reddit.com/r/example/comments/abc123/example_post/",
    )
    found_ids = thread_ids_from_text(urls)
    st.caption(f"{len(found_ids)} distinct valid post links in the queue")
    a, b, c = st.columns(3)
    with a:
        max_comments = st.slider("Max comments per thread", 100, 5000, 1000, step=100)
    with b:
        more_requests = st.slider(
            "Extra reply-page requests", 0, 64, 12,
            help="Higher values can retrieve more replies but use more Reddit API requests and take longer.",
        )
    with c:
        comment_sort = st.selectbox("Comment order", ["top", "best", "new", "controversial", "old"])
    st.caption(
        "The limits are caps, not guarantees. Reddit may omit or restrict comments; "
        "a large extraction can take time."
    )
    if st.button("Start manual extraction", type="primary", disabled=not found_ids):
        if not has_credentials():
            st.error("Add your Reddit API credentials first.")
        else:
            all_comments = []
            errors = []
            progress = st.progress(0)
            status = st.empty()
            try:
                reddit = get_client()
                for index, post_id in enumerate(found_ids):
                    status.write(f"Reading thread {index + 1} of {len(found_ids)} ({post_id})...")
                    try:
                        _, comments = scrape_post(
                            reddit, post_id, max_comments, more_requests, comment_sort
                        )
                        all_comments.extend(comments)
                    except Exception as exc:
                        errors.append(f"{post_id}: {exc}")
                    progress.progress((index + 1) / len(found_ids))
            except Exception as exc:
                errors.append(f"Could not initialize Reddit API client: {exc}")
            st.session_state["comments_rows"] = all_comments
            status.empty()
            if all_comments:
                st.success(
                    f"Collected {len(all_comments):,} comments from "
                    f"{len(set(row['post_id'] for row in all_comments))} threads."
                )
            else:
                st.warning("No comments collected.")
            for error in errors:
                st.warning(error)

    comments = st.session_state["comments_rows"]
    if comments:
        df = pd.DataFrame(comments)
        c1, c2 = st.columns(2)
        c1.metric("Comments collected", f"{len(df):,}")
        c2.metric("Threads represented", df["post_id"].nunique())
        st.dataframe(
            df[["comment", "score", "subreddit", "post_title", "comment_url"]],
            use_container_width=True,
            hide_index=True,
            column_config={"comment_url": st.column_config.LinkColumn("Open source")},
        )
        c1, c2 = st.columns(2)
        with c1:
            st.download_button(
                "Download raw comments CSV",
                df.to_csv(index=False).encode("utf-8-sig"),
                file_name="reddit-comments.csv",
                mime="text/csv",
                use_container_width=True,
            )
        with c2:
            st.download_button(
                "Download raw comments JSON",
                df.to_json(orient="records", force_ascii=False, indent=2).encode("utf-8"),
                file_name="reddit-comments.json",
                mime="application/json",
                use_container_width=True,
            )

with tab_themes:
    st.subheader("Turn comment language into research themes")
    st.caption(
        "These are deterministic keyword tags, not AI interpretations or proof of a person's beliefs. "
        "One comment can match multiple themes."
    )
    comments = st.session_state["comments_rows"]
    if not comments:
        st.info("Scrape some comments in tab 02 to start analyzing themes.")
    else:
        tagged = add_labels(comments)
        tagged_df = pd.DataFrame(tagged)
        counts = {name: sum(name in row["themes"].split(" | ") for row in tagged) for name in THEMES}
        st.bar_chart(pd.DataFrame({"Matched comments": counts.values()}, index=list(counts)))
        filter_theme = st.selectbox("Filter results", ["All comments", *THEMES.keys(), "Uncategorized"])
        if filter_theme == "All comments":
            visible = tagged_df
        else:
            visible = tagged_df[
                tagged_df["themes"].apply(lambda s: filter_theme in s.split(" | "))
            ]
        st.caption(f"Showing {len(visible):,} comments")
        st.dataframe(
            visible[["themes", "comment", "score", "comment_url", "post_title"]],
            use_container_width=True,
            hide_index=True,
            column_config={"comment_url": st.column_config.LinkColumn("Source")},
        )
        col_a, col_b, col_c = st.columns(3)
        with col_a:
            st.download_button(
                "Download tagged CSV",
                tagged_df.to_csv(index=False).encode("utf-8-sig"),
                file_name="reddit-themes.csv",
                mime="text/csv",
                use_container_width=True,
            )
        with col_b:
            st.download_button(
                "Download tagged JSON",
                tagged_df.to_json(orient="records", force_ascii=False, indent=2).encode("utf-8"),
                file_name="reddit-themes.json",
                mime="application/json",
                use_container_width=True,
            )
        with col_c:
            st.download_button(
                "Download research summary",
                markdown_report(tagged).encode("utf-8"),
                file_name="reddit-research-summary.md",
                mime="text/markdown",
                use_container_width=True,
            )
        st.warning(
            "Use these patterns to generate hypotheses, then read the complete linked discussions. "
            "Avoid assuming anything about commenters' health, identity, or motivations."
        )
