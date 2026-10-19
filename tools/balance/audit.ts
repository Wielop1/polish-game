import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { commands } from '../../src/engine/commands.ts';
import { zl } from '../../src/engine/money.ts';
import { defaultQuoteInput, previewQuote, referencePrice } from '../../src/engine/renovation.ts';
import { EQUIPMENT, LEVEL_START_XP, SERVICES } from '../../src/engine/renovationCatalog.ts';
import { craftEnquiry, fund, opsGame } from '../../src/engine/testkit.ts';
import type { GameState } from '../../src/engine/state.ts';

/**
 * Audyt rentowności usług remontowych (v0.8.1): dla każdej usługi i poziomu umiejętności właściciela liczy na SILNIKU (previewQuote) — przy cenie rynkowej
 * (referencePrice, wymagania „dobre”, zlecenie standardowe, standard materiałów „std”) — godziny pracy, koszty rzeczywiste, nadwyżkę przed obciążeniami właściciela,
 * zarobek za godzinę i zysk ekonomiczny przy stawce kalkulacyjnej. Uruchom: `node tools/balance/audit.ts [--full-equipment] [--out plik.json]` (domyślnie tylko sprzęt wymagany do usług — nowa firma).
 * Nic tu nie jest „dostrajane pod wynik” — to pomiar; kalibrację opisuje docs/BALANCE_REPORT.md.
 */
const FULL = process.argv.includes('--full-equipment');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined;
const LABOR = zl(60);

function prepared(level: number): GameState {
  let s = opsGame({ seed: 'audit', equip: FULL ? EQUIPMENT.map((e) => e.id) : ['hand-tools', 'paint-basic', 'trowel-set', 'panel-kit'] });
  s = fund(s, zl(100_000));
  for (const d of SERVICES) {
    const r = commands.addSpecialization(s, d.id);
    if (r.ok) s = r.state;
  }
  s = structuredClone(s);
  for (const d of SERVICES) s.reno.skillXp[d.id] = LEVEL_START_XP[level]!;
  return s;
}

const rows: Record<string, unknown>[] = [];
const z = (x: number) => Math.round(x / 100);
for (const level of [1, 2, 3, 4, 5]) {
  const s = prepared(level);
  for (const d of SERVICES) {
    const [lo, hi] = d.qtyRange;
    for (const units of [lo, Math.round((lo + hi) / 2), hi]) {
      for (const complexity of ['standard', 'trudne'] as const) {
        const enq = craftEnquiry(structuredClone(s), { serviceId: d.id, units, complexity, qualityReq: 2 } as never);
        const ref = referencePrice(d.id, units, complexity, 2);
        const base = defaultQuoteInput(s, enq);
        const q = { ...base, priceNet: ref, hoursPerDay: 8, durationDays: 40, laborRate: LABOR, teamId: null, supervision: 'worker' as const };
        const p = previewQuote(s, q);
        const e = p.economics;
        const hasSkillErr = p.errors.some((m) => /umiejętno|specjaliz/i.test(m));
        rows.push({
          level, service: d.id, units, complexity, priceNet: z(ref), hours: +(p.plannedCenti / 100).toFixed(1), materials: z(e.external.materials), transport: z(e.external.transport),
          external: z(e.external.total), surplus: z(e.surplusBeforeOwner), ownerHourly: e.ownerHourly === null ? null : z(e.ownerHourly), economicProfit: z(e.economicProfit), skillBlocked: hasSkillErr,
        });
      }
    }
  }
}
console.log('poziom usługa           j.  zlec.   cena  godz  koszty nadw.  zł/h   zysk-ek. (stawka 60 zł/h)  [* = brak umiejętności]');
for (const r of rows) {
  if (r.units !== undefined && r.complexity === 'standard' && (r.level === 1 || r.level === 3 || r.level === 5)) {
    console.log(`${String(r.level).padStart(3)}   ${String(r.service).padEnd(10)} ${String(r.units).padStart(5)} ${String(r.priceNet).padStart(7)} ${String(r.hours).padStart(6)} ${String(r.external).padStart(6)} ${String(r.surplus).padStart(6)} ${String(r.ownerHourly).padStart(5)} ${String(r.economicProfit).padStart(8)} ${r.skillBlocked ? '*' : ''}`);
  }
}
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(rows, null, 1)); console.log(`zapisano ${out}`); }

