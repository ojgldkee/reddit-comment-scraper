# Reddit Research — Click to Collect

**A browser extension that lets you click Reddit posts and immediately queue their comments for research.** Browse Reddit search results or subreddits normally; click **Start selecting**, then click any Reddit post you want. The extension will collect comments using approved Reddit OAuth access through a local Python bridge. It does **not** spend OpenAI/OpenRouter credits or run scheduled scrapes.

## Browser workflow (Chrome / Edge)

1. Start the local Python collector on your computer (instructions below).
2. Install the unpacked Chrome extension from the **extension/** folder.
3. Click the extension's icon and paste the pairing code shown in your terminal.
4. Browse https://www.reddit.com/search/ or any subreddit feed.
5. Click **Start selecting** in the floating bottom-left toolbar.
6. Click the post cards you want to research. **Each click immediately queues that thread's comments**—no links to copy or paste.
7. Click more posts as you scroll. A running count shows selected posts and collected comments.
8. Click **Done selecting** to return to regular browsing.
9. Click **Results / exports** to see a live log, search comments, filter keyword themes, and download **CSV, JSON, Markdown summary, or plain text**.

On a single post's page, click **Collect this thread**. You can also choose **Copy links**, **Queue all** (retry after reconnecting), **Stop** or **Reset**.

### Install the collector

Requires Python 3.11+ and **Reddit's explicit approval to use its Data API**. Commercial research requires Reddit's written authorization. See [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy).

Open a terminal on your computer:

~~~bash
git clone https://github.com/ojgldkee/reddit-comment-scraper.git
cd reddit-comment-scraper
python -m venv .venv
~~~

Activate the environment:

- macOS/Linux: source .venv/bin/activate
- Windows PowerShell: .venv\Scripts\Activate.ps1

Then install:

~~~bash
pip install -r requirements.txt
~~~

Copy **.env.example** to **.env**. Add your approved Reddit app's **REDDIT_CLIENT_ID**, **REDDIT_CLIENT_SECRET** and a descriptive **REDDIT_USER_AGENT**. Never commit the .env file.

Start the local bridge:

~~~bash
python bridge.py
~~~

Your terminal displays a private pairing code. Leave this terminal running during research. Only the local Python service sees the Reddit API credentials. **The extension never stores your Reddit client secret.**

### Install the browser extension

1. Open **chrome://extensions** in Chrome, or **edge://extensions** in Edge.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's **extension** folder—not the repository root.
5. Pin the new **Reddit Research – Click to Collect** extension.
6. Click its icon, paste the pairing code from the terminal, and select **Save & connect**.
7. The popup should say **Connected**. If it reports missing OAuth credentials, complete the .env file and restart the bridge.
8. Browse Reddit. The floating toolbar will appear. Click **Start selecting**, then click posts to collect comments.

**Important:** GitHub is hosting the *source code*, not a live online collector. The local Python bridge must be running for the extension to fetch comments. This is an **unpublished, unpacked extension**; it is not installed automatically or listed on the Chrome Web Store.

### Comment controls

In the extension popup you can choose:

| Option | What it does |
| --- | --- |
| Maximum comments per thread | Caps saved comments for each selected post (250–5,000) |
| Extra reply requests | Controls PRAW's additional "MoreComments" expansion requests (0–64) |
| Comment sort | Top, best, new, controversial, or old |

Reddit limits and API permissions may prevent all comments from being retrieved. The tool does not guarantee a particular speed or comment count.

### Safety and privacy

- The Python server binds only to **127.0.0.1**, uses a per-run pairing token, and does **not** allow cross-origin website access.
- Selecting posts and fetching comments are initiated by a user click only. There are no recurring collectors, agents, or AI inference calls.
- All collected comments and logs are held **in local memory** until you click Reset or shut down Python. No Reddit content is committed to GitHub.
- Raw comment text is **not sent to OpenAI, OpenRouter, or other LLM services**.
- CSV export guards against spreadsheet-formula injection when opening comments in Excel.
- Research themes are simple, overlapping **keyword matches**, not proven psychological beliefs. Review context and original sources; do not impersonate commenters or turn guesses into testimonials.
- Only collect, retain, or reuse Reddit data within the scope of your API permission and Reddit's deletion rules. In particular, commercial marketing research requires appropriate authorization.

**Approval is required even if you personally browse Reddit in your own browser.** This extension is not a workaround for Reddit's API or scraping restrictions.

## Optional old interface

The original Streamlit tool is still available if you want to search Reddit from a dashboard or paste a batch of URLs manually:

~~~bash
streamlit run app.py
~~~

It uses the same approved Reddit OAuth credentials and has separate in-app results. The browser extension uses **bridge.py**, not Streamlit.

## Project files

- **extension/manifest.json** — Chrome/Edge Manifest V3 extension
- **extension/content.js** — Floating Reddit post selector
- **extension/background.js** — Secure localhost request proxy
- **extension/popup.html / popup.js** — Pairing and comment limits
- **extension/results.html / results.js** — Live extraction dashboard and downloads
- **bridge.py** — Local token-protected collection server
- **reddit_core.py** — Reddit API logic and local keyword tagging
- **app.py** — Original Streamlit tool
- **tests/** — Local unit tests

Run tests using:

~~~bash
python -m unittest discover -s tests -v
~~~

**This is a local project, not a hosted service or a paid scraping tool.** The interface and tests are included in source, but a real live scrape requires installation, Reddit approval, and working Reddit OAuth credentials.
