import { issueDocument } from './business.ts';
import { CommandError, logEvent, nextCounter } from './core.ts';
import { dateInMonth, daysInMonth, formatDatePL, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { formatPLN, roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { SUPPLIER_PARTY, requireBusiness, requireCash, supplier } from './opsCommon.ts';
import { VEHICLES, VEHICLE_AGING_BPS_PER_MONTH, VEHICLE_BY_ID } from './renovationCatalog.ts';
import type { VehicleDef } from './renovationCatalog.ts';
import type { Business, GameState, Vehicle } from './state.ts';

/**
 * Pojazdy firmowe (v0.6): zakup za gotówkę przez wspólny silnik finansowy (zobowiązanie wobec sprzedawcy), wartość majątkowa
 * wg stanu technicznego (aktywo w majątku netto), koszty eksploatacji naliczane za dni pracy przy kontrakcie i koszty stałe
 * miesięczne. Podatkowo: zakup nie jest kosztem (brak amortyzacji i zasad dotyczących pojazdów — uproszczenie VEH-TAX-DEFERRED).
 */

export const vehicleBookValue = (v: Vehicle): Grosze => roundDiv(v.cost * v.conditionBps, 10_000);
export const vehicleDef = (v: Vehicle): VehicleDef => VEHICLE_BY_ID.get(v.catalogId)!;
export const vehicleLabel = (v: Vehicle): string => `${vehicleDef(v).label} (${v.id.replace('veh:', '#')})`;

export function buyVehicle(s: GameState, catalogId: string): string {
  const b = requireBusiness(s);
  const def = VEHICLE_BY_ID.get(catalogId);
  if (!def) throw new CommandError('Nieznany pojazd.');
  if (s.ops.vehicles.length >= 4) throw new CommandError('Flota może liczyć najwyżej 4 pojazdy.');
  requireCash(s, b, def.priceNet, false);
  supplier(s);
  const doc = issueDocument(s, b, {
    kind: 'cost', issueDate: s.clock.today, counterpartyId: SUPPLIER_PARTY, orderId: null, description: `Zakup pojazdu: ${def.label}`, net: def.priceNet, termDays: 0, part: 'capital',
    supplierVat: 'none', taxAmountOverride: 0, obligationCategory: 'zakup_pojazdu',
  });
  const id = `veh:${nextCounter(s, 'ops:vehicle')}`;
  s.ops.vehicles.push({ id, catalogId, purchasedOn: s.clock.today, cost: def.priceNet, docId: doc.id, conditionBps: 10_000, usedDays: 0 });
  logEvent(s, { id: `fleet.vehicle:${id}`, date: s.clock.today, type: 'fleet.vehicle', tone: 'neutral', title: `Kupiono pojazd: ${def.label}`, detail: `${formatPLN(def.priceNet)} · aktywo wyceniane wg stanu technicznego; zakup nie jest kosztem podatkowym (uproszczenie: brak amortyzacji i zasad dla pojazdów)`, amount: -def.priceNet, category: 'zakup_pojazdu' });
  return `Kupiono: ${def.label}. Zapłata z rachunku firmowego do jutra.`;
}

/** Zużycie i koszt jednego dnia pracy pojazdu przy kontrakcie; zwraca zmienny koszt eksploatacji. */
export function useVehicle(s: GameState, v: Vehicle, date: IsoDate): Grosze {
  const def = vehicleDef(v);
  v.usedDays += 1;
  v.conditionBps = Math.max(0, v.conditionBps - Math.max(1, roundDiv(10_000, def.durabilityDays)));
  const m = monthKey(date);
  s.ops.vehicleRunning[m] = (s.ops.vehicleRunning[m] ?? 0) + def.runPerDay;
  return def.runPerDay;
}

/** Koniec miesiąca: koszty stałe i zmienne pojazdów jako jeden dokument kosztowy oraz starzenie. Idempotentne. */
export function processFleet(s: GameState, b: Business, date: IsoDate): void {
  const { year, month } = parseIso(date);
  if (parseIso(date).day !== daysInMonth(year, month)) return;
  const m = monthKey(date);
  const key = `ops:fleet:${b.id}:${m}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  const owned = s.ops.vehicles.filter((v) => v.purchasedOn <= date);
  const fixed = owned.reduce((a, v) => a + vehicleDef(v).fixedMonthly, 0);
  const total = fixed + (s.ops.vehicleRunning[m] ?? 0);
  if (total > 0) {
    supplier(s);
    issueDocument(s, b, { kind: 'cost', issueDate: date, counterpartyId: SUPPLIER_PARTY, orderId: null, description: `Pojazdy: eksploatacja i koszty stałe — ${m}`, net: total, termDays: 7 });
  }
  for (const v of owned) v.conditionBps = Math.max(0, v.conditionBps - VEHICLE_AGING_BPS_PER_MONTH);
  void dateInMonth;
  void formatDatePL;
}

export { VEHICLES };
