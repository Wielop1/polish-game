import { parentPort } from 'node:worker_threads';
import { POLICIES, runScenario } from './bot.ts';

/** Wątek roboczy symulatora: wykonuje pojedynczy przebieg (seed × strategia) i odsyła metryki. */
parentPort!.on('message', (task: { id: number; seed: string; years: number; policy: string; capital?: number; marketing?: string }) => {
  const base = POLICIES.find((p) => p.id === task.policy);
  const policy = base && task.marketing ? { ...base, marketing: task.marketing as typeof base.marketing } : base;
  if (!policy) { parentPort!.postMessage({ id: task.id, error: `nieznana strategia ${task.policy}` }); return; }
  const t0 = Date.now();
  try {
    const { metrics } = runScenario({ seed: task.seed, years: task.years, policy, capital: task.capital });
    parentPort!.postMessage({ id: task.id, metrics, ms: Date.now() - t0 });
  } catch (e) {
    parentPort!.postMessage({ id: task.id, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
  }
});
