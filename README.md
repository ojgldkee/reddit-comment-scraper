# Reddit Research — Link Grabber + Comment Scraper

**Two steps:**
1. **Grab links** — Browse Reddit, click **Select posts**, then click posts you want. Click again to remove. This works **without a Reddit API key or running Python**.
2. **Scrape comments** — Open the **Open scraper** dashboard, review your links, and click **Scrape selected posts**. This step needs a local collector and Reddit-approved API credentials.

There is **no automatic scraping on post selection**, no paid AI calls and no scheduled jobs.

## 1. Install the Chrome or Edge link grabber

Open **chrome://extensions** in Chrome or **edge://extensions** in Edge.

1. Enable **Developer mode**.
2. Click **Load unpacked**.
3. Choose this repository's **extension** folder.
4. Pin the Reddit Research extension.
5. Open Reddit. Look for the small **Reddit Grabber** toolbar in the lower left.
6. Click **Select posts**, click posts to save links, then click **Finish selecting**. Selected posts are highlighted.
7. Click **Open scraper** to review your saved links. You can also paste links into the dashboard.

If you already installed an earlier version: click **Reload** on the extension page and **refresh Reddit tabs**. Old scripts stay active in previously opened tabs.

**You do NOT need to configure an API client or start Python to save links.**

## 2. Set up the comment extractor (requires approved Reddit API access)

Reddit requires API permission for collection. Commercial market research requires Reddit's explicit approval. See [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy).

On **Linux Mint**, from an existing clone:

~~~bash
cd ~/reddit-comment-scraper
source .venv/bin/activate
~~~

If the virtual environment and packages are not yet installed:

~~~bash
sudo apt install python3-venv python3-pip
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
~~~

After obtaining Reddit-approved credentials:

~~~bash
cp .env.example .env
nano .env
~~~

Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET and a descriptive REDDIT_USER_AGENT. Save, then start:

~~~bash
python bridge.py
~~~

The terminal displays a unique **pairing code**. Leave it open during collection. In **Open scraper**, expand **Connection setup**, enter the pairing code, and click **Save & connect**.

**Keep your client secret in the local .env file, never inside the browser extension.**

## 3. Scrape and export

- Review saved Reddit links; remove any you don't need or paste additional links.
- Click **Scrape selected posts**. This starts extraction manually.
- Follow collected comment count, completed threads, queue, and activity log.
- Search comments, filter keyword research themes, and download the full collection as CSV, JSON, Markdown summary, or plain text.
- **Stop** prevents additional queued threads from starting; one in-progress request may finish.
- **Reset results** clears extracted comments while keeping selected links for another run.
- **Clear links** removes selected links while preserving already extracted comments.

Reddit's rate limits and your API permissions determine what can be retrieved; collection speed and counts are not guaranteed. Keyword labels are research leads, not proof of commenters' beliefs or experiences.

## Troubleshooting

**I can select posts but Scrape selected fails:** That's expected until you run the Python bridge, enter its pairing code, and configure approved Reddit OAuth credentials.

**My old toolbar is still scraping posts on click:** Reload the extension and refresh your Reddit tabs.

**Linux Mint reports externally-managed-environment:** Activate the project virtual environment before installing packages. Do not use sudo pip or --break-system-packages.

**My saved posts don't appear:** Open the dashboard in the same Chrome profile where the extension was installed. Links are saved in that browser profile's local extension storage.

## Project files

- **extension/content.js** — Link selection only, no scraping
- **extension/popup.html, popup.js** — Simple saved-link counter and dashboard launcher
- **extension/results.html, results.js** — Link list, manual scrape button, and exports
- **extension/background.js** — Manual localhost bridge requests
- **bridge.py** — Local comment collector, export endpoints, and in-memory queue
- **reddit_core.py** — Approved Reddit OAuth collection and offline keyword labels
- **app.py** — Optional previous Streamlit interface
- **tests/** — Local tests

~~~bash
python -m unittest discover -s tests -v
~~~

This project runs on your computer; GitHub stores the source. It is not a publicly hosted scraper or an installed Chrome Web Store product.
