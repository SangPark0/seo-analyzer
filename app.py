"""
app.py - The Flask web server.

It has just two routes:
  GET  /             -> serves the web page (templates/index.html)
  POST /api/analyze  -> receives {"url": "..."} and returns the SEO report as JSON

The browser JavaScript (static/app.js) calls /api/analyze and draws the results.

Run with:  python3 app.py
"""

from flask import Flask, jsonify, render_template, request

from analyzer import AnalyzerError, analyze

app = Flask(__name__)


@app.route("/")
def index():
    """Show the main page. Flask looks for this file in the templates/ folder."""
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    """Analyze the URL sent by the browser and return the report."""
    # silent=True returns None instead of raising if the body isn't valid JSON.
    data = request.get_json(silent=True) or {}
    url = data.get("url", "")

    try:
        report = analyze(url)
    except AnalyzerError as exc:
        # Expected problems (bad URL, site down...) -> friendly message, HTTP 400.
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        # Anything unexpected -> log it in the terminal and send a generic message.
        app.logger.exception("Unexpected error analyzing %s", url)
        return jsonify({"error": f"Something went wrong while analyzing the page: {exc}"}), 500

    return jsonify(report)


if __name__ == "__main__":
    # debug=True auto-reloads the server when you edit code and shows helpful errors.
    # Port 5001 is used because macOS uses port 5000 for AirPlay Receiver.
    app.run(debug=True, port=5001)
