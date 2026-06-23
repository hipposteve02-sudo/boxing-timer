// auditors/ai-discovery-auditor.js
// Module 3 — AI Discovery Audit (0-35 points). The headline module.
//
// Sends each standardized TEST_PROMPT to every configured AI platform (Claude, OpenAI,
// Perplexity) and inspects the answers: does the brand get mentioned, where does it
// rank, is the pricing accurate, and is it beaten by competitors? This is the closest
// proxy we have for "what an AI tells a real customer who's shopping for live TV."
//
// Platforms with no API key are skipped (with a warning) unless `--mock` is set, in
// which case canned fixture responses are used so the tool is demonstrable end-to-end.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TEST_PROMPTS } from '../config/targets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'ai-responses');

const PLATFORMS = [
  { id: 'claude', label: 'Claude (Anthropic)', envKey: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', envKey: 'OPENAI_API_KEY' },
  { id: 'perplexity', label: 'Perplexity', envKey: 'PERPLEXITY_API_KEY' },
];

const MAX_CONCURRENCY = 4;

// --- Provider callers -------------------------------------------------------

async function callClaude(prompt) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

async function callOpenAI(prompt) {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.choices[0]?.message?.content || '';
}

async function callPerplexity(prompt) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Perplexity HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

const CALLERS = { claude: callClaude, openai: callOpenAI, perplexity: callPerplexity };

// --- Response analysis ------------------------------------------------------

// Find dollar figures mentioned within ~120 chars of a brand mention and judge whether
// any is within tolerance of a real plan price.
function judgePricingAccuracy(text, target) {
  const prices = (target.facts?.plans || []).map((p) => p.monthlyPrice);
  if (prices.length === 0) return null;
  const tolerance = target.facts?.priceToleranceUSD ?? 5;
  const brandIdx = text.search(target.brandPattern);
  if (brandIdx === -1) return null;
  const window = text.slice(Math.max(0, brandIdx - 120), brandIdx + 200);
  const stated = [...window.matchAll(/\$\s?(\d{1,3})(?:\.\d{2})?/g)].map((m) => Number(m[1]));
  if (stated.length === 0) return null; // mentioned but no price stated
  return stated.some((s) => prices.some((p) => Math.abs(s - p) <= tolerance));
}

// Position: 'first' if brand is the earliest service named, 'top3' if among the first
// three distinct service mentions, else 'buried'.
function judgePosition(text, target) {
  const all = [
    { name: target.name, idx: text.search(target.brandPattern) },
    ...target.competitors.map((c) => ({ name: c.name, idx: text.search(c.pattern) })),
  ].filter((s) => s.idx !== -1);
  if (all.length === 0) return 'absent';
  all.sort((a, b) => a.idx - b.idx);
  const rank = all.findIndex((s) => s.name === target.name);
  if (rank === 0) return 'first';
  if (rank > 0 && rank < 3) return 'top3';
  return 'buried';
}

function analyzeResponse(text, target) {
  const mentioned = target.brandPattern.test(text);
  if (!mentioned) {
    return { mentioned: false, position: 'absent', pricingAccurate: null, recommendedFirst: false, competitorsAbove: [] };
  }
  const position = judgePosition(text, target);
  const pricingAccurate = judgePricingAccuracy(text, target);
  // "Recommended" (vs merely mentioned): brand appears alongside positive recommend language.
  const recommended = /\b(recommend|best|top pick|great option|ideal|go with)\b/i.test(text);
  const recommendedFirst = position === 'first' && recommended;

  const brandIdx = text.search(target.brandPattern);
  const competitorsAbove = target.competitors
    .map((c) => ({ name: c.name, idx: text.search(c.pattern) }))
    .filter((c) => c.idx !== -1 && c.idx < brandIdx)
    .map((c) => c.name);

  return { mentioned: true, position, pricingAccurate, recommendedFirst, competitorsAbove };
}

// --- Fixtures (mock mode) ---------------------------------------------------

async function loadFixture(platformId) {
  const file = path.join(FIXTURE_DIR, `${platformId}.json`);
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw); // { "<prompt>": "<response text>", ... }
}

// --- Concurrency-limited prompt runner --------------------------------------

async function runPrompts(caller, prompts) {
  const results = new Array(prompts.length);
  let cursor = 0;
  async function worker() {
    while (cursor < prompts.length) {
      const i = cursor++;
      try {
        results[i] = { prompt: prompts[i], text: await caller(prompts[i]), error: null };
      } catch (err) {
        results[i] = { prompt: prompts[i], text: '', error: err.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, prompts.length) }, worker));
  return results;
}

// --- Main -------------------------------------------------------------------

