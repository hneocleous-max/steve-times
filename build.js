#!/usr/bin/env node
/**
 * The Steve Times — daily build script.
 *
 * Fetches weather (Open-Meteo), Cyprus + world news (RSS), and a science
 * discovery (RSS), asks the Anthropic API to write the greeting and the
 * discovery explanation, then renders site/index.html.
 *
 * Graceful degradation: every section falls back to data/latest.json
 * (yesterday's edition) if its source is down, with a small note on the page.
 * No npm dependencies — Node 20+ only.
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CACHE_FILE = path.join(ROOT, "data", "latest.json");
const OUT_FILE = path.join(ROOT, "site", "index.html");

const TZ = "Asia/Nicosia";

// ---------------------------------------------------------------- utilities

async function fetchText(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SteveTimes/1.0; personal newspaper bot)",
        Accept: "*/*",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal RSS/Atom item parser — good enough for well-formed news feeds. */
function parseFeed(xml, limit = 8) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const entryBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of [...itemBlocks, ...entryBlocks]) {
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    let link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (!link || !link[1].trim()) {
      const href = block.match(/<link[^>]*href="([^"]+)"/i);
      if (href) link = [null, href[1]];
    }
    const desc = block.match(
      /<(?:description|summary|content:encoded)[^>]*>([\s\S]*?)<\/(?:description|summary|content:encoded)>/i
    );
    if (title && link) {
      items.push({
        title: decodeEntities(title[1]),
        link: decodeEntities(link[1]).trim(),
        summary: desc ? stripTags(desc[1]).slice(0, 600) : "",
      });
    }
    if (items.length >= limit) break;
  }
  return items;
}

async function firstWorkingFeed(urls, limit) {
  for (const url of urls) {
    try {
      const items = parseFeed(await fetchText(url), limit);
      if (items.length) return { items, source: url };
    } catch (e) {
      console.error(`feed failed: ${url}: ${e.message}`);
    }
  }
  throw new Error(`all feeds failed: ${urls.join(", ")}`);
}

// ---------------------------------------------------------------- weather

const WEATHER_CODES = {
  0: { desc: "Clear skies", icon: "☀️", masthead: "Fine weather" },
  1: { desc: "Mainly clear", icon: "🌤️", masthead: "Fine weather" },
  2: { desc: "Partly cloudy", icon: "⛅", masthead: "Fair skies" },
  3: { desc: "Overcast", icon: "☁️", masthead: "Cloudy skies" },
  45: { desc: "Foggy", icon: "🌫️", masthead: "Fog about" },
  48: { desc: "Freezing fog", icon: "🌫️", masthead: "Fog about" },
  51: { desc: "Light drizzle", icon: "🌦️", masthead: "A little drizzle" },
  53: { desc: "Drizzle", icon: "🌦️", masthead: "A little drizzle" },
  55: { desc: "Heavy drizzle", icon: "🌧️", masthead: "Drizzle about" },
  61: { desc: "Light rain", icon: "🌦️", masthead: "Some rain" },
  63: { desc: "Rain", icon: "🌧️", masthead: "Rain expected" },
  65: { desc: "Heavy rain", icon: "🌧️", masthead: "Heavy rain" },
  66: { desc: "Freezing rain", icon: "🌧️", masthead: "Icy rain" },
  67: { desc: "Freezing rain", icon: "🌧️", masthead: "Icy rain" },
  71: { desc: "Light snow", icon: "🌨️", masthead: "Snow flurries" },
  73: { desc: "Snow", icon: "❄️", masthead: "Snow expected" },
  75: { desc: "Heavy snow", icon: "❄️", masthead: "Heavy snow" },
  77: { desc: "Snow grains", icon: "❄️", masthead: "Snow about" },
  80: { desc: "Light showers", icon: "🌦️", masthead: "Passing showers" },
  81: { desc: "Showers", icon: "🌧️", masthead: "Showers about" },
  82: { desc: "Heavy showers", icon: "🌧️", masthead: "Heavy showers" },
  85: { desc: "Snow showers", icon: "🌨️", masthead: "Snow showers" },
  86: { desc: "Snow showers", icon: "🌨️", masthead: "Snow showers" },
  95: { desc: "Thunderstorms", icon: "⛈️", masthead: "Stormy weather" },
  96: { desc: "Thunderstorms", icon: "⛈️", masthead: "Stormy weather" },
  99: { desc: "Severe storms", icon: "⛈️", masthead: "Stormy weather" },
};

