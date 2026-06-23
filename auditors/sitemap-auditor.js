// auditors/sitemap-auditor.js
// Module 5 — Channel & Pricing Data Accessibility.
//
// Per the brief, this module's findings are reported on their own but its points are
// folded into Module 1 (schema) as bonus — it doesn't carry a standalone weight in
// SCORE_WEIGHTS. It answers: can a crawler extract the channel list and plan pricing
// WITHOUT executing JavaScript? That's the litmus test for AI-readable product data.

import * as cheerio from 'cheerio';
import { fetchUrl } from './http.js';

const PRICE = /\$\s?\d{1,3}(?:\.\d{2})?/g;

export async function auditSitemap(target) {
  const checks = [];
  const details = {};

  // Channel list machine-readability (clean HTML table / list with channel names).
  const channelsUrl = target.pages.channels;
  if (channelsUrl) {
    const res = await fetchUrl(channelsUrl);
    if (res.ok && res.body) {
      const $ = cheerio.load(res.body);
      $('script, style, noscript').remove();
      const tables = $('table').length;
      const listItems = $('ul li, ol li').length;
      const imgAlts = $('img[alt]').length; // channel logos often carry names in alt
      const machineReadable = tables > 0 || listItems > 20 || imgAlts > 20;
      details.channels = { tables, listItems, imgAlts, machineReadable };
      checks.push(mk(machineReadable, machineReadable
        ? `Channel list is machine-readable (${tables} tables, ${listItems} list items)`
        : 'No machine-readable channel list (no table/list in static HTML)', {
          impactPts: 2,
          effort: 'medium',
          recommendation: 'Publish the channel lineup as a clean HTML table or list crawlers can parse',
        }));
    } else {
      checks.push(mk(false, `Channel page unreachable (${res.error || res.status})`));
    }
  }

  // Plan pricing extractable without JS.
  const pricingUrl = target.pages.pricing;
  if (pricingUrl) {
    const res = await fetchUrl(pricingUrl);
    if (res.ok && res.body) {
      const $ = cheerio.load(res.body);
      $('script, style, noscript').remove();
      const text = $('body').text();
      const prices = [...text.matchAll(PRICE)].map((m) => m[0]);
      const pricingExtractable = prices.length > 0;
      details.pricing = { pricesFound: prices.slice(0, 8), extractable: pricingExtractable };
      checks.push(mk(pricingExtractable, pricingExtractable
        ? `Plan pricing extractable without JS (${prices.length} price strings found)`
        : 'Plan pricing not extractable without JavaScript execution', {
          impactPts: 3,
          effort: 'high',
          recommendation: 'Render plan pricing server-side so it is readable without JS',
        }));
    } else {
      checks.push(mk(false, `Pricing page unreachable (${res.error || res.status})`));
    }
  }

  // Bonus points (0-5) folded into Module 1 cap.
  const passed = checks.filter((c) => c.pass).length;
  const bonus = Math.min(passed * 2, 5);

  return { bonus, maxScore: 5, checks, details };
}

function mk(pass, label, remediation = null) {
  return { pass, label, ...(remediation || {}) };
}
