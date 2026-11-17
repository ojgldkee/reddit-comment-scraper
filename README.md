# Reddit Comment Research Studio

A manual, browser-based Reddit research tool for finding discussions, collecting permitted public comments from multiple threads, and organizing themes for ad and audience research.

## What it does

- **Thread finder:** search Reddit by phrase, sort, date range, and optional subreddit; select many threads and copy all links at once.
- **Bulk comment extractor:** paste or queue multiple Reddit post URLs; retrieve comments through Reddit's official OAuth API; export CSV and JSON.
- **Belief research:** automatically tag **problems, desired outcomes, objections, past experiences, and barriers** with *local keyword rules*, not a paid AI model. Review original comment context before using themes.
- **No scheduled work, AI calls, or OpenAI credits.** Searches and scraping run only when you press a button.

## Setup

Requires Python 3.11 or newer and **Reddit-approved API access**.

1. Get explicit approval from Reddit to access the API for your intended use. Commercial market research and data mining may require a separate agreement: https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy
2. Create or use Reddit OAuth app credentials approved for this use.
3. Clone this repository and install dependencies:

~~~bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
~~~

On Windows, activate with .venv\Scripts\activate instead.

4. Copy .env.example to .env and enter your OAuth client ID and client secret. Never commit .env or API keys.
5. Start the interface:

~~~bash
streamlit run app.py
~~~

6. Open the local URL printed in your terminal. Use **Find threads**, **Scrape comments**, then **Analyze beliefs**.

For Streamlit hosting, enter the same keys in app secrets instead. Do not put real credentials in the public repo.

## Rate limits and access

The app uses PRAW, Reddit's OAuth API client, and respects Reddit's API rate limits. It does not evade blocked access, CAPTCHA, login, or paywalls. Your approved API permissions and rate limits determine what can be collected. Large threads can require many requests and may not return every comment. The "more-comment requests" slider limits work per thread; a high limit can take time. This app does not guarantee thousands of comments in minutes.

Reddit's API policies and agreements control collection, storage, analysis, redistribution, and deletion of Reddit content. Only use this with permission, including for commercial market research. Delete exported data when required and avoid uploading comments to third-party AI systems without authorization.

## Research interpretation

Keyword labels are *research leads*, not evidence of someone's actual beliefs, medical needs, personal traits, or why they feel a certain way. Labels can overlap and can be wrong. Read the source-linked comments before writing advertising angles; never present inferred experiences as real customer testimonials.

## Running tests

~~~bash
python -m unittest discover -s tests -v
~~~

## Files

- app.py — Streamlit interface
- reddit_core.py — URL validation, Reddit fetches, CSV-ready data, rule-based tagging
- requirements.txt — packages
- .env.example — credential template
- tests/test_core.py — parsing and labeling tests

Built for manual, cost-controlled research. No automatic background processing.