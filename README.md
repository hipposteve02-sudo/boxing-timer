# Sling TV — AI Discoverability Audit Tool

An automated audit tool that scores how ready **Sling TV** is to be discovered, cited,
and recommended by AI platforms (ChatGPT, Claude, Perplexity, Gemini, voice assistants) —
the emerging **"retrieval economy."** It crawls Sling's public web presence, queries AI
APIs with real shopper prompts, and produces a scored report with prioritized,
engineering-ready remediation recommendations.

As AI-mediated search grows, streaming services that lack structured, machine-readable
content get systematically excluded from AI-generated recommendations when users ask
things like _"What's the cheapest live TV streaming service?"_ or _"How can I watch ESPN
without cable?"_ This tool gives the marketing team a concrete, **repeatable** way to
measure and track progress.

---

## What it scores (0–100)

| Module | File | Points | What it checks |
| --- | --- | --- | --- |
| **Schema.org structured data** | `auditors/schema-auditor.js` | 25 | JSON-LD presence + completeness across key pages (Product, FAQPage, BroadcastService, Organization, WebSite) |
| **Content structure** | `auditors/content-auditor.js` | 25 | Direct-answer openings, question-style headings, FAQ sections, and whether key facts are in crawlable (non-JS) text |
| **AI platform discovery** | `auditors/ai-discovery-auditor.js` | 35 | Queries Claude, OpenAI, and Perplexity with 10 standardized prompts; measures mention rate, position, pricing accuracy, and competitor ranking |
| **LLM / crawler guidance** | `auditors/llm-txt-auditor.js` | 15 | `/llm.txt`, AI-bot directives in `robots.txt`, sitemap coverage, Open Graph / Twitter meta |
| **Channel & pricing accessibility** | `auditors/sitemap-auditor.js` | bonus | Whether channel lists and plan pricing are extractable without JavaScript (folded into the schema score as up to +5) |

Scoring weights, target URLs, test prompts, and known pricing all live in
**`config/targets.js`** — the single source of truth for "what good looks like."

---

## Setup

```bash
npm install
cp .env.example .env      # then add your API keys
```

`.env` keys (any left blank → that AI platform is skipped, the rest of the audit still runs):

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PERPLEXITY_API_KEY=pplx-...
```

No keys handy? Use `--mock` to run the AI module against bundled fixture responses so you
can see the full report end-to-end.

---

## Usage

```bash
# Full audit (terminal report + JSON snapshot)
node cli.js audit --target sling

# Demo without API keys — uses canned AI fixtures
node cli.js audit --target sling --mock --output both

# Run a single module
node cli.js audit --target sling --module schema
node cli.js audit --target sling --module ai-discovery --mock

# Output formats: terminal (default) | json | html | both
node cli.js audit --target sling --output html

# Compare against a competitor (Phase 2 stub config)
node cli.js audit --target youtube-tv --mock

# Show score trend across past audits
node cli.js history --target sling
```

Reports are written to `./outputs/<target>-audit-<timestamp>.{json,html}`. JSON snapshots
are what `history` reads to render the trend table, so keep them around to track
improvement over audit cycles.

---

## How the AI discovery module works

For each of the 10 prompts in `config/targets.js`, the tool asks each platform the
question a real customer would ask, then inspects the answer:

- **Mentioned?** — does "Sling" / "Sling TV" appear?
- **Position** — first service named, in the top 3, or buried later
- **Pricing accuracy** — are stated prices within tolerance of Sling's real plan prices?
- **Recommended vs. mentioned** — is it actively recommended or just listed?
- **Competitor ranking** — is YouTube TV / DirecTV / Fubo / Philo ranked above Sling?

Platforms are queried concurrently (capped at 4 in flight). Missing keys are skipped with
a warning rather than failing the run.

---

## Project structure

```
config/targets.js              URLs, test prompts, known prices, scoring weights
auditors/
  http.js                      shared Axios fetch (UA, timeout, graceful failure)
  schema-auditor.js            Module 1 — Schema.org JSON-LD
  content-auditor.js           Module 2 — content structure
  ai-discovery-auditor.js      Module 3 — multi-platform AI querying
  llm-txt-auditor.js           Module 4 — llm.txt / robots / sitemap / meta
  sitemap-auditor.js           Module 5 — channel & pricing accessibility (bonus)
scoring/scorer.js              aggregate to 0–100 + ranked remediation roadmap
reporters/
  terminal-reporter.js         chalk-colored CLI report
  html-reporter.js             standalone HTML report (inline CSS)
fixtures/ai-responses/         canned AI responses for --mock mode
outputs/                       generated JSON + HTML reports
cli.js                         Commander.js entry point
```

---

## Notes on running in restricted networks

The crawl-based modules fetch live pages over HTTP. In sandboxed environments where
outbound web access is blocked, those modules degrade gracefully (pages are marked
unreachable and score 0 — no crash), and you can still demonstrate the full pipeline with
`--mock`. Against a normal network they return real findings.

---

## Roadmap (Phase 2)

- **Competitor benchmarking** — auto-run the same audit against YouTube TV, DirecTV, Fubo,
  Philo and emit a comparison table (config stubs already in place)
- **Playwright integration** — render JS-heavy pages to audit the full DOM
- **Slack / email alerts** — notify when AI discovery scores drop below a threshold
- **Scheduled audits** — weekly cron pushing results to a shared dashboard
