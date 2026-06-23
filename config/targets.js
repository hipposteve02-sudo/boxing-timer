// config/targets.js
//
// One entry per brand the tool can audit. Sling is fully populated for the MVP;
// competitors are placeholders for Phase 2 (auto-benchmarking). Every auditor and
// the scorer reads its inputs from here, so this file is the single source of truth
// for "what good looks like" and how points are awarded.

// Standardized prompts a real user might ask an AI assistant. The AI-discovery
// auditor sends each of these to every configured platform and inspects the answer.
export const TEST_PROMPTS = [
  'What is the cheapest live TV streaming service in 2026?',
  'How can I watch ESPN without a cable subscription?',
  'What are the best YouTube TV alternatives?',
  'Which streaming service has the most flexible TV plans?',
  'What live TV streaming services offer no-contract options?',
  'How much does Sling TV cost per month?',
  'What channels does Sling TV include?',
  'Is Sling TV available on Roku?',
  'What is Sling Freestream?',
  'Compare Sling TV vs YouTube TV',
];

// Max points each module can contribute. Sums to 100.
// Note: Module 5 (channel/pricing accessibility) is folded into the schema module's
// cap as bonus points per the brief, so it has no standalone weight here.
export const SCORE_WEIGHTS = {
  schema: 25,
  content: 25,
  aiDiscovery: 35,
  llmTxt: 15,
};

const slingTarget = {
  key: 'sling',
  name: 'Sling TV',
  // Regex used to detect the brand in free-text AI responses and crawled HTML.
  brandPattern: /\bsling(?:\s*tv)?\b/i,
  baseUrl: 'https://sling.com',

  // Pages crawled by the schema, content, and sitemap auditors.
  pages: {
    homepage: 'https://sling.com',
    pricing: 'https://sling.com/service/compare-plans',
    channels: 'https://sling.com/channel-lineup',
    help: 'https://sling.com/help',
    freestream: 'https://sling.com/freestream',
  },

  // Known-correct facts. The AI-discovery auditor compares figures an AI states
  // against these to judge "pricing accuracy"; the content auditor looks for these
  // numbers in crawlable (non-JS) HTML.
  facts: {
    plans: [
      { name: 'Sling Orange', monthlyPrice: 46 },
      { name: 'Sling Blue', monthlyPrice: 51 },
      { name: 'Sling Orange + Blue', monthlyPrice: 66 },
    ],
    freestreamPrice: 0,
    // Any dollar figure within this many dollars of a real plan price counts as accurate.
    priceToleranceUSD: 6,
    channelCountApprox: 200,
  },

  // Competitors we track relative ranking against in AI responses.
  competitors: [
    { name: 'YouTube TV', pattern: /\byoutube\s*tv\b/i },
    { name: 'DirecTV', pattern: /\bdirec\s*tv\b/i },
    { name: 'Fubo', pattern: /\bfubo(?:tv)?\b/i },
    { name: 'Philo', pattern: /\bphilo\b/i },
    { name: 'Hulu + Live TV', pattern: /\bhulu\s*\+?\s*live\s*tv\b/i },
  ],
};

// Minimal competitor stubs so `--target youtube-tv` doesn't crash; Phase 2 fills these.
const youtubeTvTarget = {
  key: 'youtube-tv',
  name: 'YouTube TV',
  brandPattern: /\byoutube\s*tv\b/i,
  baseUrl: 'https://tv.youtube.com',
  pages: {
    homepage: 'https://tv.youtube.com',
  },
  facts: { plans: [{ name: 'Base Plan', monthlyPrice: 83 }], priceToleranceUSD: 6 },
  competitors: [
    { name: 'Sling TV', pattern: /\bsling(?:\s*tv)?\b/i },
    { name: 'Hulu + Live TV', pattern: /\bhulu\s*\+?\s*live\s*tv\b/i },
    { name: 'Fubo', pattern: /\bfubo(?:tv)?\b/i },
  ],
};

export const TARGETS = {
  sling: slingTarget,
  'youtube-tv': youtubeTvTarget,
};

export function getTarget(key) {
  const target = TARGETS[key];
  if (!target) {
    const available = Object.keys(TARGETS).join(', ');
    throw new Error(`Unknown target "${key}". Available targets: ${available}`);
  }
  return target;
}
