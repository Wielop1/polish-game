import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { POLICIES, runScenario } from './bot.ts';
import type { RunMetrics } from './bot.ts';
import { summarize, formatSummary } from './report.ts';

/**
 * Symulator balansu (narzędzie developerskie). Używa tego samego silnika co gra — bot gra wyłącznie przez `commands.*`.
 *
 *   npm run balance -- --years 5 --runs 200
 *   npm run balance -- --quick                       (2 lata, 4 seedy, wszystkie strategie)
 *   npm run balance -- --policies solo,team3 --runs 20
 *   npm run balance -- --trace bal-3 --policy team3   (jeden seed: log decyzji + końcowy stan, do debugowania)
 *   npm run balance -- --policies team3 --marketing portals   (nadpisuje profil marketingu: none | basic | active | portals)
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? 'true' : v;
}

const quick = arg('quick') === 'true';
const years = Number(arg('years', quick ? '2' : '5'));
const runs = Number(arg('runs', quick ? '4' : '20'));
const prefix = arg('seed-prefix', 'bal')!;
const policyIds = (arg('policies') ?? POLICIES.map((p) => p.id).join(',')).split(',').filter(Boolean);
const out = arg('out', 'balance-out/report.json')!;
const workers = Math.max(1, Number(arg('workers', String(Math.min(4, Math.max(1, cpus().length - 1))))));
const traceSeed = arg('trace');
const marketing = arg('marketing');
if (marketing && !['none', 'basic', 'active', 'portals'].includes(marketing)) throw new Error('--marketing: none | basic | active | portals');
const capital = Math.round(Number(arg('capital', '90000')) * 100);

function writeOut(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

if (traceSeed) {
  const policy = POLICIES.find((p) => p.id === arg('policy', 'solo'));
  if (!policy) throw new Error(`Nieznana strategia: ${arg('policy')}`);
  const t0 = Date.now();
  const r = runScenario({ seed: traceSeed, years, policy: marketing ? { ...policy, marketing: marketing as typeof policy.marketing } : policy, trace: true, capital });
  const base = `balance-out/trace-${policy.id}-${traceSeed}`;
  writeOut(`${base}.log`, r.trace!.join('\n'));
  writeOut(`${base}.metrics.json`, JSON.stringify(r.metrics, null, 2));
  if (arg('dump-state') === 'true') writeOut(`${base}.state.json`, JSON.stringify(r.final));
  console.log(`Seed ${traceSeed}, strategia ${policy.id}, ${years} lat, ${Date.now() - t0} ms`);
  console.log(`Log decyzji: ${base}.log (${r.trace!.length} wpisów), metryki: ${base}.metrics.json`);
  console.log(JSON.stringify(r.metrics, null, 2));
  process.exit(0);
}

for (const id of policyIds) if (!POLICIES.some((p) => p.id === id)) throw new Error(`Nieznana strategia: ${id}. Dostępne: ${POLICIES.map((p) => p.id).join(', ')}`);

const tasks: { id: number; seed: string; years: number; policy: string; capital: number; marketing?: string }[] = [];
for (let r = 0; r < runs; r++) for (const policy of policyIds) tasks.push({ id: tasks.length, seed: `${prefix}-${r + 1}`, years, policy, capital, marketing });

console.log(`Symulator balansu: ${policyIds.length} strategii × ${runs} seedów × ${years} lat = ${tasks.length} przebiegów, kapitał ${capital / 100} zł, wątków: ${workers}`);
const results: RunMetrics[] = [];
const errors: string[] = [];
const started = Date.now();
let next = 0;
let done = 0;

function finish(): void {
  const summary = summarize(results, { years, runs, prefix, policies: policyIds, capital });
  writeOut(out, JSON.stringify({ generatedAt: new Date().toISOString(), params: { years, runs, prefix, policies: policyIds, capital, marketing: marketing ?? null }, errors, summary, runs: results }, null, 1));
  console.log(formatSummary(summary));
  console.log(`\nRaport JSON: ${out} · czas: ${Math.round((Date.now() - started) / 1000)} s${errors.length ? ` · BŁĘDY: ${errors.length}` : ''}`);
  if (errors.length) console.error(errors.slice(0, 3).join('\n---\n'));
  process.exit(errors.length ? 1 : 0);
}

for (let w = 0; w < Math.min(workers, tasks.length); w++) {
  const worker = new Worker(new URL('./worker.ts', import.meta.url));
  const feed = () => {
    if (next >= tasks.length) { void worker.terminate(); return; }
    worker.postMessage(tasks[next++]);
  };
  worker.on('message', (m: { id: number; metrics?: RunMetrics; error?: string; ms?: number }) => {
    if (m.error) errors.push(`zadanie ${m.id}: ${m.error}`);
    else if (m.metrics) results.push(m.metrics);
    done += 1;
    if (done % Math.max(1, Math.floor(tasks.length / 10)) === 0) console.log(`  ${done}/${tasks.length} (${Math.round((Date.now() - started) / 1000)} s)`);
    if (done === tasks.length) finish();
    else feed();
  });
  worker.on('error', (e: Error) => { errors.push(`wątek: ${e.message}`); done += 1; if (done >= tasks.length) finish(); });
  feed();
}
