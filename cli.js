#!/usr/bin/env node
// cli.js — Commander.js entry point for the Sling TV AI Discoverability Audit Tool.
//
// Commands:
//   audit   --target <key> [--module <name>] [--output terminal|json|html|both] [--mock]
//   history --target <key>
//
// The audit command runs the selected auditors, scores them, prints the terminal
// report, and writes timestamped JSON/HTML artifacts to ./outputs so progress can be
// tracked over time. `history` reads those JSON snapshots back into a trend table.

import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import dayjs from 'dayjs';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTarget } from './config/targets.js';
import { auditSchema } from './auditors/schema-auditor.js';
import { auditContent } from './auditors/content-auditor.js';
import { auditAiDiscovery } from './auditors/ai-discovery-auditor.js';
import { auditLlmTxt } from './auditors/llm-txt-auditor.js';
import { auditSitemap } from './auditors/sitemap-auditor.js';
import { score } from './scoring/scorer.js';
import { renderTerminal } from './reporters/terminal-reporter.js';
import { renderHtml } from './reporters/html-reporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'outputs');

// Module registry. `weighted` modules feed the 0-100 score; sitemap is bonus-only.
const MODULES = {
  schema: { label: 'Schema.org', run: (t) => auditSchema(t) },
  content: { label: 'Content structure', run: (t) => auditContent(t) },
  'ai-discovery': { label: 'AI discovery', run: (t, opts) => auditAiDiscovery(t, opts), key: 'aiDiscovery' },
  'llm-txt': { label: 'LLM/crawler guidance', run: (t) => auditLlmTxt(t), key: 'llmTxt' },
  sitemap: { label: 'Channel/pricing accessibility', run: (t) => auditSitemap(t) },
};

