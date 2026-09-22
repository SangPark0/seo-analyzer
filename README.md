# SEO Analyzer

Paste a URL and get a report on its meta tags, with Google and social previews, a score, and recommendations.

## Run it

```bash
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Then open http://127.0.0.1:5001

## How the code is organized

| File | What it does |
|------|--------------|
| `app.py` | Flask web server: serves the page and the `/api/analyze` endpoint |
| `analyzer.py` | Fetches the HTML, extracts the tags, scores them, writes recommendations |
| `templates/index.html` | The page layout |
| `static/app.js` | Sends the URL to the backend and draws the report |
| `static/style.css` | Styles (mobile-friendly) |
