// app.js - Runs in the browser.
//
// Flow: user submits the form -> we POST the URL to /api/analyze ->
// Flask returns a JSON report -> we fill in the page with the results.

// Grab the elements we'll use often. `$` is just a short helper name.
const $ = (id) => document.getElementById(id);

const form = $("analyze-form");
const input = $("url-input");
const button = $("analyze-btn");

form.addEventListener("submit", async (event) => {
  // By default a form submit reloads the page. We don't want that.
  event.preventDefault();

  const url = input.value.trim();
  if (!url) {
    showError("Please enter a URL.");
    return;
  }

  // Reset the UI into a "loading" state.
  showError(null);
  $("results").hidden = true;
  $("loading").hidden = false;
  button.disabled = true;

  try {
    // Send the URL to our Flask backend as JSON.
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();

    // The backend sends {"error": "..."} when something went wrong.
    if (!response.ok) {
      showError(data.error || "Something went wrong.");
      return;
    }
    renderReport(data);
  } catch (err) {
    // This happens if our own Flask server is down or unreachable.
    showError("Couldn't reach the analyzer server. Is `python3 app.py` running?");
  } finally {
    // `finally` runs whether we succeeded or failed.
    $("loading").hidden = true;
    button.disabled = false;
  }
});

function showError(message) {
  const el = $("error");
  el.textContent = message || "";
  el.hidden = !message;
}

// ---------------------------------------------------------------------------
// Drawing the report
// ---------------------------------------------------------------------------

function renderReport(report) {
  renderScore(report);
  renderPreviews(report);
  renderChecks(report.checks);
  $("results").hidden = false;
}

function renderScore(report) {
  const score = report.score;

  // Pick a color and label based on the score.
  let color = "var(--fail)";
  let label = "Needs work";
  if (score >= 80) {
    color = "var(--pass)";
    label = "Great";
  } else if (score >= 50) {
    color = "var(--warn)";
    label = "Could be better";
  }

  $("score-value").textContent = score;
  $("score-label").textContent = label;
  $("score-url").textContent = report.url;

  // The ring is a CSS conic-gradient; we fill `score`% of the circle.
  const ring = $("score-ring");
  ring.style.setProperty("--score", score);
  ring.style.setProperty("--ring-color", color);

  // Count how many checks passed / warned / failed.
  const count = (status) => report.checks.filter((c) => c.status === status).length;
  $("score-counts").textContent =
    `${count("pass")} passed · ${count("warn")} warnings · ${count("fail")} missing`;
}

function renderPreviews(report) {
  const t = report.tags;

  // Social sites fall back to the regular title/description if OG tags are missing,
  // so our previews do the same. `||` picks the first value that isn't empty.
  const title = t.title || report.domain;
  const desc = t.description || "No meta description - Google will pick some text from the page.";
  const ogTitle = t.og_title || title;
  const ogDesc = t.og_description || t.description || "";
  const ogImage = t.og_image;

  // Website thumbnail: a free screenshot service by WordPress ("mShots").
  // The first request may show a "generating" placeholder; it's ready on re-analyze.
  $("thumb-img").src =
    "https://s0.wp.com/mshots/v1/" + encodeURIComponent(report.url) + "?w=800";

  // Google search result preview.
  $("g-favicon").src = t.favicon_fallback;
  $("g-domain").textContent = report.domain;
  $("g-url").textContent = report.url;
  $("g-title").textContent = truncate(title, 60);
  $("g-desc").textContent = truncate(desc, 160);

  // Facebook / LinkedIn preview.
  setImage($("fb-image"), ogImage);
  $("fb-domain").textContent = report.domain.toUpperCase();
  $("fb-title").textContent = ogTitle;
  $("fb-desc").textContent = ogDesc;

  // X / Twitter preview (prefers twitter:* tags, falls back to OG tags).
  setImage($("tw-image"), t.twitter_image || ogImage);
  $("tw-title").textContent = t.twitter_title || ogTitle;
  $("tw-desc").textContent = t.twitter_description || ogDesc;
  $("tw-domain").textContent = report.domain;
}

// Show an image as a background, or a "No image" placeholder if there isn't one.
function setImage(el, imageUrl) {
  if (imageUrl) {
    // JSON.stringify adds quotes and escapes, keeping the CSS url() safe.
    el.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
    el.textContent = "";
    el.classList.remove("empty");
  } else {
    el.style.backgroundImage = "";
    el.textContent = "No image (og:image missing)";
    el.classList.add("empty");
  }
}

function renderChecks(checks) {
  const list = $("checks");
  list.innerHTML = ""; // clear results from a previous analysis

  // Show problems first: fail, then warn, then pass.
  const order = { fail: 0, warn: 1, pass: 2 };
  const sorted = [...checks].sort((a, b) => order[a.status] - order[b.status]);

  const icons = { pass: "✓", warn: "!", fail: "✗" };

  for (const check of sorted) {
    const li = document.createElement("li");
    li.className = `check ${check.status}`;

    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.textContent = icons[check.status];

    const body = document.createElement("div");
    body.className = "check-body";

    const name = document.createElement("strong");
    name.textContent = check.name;

    const message = document.createElement("p");
    message.textContent = check.message;

    body.append(name, message);

    // Show the actual value found on the page, if there is one.
    if (check.value) {
      const value = document.createElement("code");
      value.textContent = check.value;
      body.append(value);
    }

    li.append(icon, body);
    list.append(li);
  }
  // Note: we always use `textContent` (never innerHTML) for data from the
  // analyzed site. That way a malicious page can't inject HTML/scripts into ours.
}

// Cut long text and add "…" - roughly how Google trims titles/descriptions.
function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
