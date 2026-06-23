// auditors/llm-txt-auditor.js
// Module 4 — LLM.txt & Crawler Guidance Audit (0-15 points).
//
// Checks the small set of files and meta tags that tell AI crawlers how to treat the
// site: /llm.txt (an emerging canonical-description convention), AI-bot directives in
// robots.txt, sitemap coverage, and Open Graph / Twitter Card meta on key pages.

import * as cheerio from 'cheerio';
import { fetchUrl } from './http.js';

const AI_BOTS = ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot'];

export async function auditLlmTxt(target) {
  const base = target.baseUrl.replace(/\/$/, '');
  const [llm, robots, sitemap, home] = await Promise.all([
    fetchUrl(`${base}/llm.txt`),
    fetchUrl(`${base}/robots.txt`),
    fetchUrl(`${base}/sitemap.xml`),
    fetchUrl(target.pages.homepage || base),
  ]);

  let score = 0;
  const checks = [];

  // 1. /llm.txt exists and is non-trivial (5)
  const llmExists = llm.ok && llm.body.trim().length > 0 && !looksLikeHtml(llm.body);
  if (llmExists) score += 5;
  checks.push(mk(llmExists, llmExists ? '/llm.txt found and well-formed' : 'No /llm.txt found', {
    impactPts: 3,
    effort: 'low',
    recommendation: 'Create /llm.txt with a canonical brand description, plans, and pricing',
  }));

  // 2. robots.txt exists (2) + addresses AI bots (3)
  const robotsExists = robots.ok && robots.body.length > 0;
  if (robotsExists) score += 2;
  const aiBotsMentioned = robotsExists
    ? AI_BOTS.filter((bot) => new RegExp(`User-agent:\\s*${bot}\\b`, 'i').test(robots.body))
    : [];
  if (aiBotsMentioned.length > 0) score += 3;
  checks.push(mk(robotsExists, robotsExists ? 'robots.txt exists' : 'No robots.txt found'));
  checks.push(mk(aiBotsMentioned.length > 0,
    aiBotsMentioned.length > 0
      ? `robots.txt addresses AI crawlers: ${aiBotsMentioned.join(', ')}`
      : 'ClaudeBot/GPTBot not addressed in robots.txt', {
        impactPts: 2,
        effort: 'low',
        recommendation: 'Add explicit AI-crawler directives (GPTBot, ClaudeBot, PerplexityBot) to robots.txt',
      }));

  // 3. XML sitemap exists with reasonable coverage (3)
  const sitemapUrls = sitemap.ok ? countSitemapUrls(sitemap.body) : 0;
  const sitemapPass = sitemapUrls > 0;
  if (sitemapPass) score += 3;
  checks.push(mk(sitemapPass, sitemapPass
    ? `XML sitemap found (${sitemapUrls} URLs indexed)`
    : 'No XML sitemap found', {
      impactPts: 2,
      effort: 'low',
      recommendation: 'Publish an XML sitemap covering all key product pages',
    }));

  // 4. Open Graph / Twitter Card meta on homepage (2)
  const meta = home.ok ? extractSocialMeta(home.body) : { og: 0, twitter: 0 };
  const metaPass = meta.og > 0 && meta.twitter > 0;
  if (metaPass) score += 2;
  checks.push(mk(metaPass, metaPass
    ? `Open Graph (${meta.og}) + Twitter Card (${meta.twitter}) meta tags present`
    : 'Missing Open Graph / Twitter Card meta on key pages', {
      impactPts: 1,
      effort: 'low',
      recommendation: 'Add Open Graph and Twitter Card meta tags to key pages',
    }));

  score = Math.min(score, 15);

  return {
    score,
    maxScore: 15,
    checks,
    details: {
      llmTxt: { exists: llmExists, status: llm.status },
      robots: { exists: robotsExists, status: robots.status, aiBotsMentioned },
      sitemap: { urls: sitemapUrls, status: sitemap.status },
      socialMeta: meta,
    },
  };
}

function looksLikeHtml(body) {
  return /<!doctype html|<html[\s>]/i.test(body.slice(0, 200));
}

function countSitemapUrls(xml) {
  const locs = xml.match(/<loc>/gi);
  return locs ? locs.length : 0;
}

function extractSocialMeta(html) {
  const $ = cheerio.load(html);
  return {
    og: $('meta[property^="og:"]').length,
    twitter: $('meta[name^="twitter:"]').length,
  };
}

function mk(pass, label, remediation = null) {
  return { pass, label, ...(remediation || {}) };
}
