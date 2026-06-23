// auditors/content-auditor.js
// Module 2 — Content Structure Audit (0-25 points).
//
// Checks whether pages are written for the "retrieval economy": do they lead with a
// direct answer, use question-style headings, expose an FAQ, and put key facts (price,
// channel count, plan names) in crawlable text rather than locking them behind
// JavaScript? An AI that can't read a fact in the static HTML can't cite it.

import * as cheerio from 'cheerio';
import { fetchUrl } from './http.js';

const QUESTION_HEADING = /^(what|how|does|can|is|are|when|where|why|which|who)\b/i;
const PRICE_IN_TEXT = /\$\s?\d{1,3}(?:\.\d{2})?/;

function firstNWords(text, n) {
  return text.split(/\s+/).filter(Boolean).slice(0, n).join(' ');
}

// "Direct answer" heuristic: the opening of <main> contains a concrete claim —
// a price, a number, or a plan name — rather than pure marketing copy.
function opensWithDirectAnswer(opening, target) {
  if (PRICE_IN_TEXT.test(opening)) return true;
  if (/\b\d{2,}\b/.test(opening)) return true; // e.g. "200+ channels"
  return target.facts?.plans?.some((p) => opening.includes(p.name)) || false;
}

function analyzePage(label, url, html, target) {
  const $ = cheerio.load(html);
  // Strip script/style so we measure human/crawler-visible text only.
  $('script, style, noscript').remove();

  const main = $('main').length ? $('main') : $('body');
  const mainText = main.text().replace(/\s+/g, ' ').trim();
  const opening = firstNWords(mainText, 50);

  const headings = [];
  $('h2, h3').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t) headings.push(t);
  });
  const questionHeadings = headings.filter((h) => QUESTION_HEADING.test(h));

  const hasDetailsFaq = $('details').length > 0;
  const hasFaqHeading = headings.some((h) => /faq|frequently asked|questions/i.test(h));
  const hasFaq = hasDetailsFaq || hasFaqHeading || (questionHeadings.length >= 2);

  // Are known facts visible in the static (non-JS) HTML?
  const plansInText = (target.facts?.plans || []).filter((p) => mainText.includes(p.name));
  const priceInText = PRICE_IN_TEXT.test(mainText);

  return {
    label,
    url,
    directAnswer: opensWithDirectAnswer(opening, target),
    opening: opening.slice(0, 160),
    headingCount: headings.length,
    questionHeadingCount: questionHeadings.length,
    hasFaq,
    plansVisible: plansInText.map((p) => p.name),
    priceVisibleInText: priceInText,
  };
}

export async function auditContent(target) {
  const pages = [];
  for (const [label, url] of Object.entries(target.pages)) {
    const res = await fetchUrl(url);
    if (res.ok && res.body) {
      pages.push(analyzePage(label, url, res.body, target));
    } else {
      pages.push({ label, url, error: res.error || `HTTP ${res.status}`, unreachable: true });
    }
  }

  const reachable = pages.filter((p) => !p.unreachable);
  const pageCount = reachable.length || 1;

  const pagesWithQuestionHeadings = reachable.filter((p) => p.questionHeadingCount > 0).length;
  const pagesWithFaq = reachable.filter((p) => p.hasFaq).length;
  const homepage = reachable.find((p) => p.label === 'homepage');
  const pricingPage = reachable.find((p) => p.label === 'pricing');
  const channelsPage = reachable.find((p) => p.label === 'channels');

  // --- Scoring (0-25), evenly weighted across five signals ---
  let score = 0;
  const checks = [];

  // 1. Direct-answer opening on homepage (5)
  const homeDirect = homepage?.directAnswer || false;
  if (homeDirect) score += 5;
  checks.push(mk(homeDirect, homeDirect
    ? 'Homepage opens with a direct, factual answer'
    : 'Homepage opens with marketing copy, not a direct answer', {
      impactPts: 3,
      effort: 'low',
      recommendation: 'Rewrite homepage opening paragraph to lead with a direct answer (price + what it is)',
    }));

  // 2. Question-format headings on most pages (5)
  const questionRatio = pagesWithQuestionHeadings / pageCount;
  const questionPass = questionRatio >= 0.5;
  if (questionPass) score += 5;
  checks.push(mk(questionPass,
    `Question-format H2/H3 headings on ${pagesWithQuestionHeadings}/${pageCount} pages`, {
      impactPts: 2,
      effort: 'low',
      recommendation: 'Rewrite section headings as the questions users actually ask',
    }));

  // 3. FAQ section present somewhere (5)
  const faqPass = pagesWithFaq > 0;
  if (faqPass) score += 5;
  checks.push(mk(faqPass, faqPass
    ? `FAQ section found on ${pagesWithFaq} page(s)`
    : 'No structured FAQ section (<details> or Q&A) found', {
      impactPts: 3,
      effort: 'medium',
      recommendation: 'Add an FAQ section using <details> or structured Q&A on /help',
    }));

  // 4. Pricing readable in crawlable text (5)
  const priceCrawlable = pricingPage?.priceVisibleInText || false;
  if (priceCrawlable) score += 5;
  checks.push(mk(priceCrawlable, priceCrawlable
    ? 'Plan pricing present in crawlable text on /compare-plans'
    : 'Plan pricing not found in crawlable text on /compare-plans (likely JS-rendered)', {
      impactPts: 4,
      effort: 'high',
      recommendation: 'Render plan prices in server-side HTML so crawlers (and AI) can read them',
    }));

  // 5. Channel/plan names readable in crawlable text (5)
  const channelsCrawlable = (channelsPage?.plansVisible?.length || 0) > 0
    || (channelsPage && channelsPage.headingCount > 3);
  if (channelsCrawlable) score += 5;
  checks.push(mk(!!channelsCrawlable, channelsCrawlable
    ? 'Channel/plan data readable in non-JS HTML'
    : 'Channel lineup appears locked in JavaScript render', {
      impactPts: 3,
      effort: 'high',
      recommendation: 'Expose the channel lineup as crawlable HTML (table or list), not JS-only',
    }));

  score = Math.min(score, 25);

  return { score, maxScore: 25, checks, details: { pages } };
}

function mk(pass, label, remediation = null) {
  return { pass, label, ...(remediation || {}) };
}
