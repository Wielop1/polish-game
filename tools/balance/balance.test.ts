import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../src/engine/invariants.ts';
import { POLICIES, runScenario } from './bot.ts';
import type { RunMetrics } from './bot.ts';
import { formatSummary, summarize } from './report.ts';

const base = (over: Partial<RunMetrics>): RunMetrics => ({
  seed: 's', policy: 'solo', years: 1, days: 365, inquiries: 100, quotesSent: 60, contracts: 30, contractsDone: 28, unanswered: 0, declined: 30,
  revenueNet: 10_000_00, economicResult: 6_000_00, workHours: 400, ownerHours: 400, payrollTotal: 0, payrollIdle: 0, fixedCostsTotal: 2_000_00, marketingSpend: 0,
  minBusinessCash: 5_000_00, insolvent: false, insolvencyDay: null, netWorthStart: 90_000_00, capital: 90_000_00, netWorthEnd: 100_000_00, ownerInjections: 0, ownerDraws: 0,
  avgEmployees: 0, avgOpenBacklog: 2, capacityHours: 2_000, lostCapacity: 4, lostToRivals: 10, marketShare: 0.05, competitorsEnd: 15, competitorExits: 1,
  competitorEntries: 2, avgCompetitorUtil: 0.7, declineReasons: {}, invariantErrors: [], yearly: [],
  projectEnquiries: 0, projectsQuoted: 0, projectsSigned: 0, projectsDone: 0, projectsCancelled: 0, projectRevenueNet: 0, projectSurplusNet: 0, privateRevenueNet: 10_000_00,
  privateSurplusNet: 6_000_00, ownerEconomicProfit: 3_000_00, avgPaymentDelay: 0, ...over,
});

describe('symulator balansu: agregacja wyników', () => {
  it('wskaźniki ilorazowe liczy z sum (nie ze średnich), a rozrzut z mediany i percentyli; niewypłacalność i dominacja są sygnalizowane', () => {
    const runs = [
      base({ policy: 'solo', inquiries: 100, contracts: 30 }),
      base({ policy: 'solo', inquiries: 300, contracts: 30, netWorthEnd: 120_000_00 }),
      base({ policy: 'solo', inquiries: 100, contracts: 40, netWorthEnd: 95_000_00 }),
      base({ policy: 'team3', inquiries: 200, contracts: 20, insolvent: true, netWorthEnd: 91_000_00, payrollTotal: 100_000_00, payrollIdle: 80_000_00 }),
      base({ policy: 'team3', inquiries: 200, contracts: 20, insolvent: true, netWorthEnd: 92_000_00, payrollTotal: 100_000_00, payrollIdle: 80_000_00 }),
    ];
    const sm = summarize(runs, { years: 1, runs: 3, prefix: 't', policies: ['solo', 'team3'] });
    const solo = sm.policies.find((p) => p.policy === 'solo')!;
    const team = sm.policies.find((p) => p.policy === 'team3')!;
    expect(solo.conversion).toBeCloseTo(100 / 500, 10); // Σ kontraktów / Σ zapytań, a nie średnia ilorazów
    expect(solo.netWorthGrowthPerYear.median).toBe(10_000); // mediana z (+10 000, +30 000, +5 000) zł
    expect(solo.netWorthGrowthPerYear.p10).toBeLessThanOrEqual(solo.netWorthGrowthPerYear.median);
    expect(team.insolvencyRate).toBe(1);
    expect(team.payrollUtilization).toBeCloseTo(0.2, 10);
    expect(solo.payrollUtilization).toBeNull();
    expect(sm.notes.some((n) => n.includes('niewypłacalność'))).toBe(true);
    expect(sm.notes.some((n) => n.startsWith('DOMINACJA'))).toBe(true);
    const text = formatSummary(sm);
    expect(text).toContain('solo');
    expect(text).toContain('wzrost majątku');
  });

  it('ocenia naruszenia niezmienników', () => {
    const sm = summarize([base({ invariantErrors: ['x'] })], { years: 1, runs: 1, prefix: 't', policies: ['solo'] });
    expect(sm.policies[0]!.invariantFailures).toBe(1);
    expect(sm.notes.some((n) => n.includes('niezmienniki'))).toBe(true);
  });
});

describe('symulator balansu: przebieg na silniku gry', () => {
  it('strategie mają unikalne identyfikatory i opisy', () => {
    expect(new Set(POLICIES.map((p) => p.id)).size).toBe(POLICIES.length);
    expect(POLICIES.every((p) => p.label.length > 3)).toBe(true);
    expect(POLICIES.map((p) => p.id)).toEqual(expect.arrayContaining(['solo', 'owner+1', 'team3', 'team5', 'subs-only', 'mixed']));
  });

  it('krótka próba jest powtarzalna (ten seed → te same metryki), zachowuje niezmienniki i zbiera metryki rynku; inny seed daje inny przebieg', () => {
    const run = (seed: string) => runScenario({ seed, years: 0.35, policy: POLICIES.find((p) => p.id === 'solo')! });
    const a = run('bal-test-1');
    expect(run('bal-test-1').metrics).toEqual(a.metrics);
    expect(a.metrics.invariantErrors).toEqual([]);
    expect(checkInvariants(a.final)).toEqual([]);
    expect(a.metrics.inquiries).toBeGreaterThan(0);
    expect(a.metrics.competitorsEnd).toBeGreaterThan(5);
    expect(a.metrics.days).toBe(Math.round(0.35 * 365));
    expect(run('bal-test-2').metrics).not.toEqual(a.metrics);
  }, 120_000);

  it('szczegóły pojedynczego seeda do debugowania: log decyzji i końcowy stan', () => {
    const r = runScenario({ seed: 'bal-test-3', years: 0.2, policy: POLICIES.find((p) => p.id === 'solo')!, trace: true });
    expect(r.trace).not.toBeNull();
    expect(r.trace!.some((l) => l.includes('rejestracja JDG'))).toBe(true);
    expect(r.final.clock.today > '2026-02-01').toBe(true);
  }, 120_000);
});
