"""
analyzer.py - The "brain" of the SEO Analyzer.

This module does three jobs:
  1. fetch_html()   -> download a web page's HTML using `requests`
  2. extract_tags() -> pull out the SEO-related tags using BeautifulSoup
  3. build_checks() -> compare those tags against best practices, producing
                       a list of pass/warn/fail checks and an overall score

It has no Flask code in it, so you can test it on its own, e.g.:
    python3 -c "from analyzer import analyze; print(analyze('https://example.com'))"
"""

from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


# Some websites block requests that don't look like they come from a browser,
# so we send a browser-like User-Agent header.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

# How many seconds to wait for a site before giving up.
TIMEOUT_SECONDS = 10


class AnalyzerError(Exception):
    """An error with a friendly message we can show directly to the user."""


# ---------------------------------------------------------------------------
# Step 0: clean up the URL the user typed
# ---------------------------------------------------------------------------

def normalize_url(raw_url):
    """Turn user input like 'example.com' into 'https://example.com'.

    Raises AnalyzerError if the input can't be a valid web address.
    """
    url = (raw_url or "").strip()
    if not url:
        raise AnalyzerError("Please enter a URL.")

    # If the user left off the scheme ("example.com"), assume https.
    if "://" not in url:
        url = "https://" + url

    parsed = urlparse(url)

    # We only analyze normal web pages (not ftp://, file://, etc.).
    if parsed.scheme not in ("http", "https"):
        raise AnalyzerError("Only http:// and https:// URLs are supported.")

    # A real domain needs at least one dot (e.g. "example.com"), or be localhost.
    host = parsed.hostname or ""
    if not host or ("." not in host and host != "localhost"):
        raise AnalyzerError(f"'{raw_url}' doesn't look like a valid URL. Try something like example.com")

    return url


# ---------------------------------------------------------------------------
# Step 1: download the page
# ---------------------------------------------------------------------------

def fetch_html(url):
    """Download the page and return (final_url, html_text).

    `final_url` may differ from `url` if the site redirected us
    (e.g. http -> https, or example.com -> www.example.com).
    """
    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT_SECONDS)
    except requests.exceptions.Timeout:
        raise AnalyzerError(f"The site took longer than {TIMEOUT_SECONDS} seconds to respond.")
    except requests.exceptions.ConnectionError:
        raise AnalyzerError("Couldn't connect to that site. Check the URL is correct and the site is online.")
    except requests.exceptions.RequestException as exc:
        raise AnalyzerError(f"Couldn't fetch the page: {exc}")

    # 4xx / 5xx status codes mean the server refused or failed.
    if response.status_code >= 400:
        raise AnalyzerError(f"The site responded with an error (HTTP {response.status_code}).")

    # Make sure we actually got a web page, not a PDF or image.
    content_type = response.headers.get("Content-Type", "")
    if "html" not in content_type.lower():
        raise AnalyzerError(f"That URL isn't an HTML page (it returned '{content_type or 'unknown type'}').")

    return response.url, response.text


# ---------------------------------------------------------------------------
# Step 2: pull the SEO tags out of the HTML
# ---------------------------------------------------------------------------

def _meta(soup, **attrs):
    """Find a <meta> tag matching `attrs` and return its `content`, or None.

    Example: _meta(soup, property="og:title") finds
        <meta property="og:title" content="...">
    """
    tag = soup.find("meta", attrs=attrs)
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def extract_tags(html, page_url):
    """Parse the HTML and return a dictionary of the SEO tags we care about."""
    soup = BeautifulSoup(html, "html.parser")

    # <title>...</title>
    title = soup.title.get_text(strip=True) if soup.title else None

    # <link rel="canonical" href="...">
    canonical_tag = soup.find("link", rel="canonical")
    canonical = canonical_tag.get("href") if canonical_tag else None

    # Favicon: <link rel="icon"> or <link rel="shortcut icon">.
    # BeautifulSoup treats `rel` as a list of words, so we check each word.
    favicon = None
    for link in soup.find_all("link", rel=True):
        if "icon" in [r.lower() for r in link["rel"]] and link.get("href"):
            favicon = link["href"]
            break

    tags = {
        "title": title or None,
        "description": _meta(soup, name="description"),
        "og_title": _meta(soup, property="og:title"),
        "og_description": _meta(soup, property="og:description"),
        "og_image": _meta(soup, property="og:image"),
        "og_url": _meta(soup, property="og:url"),
        "twitter_card": _meta(soup, name="twitter:card"),
        "twitter_title": _meta(soup, name="twitter:title"),
        "twitter_description": _meta(soup, name="twitter:description"),
        "twitter_image": _meta(soup, name="twitter:image"),
        "canonical": canonical,
        "robots": _meta(soup, name="robots"),
        "viewport": _meta(soup, name="viewport"),
        "favicon": favicon,
    }

    # Links in HTML are often relative ("/logo.png"). Convert them to full
    # URLs ("https://site.com/logo.png") so the browser can display them.
    for key in ("og_image", "twitter_image", "favicon", "canonical"):
        if tags[key]:
            tags[key] = urljoin(page_url, tags[key])

    # Most browsers look for /favicon.ico even without a <link> tag,
    # so use that as a fallback for the preview (but not for the check).
    tags["favicon_fallback"] = tags["favicon"] or urljoin(page_url, "/favicon.ico")

    return tags