function weatherInfo(code) {
  return WEATHER_CODES[code] || { desc: "Changeable", icon: "🌥️", masthead: "Changeable weather" };
}

async function getWeather() {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=34.9167&longitude=33.6333" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
    `&timezone=${encodeURIComponent(TZ)}&forecast_days=2`;
  const data = JSON.parse(await fetchText(url));
  const d = data.daily;
  const day = (i) => ({
    date: d.time[i],
    code: d.weather_code[i],
    max: Math.round(d.temperature_2m_max[i]),
    min: Math.round(d.temperature_2m_min[i]),
    ...weatherInfo(d.weather_code[i]),
  });
  return { today: day(0), tomorrow: day(1) };
}

// ---------------------------------------------------------------- greeting

function buildGreeting(weather) {
  const time = new Date()
    .toLocaleTimeString("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s?(am|pm)/i, (m) => m.trim());
  const parts = [`Morning Steve, it's currently ${time}.`];
  if (weather) {
    parts.push(`This is the weather in Larnaca — ${weather.today.desc.toLowerCase()} today, around ${weather.today.max}°C.`);
  }
  parts.push("And here are today's top stories:");
  return parts.join(" ");
}

// ---------------------------------------------------------------- assembly

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function trySection(name, fn, cache, stale) {
  try {
    const value = await fn();
    return { value, fresh: true };
  } catch (e) {
    console.error(`section "${name}" failed: ${e.message}`);
    if (cache[name]) {
      stale.push(name);
      return { value: cache[name], fresh: false };
    }
    return { value: null, fresh: false };
  }
}

async function main() {
  const cache = loadCache();
  const stale = [];

  const [weatherR, localR, worldR, discoveryR] = await Promise.all([
    trySection("weather", getWeather, cache, stale),
    trySection(
      "local",
      async () => {
        // Prefer a blend of Cyprus Mail + in-cyprus; fall back to whichever works.
        const sources = [
          "https://cyprus-mail.com/feed/",
          "https://in-cyprus.philenews.com/feed/",
          "https://in-cyprus.com/feed/",
        ];
        const results = [];
        for (const url of sources) {
          try {
            results.push(parseFeed(await fetchText(url), 5));
          } catch (e) {
            console.error(`local feed failed: ${url}: ${e.message}`);
          }
        }
        const merged = [];
        // interleave so both papers get a look-in
        for (let i = 0; i < 5; i++) {
          for (const list of results) {
            if (list[i] && merged.length < 5 && !merged.some((m) => m.title === list[i].title)) {
              merged.push(list[i]);
            }
          }
        }
        if (!merged.length) throw new Error("no Cyprus headlines available");
        return merged.slice(0, 5);
      },
      cache,
      stale
    ),
    trySection(
      "world",
      async () => {
        const { items } = await firstWorkingFeed(
          [
            "https://feeds.bbci.co.uk/news/world/rss.xml",
            "https://feeds.skynews.com/feeds/rss/world.xml",
          ],
          5
        );
        return items.slice(0, 5);
      },
      cache,
      stale
    ),
    trySection(
      "discovery",
      async () => {
        const { items, source } = await firstWorkingFeed(
          [
            "https://phys.org/rss-feed/",
            "https://www.sciencedaily.com/rss/all.xml",
            "https://www.nasa.gov/feed/",
          ],
          3
        );
        // pick the first item with a decent summary
        const pick = items.find((i) => i.summary && i.summary.length > 80) || items[0];
        return { ...pick, source };
      },
      cache,
      stale
    ),
  ]);

  const weather = weatherR.value;
  const local = localR.value || [];
  const world = worldR.value || [];
  const discovery = discoveryR.value;

  // --- greeting + top-stories digest (no AI) ---
  const greeting = buildGreeting(weather);
  const discoveryExplanation = (discovery && discovery.summary) || "";

  // Merged front-page digest: alternate Cyprus and world headlines.
  const topStories = [];
  for (let i = 0; i < 5; i++) {
    for (const list of [local, world]) {
      if (list[i] && topStories.length < 6 && !topStories.some((s) => s.title === list[i].title)) {
        topStories.push(list[i]);
      }
    }
  }

  // --- persist cache for tomorrow's fallback ---
  const newCache = {
    weather: weather || cache.weather || null,
    local: local.length ? local : cache.local || [],
    world: world.length ? world : cache.world || [],
    discovery: discovery || cache.discovery || null,
    generated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(newCache, null, 2));

  // --- render ---
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    render({ weather, local, world, discovery, greeting, discoveryExplanation, topStories, stale })
  );
  console.log(`Edition written. Stale sections: ${stale.length ? stale.join(", ") : "none"}`);
}

