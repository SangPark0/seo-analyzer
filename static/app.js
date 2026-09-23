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
  hideHistory();
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
    // Only remember URLs that worked, so typos don't clutter the history.
    saveToHistory(url);
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

// ---------------------------------------------------------------------------
// Recent URLs (shown in a dropdown when the input is clicked)
// ---------------------------------------------------------------------------
//
// We keep the list in `localStorage`: a small key/value store built into the
// browser. It survives page reloads, but lives only in this browser.
// localStorage can only store text, so we convert the list to/from JSON.
// Every access is wrapped in try/catch because some browsers block it
// (e.g. private windows) - the app should still work, just without history.

const HISTORY_KEY = "seo-analyzer-history";
const HISTORY_MAX = 5;
const historyList = $("history");

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveToHistory(url) {
  // Put the newest URL first, drop any older copy of it, keep only 5.
  const list = [url, ...loadHistory().filter((u) => u !== url)].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable - silently skip.
  }
}

// `filter` is true only while the user is typing. On click/focus we show the
// whole list; otherwise the URL left in the box from the last analysis would
// filter out every other entry.
function showHistory(filter = false) {
  const typed = filter ? input.value.trim().toLowerCase() : "";
  const matches = loadHistory().filter((u) => u.toLowerCase().includes(typed));

  if (matches.length === 0) {
    hideHistory();
    return;
  }

  historyList.innerHTML = "";
  const label = document.createElement("li");
  label.className = "history-label";
  label.textContent = "Recent";
  historyList.append(label);

  for (const url of matches) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button"; // a plain button, so it doesn't submit the form by itself
    btn.textContent = url;
    btn.addEventListener("click", () => {
      input.value = url;
      hideHistory();
      form.requestSubmit(); // analyze it right away
    });
    li.append(btn);
    historyList.append(li);
  }
  historyList.hidden = false;
}

function hideHistory() {
  historyList.hidden = true;
}

// The arrow functions make sure showHistory gets the `filter` value we want
// (not the event object the browser passes to listeners).
input.addEventListener("focus", () => showHistory(false));
input.addEventListener("click", () => showHistory(false)); // re-open if already focused
input.addEventListener("input", () => showHistory(true));  // filter as the user types
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideHistory();
});
// Clicking a history item would first "blur" (unfocus) the input and hide the
// list before the click registers. preventDefault on mousedown keeps focus
// in the input, so the click goes through.
historyList.addEventListener("mousedown", (e) => e.preventDefault());
input.addEventListener("blur", hideHistory);

// ---------------------------------------------------------------------------
// Preview carousel (‹ › buttons)
// ---------------------------------------------------------------------------

const previews = $("previews");
const prevBtn = $("prev-btn");
const nextBtn = $("next-btn");

// Scroll by exactly one card. We measure the distance from the start of the
// 1st card to the start of the 2nd (card width + gap). getBoundingClientRect()
// keeps fractions of a pixel; offsetWidth would round them and drift.
function scrollPreviews(direction) {
  const cards = previews.querySelectorAll(".card");
  const step = cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left;
  previews.scrollBy({ left: direction * step });
}

// Hide ‹ at the start of the row and › at the end.
function updateCarouselButtons() {
  const maxScroll = previews.scrollWidth - previews.clientWidth;
  prevBtn.hidden = previews.scrollLeft <= 1;
  nextBtn.hidden = previews.scrollLeft >= maxScroll - 1; // -1 absorbs rounding
}

prevBtn.addEventListener("click", () => scrollPreviews(-1));
nextBtn.addEventListener("click", () => scrollPreviews(1));
previews.addEventListener("scroll", updateCarouselButtons);
window.addEventListener("resize", updateCarouselButtons);

// ---------------------------------------------------------------------------

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

  // Start each new report at the first preview. This must run after the
  // results are visible, because hidden elements have no size to measure.
  previews.scrollTo({ left: 0, behavior: "instant" });
  updateCarouselButtons();
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
