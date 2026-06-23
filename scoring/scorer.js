// scoring/scorer.js
// Aggregates the per-module results into a single 0-100 score and produces the ranked
// remediation list. Every failed check across the modules carries an `impactPts` (how
// many points fixing it could recover) and an `effort` tag; we sort failures by impact
// to surface the highest-leverage fixes first.

import { SCORE_WEIGHTS } from '../config/targets.js';

const RATING = [
  { min: 80, label: 'AI-READY', emoji: '✅' },
  { min: 60, label: 'ON TRACK', emoji: '🟢' },
  { min: 40, label: 'NEEDS WORK', emoji: '🟡' },
  { min: 0, label: 'NEEDS SIGNIFICANT WORK', emoji: '⚠️' },
];

const EFFORT_RANK = { low: 0, medium: 1, high: 2 };

export function score(modules) {
  // modules: { schema, content, aiDiscovery, llmTxt } each { score, maxScore, checks }
  const breakdown = {};
  let total = 0;
  let maxTotal = 0;

  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    const mod = modules[key];
    const pts = mod ? mod.score : 0;
    breakdown[key] = { score: pts, max: weight };
    total += pts;
    maxTotal += weight;
  }

  total = Math.round(total);
  const rating = RATING.find((r) => total >= r.min);

  // Gather every failed check with a recommendation across all modules.
  const remediations = [];
  for (const [moduleKey, mod] of Object.entries(modules)) {
    if (!mod?.checks) continue;
    for (const check of mod.checks) {
      if (!check.pass && check.recommendation) {
        remediations.push({
          module: moduleKey,
          priority: priorityFor(check.impactPts ?? 1),
          impactPts: check.impactPts ?? 1,
          effort: check.effort ?? 'medium',
          recommendation: check.recommendation,
        });
      }
    }
  }

  // Sort by impact desc, then by lower effort (quicker wins) first.
  remediations.sort((a, b) => {
    if (b.impactPts !== a.impactPts) return b.impactPts - a.impactPts;
    return EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort];
  });

  return {
    total,
    maxTotal,
    rating: rating.label,
    ratingEmoji: rating.emoji,
    breakdown,
    remediations,
    topRemediations: remediations.slice(0, 5),
  };
}

function priorityFor(impactPts) {
  if (impactPts >= 4) return 'HIGH';
  if (impactPts >= 2) return 'MEDIUM';
  return 'LOW';
}
