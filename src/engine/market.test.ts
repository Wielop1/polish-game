import { describe, expect, it } from 'vitest';
import { commands } from './commands.ts';
import { activeBusiness } from './business.ts';
import { addDays } from './date.ts';
import { checkInvariants } from './invariants.ts';
import { economicClimate, layoffRisk } from './labor.ts';
import { macroAt } from './macro.ts';
import {
  awardToRival, competitorVisibility, contestRival, expectedDailyDemand, marketingTargetReach, organicReferralReach, playerVisibilityParts, positioningBlend, segmentShares,
  utilityParts, winProbabilityBps,
} from './market.ts';
import { competitorViews, employmentProfitability, marketOverview, playerFunnel, segmentReport, channelReport, capacityOverview } from './marketAnalytics.ts';
import { CHANNELS, COMPETITORS, POSITIONING, SEGMENTS, SEGMENT_IDS, STRATEGY } from './marketConfig.ts';
import { zl } from './money.ts';
import { playerMarketView, playerQuality, reputation } from './renovation.ts';
import { RENOVATION_MARKET } from './renovationMarket.ts';
import { advanceDays } from './simulate.ts';
import type { GameState } from './state.ts';
import { consistentErrors, fail, hireEmployee, ok, opsGame, toDate } from './testkit.ts';

const game = (seed = 'mkt-1', o: Parameters<typeof opsGame>[0] = {}) => opsGame({ seed, ...o });
const view = (s: GameState) => playerMarketView(s, s.clock.today);
const monthDemand = (s: GameState, date: string) => expectedDailyDemand(s, date, RENOVATION_MARKET, macroAt(s.seed, date.slice(0, 7))).reduce((a, x) => a + x.expected, 0);

