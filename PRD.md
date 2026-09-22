# SEO Analyzer - PRD

## Goal
A web app that analyze SEO of an any website. When pasting a URL, the app generates a report of the website's meta tags, with visual previews and optimization recommendations. 

## Features (MVP)

1. An input box for a URL with "Analyze" button
2. Visual previews such as the website thumbnail, google search result, social media previews
3. Summary score (visually) 
4. List of what's present/missing with a short recommendations for each issue
5.  The backend fetches the page's HTML and extracts:
   - <title> and meta description
   - Open Graph tags (og:title, og:description, og:image, og:url)
   - Twitter card tags
   - Canonical URL, robots meta, viewport, favicon 
6. Clear error messages when the URL is invalid


## Tech Stack
- Python 3 + Flask backend
- requests + BeautifulSoup for fetching and parsing
- Plain HTML/CSS/JavaScript frontend (no framework), clean and
  mobile-friendly
- Dependencies listed in requirements.txt
- Must run locally with `python3 app.py`

## Out of scope for now
User accounts, saving history, database