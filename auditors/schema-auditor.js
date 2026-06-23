// auditors/schema-auditor.js
// Module 1 — Schema.org Structured Data Audit (0-25 points).
//
// Crawls the target's key pages, extracts every <script type="application/ld+json">
// block, and classifies the structured data by @type. AI platforms lean heavily on
// this machine-readable markup to understand and cite a service, so its presence (and
// completeness) is the single highest-signal thing we check.

import * as cheerio from 'cheerio';
import { fetchUrl } from './http.js';

// Schema types that matter for a streaming service, and the fields each needs to be
// genuinely useful to a crawler.
const REQUIRED_FIELDS = {
  Product: ['name', 'offers'],
  Offer: ['price', 'priceCurrency'],
  FAQPage: ['mainEntity'],
  Organization: ['name', 'url'],
  WebSite: ['name', 'url'],
  BroadcastService: ['name'],
  BroadcastChannel: ['name'],
  VideoObject: ['name'],
};

const HIGH_VALUE_TYPES = [
  'Product',
  'FAQPage',
  'BroadcastService',
  'BroadcastChannel',
  'VideoObject',
];

// Recursively walk JSON-LD (which may use @graph or nest nodes) collecting every @type.
function collectNodes(node, acc) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectNodes(n, acc));
    return;
  }
  if (node && typeof node === 'object') {
    if (node['@graph']) collectNodes(node['@graph'], acc);
    if (node['@type']) {
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      types.forEach((t) => acc.push({ type: t, node }));
    }
    // Descend into common containers (offers, mainEntity, etc.) for nested types.
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') collectNodes(value, acc);
    }
  }
}

function hasRequiredFields(type, node) {
  const required = REQUIRED_FIELDS[type];
  if (!required) return true;
  return required.every((f) => node[f] !== undefined && node[f] !== null && node[f] !== '');
}

function extractFromHtml(html) {
  const $ = cheerio.load(html);
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      blocks.push({ parsed: JSON.parse(raw), ok: true });
    } catch {
      blocks.push({ parsed: null, ok: false, raw: raw.slice(0, 120) });
    }
  });
  return blocks;
}

export async function auditSchema(target) {
  const pageResults = [];
  const typesFound = new Set();
  const typesWithRequiredFields = new Set();
  let malformedBlocks = 0;

  for (const [label, url] of Object.entries(target.pages)) {
    const res = await fetchUrl(url);
    const page = { label, url, status: res.status, schemaBlocks: 0, types: [], error: res.error };

    if (res.ok && res.body) {
      const blocks = extractFromHtml(res.body);
      page.schemaBlocks = blocks.length;
      for (const block of blocks) {
        if (!block.ok) {
          malformedBlocks += 1;
          continue;
        }
        const nodes = [];
        collectNodes(block.parsed, nodes);
        for (const { type, node } of nodes) {
          typesFound.add(type);
          page.types.push(type);
          if (hasRequiredFields(type, node)) typesWithRequiredFields.add(type);
        }
      }
      page.types = [...new Set(page.types)];
    }
    pageResults.push(page);
  }

  // --- Scoring per brief: 0 / 5 / 15 then +5 / +5, capped at 25 ---
  let score = 0;
  const checks = [];
  const has = (t) => typesFound.has(t);
  const hasComplete = (t) => typesWithRequiredFields.has(t);

  if (typesFound.size === 0) {
    score = 0;
  } else if (has('Organization') || has('WebSite')) {
    score = 5;
  }

  // Product + real pricing is the big jump (5 -> 15).
  const hasPricing = hasComplete('Product') || hasComplete('Offer');
  if (has('Product') && hasPricing) score = Math.max(score, 15);

  if (has('FAQPage')) score += 5;
  if (has('BroadcastService') || has('BroadcastChannel')) score += 5;
  score = Math.min(score, 25);

  // --- Per-check findings drive the terminal report + remediation list ---
  const orgFound = has('Organization');
  const websiteFound = has('WebSite');
  checks.push(mk(orgFound, `Organization schema ${orgFound ? 'found' : 'missing'}`));
  checks.push(mk(websiteFound, `WebSite schema ${websiteFound ? 'found' : 'missing'}`));
  checks.push(
    mk(has('Product') && hasPricing, has('Product') && hasPricing
      ? 'Product + Offer schema with pricing found on plans page'
      : 'No Product schema with pricing on /compare-plans', {
        impactPts: 4,
        effort: 'medium',
        recommendation: 'Add Product + Offer schema (name, price, priceCurrency, url) to /compare-plans',
      })
  );
  checks.push(
    mk(has('FAQPage'), has('FAQPage') ? 'FAQPage schema found' : 'No FAQPage schema on /help', {
      impactPts: 5,
      effort: 'low',
      recommendation: 'Add FAQPage schema to /help — wrap existing Q&A in mainEntity',
    })
  );
  checks.push(
    mk(
      has('BroadcastService') || has('BroadcastChannel'),
      has('BroadcastService') || has('BroadcastChannel')
        ? 'BroadcastService/Channel schema found'
        : 'No BroadcastService schema anywhere',
      {
        impactPts: 3,
        effort: 'medium',
        recommendation: 'Add BroadcastService schema to channel pages to describe live-TV offering',
      }
    )
  );
  if (malformedBlocks > 0) {
    checks.push(mk(false, `${malformedBlocks} malformed JSON-LD block(s) failed to parse`, {
      impactPts: 1,
      effort: 'low',
      recommendation: 'Fix malformed JSON-LD so crawlers can parse it',
    }));
  }

  // Opportunities: high-value types entirely absent.
  const missingHighValue = HIGH_VALUE_TYPES.filter((t) => !has(t));

  return {
    score,
    maxScore: 25,
    checks,
    details: {
      pages: pageResults,
      typesFound: [...typesFound],
      missingHighValueTypes: missingHighValue,
      malformedBlocks,
    },
  };
}

// Small helper to build a uniform check object.
function mk(pass, label, remediation = null) {
  return { pass, label, ...(remediation || {}) };
}
