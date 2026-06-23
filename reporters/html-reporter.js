// reporters/html-reporter.js
// Generates a standalone, self-contained HTML report (inline CSS, no external assets)
// suitable for an executive to open in a browser or forward to engineering/SEO teams.

import dayjs from 'dayjs';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function scoreColor(pct) {
  if (pct >= 0.6) return '#16a34a';
  if (pct >= 0.4) return '#d97706';
  return '#dc2626';
}

function checkRow(c) {
  const icon = c.pass ? '✅' : c.impactPts >= 4 ? '❌' : '⚠️';
  return `<li class="${c.pass ? 'pass' : 'fail'}"><span class="ico">${icon}</span> ${esc(c.label)}</li>`;
}

function moduleCard(title, mod) {
  if (!mod) return '';
  const score = mod.score ?? mod.bonus ?? 0;
  const max = mod.maxScore ?? 0;
  const pct = max ? score / max : 0;
  return `
  <section class="card">
    <div class="card-head">
      <h2>${esc(title)}</h2>
      <span class="badge" style="background:${scoreColor(pct)}">${score} / ${max}</span>
    </div>
    <div class="track"><div class="fill" style="width:${Math.round(pct * 100)}%;background:${scoreColor(pct)}"></div></div>
    <ul class="checks">${(mod.checks || []).map(checkRow).join('')}</ul>
  </section>`;
}

function aiPlatformTable(mod) {
  if (!mod?.details?.platforms?.length) return '';
  const rows = mod.details.platforms
    .map(
      (p) => `<tr>
        <td>${esc(p.label)} <span class="src">${esc(p.source)}</span></td>
        <td>${p.mentioned}/${p.prompts}</td>
        <td>${p.pricingAccurate.accurate}/${p.pricingAccurate.of}</td>
        <td>${p.recommendedFirst}/${p.prompts}</td>
      </tr>`
    )
    .join('');
  const comp = (mod.details.competitorRanking || [])
    .map((r) => `<tr><td>${esc(r.name)}</td><td>${r.count}/${mod.details.totalResponses}</td><td>${r.pct}%</td></tr>`)
    .join('');
  return `
  <section class="card">
    <h2>🤖 AI Platform Discovery — detail</h2>
    <p class="muted">Mode: ${esc(mod.details.mode)} · ${mod.details.totalResponses} total queries</p>
    <table>
      <thead><tr><th>Platform</th><th>Mentioned</th><th>Pricing accurate</th><th>Recommended first</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3>Service appearances across all responses</h3>
    <table>
      <thead><tr><th>Service</th><th>Appearances</th><th>Rate</th></tr></thead>
      <tbody>${comp}</tbody>
    </table>
  </section>`;
}

function remediationTable(remediations) {
  if (!remediations?.length) return '';
  const rows = remediations
    .map(
      (r, i) => `<tr>
        <td>${i + 1}</td>
        <td><span class="pri pri-${r.priority.toLowerCase()}">${r.priority}</span></td>
        <td>${esc(r.recommendation)}</td>
        <td>${esc(r.effort)}</td>
        <td>+${r.impactPts}</td>
      </tr>`
    )
    .join('');
  return `
  <section class="card">
    <h2>🛠️ Remediation Roadmap</h2>
    <table>
      <thead><tr><th>#</th><th>Priority</th><th>Recommendation</th><th>Effort</th><th>Est. pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

export function renderHtml(report) {
  const { target, scoring, modules, timestamp } = report;
  const pct = scoring.maxTotal ? scoring.total / scoring.maxTotal : 0;
  const color = scoreColor(pct);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(target.name)} — AI Discoverability Audit</title>
<style>
  :root { --bg:#0b1020; --card:#fff; --ink:#0f172a; --muted:#64748b; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:#f1f5f9; color:var(--ink); }
  header { background:linear-gradient(135deg,#111827,#1e3a8a); color:#fff; padding:40px 24px; }
  .wrap { max-width:920px; margin:0 auto; padding:24px; }
  header .wrap { padding:0; }
  h1 { margin:0 0 4px; font-size:24px; }
  .sub { color:#cbd5e1; font-size:14px; }
  .hero-score { display:flex; align-items:center; gap:24px; margin-top:24px; }
  .ring { font-size:46px; font-weight:800; }
  .rating { font-size:18px; font-weight:700; }
  .card { background:var(--card); border-radius:12px; padding:20px 22px; margin:18px 0; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .card-head { display:flex; justify-content:space-between; align-items:center; }
  h2 { font-size:17px; margin:0 0 10px; }
  h3 { font-size:14px; color:var(--muted); margin:18px 0 8px; }
  .badge { color:#fff; padding:4px 12px; border-radius:999px; font-weight:700; font-size:13px; }
  .track { height:8px; background:#e2e8f0; border-radius:999px; overflow:hidden; margin:6px 0 14px; }
  .fill { height:100%; }
  ul.checks { list-style:none; padding:0; margin:0; }
  ul.checks li { padding:6px 0; border-bottom:1px solid #f1f5f9; }
  ul.checks li.fail { color:#475569; }
  .ico { margin-right:8px; }
  table { width:100%; border-collapse:collapse; margin:8px 0; font-size:14px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #e2e8f0; }
  th { color:var(--muted); font-weight:600; }
  .src { color:var(--muted); font-size:12px; }
  .muted { color:var(--muted); }
  .pri { padding:2px 8px; border-radius:6px; font-size:12px; font-weight:700; color:#fff; }
  .pri-high { background:#dc2626; } .pri-medium { background:#d97706; } .pri-low { background:#64748b; }
  footer { text-align:center; color:var(--muted); font-size:12px; padding:24px; }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>${esc(target.name)} — AI Discoverability Audit</h1>
    <div class="sub">${esc(dayjs(timestamp).format('MMMM D, YYYY · h:mm A'))} · ${esc(target.baseUrl)}</div>
    <div class="hero-score">
      <div class="ring" style="color:${color}">${scoring.total}<span style="font-size:22px;color:#94a3b8">/${scoring.maxTotal}</span></div>
      <div class="rating" style="color:${color}">${esc(scoring.ratingEmoji)} ${esc(scoring.rating)}</div>
    </div>
  </div>
</header>
<div class="wrap">
  ${moduleCard('📋 Schema.org Structured Data', modules.schema)}
  ${moduleCard('📄 Content Structure', modules.content)}
  ${moduleCard('🤖 AI Platform Discovery', modules.aiDiscovery)}
  ${aiPlatformTable(modules.aiDiscovery)}
  ${moduleCard('🔧 Crawler & LLM Guidance', modules.llmTxt)}
  ${modules.sitemap ? moduleCard('🗂️ Channel & Pricing Accessibility', { ...modules.sitemap, score: modules.sitemap.bonus }) : ''}
  ${remediationTable(scoring.remediations)}
</div>
<footer>Generated by sling-ai-audit · ${esc(dayjs(timestamp).toISOString())}</footer>
</body>
</html>`;
}
