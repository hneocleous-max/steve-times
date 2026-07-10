# The Steve Times

A personal morning broadsheet for Steve — printed fresh every day at 5am Cyprus
time and published to GitHub Pages.

**Live:** https://hneocleous-max.github.io/steve-times/

## What's in the paper

1. **Morning greeting** — AI-written, 3–4 sentences summarising the day
2. **Weather in Larnaca** — today + tomorrow (Open-Meteo, free, no key)
3. **Local News** — 5 headlines from Cyprus Mail / in-cyprus
4. **World News** — 5 headlines from BBC World
5. **Discovery of the Day** — one science/space/archaeology story (Phys.org,
   ScienceDaily or NASA) with a plain-English "why it matters" written by Claude

## How it works

`build.js` (plain Node, no dependencies) fetches everything, calls the
Anthropic API for the greeting and discovery explanation, and renders
`site/index.html`. The GitHub Action in `.github/workflows/daily.yml` runs it
on a schedule and deploys `site/` to Pages.

**Graceful failure:** every successful run saves its data to
`data/latest.json` (committed back to the repo). If a source is down the next
morning, that section is printed from yesterday's edition with a small italic
note — the page never breaks. If the Anthropic key is missing or the API is
down, a simple templated greeting is used instead.

## Setup

One secret is required: `ANTHROPIC_API_KEY`
(repo → Settings → Secrets and variables → Actions → New repository secret),
or via CLI:

```sh
gh secret set ANTHROPIC_API_KEY --repo hneocleous-max/steve-times
```

Run it manually any time:

```sh
gh workflow run daily.yml --repo hneocleous-max/steve-times
```
