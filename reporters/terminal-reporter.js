// reporters/terminal-reporter.js
// Renders the audit to a chalk-colored terminal report that mirrors the layout in the
// project brief: a banner, one section per module with ✅/❌/⚠️ checks, the AI-platform
// breakdown, the total score with a rating, and the Top-5 remediation priorities.

import chalk from 'chalk';
import dayjs from 'dayjs';

const PASS = chalk.green('✅');
const FAIL = chalk.red('❌');
const WARN = chalk.yellow('⚠️');

function bar(score, max, width = 24) {
  const filled = max > 0 ? Math.round((score / max) * width) : 0;
  const color = score / max >= 0.6 ? chalk.green : score / max >= 0.4 ? chalk.yellow : chalk.red;
  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
}

function mark(check) {
  if (check.pass) return PASS;
  return check.effort === 'high' || check.impactPts >= 4 ? FAIL : WARN;
}

function section(title, mod) {
  const lines = [];
  lines.push('');
  lines.push(chalk.bold.cyan(title) + chalk.gray(`  [${mod.score} / ${mod.maxScore}]`));
  for (const check of mod.checks || []) {
    lines.push(`   ${mark(check)} ${check.pass ? check.label : chalk.dim(check.label)}`);
  }
  return lines.join('\n');
}

export function renderTerminal(report) {
  const { target, scoring, modules } = report;
  const width = 60;
  const out = [];

  // Banner
  out.push(chalk.bold.white('╔' + '═'.repeat(width) + '╗'));
  out.push(chalk.bold.white('║') + chalk.bold.yellow(center(`${target.name.toUpperCase()} — AI DISCOVERABILITY AUDIT REPORT`, width)) + chalk.bold.white('║'));
  out.push(chalk.bold.white('║') + chalk.gray(center(dayjs(report.timestamp).format('MMMM D, YYYY'), width)) + chalk.bold.white('║'));
  out.push(chalk.bold.white('╚' + '═'.repeat(width) + '╝'));

  // Module sections
  if (modules.schema) out.push(section('📋 SCHEMA.ORG STRUCTURED DATA', modules.schema));
  if (modules.content) out.push(section('📄 CONTENT STRUCTURE', modules.content));

  if (modules.aiDiscovery) {
    out.push(section('🤖 AI PLATFORM DISCOVERY', modules.aiDiscovery));
    const d = modules.aiDiscovery.details;
    out.push(chalk.gray(`    Mode: ${d.mode} · ${d.totalResponses} total queries`));
    for (const p of d.platforms) {
      out.push('');
      out.push('   ' + chalk.bold(p.label) + chalk.gray(`  (${p.source})`));
      out.push(`     Brand mentioned:   ${p.mentioned}/${p.prompts}`);
      out.push(`     Pricing accurate:  ${p.pricingAccurate.accurate}/${p.pricingAccurate.of}`);
      out.push(`     Recommended first: ${p.recommendedFirst}/${p.prompts}`);
    }
    if (d.competitorRanking?.length) {
      out.push('');
      out.push('   ' + chalk.bold('Top service appearances:'));
      const top = d.competitorRanking[0];
      for (const r of d.competitorRanking) {
        const isBrand = r.name === target.name;
        const flag = top && top.name !== target.name && r.name === top.name ? chalk.red('   ← biggest gap') : '';
        const line = `     ${r.name.padEnd(16)} ${String(r.count).padStart(2)}/${d.totalResponses} (${r.pct}%)${flag}`;
        out.push(isBrand ? chalk.cyan(line) : line);
      }
    }
    for (const w of modules.aiDiscovery.warnings || []) out.push('   ' + chalk.yellow(`⚠️  ${w}`));
  }

  if (modules.llmTxt) out.push(section('🔧 CRAWLER & LLM GUIDANCE', modules.llmTxt));

  if (modules.sitemap) out.push(section('🗂️  CHANNEL & PRICING ACCESSIBILITY', { ...modules.sitemap, score: modules.sitemap.bonus, maxScore: modules.sitemap.maxScore }));

  // Total
  out.push('');
  out.push(chalk.gray('━'.repeat(width + 2)));
  const s = scoring;
  out.push(
    chalk.bold(`TOTAL SCORE:   ${s.total} / ${s.maxTotal}   `) +
    ratingColor(s.total)(`${s.ratingEmoji} ${s.rating}`)
  );
  out.push('   ' + bar(s.total, s.maxTotal, 40));
  out.push(chalk.gray('━'.repeat(width + 2)));

  // Remediations
  if (s.topRemediations.length) {
    out.push('');
    out.push(chalk.bold('TOP REMEDIATION PRIORITIES (by impact):'));
    s.topRemediations.forEach((r, i) => {
      const tag = r.priority === 'HIGH' ? chalk.red('[HIGH]  ') : r.priority === 'MEDIUM' ? chalk.yellow('[MEDIUM]') : chalk.gray('[LOW]   ');
      out.push(`   ${i + 1}. ${tag} ${r.recommendation} ${chalk.gray(`— est. +${r.impactPts} pts`)}`);
    });
  }

  out.push('');
  return out.join('\n');
}

function center(text, width) {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + text + ' '.repeat(pad - left);
}

function ratingColor(total) {
  if (total >= 60) return chalk.green;
  if (total >= 40) return chalk.yellow;
  return chalk.red;
}