/* ---------- Audyt projektów B2B (v0.8.1) ---------- */
import { currentOperator } from '../../src/engine/operator.ts';
import { B2B_KINDS, PROJECT_TEMPLATES } from '../../src/engine/projectsCatalog.ts';
import { buildProject, defaultPlanInput, ensureB2BPool, planProject } from '../../src/engine/projects.ts';

{
  let s = opsGame({ seed: 'audit-proj', equip: ['hand-tools', 'paint-basic', 'trowel-set', 'panel-kit'] });
  s = fund(s, zl(100_000));
  for (const id of ['gladzie', 'panele', 'drobne']) { const r = commands.addSpecialization(s, id); if (r.ok) s = r.state; }
  s = structuredClone(s);
  const clients = ensureB2BPool(s);
  console.log('\nprojekt                                  klient                          cena  koszty  nadw.  godz. zł/h(nadw.) dni/okno  szczyt gotówki');
  const rows2: Record<string, unknown>[] = [];
  for (const [tid, tpl] of Object.entries(PROJECT_TEMPLATES)) {
    for (const pos of [0, 0.5, 1]) {
      const kind = tid === 'subcontract' || tid === 'serial_flats' ? 'general_contractor' : tid === 'flat_finish' ? 'private_investor' : 'property_manager';
      const client = clients.find((c) => c.kind === kind)!;
      const area = Math.round(tpl.areaRange[0] + (tpl.areaRange[1] - tpl.areaRange[0]) * pos);
      const flats = tid === 'serial_flats' ? Math.round(tpl.flatsRange[0] + (tpl.flatsRange[1] - tpl.flatsRange[0]) * pos) : 1;
      const wanted = [1, 2, 3].find((t) => buildProject(s, currentOperator(s)!, client, tid as never, t, s.clock.today) !== null);
      void wanted;
      // buildProject losuje metraż — dla audytu budujemy projekt ręcznie z tego samego szablonu
      const p = (() => {
        for (let t = 1; t <= 3; t++) { const x = buildProject(s, currentOperator(s)!, client, tid as never, t, s.clock.today); if (x) return x; }
        return null;
      })();
      if (!p) continue;
      for (const pkg of p.packages) { pkg.complexity = 'standard'; pkg.refPriceNet = referencePrice(pkg.serviceId, pkg.units, 'standard', pkg.qualityReq); }
      p.requirements = { minCompleted: 0, minValueNet: 0, minRating10: 0, minProjectTier: 0, minWorkers: 0 };
      s.reno.projects.push(p);
      const plan = planProject(s, p, defaultPlanInput(s, p));
      void area; void flats;
      rows2.push({ title: p.title, kind: B2B_KINDS[client.kind].label, revenue: z(plan.economics.revenueNet), external: z(plan.economics.externalCost), surplus: z(plan.economics.surplus), hours: plan.economics.ownerCenti / 100, hourly: plan.economics.ownerHourly === null ? null : z(plan.economics.ownerHourly), chainDays: plan.chainDays, maxDays: p.maxDays, peak: z(plan.cash.peakNeed), blockers: plan.blockers.length });
      console.log(`${p.title.slice(0, 40).padEnd(40)} ${B2B_KINDS[client.kind].label.slice(0, 24).padEnd(24)} ${String(z(plan.economics.revenueNet)).padStart(8)} ${String(z(plan.economics.externalCost)).padStart(7)} ${String(z(plan.economics.surplus)).padStart(6)} ${String(Math.round(plan.economics.ownerCenti / 100)).padStart(5)} ${String(plan.economics.ownerHourly === null ? '-' : z(plan.economics.ownerHourly)).padStart(6)} ${String(plan.chainDays).padStart(5)}/${String(p.maxDays).padEnd(4)} ${String(z(plan.cash.peakNeed)).padStart(8)} ${plan.blockers.length ? '!' + plan.blockers.length : ''}`);
      break;
    }
  }
  if (out) writeFileSync(out.replace('.json', '-projects.json'), JSON.stringify(rows2, null, 1));
}