# ---------------------------------------------------------------------------
# Step 3: grade the tags and write recommendations
# ---------------------------------------------------------------------------

def _check(name, status, value, message, weight):
    """Build one check result.

    status is one of: "pass" (good), "warn" (present but could be better),
    "fail" (missing). `weight` is how many points this check is worth.
    """
    return {"name": name, "status": status, "value": value, "message": message, "weight": weight}


def _length_check(name, value, low, high, weight, missing_msg):
    """Shared logic for text tags that have an ideal length range."""
    if not value:
        return _check(name, "fail", None, missing_msg, weight)
    n = len(value)
    if n < low:
        return _check(name, "warn", value, f"{n} characters - a bit short. Aim for {low}-{high}.", weight)
    if n > high:
        return _check(name, "warn", value, f"{n} characters - may get cut off in search results. Aim for {low}-{high}.", weight)
    return _check(name, "pass", value, f"{n} characters - great length.", weight)


def _presence_check(name, value, weight, ok_msg, missing_msg):
    """Shared logic for tags where we only care whether they exist."""
    if value:
        return _check(name, "pass", value, ok_msg, weight)
    return _check(name, "fail", None, missing_msg, weight)


def build_checks(tags):
    """Return a list of checks. Weights reflect how important each tag is."""
    checks = [
        # --- Basic SEO (most important) ---
        _length_check("Title", tags["title"], 30, 60, 20,
                      "Missing <title>. This is the headline shown in Google - add one!"),
        _length_check("Meta description", tags["description"], 70, 160, 15,
                      'Missing. Add <meta name="description" content="..."> to control the snippet under your link in Google.'),

        # --- Open Graph (Facebook, LinkedIn, Slack, iMessage...) ---
        _presence_check("og:title", tags["og_title"], 8,
                        "Present.", "Missing. Social sites will guess a title - add og:title to control it."),
        _presence_check("og:description", tags["og_description"], 6,
                        "Present.", "Missing. Add og:description for a summary under shared links."),
        _presence_check("og:image", tags["og_image"], 10,
                        "Present.", "Missing. Links without an image get far fewer clicks - add og:image (1200x630 px recommended)."),
        _presence_check("og:url", tags["og_url"], 4,
                        "Present.", "Missing. Add og:url with the page's permanent address."),

        # --- Twitter / X ---
        _presence_check("twitter:card", tags["twitter_card"], 6,
                        "Present.", 'Missing. Add <meta name="twitter:card" content="summary_large_image"> for a rich preview on X/Twitter.'),

        # --- Technical ---
        _presence_check("Canonical URL", tags["canonical"], 8,
                        "Present.", 'Missing. Add <link rel="canonical" href="..."> so search engines know the "main" version of this page.'),
        _presence_check("Viewport", tags["viewport"], 10,
                        "Present - page is set up for mobile.",
                        'Missing. Add <meta name="viewport" content="width=device-width, initial-scale=1"> - Google ranks mobile-friendly pages higher.'),
        _presence_check("Favicon", tags["favicon"], 5,
                        "Present.", 'Missing <link rel="icon">. A favicon shows in browser tabs and some search results.'),
    ]

    # Robots is special: being *missing* is fine (default = index everything),
    # but "noindex" is a big problem because it hides the page from Google.
    robots = tags["robots"]
    if robots and "noindex" in robots.lower():
        checks.append(_check("Robots", "fail", robots,
                             '"noindex" tells search engines NOT to show this page. Remove it unless that\'s intentional.', 8))
    elif robots:
        checks.append(_check("Robots", "pass", robots, "Page can be indexed.", 8))
    else:
        checks.append(_check("Robots", "pass", None, "Not set - search engines will index the page by default (that's fine).", 8))

    return checks


def calculate_score(checks):
    """Score out of 100: full points for pass, half for warn, zero for fail."""
    earned = 0
    possible = 0
    for c in checks:
        possible += c["weight"]
        if c["status"] == "pass":
            earned += c["weight"]
        elif c["status"] == "warn":
            earned += c["weight"] / 2
    return round(earned / possible * 100)


# ---------------------------------------------------------------------------
# Put it all together
# ---------------------------------------------------------------------------

def analyze(raw_url):
    """Run the full analysis and return a dictionary ready to send as JSON."""
    url = normalize_url(raw_url)
    final_url, html = fetch_html(url)
    tags = extract_tags(html, final_url)
    checks = build_checks(tags)
    return {
        "url": final_url,
        "domain": urlparse(final_url).hostname,
        "tags": tags,
        "checks": checks,
        "score": calculate_score(checks),
    }