describe('1. koniunktura (macro): jedna spójna wartość z istniejącym klimatem, deterministyczna', () => {
  it('rok w recesji ma w środku roku spowolnienie lub recesję, a rok dobry — stabilizację lub wzrost; wynik zależy tylko od (seed, miesiąc)', () => {
    let checked = 0;
    for (let seed = 0; seed < 40; seed++) {
      for (const year of [2026, 2027, 2028, 2029]) {
        const climate = economicClimate(`m${seed}`, year);
        const phase = macroAt(`m${seed}`, `${year}-07`).phase;
        if (climate === 'recesja') { expect(['spowolnienie', 'recesja']).toContain(phase); checked += 1; }
        if (climate === 'dobra') { expect(['stabilizacja', 'wzrost']).toContain(phase); checked += 1; }
        expect(macroAt(`m${seed}`, `${year}-03`)).toEqual(macroAt(`m${seed}`, `${year}-03`));
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('zmiany są płynne (bez skoków o dwie fazy z miesiąca na miesiąc) i wszystkie cztery fazy występują w próbie', () => {
    const order = ['recesja', 'spowolnienie', 'stabilizacja', 'wzrost'];
    const seen = new Set<string>();
    let maxJump = 0;
    for (let seed = 0; seed < 30; seed++) {
      let prev: string | null = null;
      for (let t = 0; t < 72; t++) {
        const month = `${2026 + Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
        const p = macroAt(`s${seed}`, month).phase;
        seen.add(p);
        if (prev) maxJump = Math.max(maxJump, Math.abs(order.indexOf(p) - order.indexOf(prev)));
        prev = p;
      }
    }
    expect([...seen].sort()).toEqual([...order].sort());
    expect(maxJump).toBeLessThanOrEqual(2);
  });

  it('wskaźniki rosną z koniunkturą (popyt, wydatki, materiały, płace) i przesuwają strukturę klientów w stronę budżetowych w recesji', () => {
    const rec = { ...macroAt('x', '2026-07'), index: -140 };
    const boom = { ...macroAt('x', '2026-07'), index: 90 };
    expect(segmentShares(rec).budget).toBeGreaterThan(segmentShares(boom).budget);
    expect(segmentShares(rec).premium).toBeLessThan(segmentShares(boom).premium);
    for (const sh of [segmentShares(rec), segmentShares(boom), segmentShares(macroAt('x', '2027-01'))]) expect(SEGMENT_IDS.reduce((a, g) => a + sh[g], 0)).toBe(10_000);
    // 2026–2029: zdarza się recesja i dobra koniunktura, a ryzyko zwolnień nadal korzysta z tego samego rocznego klimatu
    const s = game('mkt-macro');
    expect(layoffRisk(s).climate).toBe(economicClimate(s.seed, 2026));
  });
});

describe('2. popyt: wielkość, sezonowość i rozdzielenie na etapy', () => {
  it('popyt dzienny sumuje się do popytu miesięcznego z modelu i jest wyższy w sezonie niż zimą, a usługi mają własną sezonowość', () => {
    const s = game();
    const may = Array.from({ length: 31 }, (_, i) => monthDemand(s, addDays('2026-05-01', i))).reduce((a, b) => a + b, 0);
    const jan = Array.from({ length: 31 }, (_, i) => monthDemand(s, addDays('2026-01-01', i))).reduce((a, b) => a + b, 0);
    expect(may).toBeGreaterThan(jan * 1.4);
    // rząd wielkości: kilkaset projektów miesięcznie w mieście ~170 tys. mieszkańców
    expect(may).toBeGreaterThan(300);
    expect(may).toBeLessThan(900);
    const dec = (id: string) => expectedDailyDemand(s, '2026-12-14', RENOVATION_MARKET, macroAt(s.seed, '2026-12')).find((x) => x.serviceId === id)!.expected;
    const jun = (id: string) => expectedDailyDemand(s, '2026-06-15', RENOVATION_MARKET, macroAt(s.seed, '2026-06')).find((x) => x.serviceId === id)!.expected;
    expect(dec('panele') / jun('panele')).toBeGreaterThan(dec('malowanie') / jun('malowanie')); // panele mniej sezonowe niż malowanie
  });

  it('lejek: popyt ≥ szukający ≥ zapytania do gracza; nie każde zapytanie kończy się sprzedażą; zatrudnienie samo nie tworzy klientów', () => {
    let s = game('mkt-funnel', { equip: ['paint-basic', 'paint-basic'] });
    s = toDate(s, '2026-06-01');
    s = toDate(ok(commands.setMarketingBudget(s, 'local_ads', zl(400))), '2026-09-01');
    const months = s.market.months;
    expect(months.length).toBeGreaterThanOrEqual(3);
    for (const m of months) {
      expect(m.demand).toBeGreaterThan(m.seekers);
      expect(m.seekers).toBeGreaterThanOrEqual(m.playerInquiries + m.playerLostCapacity);
      // klienci szukający wykonawcy to ułamek popytu (reszta robi sama / odkłada)
      expect(m.seekers / m.demand).toBeGreaterThan(0.25);
      expect(m.seekers / m.demand).toBeLessThan(0.6);
    }
    const inquiries = s.reno.enquiries.length;
    expect(inquiries).toBeGreaterThan(0);
    // bez odpowiedzi gracza żadne zapytanie nie staje się sprzedażą
    expect(s.reno.jobs.length).toBe(0);
    expect(s.reno.enquiries.every((e) => e.status !== 'won')).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('ceny na rynku wpływają na popyt: gdy firmy są drogie, mniej klientów szuka wykonawców (elastyczność ~0,5)', () => {
    const ratio = (price: number) => {
      let s = game('mkt-price');
      s = structuredClone(s);
      for (const c of s.market.competitors) c.priceBps = price;
      s = toDate(s, '2026-04-20');
      const m = s.market.months.filter((x) => x.month >= '2026-02');
      return m.reduce((a, x) => a + x.seekers, 0) / m.reduce((a, x) => a + x.demand, 0);
    };
    expect(ratio(8_500)).toBeGreaterThan(ratio(13_000) * 1.1);
  });

  it('zatrudnienie pracownika nie zwiększa liczby zapytań (zmienia tylko to, ile da się obsłużyć)', () => {
    const base = game('mkt-hire');
    const staffed = hireEmployee(base, { start: '2026-02-02' }).s;
    expect(staffed.ops.employments.length).toBe(1);
    const run = (s: GameState) => toDate(s, '2026-07-01').reno.enquiries.map((e) => [e.receivedOn, e.serviceId, e.units, e.segment]);
    expect(run(staffed)).toEqual(run(base));
  });
});

describe('3. alokacja klientów i konkurencja', () => {
  it('rynek startuje z konkurentami dopiero od pierwszego dnia firmy remontowej i jest deterministyczny', () => {
    const s = game('mkt-comp');
    expect(s.market.competitors.length).toBe(COMPETITORS.initialMix.solo + COMPETITORS.initialMix.small + COMPETITORS.initialMix.medium);
    const again = game('mkt-comp');
    expect(again.market.competitors).toEqual(s.market.competitors);
    const other = game('mkt-comp-2');
    expect(other.market.competitors).not.toEqual(s.market.competitors);
    const next = advanceDays(s, 40);
    expect(advanceDays(again, 40).market).toEqual(next.market);
    for (const c of s.market.competitors) {
      expect(c.services.length).toBeGreaterThan(0);
      expect(c.workers).toBeGreaterThan(0);
      expect(c.name).toMatch(/\(fikcyjna\)$/);
    }
  });

  it('klient porównuje oferty: wyższa cena, słabsze opinie lub późniejszy termin zmniejszają szansę gracza; premium mniej wrażliwy na cenę niż budżetowy', () => {
    const t = { valueIdx: 0.9, quality: 68, reputation: 65, lateDays: 0, fit: 0 };
    for (const g of SEGMENT_IDS) {
      const base = utilityParts(g, t).total;
      expect(utilityParts(g, { ...t, valueIdx: 1.1 }).total).toBeLessThan(base);
      expect(utilityParts(g, { ...t, reputation: 40 }).total).toBeLessThan(base);
      expect(utilityParts(g, { ...t, lateDays: 14 }).total).toBeLessThan(base);
      expect(utilityParts(g, { ...t, quality: 50 }).total).toBeLessThan(base);
    }
    const priceHit = (g: 'budget' | 'premium') => utilityParts(g, t).total - utilityParts(g, { ...t, valueIdx: 1.1 }).total;
    expect(priceHit('budget')).toBeGreaterThan(priceHit('premium') * 2);
    // jakość ma większe znaczenie dla premium
    const qHit = (g: 'budget' | 'premium') => utilityParts(g, t).total - utilityParts(g, { ...t, quality: 50 }).total;
    expect(qHit('premium')).toBeGreaterThan(qHit('budget'));
    expect(winProbabilityBps(0)).toBe(5_000);
    expect(winProbabilityBps(2)).toBeGreaterThan(winProbabilityBps(1));
    expect(winProbabilityBps(-9)).toBe(winProbabilityBps(-4));
  });

  it('najniższa cena nie wygrywa automatycznie: oferta tania, ale o słabych opiniach i jakości przegrywa z droższą w segmencie premium', () => {
    const cheapBad = utilityParts('premium', { valueIdx: 0.7, quality: 55, reputation: 40, lateDays: 0, fit: -35 }).total;
    const dearGood = utilityParts('premium', { valueIdx: 1.0, quality: 82, reputation: 85, lateDays: 0, fit: 40 }).total;
    expect(dearGood).toBeGreaterThan(cheapBad);
    // w segmencie budżetowym kolejność bywa odwrotna
    const cheapBadB = utilityParts('budget', { valueIdx: 0.7, quality: 55, reputation: 40, lateDays: 0, fit: 30 }).total;
    const dearGoodB = utilityParts('budget', { valueIdx: 1.0, quality: 82, reputation: 85, lateDays: 0, fit: -35 }).total;
    expect(cheapBadB).toBeGreaterThan(dearGoodB);
  });

  it('klient z konkurencją (rivals > 0) wygrywa konkurent albo gracz, rozstrzygnięcie jest deterministyczne, a zlecenie przegrane trafia do konkurenta tylko raz', () => {
    let s = toDate(game('mkt-contest'), '2026-05-20');
    const enq = s.reno.enquiries.find((e) => e.rivals > 0 && e.status === 'open');
    expect(enq, 'powinno być zapytanie z konkurencją').toBeDefined();
    const q = { id: 'quote:test', priceGross: enq!.budgetGross, startDate: enq!.desiredStart };
    const a = contestRival(s, q, enq!, { quality: 62, reputation: 60 }, s.clock.today);
    expect(a.contested).toBe(true);
    expect(contestRival(s, q, enq!, { quality: 62, reputation: 60 }, s.clock.today)).toEqual(a);
    // lepsza oferta ma większą szansę
    const better = contestRival(s, { ...q, priceGross: Math.round(enq!.budgetGross * 0.8) }, enq!, { quality: 80, reputation: 85 }, s.clock.today);
    expect(better.winProbBps).toBeGreaterThan(a.winProbBps);
    // klient, który zapytał tylko gracza, nie porównuje ofert
    expect(contestRival(s, q, { ...enq!, rivals: 0, rivalId: null }, { quality: 62, reputation: 60 }, s.clock.today).contested).toBe(false);
    // przyznanie konkurentowi: raz
    s = structuredClone(s);
    const target = s.reno.enquiries.find((e) => e.id === enq!.id)!;
    const comp = s.market.competitors.find((c) => c.id === target.rivalId)!;
    const before = comp.backlogHours;
    const first = awardToRival(s, target);
    const after = comp.backlogHours;
    expect(awardToRival(s, target)).toBeNull();
    expect(comp.backlogHours).toBe(after);
    if (first) expect(after).toBeGreaterThan(before);
  });

  it('konkurenci reagują na wyniki: przy słabym obłożeniu tną ceny, zmieniają moce, wychodzą z rynku i wchodzą nowi; zapisują się zdarzenia', () => {
    let s = game('mkt-dyn');
    const p0 = new Map(s.market.competitors.map((c) => [c.id, c.priceBps]));
    s = toDate(s, '2028-02-01');
    expect(s.market.months.length).toBeGreaterThan(20);
    const changed = s.market.competitors.filter((c) => p0.has(c.id) && p0.get(c.id) !== c.priceBps).length;
    expect(changed).toBeGreaterThan(3);
    expect(s.market.competitors.some((c) => c.workers !== COMPETITORS.sizes[c.size].workers || c.marketingMonthly > 0)).toBe(true);
    // rynek żyje: są wejścia i/lub wyjścia (zależnie od koniunktury), a liczba aktywnych firm pozostaje w rozsądnych granicach
    const active = s.market.competitors.filter((c) => c.status === 'active').length;
    expect(active).toBeGreaterThanOrEqual(8);
    expect(active).toBeLessThanOrEqual(COMPETITORS.maxCount);
    expect(s.events.some((e) => e.type === 'market.entry' || e.type === 'market.exit')).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
  }, 120_000);

  it('konkurenci nie znają ukrytych informacji gracza: ich ścieżka nie zależy od gotówki gracza; widok dla gracza to oszacowania bez pól ukrytych', () => {
    const rich = game('mkt-hidden', { business: zl(150_000) });
    const poor = game('mkt-hidden', { business: zl(20_000) });
    expect(advanceDays(rich, 200).market.competitors).toEqual(advanceDays(poor, 200).market.competitors);
    const s = advanceDays(rich, 60);
    const views = competitorViews(s);
    const allowed = new Set(['id', 'name', 'status', 'positioning', 'sizeBand', 'priceLevel', 'stars', 'marketing', 'services', 'threat']);
    for (const v of views) for (const k of Object.keys(v)) expect(allowed.has(k), `pole ${k} nie powinno być widoczne`).toBe(true);
    // oszacowania nie są prawdą absolutną: gwiazdki mieszczą się w ±0,75 gwiazdki od rzeczywistej oceny
    for (const v of views) { const c = s.market.competitors.find((x) => x.id === v.id)!; expect(Math.abs(v.stars - c.reputation / 20)).toBeLessThanOrEqual(0.75); }
  });
});

describe('4. segmenty klientów', () => {
  it('segmenty różnią się wymaganiami, budżetem i skłonnością do negocjacji; zapytania w segmentach mają zgodne wymagania jakościowe', () => {
    expect(SEGMENTS.budget.priceSensitivity).toBeGreaterThan(SEGMENTS.standard.priceSensitivity);
    expect(SEGMENTS.standard.priceSensitivity).toBeGreaterThan(SEGMENTS.premium.priceSensitivity);
    expect(SEGMENTS.premium.expectedQuality).toBeGreaterThan(SEGMENTS.budget.expectedQuality);
    expect(SEGMENTS.premium.budgetFactorBps).toBeGreaterThan(SEGMENTS.budget.budgetFactorBps);
    expect(SEGMENTS.budget.haggleChancePct).toBeGreaterThan(SEGMENTS.premium.haggleChancePct);
    expect(SEGMENTS.premium.complaintFactorBps).toBeGreaterThan(SEGMENTS.budget.complaintFactorBps);
    expect(SEGMENT_IDS.reduce((a, g) => a + SEGMENTS[g].shareBps, 0)).toBe(10_000);
    const s = toDate(game('mkt-seg', { equip: ['paint-basic'] }), '2027-01-01');
    const by = (g: string) => s.reno.enquiries.filter((e) => e.segment === g);
    expect(by('budget').length + by('standard').length + by('premium').length).toBe(s.reno.enquiries.length);
    expect(by('premium').every((e) => e.qualityReq >= 2)).toBe(true);
    expect(by('budget').every((e) => e.qualityReq <= 2)).toBe(true);
    const avgBudget = (g: string) => { const l = by(g); return l.reduce((a, e) => a + e.budgetGross / Math.max(1, e.units), 0) / Math.max(1, l.length); };
    if (by('premium').length > 2 && by('budget').length > 2) expect(avgBudget('premium')).toBeGreaterThan(avgBudget('budget'));
    const rep = segmentReport(s);
    expect(rep.map((r) => r.id)).toEqual(['budget', 'standard', 'premium']);
    expect(rep.reduce((a, r) => a + r.inquiries, 0)).toBeLessThanOrEqual(s.reno.enquiries.length);
  });
});

describe('5. marketing: kanały, opóźnienie, malejące korzyści, zależność od rynku', () => {
  it('malejące korzyści: podwojenie budżetu daje mniej niż dwukrotnie większą widoczność; wartości rosną z budżetem; zero = zero', () => {
    const s = game('mkt-ad');
    const m = macroAt(s.seed, '2026-03');
    for (const id of Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]) {
      const a = marketingTargetReach(s, id, zl(500), m);
      const b = marketingTargetReach(s, id, zl(1_000), m);
      expect(b).toBeGreaterThan(a);
      expect(b).toBeLessThan(a * 2);
      expect(marketingTargetReach(s, id, 0, m)).toBe(0);
      expect(marketingTargetReach(s, id, zl(1_000_000), m)).toBeLessThanOrEqual(Math.round(CHANNELS[id].maxReach * 1.15));
    }
  });

  it('skuteczność zależy od rynku: w recesji kanały wrażliwe na koniunkturę są słabsze, a rosnąca reklama konkurencji zwiększa tłok', () => {
    const s = game('mkt-ad2');
    const boom = { ...macroAt(s.seed, '2026-07'), index: 90 };
    const rec = { ...macroAt(s.seed, '2026-07'), index: -140 };
    expect(marketingTargetReach(s, 'search', zl(800), boom)).toBeGreaterThan(marketingTargetReach(s, 'search', zl(800), rec));
    const crowded = structuredClone(s);
    for (const c of crowded.market.competitors) c.marketingReach = 9_000;
    expect(marketingTargetReach(crowded, 'search', zl(800), boom)).toBeLessThan(marketingTargetReach(s, 'search', zl(800), boom));
  });

  it('opóźnienie efektu: widoczność dochodzi do celu stopniowo (partnerstwa wolniej niż wyszukiwarka) i wygasa po wyłączeniu', () => {
    let s = game('mkt-delay');
    s = ok(commands.setMarketingBudget(s, 'search', zl(800)));
    s = ok(commands.setMarketingBudget(s, 'partnerships', zl(800)));
    const reachAfter = (st: GameState, ch: string) => st.market.marketing.reach[ch] ?? 0;
    const m = (d: string) => macroAt(s.seed, d.slice(0, 7));
    s = toDate(s, '2026-03-02');
    const t1 = { search: reachAfter(s, 'search'), partnerships: reachAfter(s, 'partnerships') };
    s = toDate(s, '2026-08-02');
    const t5 = { search: reachAfter(s, 'search'), partnerships: reachAfter(s, 'partnerships') };
    expect(t1.search).toBeGreaterThan(0);
    expect(t5.search).toBeGreaterThan(t1.search);
    const targetSearch = marketingTargetReach(s, 'search', zl(800), m('2026-08-02'));
    const targetPartners = marketingTargetReach(s, 'partnerships', zl(800), m('2026-08-02'));
    expect(t1.search / targetSearch).toBeGreaterThan(t1.partnerships / targetPartners); // szybszy kanał dochodzi szybciej
    expect(t5.search / targetSearch).toBeGreaterThan(0.85);
    expect(t5.partnerships / targetPartners).toBeLessThan(0.95);
    s = ok(commands.setMarketingBudget(s, 'search', 0));
    s = toDate(s, '2027-01-02');
    expect(reachAfter(s, 'search')).toBeLessThan(t5.search * 0.2);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('polecenia: spontaniczne polecenia rosną z liczbą zakończonych prac i reputacją, ale z nasyceniem', () => {
    const v0 = { ...view(game('mkt-ref')) };
    const v = (n: number, rep: number) => organicReferralReach({ ...v0, completed12m: n, reputation: rep });
    expect(v(0, 70)).toBe(0);
    expect(v(20, 70)).toBeGreaterThan(v(5, 70));
    expect(v(20, 90)).toBeGreaterThan(v(20, 50));
    expect(v(200, 70) - v(100, 70)).toBeLessThan(v(40, 70) - v(0, 70));
  });

  it('reklama nie jest prostym mnożnikiem: te same pieniądze w kanale nasyconym dają mniej zapytań niż w świeżym; raport kanałów liczy koszt pozyskania', () => {
    let s = game('mkt-cac');
    for (const [ch, amount] of [['local_ads', zl(400)], ['search', zl(800)], ['card', zl(150)]] as const) s = ok(commands.setMarketingBudget(s, ch, amount));
    s = toDate(s, '2026-08-01');
    const rows = channelReport(s);
    expect(rows.reduce((a, r) => a + r.budget, 0)).toBe(zl(1_350));
    expect(rows.find((r) => r.id === 'search')!.spend3m).toBeGreaterThan(0);
    const fn = playerFunnel(s, 6);
    expect(fn.at(-1)!.month).toBe('2026-08');
    expect(fn.some((f) => f.costPerInquiry !== null)).toBe(true);
    expect(marketOverview(s).inquiriesPerMonth).toBeGreaterThan(0);
  });
});

describe('6. strategia (pozycjonowanie)', () => {
  it('zmiana wprowadzana stopniowo: dzień zmiany = stare wagi, połowa okresu = średnia, po okresie = nowe; reputacja nietknięta', () => {
    let s = toDate(game('mkt-strat'), '2026-04-01');
    const rep0 = reputation(s).score;
    const bias0 = positioningBlend(s, s.clock.today).bias;
    s = ok(commands.setPositioning(s, 'premium'));
    expect(positioningBlend(s, s.clock.today).bias).toEqual(bias0);
    expect(positioningBlend(s, s.clock.today).progress).toBe(0);
    const half = positioningBlend(s, addDays(s.clock.today, STRATEGY.transitionDays / 2));
    expect(half.progress).toBeCloseTo(0.5, 5);
    expect(half.bias.premium).toBeGreaterThan(POSITIONING.balanced.segmentBias.premium);
    expect(half.bias.premium).toBeLessThan(POSITIONING.premium.segmentBias.premium);
    expect(positioningBlend(s, addDays(s.clock.today, STRATEGY.transitionDays)).bias).toEqual(POSITIONING.premium.segmentBias);
    expect(reputation(s).score).toBe(rep0);
    // widoczność dla klientów premium rośnie stopniowo, a nie skokowo
    const vis = (date: string) => playerVisibilityParts(s, 'premium', view(s), date).reduce((a, p) => a + p.weight, 0);
    expect(vis(s.clock.today)).toBe(vis(addDays(s.clock.today, 0)));
    expect(vis(addDays(s.clock.today, 45))).toBeGreaterThan(vis(s.clock.today));
    expect(vis(addDays(s.clock.today, 90))).toBeGreaterThan(vis(addDays(s.clock.today, 45)));
  });

  it('historia decyzji, odstęp między zmianami, walidacje i miesięczny koszt pozycjonowania (dokument kosztowy)', () => {
    let s = toDate(game('mkt-strat2'), '2026-04-01');
    expect(fail(commands.setPositioning(s, 'balanced'))).toMatch(/już ustawione/);
    expect(fail(commands.setPositioning(s, 'nie-ma'))).toMatch(/Nieznane/);
    s = ok(commands.setPositioning(s, 'premium'));
    expect(s.market.strategy.history).toHaveLength(1);
    expect(fail(commands.setPositioning(s, 'low'))).toMatch(/najwcześniej/);
    s = toDate(s, '2026-07-01');
    expect(s.documents.filter((d) => d.description.startsWith('Pozycjonowanie: Wysoka jakość')).map((d) => d.issueDate.slice(0, 7))).toEqual(['2026-05', '2026-06', '2026-07']);
    s = ok(commands.setPositioning(s, 'low'));
    expect(s.market.strategy.history.map((h) => [h.from, h.to])).toEqual([['balanced', 'premium'], ['premium', 'low']]);
    s = toDate(s, '2026-09-01');
    expect(s.documents.filter((d) => d.description.startsWith('Pozycjonowanie: Niska cena')).length).toBe(0); // niska cena nie ma kosztu utrzymania
    expect(consistentErrors(s)).toEqual([]);
  });

  it('pozycjonowanie zmienia mieszankę klientów: premium przyciąga więcej klientów premium niż niska cena (po wdrożeniu)', () => {
    const mix = (pos: 'low' | 'premium') => {
      let s = toDate(game('mkt-strat3'), '2026-03-01');
      s = ok(commands.setPositioning(s, pos));
      const from = addDays(s.clock.today, STRATEGY.transitionDays);
      s = toDate(s, addDays(from, 150));
      const list = s.reno.enquiries.filter((e) => e.receivedOn >= from);
      const premium = list.filter((e) => e.segment === 'premium').length;
      return { share: premium / Math.max(1, list.length), n: list.length };
    };
    const lo = mix('low');
    const hi = mix('premium');
    expect(lo.n).toBeGreaterThan(10);
    expect(hi.n).toBeGreaterThan(10);
    expect(hi.share).toBeGreaterThan(lo.share);
  }, 120_000);
});

describe('7. zdolność wykonawcza i limity', () => {
  it('zapytania do gracza nie przekraczają limitu otwartych; nadwyżka jest tracona (brak mocy) i trafia do konkurencji', () => {
    let s = game('mkt-cap');
    s = ok(commands.setMarketingBudget(s, 'search', zl(2_500)));
    s = ok(commands.setMarketingBudget(s, 'portals', zl(2_000)));
    s = toDate(s, '2026-09-01'); // bez odpowiedzi gracza otwarte zapytania wygasają, ale w trakcie nie przekraczają limitu
    for (let d = 0; d < 60; d++) {
      s = advanceDays(s, 1);
      expect(s.reno.enquiries.filter((e) => e.status === 'open' || e.status === 'quoted').length).toBeLessThanOrEqual(6);
    }
    expect(s.market.months.reduce((a, m) => a + m.playerLostCapacity, 0)).toBeGreaterThan(0);
    expect(playerQuality(s)).toBe(62);
    expect(capacityOverview(s).contractsPerMonth).toBeGreaterThan(0);
  }, 120_000);

  it('konkurent przeciążony (długa kolejka) traci widoczność wobec swobodnego', () => {
    const s = game('mkt-cap2');
    const c = s.market.competitors.find((x) => x.size !== 'solo')!;
    const svc = c.services[0]!;
    const free = competitorVisibility(c, 'standard', svc);
    const days = (d: number) => ({ ...c, backlogHours: c.workers * COMPETITORS.hoursPerWorkerDay * d });
    expect(competitorVisibility(days(8), 'standard', svc)).toBeLessThan(free);
    expect(competitorVisibility(days(COMPETITORS.maxBacklogDays), 'standard', svc)).toBeLessThan(competitorVisibility(days(8), 'standard', svc));
    expect(competitorVisibility({ ...c, status: 'exited' }, 'standard', svc)).toBe(0);
  });
});

describe('8. powtarzalność, spójność finansów i zapis', () => {
  it('ten sam seed → ten sam stan; zapis w środku nie zmienia wyniku; niezmienniki po roku z marketingiem i strategią', () => {
    const run = () => {
      let s = game('mkt-det');
      s = ok(commands.setMarketingBudget(s, 'local_ads', zl(400)));
      s = ok(commands.setPositioning(s, 'premium'));
      return toDate(s, '2027-03-01');
    };
    const a = run();
    expect(run()).toEqual(a);
    const copy = JSON.parse(JSON.stringify(a)) as GameState;
    expect(advanceDays(copy, 45)).toEqual(advanceDays(a, 45));
    expect(checkInvariants(a)).toEqual([]);
    expect(a.documents.filter((d) => d.description.startsWith('Marketing')).length).toBeGreaterThanOrEqual(12);
    expect(a.documents.filter((d) => d.description.startsWith('Pozycjonowanie')).length).toBeGreaterThanOrEqual(12);
    expect(activeBusiness(a)).not.toBeNull();
    const other = toDate(game('mkt-det-b'), '2027-03-01');
    expect(other.market.months).not.toEqual(a.market.months);
  }, 120_000);

  it('niezmienniki rynku wykrywają uszkodzony stan (konkurent, budżet, strategia, odwołanie zapytania)', () => {
    const s = toDate(game('mkt-inv'), '2026-05-15');
    expect(checkInvariants(s)).toEqual([]);
    const bad = (mutate: (x: GameState) => void) => { const x = structuredClone(s); mutate(x); return checkInvariants(x).join(' | '); };
    expect(bad((x) => { x.market.competitors[0]!.status = 'exited'; })).toMatch(/niezgodny z datą wyjścia/);
    expect(bad((x) => { x.market.competitors[0]!.backlogHours = 0; x.market.competitors[0]!.backlogValue = 5; })).toMatch(/wartość zaległości bez godzin/);
    expect(bad((x) => { x.market.marketing.budgets.nie_ma = 100; })).toMatch(/nieprawidłowy budżet kanału/);
    expect(bad((x) => { x.market.strategy.previous = 'balanced'; })).toMatch(/poprzednie pozycjonowanie/);
    const enq = s.reno.enquiries.find((e) => e.rivals > 0)!;
    expect(bad((x) => { x.reno.enquiries.find((e) => e.id === enq.id)!.rivalId = 'comp:999'; })).toMatch(/nieznany konkurent/);
    expect(bad((x) => { x.market.months.push({ ...x.market.months[0]! }); })).toMatch(/nie są chronologiczne/);
  });

  it('analiza popytu i rentowności zatrudnienia działają na pustym i na realnym stanie', () => {
    const s = toDate(game('mkt-an'), '2026-06-01');
    expect(employmentProfitability(s).employees).toBe(0);
    expect(segmentReport(s)).toHaveLength(3);
    expect(competitorViews(s).length).toBe(s.market.competitors.length);
    const ov = marketOverview(s);
    expect(ov.initialized).toBe(true);
    expect(ov.competitors).toBeGreaterThan(5);
  });
});