export async function auditAiDiscovery(target, { mock = false, prompts = TEST_PROMPTS } = {}) {
  const platformResults = [];
  const warnings = [];
  const competitorTally = {}; // name -> count of responses mentioning it
  let totalResponses = 0;
  let totalMentions = 0;
  let totalAccurate = 0;
  let totalPriced = 0; // responses that both mentioned brand and stated a price

  for (const platform of PLATFORMS) {
    const hasKey = !!process.env[platform.envKey];
    let raw;

    if (mock) {
      try {
        const fixture = await loadFixture(platform.id);
        raw = prompts.map((p) => ({ prompt: p, text: fixture[p] ?? '', error: fixture[p] ? null : 'no fixture' }));
      } catch (err) {
        warnings.push(`${platform.label}: fixture load failed (${err.message}) — skipped`);
        continue;
      }
    } else if (!hasKey) {
      warnings.push(`${platform.label}: ${platform.envKey} not set — platform skipped (use --mock to demo)`);
      continue;
    } else {
      raw = await runPrompts(CALLERS[platform.id], prompts);
    }

    // Analyze each response for this platform.
    const analyzed = raw.map((r) => ({ ...r, analysis: analyzeResponse(r.text, target) }));
    const mentions = analyzed.filter((r) => r.analysis.mentioned);
    const accurate = mentions.filter((r) => r.analysis.pricingAccurate === true);
    const priced = mentions.filter((r) => r.analysis.pricingAccurate !== null);
    const recommendedFirst = analyzed.filter((r) => r.analysis.recommendedFirst);

    totalResponses += analyzed.length;
    totalMentions += mentions.length;
    totalAccurate += accurate.length;
    totalPriced += priced.length;

    // Tally competitor appearances across all responses on this platform.
    for (const r of analyzed) {
      for (const c of target.competitors) {
        if (c.pattern.test(r.text)) competitorTally[c.name] = (competitorTally[c.name] || 0) + 1;
      }
      if (r.analysis.mentioned) competitorTally[target.name] = (competitorTally[target.name] || 0) + 1;
    }

    platformResults.push({
      id: platform.id,
      label: platform.label,
      source: mock ? 'fixture' : 'live',
      prompts: analyzed.length,
      mentioned: mentions.length,
      pricingAccurate: { accurate: accurate.length, of: priced.length },
      recommendedFirst: recommendedFirst.length,
      responses: analyzed.map((r) => ({
        prompt: r.prompt,
        mentioned: r.analysis.mentioned,
        position: r.analysis.position,
        pricingAccurate: r.analysis.pricingAccurate,
        competitorsAbove: r.analysis.competitorsAbove,
        error: r.error,
      })),
    });
  }

  // --- Scoring (0-35) based on mention rate, weighted up for accuracy ---
  const mentionRate = totalResponses > 0 ? totalMentions / totalResponses : 0;
  const accuracyRate = totalPriced > 0 ? totalAccurate / totalPriced : 0;

  // Base from mention-rate bands per brief, then scale the top band by accuracy.
  let score;
  if (mentionRate < 0.25) score = Math.round(mentionRate * 36); // 0-9
  else if (mentionRate < 0.5) score = 10 + Math.round((mentionRate - 0.25) * 28); // 10-17
  else if (mentionRate < 0.75) score = 18 + Math.round((mentionRate - 0.5) * 28); // 18-25
  else {
    // 75-100%: 26-35, but discount if pricing is frequently wrong.
    const band = 26 + Math.round((mentionRate - 0.75) * 36); // 26-35
    score = Math.round(band * (0.7 + 0.3 * accuracyRate));
  }
  score = Math.max(0, Math.min(score, 35));

  // Build competitor ranking sorted by appearances.
  const competitorRanking = Object.entries(competitorTally)
    .map(([name, count]) => ({ name, count, pct: totalResponses ? Math.round((count / totalResponses) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);

  // --- Findings / remediation ---
  const checks = [];
  const brandRow = competitorRanking.find((r) => r.name === target.name);
  const topCompetitor = competitorRanking.find((r) => r.name !== target.name);
  checks.push(mk(mentionRate >= 0.75,
    `${target.name} mentioned in ${totalMentions}/${totalResponses} AI responses (${Math.round(mentionRate * 100)}%)`, {
      impactPts: 6,
      effort: 'high',
      recommendation: 'Improve structured data + content so AI platforms cite the brand more often',
    }));
  checks.push(mk(accuracyRate >= 0.8,
    `Pricing accurate in ${totalAccurate}/${totalPriced} priced mentions (${Math.round(accuracyRate * 100)}%)`, {
      impactPts: 3,
      effort: 'medium',
      recommendation: 'Publish canonical, machine-readable pricing so AI cites correct figures',
    }));
  if (topCompetitor && brandRow && topCompetitor.count > brandRow.count) {
    checks.push(mk(false,
      `${topCompetitor.name} out-appears ${target.name} (${topCompetitor.pct}% vs ${brandRow.pct}%) — biggest gap`, {
        impactPts: 4,
        effort: 'high',
        recommendation: `Close the AI-visibility gap with ${topCompetitor.name} via schema + comparison content`,
      }));
  }

  return {
    score,
    maxScore: 35,
    checks,
    warnings,
    details: {
      mode: mock ? 'mock (fixtures)' : 'live',
      totalResponses,
      totalMentions,
      mentionRate: Number(mentionRate.toFixed(3)),
      accuracyRate: Number(accuracyRate.toFixed(3)),
      platforms: platformResults,
      competitorRanking,
    },
  };
}

function mk(pass, label, remediation = null) {
  return { pass, label, ...(remediation || {}) };
}