// Resolve a target key or exit cleanly with a friendly message (not a stack trace).
function resolveTarget(key) {
  try {
    return getTarget(key);
  } catch (err) {
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}

async function runAudit(opts) {
  const target = resolveTarget(opts.target);
  const only = opts.module; // run a single module if specified
  const mock = !!opts.mock;

  const selected = only ? [only] : Object.keys(MODULES);
  if (only && !MODULES[only]) {
    console.error(chalk.red(`Unknown module "${only}". Choose from: ${Object.keys(MODULES).join(', ')}`));
    process.exit(1);
  }

  console.error(chalk.gray(`\nAuditing ${chalk.bold(target.name)} (${target.baseUrl})${mock ? chalk.yellow(' [mock AI]') : ''}…`));

  const modules = {};
  for (const name of selected) {
    const spec = MODULES[name];
    const key = spec.key || name;
    process.stderr.write(chalk.gray(`  • ${spec.label}… `));
    try {
      modules[key] = await spec.run(target, { mock });
      process.stderr.write(chalk.green('done\n'));
    } catch (err) {
      process.stderr.write(chalk.red(`failed (${err.message})\n`));
      modules[key] = { score: 0, maxScore: 0, checks: [{ pass: false, label: `Module error: ${err.message}` }], error: err.message };
    }
  }

  // Fold sitemap bonus into the schema module's score (capped at 25).
  if (modules.schema && modules.sitemap?.bonus) {
    modules.schema.score = Math.min(modules.schema.score + modules.sitemap.bonus, modules.schema.maxScore);
    modules.schema.checks.push({
      pass: modules.sitemap.bonus > 0,
      label: `+${modules.sitemap.bonus} bonus from channel/pricing accessibility`,
    });
  }

  const scoring = score(modules);

  const report = {
    target: { key: target.key, name: target.name, baseUrl: target.baseUrl },
    timestamp: new Date().toISOString(),
    mock,
    partial: !!only,
    scoring,
    modules,
  };

  // Terminal output (unless explicitly json/html only).
  const output = opts.output || 'terminal';
  if (output === 'terminal' || output === 'both') {
    console.log(renderTerminal({ ...report, target }));
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = dayjs(report.timestamp).format('YYYY-MM-DD-HHmmssSSS');
  const base = `${target.key}-audit-${stamp}`;

  // Always persist JSON for tracking, unless the user asked for html-only.
  if (output !== 'html') {
    const jsonPath = path.join(OUTPUT_DIR, `${base}.json`);
    await writeFile(jsonPath, JSON.stringify(report, null, 2));
    console.error(chalk.gray(`\nJSON report saved: ${path.relative(process.cwd(), jsonPath)}`));
  }
  if (output === 'html' || output === 'both') {
    const htmlPath = path.join(OUTPUT_DIR, `${base}.html`);
    await writeFile(htmlPath, renderHtml({ ...report, target }));
    console.error(chalk.gray(`HTML report saved: ${path.relative(process.cwd(), htmlPath)}`));
  }
}

async function runHistory(opts) {
  const target = resolveTarget(opts.target);
  let files;
  try {
    files = (await readdir(OUTPUT_DIR)).filter((f) => f.startsWith(`${target.key}-audit-`) && f.endsWith('.json'));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    console.log(chalk.yellow(`No prior audits found for "${target.key}". Run an audit first.`));
    return;
  }

  const rows = [];
  for (const f of files.sort()) {
    try {
      const r = JSON.parse(await readFile(path.join(OUTPUT_DIR, f), 'utf8'));
      // Partial (single-module) audits aren't comparable to full ones — skip them
      // so the trend line only reflects complete audits.
      if (r.partial) continue;
      rows.push({
        date: dayjs(r.timestamp).format('YYYY-MM-DD HH:mm'),
        total: r.scoring.total,
        schema: r.scoring.breakdown.schema?.score ?? '-',
        content: r.scoring.breakdown.content?.score ?? '-',
        ai: r.scoring.breakdown.aiDiscovery?.score ?? '-',
        llm: r.scoring.breakdown.llmTxt?.score ?? '-',
        rating: r.scoring.rating,
      });
    } catch { /* skip unreadable */ }
  }

  if (rows.length === 0) {
    console.log(chalk.yellow(`No complete audits found for "${target.key}" (only partial/single-module runs). Run a full audit first.`));
    return;
  }

  console.log(chalk.bold.cyan(`\nScore history — ${target.name}\n`));
  console.log(chalk.gray('  Date              Total   Schema  Content  AI    LLM   Rating'));
  console.log(chalk.gray('  ' + '─'.repeat(64)));
  let prev = null;
  for (const r of rows) {
    const delta = prev === null ? '' : r.total > prev ? chalk.green(` ▲${r.total - prev}`) : r.total < prev ? chalk.red(` ▼${prev - r.total}`) : chalk.gray(' ─');
    console.log(
      `  ${r.date}   ${String(r.total).padStart(3)}/100${delta.padEnd(6)} ${String(r.schema).padStart(3)}    ${String(r.content).padStart(3)}     ${String(r.ai).padStart(3)}   ${String(r.llm).padStart(3)}   ${r.rating}`
    );
    prev = r.total;
  }
  console.log('');
}

const program = new Command();
program
  .name('sling-ai-audit')
  .description('Audit a streaming service\'s readiness to be discovered and cited by AI platforms')
  .version('1.0.0');

program
  .command('audit')
  .description('Run the AI-discoverability audit for a target')
  .requiredOption('-t, --target <key>', 'target brand key (e.g. sling, youtube-tv)')
  .option('-m, --module <name>', 'run a single module: schema | content | ai-discovery | llm-txt | sitemap')
  .option('-o, --output <format>', 'terminal | json | html | both', 'terminal')
  .option('--mock', 'use canned AI fixtures instead of live API calls (no keys needed)', false)
  .action((opts) => runAudit(opts).catch((e) => { console.error(chalk.red(e.stack || e.message)); process.exit(1); }));

program
  .command('history')
  .description('Show score trend across past audits for a target')
  .requiredOption('-t, --target <key>', 'target brand key')
  .action((opts) => runHistory(opts).catch((e) => { console.error(chalk.red(e.stack || e.message)); process.exit(1); }));

program.parseAsync(process.argv);