// ---------------------------------------------------------------- template

function render({ weather, local, world, discovery, greeting, discoveryExplanation, topStories, stale }) {
  const now = new Date();
  const dateLine = now.toLocaleDateString("en-GB", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const weatherWord = weather ? weatherInfo(weather.today.code).masthead : null;
  const mastheadDate = weatherWord ? `${dateLine} — ${weatherWord} in Larnaca` : dateLine;

  const staleNote = (name, text) =>
    stale.includes(name)
      ? `<p class="stale">${escapeHtml(text)}</p>`
      : "";

  const newsList = (items) =>
    items
      .map(
        (i) =>
          `<li><a href="${escapeHtml(i.link)}" target="_blank" rel="noopener">${escapeHtml(i.title)}</a></li>`
      )
      .join("\n");

  const weatherCard = (label, d) => `
      <div class="wx-card">
        <div class="wx-label">${label}</div>
        <div class="wx-icon" aria-hidden="true">${d.icon}</div>
        <div class="wx-desc">${escapeHtml(d.desc)}</div>
        <div class="wx-temp">${d.max}°C</div>
        <div class="wx-low">low ${d.min}°C</div>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>The Steve Times — ${escapeHtml(dateLine)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Playfair+Display:ital,wght@0,600;0,800;1,600&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #1a1712;
    --paper: #f7f1e3;
    --rule: #2b2620;
    --faded: #6b6152;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: Georgia, "Times New Roman", serif;
    font-size: 22px;
    line-height: 1.55;
  }
  .sheet { max-width: 1000px; margin: 0 auto; padding: 24px 28px 60px; }

  /* masthead */
  .masthead { text-align: center; border-bottom: 4px double var(--rule); padding-bottom: 14px; }
  .masthead h1 {
    font-family: "UnifrakturMaguntia", Georgia, serif;
    font-weight: 400;
    font-size: clamp(3rem, 10vw, 5.5rem);
    margin: 10px 0 6px;
    letter-spacing: 1px;
  }
  .masthead .edition {
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1.5px solid var(--rule); border-bottom: 1.5px solid var(--rule);
    padding: 6px 4px; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 2px;
  }
  .masthead .edition span { white-space: nowrap; }
  .dateline { font-style: italic; font-size: 1.15rem; margin-top: 10px; }

  /* greeting */
  .greeting {
    border: 3px double var(--rule);
    margin: 28px 0;
    padding: 22px 30px;
    font-size: 1.35rem;
    line-height: 1.6;
  }
  .greeting p { margin: 0; }
  .greeting p::first-letter { font-size: 2.2em; font-family: "Playfair Display", Georgia, serif; float: left; line-height: 0.85; padding-right: 8px; padding-top: 4px; }
  .digest { margin: 18px 0 0; padding-left: 1.6em; }
  .digest li { padding: 7px 0; font-family: "Playfair Display", Georgia, serif; font-size: 1.2rem; }
  .digest a { color: var(--ink); text-decoration: none; }
  .digest a:hover, .digest a:focus { text-decoration: underline; text-underline-offset: 4px; }

  /* section headers */
  h2.section {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 1.6rem;
    text-transform: uppercase;
    letter-spacing: 3px;
    text-align: center;
    border-top: 3px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 10px 0;
    margin: 40px 0 20px;
  }

  /* weather */
  .wx-row { display: flex; gap: 32px; justify-content: center; flex-wrap: wrap; }
  .wx-card {
    text-align: center; padding: 18px 34px; border: 1.5px solid var(--rule);
    min-width: 240px; flex: 0 1 300px;
  }
  .wx-label { text-transform: uppercase; letter-spacing: 3px; font-size: 1rem; color: var(--faded); }
  .wx-icon { font-size: 5rem; line-height: 1.2; }
  .wx-desc { font-size: 1.3rem; font-style: italic; }
  .wx-temp { font-family: "Playfair Display", Georgia, serif; font-size: 3rem; font-weight: 800; margin-top: 4px; }
  .wx-low { color: var(--faded); font-size: 1.1rem; }

  /* news */
  .news-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 3rem; }
  .news-col:first-child { border-right: 1px solid var(--rule); padding-right: 3rem; }
  .news-col h2.section { margin-top: 0; }
  ul.headlines { list-style: none; margin: 0; padding: 0; }
  ul.headlines li { padding: 14px 0; border-bottom: 1px dotted var(--faded); }
  ul.headlines li:last-child { border-bottom: none; }
  ul.headlines a {
    color: var(--ink); text-decoration: none;
    font-family: "Playfair Display", Georgia, serif;
    font-weight: 600; font-size: 1.35rem; line-height: 1.4;
  }
  ul.headlines a:hover, ul.headlines a:focus { text-decoration: underline; text-underline-offset: 4px; }

  /* discovery */
  .discovery { border: 1.5px solid var(--rule); padding: 26px 34px; margin-top: 8px; }
  .discovery h3 {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 1.7rem; margin: 0 0 14px; line-height: 1.35;
  }
  .discovery h3 a { color: var(--ink); text-decoration: none; }
  .discovery h3 a:hover { text-decoration: underline; text-underline-offset: 4px; }
  .discovery .why { font-size: 1.3rem; }
  .discovery .why strong { font-variant: small-caps; letter-spacing: 1px; }

  .stale { font-style: italic; color: var(--faded); font-size: 1rem; margin: 4px 0 12px; text-align: center; }
  .missing { font-style: italic; color: var(--faded); text-align: center; padding: 20px 0; }

  footer {
    margin-top: 50px; border-top: 4px double var(--rule); padding-top: 14px;
    text-align: center; font-size: 0.95rem; color: var(--faded); font-style: italic;
  }

  @media (max-width: 720px) {
    body { font-size: 20px; }
    .sheet { padding: 16px 16px 40px; }
    .news-grid { grid-template-columns: 1fr; }
    .news-col:first-child { border-right: none; padding-right: 0; }
    .masthead .edition { font-size: 0.75rem; letter-spacing: 1px; }
  }
</style>
</head>
<body>
<div class="sheet">

  <header class="masthead">
    <div class="edition"><span>Personal Edition</span><span>Est. 2026</span><span>Price: One Smile</span></div>
    <h1>The Steve Times</h1>
    <div class="edition"><span>Larnaca &amp; The World</span><span>All the news Steve needs</span><span>Daily at dawn</span></div>
    <p class="dateline">${escapeHtml(mastheadDate)}</p>
  </header>

  <section class="greeting">
    <p>${escapeHtml(greeting)}</p>
    ${topStories && topStories.length ? `<ol class="digest">${topStories.map((s) => `<li><a href="${escapeHtml(s.link)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></li>`).join("\n")}</ol>` : ""}
  </section>

  <h2 class="section">Weather in Larnaca</h2>
  ${staleNote("weather", "Yesterday's forecast — the weather service was unavailable this morning.")}
  ${
    weather
      ? `<div class="wx-row">${weatherCard("Today", weather.today)}${weatherCard("Tomorrow", weather.tomorrow)}</div>`
      : `<p class="missing">The weather report failed to arrive this morning.</p>`
  }

  <div class="news-grid">
    <div class="news-col">
      <h2 class="section">Local News</h2>
      ${staleNote("local", "From yesterday's edition — the Cyprus wires were down this morning.")}
      ${local.length ? `<ul class="headlines">${newsList(local)}</ul>` : `<p class="missing">No word from Cyprus this morning.</p>`}
    </div>
    <div class="news-col">
      <h2 class="section">World News</h2>
      ${staleNote("world", "From yesterday's edition — the world wires were down this morning.")}
      ${world.length ? `<ul class="headlines">${newsList(world)}</ul>` : `<p class="missing">No word from the world this morning.</p>`}
    </div>
  </div>

  <h2 class="section">Discovery of the Day</h2>
  ${staleNote("discovery", "From yesterday's edition — the science desk was quiet this morning.")}
  ${
    discovery
      ? `<div class="discovery">
      <h3><a href="${escapeHtml(discovery.link)}" target="_blank" rel="noopener">${escapeHtml(discovery.title)}</a></h3>
      ${discoveryExplanation ? `<p class="why"><strong>Why it matters:</strong> ${escapeHtml(discoveryExplanation)}</p>` : ""}
    </div>`
      : `<p class="missing">The science desk had nothing for us today.</p>`
  }

  <footer>
    Printed with love for Steve, fresh every morning at five o'clock — Larnaca time.
  </footer>

</div>
</body>
</html>
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
