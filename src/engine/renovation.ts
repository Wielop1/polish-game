import { activeBusiness, isSuspendedOn, issueDocument } from './business.ts';
import { CommandError, ensureParty, logEvent, nextCounter } from './core.ts';
import { addDays, diffDays, formatDatePL, monthKey, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { RULES_2026 as R } from './legal.ts';
import { formatPLN, mulBps, roundDiv, zl } from './money.ts';
import type { Grosze } from './money.ts';
import { createRng } from './rng.ts';
import {
  ADVERTISING, BASE_ENQUIRY_BPS, CANCEL_AFTER_DEADLINE_DAYS, CLIENT_NAMES, COMPLAINT_WINDOW_DAYS, COMPLEXITY_HOURS_BPS, DELAY_PENALTY_BPS_PER_WEEK,
  DELAY_PENALTY_CAP_BPS, DISTRICTS, EQUIPMENT, EQUIPMENT_BY_ID, MATERIAL_BY_ID, MAX_OPEN_ENQUIRIES, OTHER_COSTS_BPS, OWN_LABOR_RATE_DEFAULT, QUALITY_REQ_LABEL,
  QUALITY_THRESHOLD, SEASONALITY_BPS, SERVICES, SERVICE_BY_ID, SKILL_QUALITY, SKILL_SPEED_BPS, SKILL_START_CENTI, SKILL_THRESHOLD_CENTI, SPECIALIZATION_COURSE, STANDARDS,
} from './renovationCatalog.ts';
import type { MaterialStandard as Std, ServiceDef } from './renovationCatalog.ts';
import { inventoryValue, equipmentValue } from './selectors.ts';
import { budgetFor, firstOverload, performanceBps } from './time.ts';
import type {
  Business, Complexity, EquipmentItem, GameState, MaterialStandard, RenoCostPlan, RenoEnquiry, RenoJob, RenoQuote, RenovationState, ServiceOrder,
} from './state.ts';

/**
 * Moduł branży remontowo-wykończeniowej (v0.5). Rozszerza wspólny silnik: zlecenie jest zwykłym `ServiceOrder`
 * (`kind: 'renovation'`), przychód, zaliczka, koszty i VAT idą przez `issueDocument`, czas przez `commitments`.
 * Moduł dokłada: zapytania, wyceny, negocjacje, materiały (zapas = aktywo), sprzęt (wartość = aktywo), etapy realizacji,
 * jakość, reklamacje i reputację. WSZYSTKIE ceny i normy to parametry symulacyjne (renovationCatalog.ts).
 */

export const SUPPLIER_PARTY = 'party:supplier-reno';
const MARKET_PARTY_NAME = 'Hurtownie i dostawcy materiałów (fikcyjni)';

const reno = (s: GameState): RenovationState => s.reno;
const tomorrow = (s: GameState) => addDays(s.clock.today, 1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const roundTo = (v: Grosze, unit: Grosze) => Math.max(unit, roundDiv(v, unit) * unit);
export const stockKey = (materialId: string, std: MaterialStandard) => `${materialId}:${std}`;
export const splitKey = (key: string): { materialId: string; std: MaterialStandard } => {
  const [materialId, std] = key.split(':') as [string, MaterialStandard];
  return { materialId, std };
};

/* ---------- Umiejętności i wyposażenie ---------- */

export function isSpecialized(s: GameState, serviceId: string): boolean {
  return reno(s).specializations.includes(serviceId);
}

export function skillLevel(s: GameState, serviceId: string): number {
  if (!isSpecialized(s, serviceId)) return 0;
  const xp = reno(s).skillXp[serviceId] ?? 0;
  let level = 2;
  for (const th of SKILL_THRESHOLD_CENTI) if (xp >= th) level += 1;
  return level;
}

/** Postęp do następnego poziomu: [bieżące xp, próg następnego | null]. */
export function skillProgress(s: GameState, serviceId: string): { xp: number; next: number | null; level: number } {
  const xp = reno(s).skillXp[serviceId] ?? 0;
  const level = skillLevel(s, serviceId);
  return { xp, level, next: level >= 5 ? null : SKILL_THRESHOLD_CENTI[level - 2]! };
}

export const jobDifficulty = (def: ServiceDef, complexity: Complexity): number => def.difficulty + (complexity === 'trudne' ? 1 : 0);

/** Najlepszy (stanem technicznym) egzemplarz danego sprzętu. */
export function ownedEquipment(s: GameState, catalogId: string): EquipmentItem | undefined {
  return reno(s).equipment.filter((e) => e.catalogId === catalogId).sort((a, b) => b.conditionBps - a.conditionBps)[0];
}

export function equipmentStatus(s: GameState, def: ServiceDef): { missing: string[]; broken: string[] } {
  const missing: string[] = [];
  const broken: string[] = [];
  for (const id of def.requiredEquipment) {
    const item = ownedEquipment(s, id);
    const label = EQUIPMENT_BY_ID.get(id)!.label;
    if (!item) missing.push(label);
    else if (item.conditionBps <= 0) broken.push(label);
  }
  return { missing, broken };
}

/** Sprzęt, który zużywa się podczas pracy przy usłudze (wymagany + przyspieszający, wszystko co ma wpływ). */
function relevantEquipment(s: GameState, serviceId: string): EquipmentItem[] {
  const def = SERVICE_BY_ID.get(serviceId)!;
  const out: EquipmentItem[] = [];
  for (const e of EQUIPMENT) {
    const relevant = def.requiredEquipment.includes(e.id) || (e.speedBps[serviceId] ?? e.speedBps['*'] ?? 0) > 0 || (e.quality[serviceId] ?? e.quality['*'] ?? 0) > 0;
    if (!relevant) continue;
    const item = ownedEquipment(s, e.id);
    if (item && item.conditionBps > 0) out.push(item);
  }
  return out;
}

/** Łączny mnożnik wydajności (pkt bazowe; 10 000 = norma): umiejętności × sprzęt, z karą za zużyty sprzęt. */
export function speedBps(s: GameState, serviceId: string): number {
  let bps: number = SKILL_SPEED_BPS[clamp(skillLevel(s, serviceId), 1, 5)]!;
  for (const item of relevantEquipment(s, serviceId)) {
    const def = EQUIPMENT_BY_ID.get(item.catalogId)!;
    const boost = def.speedBps[serviceId] ?? def.speedBps['*'] ?? 0;
    if (boost > 0) bps = roundDiv(bps * (10_000 + boost), 10_000);
    if (item.conditionBps < 3_000) bps = roundDiv(bps * 9_000, 10_000);
  }
  return bps;
}

function equipmentQuality(s: GameState, serviceId: string): number {
  let q = 0;
  for (const item of relevantEquipment(s, serviceId)) {
    const def = EQUIPMENT_BY_ID.get(item.catalogId)!;
    q += def.quality[serviceId] ?? def.quality['*'] ?? 0;
    if (item.conditionBps < 3_000) q -= 4;
  }
  return Math.min(10, q);
}

export function transportSaveBps(s: GameState): number {
  let best = 0;
  for (const e of reno(s).equipment) if (e.conditionBps > 0) best = Math.max(best, EQUIPMENT_BY_ID.get(e.catalogId)!.transportSaveBps ?? 0);
  return best;
}

/** Wartość księgowa pojedynczego sprzętu (ekonomiczna): koszt zakupu × stan techniczny. */
export const equipmentBookValue = (e: EquipmentItem): Grosze => roundDiv(e.cost * e.conditionBps, 10_000);

/* ---------- Materiały: ceny, dostępność, zapotrzebowanie ---------- */

/** Cena netto jednostki w danym dniu: cena bazowa × standard × miesięczne wahania (±5%, deterministyczne). */
export function materialPrice(s: GameState, key: string, date: IsoDate): Grosze {
  const { materialId, std } = splitKey(key);
  const def = MATERIAL_BY_ID.get(materialId);
  if (!def) throw new CommandError('Nieznany materiał.');
  const factor = 9_500 + createRng(s.seed, `reno:price:${key}:${monthKey(date)}`).int(0, 1_000);
  return Math.max(1, roundDiv(roundDiv(def.priceNet * STANDARDS[std].priceBps, 10_000) * factor, 10_000));
}

export function materialAvailable(s: GameState, key: string, date: IsoDate): boolean {
  const { std } = splitKey(key);
  return createRng(s.seed, `reno:avail:${key}:${date}`).int(0, 99) >= (std === 'premium' ? 12 : 4);
}

export const stockQty = (s: GameState, key: string): number => reno(s).stock[key]?.qty ?? 0;

export function materialNeeds(serviceId: string, units: number, complexity: Complexity, std: MaterialStandard): Record<string, number> {
  const def = SERVICE_BY_ID.get(serviceId)!;
  const extra = complexity === 'trudne' ? 11_000 : 10_000;
  const out: Record<string, number> = {};
  for (const m of def.materialsPer100) out[stockKey(m.materialId, std)] = Math.max(1, Math.ceil((units * m.qty * extra) / (100 * 10_000)));
  return out;
}

export const normCenti = (serviceId: string, units: number, complexity: Complexity): number =>
  roundDiv(SERVICE_BY_ID.get(serviceId)!.normCentiPerUnit * units * COMPLEXITY_HOURS_BPS[complexity], 10_000);

/** Orientacyjna cena rynkowa netto zlecenia — baza budżetu klienta i wskaźnika cen. */
export function referencePrice(serviceId: string, units: number, complexity: Complexity, qualityReq: number): Grosze {
  const def = SERVICE_BY_ID.get(serviceId)!;
  const q = qualityReq === 3 ? 11_200 : qualityReq === 1 ? 9_500 : 10_000;
  return roundTo(mulBps(mulBps(def.referencePerUnit * units, COMPLEXITY_HOURS_BPS[complexity]), q), zl(10));
}

/* ---------- Reputacja ---------- */

export interface Reputation { score: number; stars: number; reviews: number }

/** Reputacja 0–100: średnia ocen z wygaszaniem starych opinii i „zakotwiczeniem” na 3,5 gwiazdki (3 opinie wagi). */
export function reputation(s: GameState, date: IsoDate = s.clock.today): Reputation {
  let sum = 3.5 * 3;
  let w = 3;
  for (const r of reno(s).reviews) {
    const age = diffDays(date, r.date);
    const weight = age <= 180 ? 1 : age <= 365 ? 0.5 : 0.25;
    sum += (r.rating10 / 10) * weight;
    w += weight;
  }
  const stars = sum / w;
  return { score: Math.round(stars * 20), stars: Math.round(stars * 10) / 10, reviews: reno(s).reviews.length };
}

const repFactorBps = (score: number) => 4_000 + score * 80;

/* ---------- Wycena ---------- */

export interface QuoteInput {
  serviceId: string;
  units: number;
  complexity: Complexity;
  standard: MaterialStandard;
  priceNet: Grosze;
  startDate: IsoDate;
  durationDays: number;
  hoursPerDay: number;
  advanceBps: number;
  paymentTermDays: number;
  laborRate: Grosze;
}

export interface QuotePreview {
  normCenti: number;
  speedBps: number;
  /** Planowany czas pracy w setnych godziny przy pełnej wydajności i bieżących umiejętnościach/sprzęcie. */
  plannedCenti: number;
  minDays: number;
  planned: RenoCostPlan;
  vatRateBps: number;
  priceGross: Grosze;
  /** Narzut = (cena − koszt) / koszt; marża = (cena − koszt) / cena — to różne wielkości. */
  markupBps: number;
  marginBps: number;
  /** Zarobek na godzinę własnej pracy po odliczeniu kosztów materiałów, transportu i innych (bez robocizny). */
  effectiveHourly: Grosze;
  need: Record<string, number>;
  stockShortage: Record<string, number>;
  difficulty: number;
  level: number;
  errors: string[];
  warnings: string[];
  timeConflict: { date: IsoDate; missing: number } | null;
}

export const vatRateNow = (b: Business): number => (b.vat.status === 'active' ? R.vat.rateBps : 0);
export const grossOfNet = (net: Grosze, vatBps: number): Grosze => net + mulBps(net, vatBps);

export function previewQuote(s: GameState, i: QuoteInput, opts: { forSending?: boolean } = {}): QuotePreview {
  const def = SERVICE_BY_ID.get(i.serviceId);
  if (!def) throw new CommandError('Nieznana usługa.');
  const b = activeBusiness(s);
  const today = s.clock.today;
  const errors: string[] = [];
  const warnings: string[] = [];
  const speed = speedBps(s, i.serviceId);
  const norm = normCenti(i.serviceId, i.units, i.complexity);
  const plannedCenti = Math.max(1, roundDiv(norm * 10_000, Math.max(1, speed)));
  const hpd = clamp(Math.round(i.hoursPerDay) || 1, 1, 8);
  const minDays = Math.ceil(plannedCenti / (hpd * 100));
  const need = materialNeeds(i.serviceId, i.units, i.complexity, i.standard);
  let materials = 0;
  const shortage: Record<string, number> = {};
  for (const [key, qty] of Object.entries(need)) {
    materials += qty * materialPrice(s, key, today);
    const short = qty - stockQty(s, key);
    if (short > 0) shortage[key] = short;
  }
  const transport = minDays * roundDiv(def.transportPerDay * (10_000 - transportSaveBps(s)), 10_000);
  const other = mulBps(materials, OTHER_COSTS_BPS);
  const labor = roundDiv(plannedCenti * i.laborRate, 100);
  const total = materials + labor + transport + other;
  const markupBps = total > 0 ? roundDiv((i.priceNet - total) * 10_000, total) : 0;
  const marginBps = i.priceNet > 0 ? roundDiv((i.priceNet - total) * 10_000, i.priceNet) : 0;
  const vatRateBps = b ? vatRateNow(b) : 0;
  const effectiveHourly = roundDiv((i.priceNet - materials - transport - other) * 100, plannedCenti);
  const level = skillLevel(s, i.serviceId);
  const difficulty = jobDifficulty(def, i.complexity);

  if (!b) errors.push('Nie prowadzisz działalności.');
  else if (b.closeOn !== null) errors.push('Działalność jest w trakcie zamykania.');
  else if (isSuspendedOn(b, today) || b.suspensions.some((x) => x.from > today)) errors.push('Działalność jest zawieszona lub zawieszenie jest zaplanowane.');
  if (!isSpecialized(s, i.serviceId)) errors.push(`Brak specjalizacji „${def.label}” — dodaj ją w zakładce Sprzęt i umiejętności (szkolenie ${formatPLN(SPECIALIZATION_COURSE, { round: true })}).`);
  else if (level < difficulty) errors.push(`Za niski poziom umiejętności (${level}) na to zlecenie (wymagany ${difficulty}). Zdobywaj doświadczenie przy łatwiejszych pracach.`);
  const eq = equipmentStatus(s, def);
  if (eq.missing.length) errors.push(`Brakuje wymaganego sprzętu: ${eq.missing.join(', ')}.`);
  if (eq.broken.length) errors.push(`Sprzęt wymaga konserwacji (stan 0%): ${eq.broken.join(', ')}.`);
  if (!Number.isInteger(i.priceNet) || i.priceNet <= 0) errors.push('Podaj dodatnią cenę netto.');
  if (!Number.isInteger(i.advanceBps) || i.advanceBps < 0 || i.advanceBps > 5_000) errors.push('Zaliczka: od 0 do 50% ceny.');
  if (!Number.isInteger(i.paymentTermDays) || i.paymentTermDays < 0 || i.paymentTermDays > 30) errors.push('Termin płatności: od 0 do 30 dni.');
  if (!Number.isInteger(i.hoursPerDay) || i.hoursPerDay < 1 || i.hoursPerDay > 8) errors.push('Godziny dziennie: od 1 do 8.');
  if (i.startDate <= today) errors.push('Rozpoczęcie prac najwcześniej jutro.');
  if (i.startDate > addDays(today, 120)) errors.push('Rozpoczęcie prac najpóźniej za 120 dni.');
  if (!Number.isInteger(i.durationDays) || i.durationDays < minDays) errors.push(`Przy ${hpd} godz. dziennie praca zajmie co najmniej ${minDays} dni — wydłuż termin lub zwiększ godziny dziennie.`);
  if (i.laborRate < 0) errors.push('Stawka robocizny nie może być ujemna.');

  let timeConflict: QuotePreview['timeConflict'] = null;
  if (b && i.startDate > today && Number.isInteger(i.durationDays) && i.durationDays >= 1 && i.durationDays <= 200) {
    timeConflict = firstOverload(s, i.startDate, addDays(i.startDate, i.durationDays - 1), { extraHoursPerDay: hpd });
    if (timeConflict) warnings.push(`Kolizja czasu: ${formatDatePL(timeConflict.date)} brakuje ${timeConflict.missing} godz. (etat, sen, obowiązki i inne kontrakty zajmują dobę).`);
  }
  if (i.priceNet > 0 && marginBps < 0) warnings.push('Cena nie pokrywa planowanych kosztów (łącznie z Twoją robocizną po podanej stawce).');
  if (b && b.vat.status === 'exempt') warnings.push('Zwolnienie podmiotowe z VAT: cena dla klienta = cena netto (bez VAT).');
  if (b && b.vat.status === 'active') warnings.push(`Czynny podatnik VAT: do ceny netto dolicza się ${vatRateBps / 100}% VAT (obsługiwana tylko stawka podstawowa; obniżona 8% dla remontów mieszkań — niezaimplementowana, RENO-VAT-REDUCED).`);
  if (i.advanceBps > 0) warnings.push('Zaliczka jest odrębnym dokumentem sprzedaży (przychód i VAT powstają przy jej otrzymaniu) — rozliczenie końcowe obejmuje resztę ceny.');
  void opts;
  return {
    normCenti: norm, speedBps: speed, plannedCenti, minDays, planned: { materials, labor, transport, other, total }, vatRateBps, priceGross: grossOfNet(Math.max(0, i.priceNet), vatRateBps),
    markupBps, marginBps, effectiveHourly, need, stockShortage: shortage, difficulty, level, errors, warnings, timeConflict,
  };
}

/** Domyślne parametry wyceny (cena = koszt planowany + 25% narzutu, start za tydzień). */
export function defaultQuoteInput(s: GameState, enq: RenoEnquiry): QuoteInput {
  const base: QuoteInput = {
    serviceId: enq.serviceId, units: enq.units, complexity: enq.complexity, standard: (['eko', 'std', 'premium'] as const)[Math.min(2, enq.qualityReq - 1)]!,
    priceNet: zl(1), startDate: addDays(s.clock.today, 2), durationDays: 1, hoursPerDay: 4, advanceBps: 0, paymentTermDays: 7, laborRate: OWN_LABOR_RATE_DEFAULT,
  };
  const p0 = previewQuote(s, base);
  const durationDays = Math.max(p0.minDays + 2, 3);
  // najwcześniejszy start nie wcześniej niż życzenie klienta, w którym zmieści się cały kontrakt (bez przekroczenia doby)
  let start = enq.desiredStart > base.startDate ? enq.desiredStart : base.startDate;
  for (let i = 0; i < 120; i++) {
    if (!firstOverload(s, start, addDays(start, durationDays - 1), { extraHoursPerDay: base.hoursPerDay })) break;
    start = addDays(start, 1);
  }
  const p1 = previewQuote(s, { ...base, durationDays, startDate: start });
  return { ...base, startDate: start, durationDays, priceNet: roundTo(mulBps(p1.planned.total, 12_500), zl(10)) };
}

/* ---------- Pomocnicze: dokumenty i gotówka firmy ---------- */

function supplier(s: GameState): void {
  ensureParty(s, { id: SUPPLIER_PARTY, name: MARKET_PARTY_NAME, role: 'service' });
}

/** Gotówka firmy po odliczeniu zobowiązań już wymagalnych (nie wolno wydać pieniędzy, które są już „zajęte”). */
export function availableCash(s: GameState, b: Business): Grosze {
  let due = 0;
  for (const o of s.obligations) if (o.scope === 'business' && o.status === 'open' && o.direction === 'payable' && o.dueDate <= s.clock.today) due += o.amount;
  return s.accounts[b.accountId]!.balance - due;
}

function requireBusiness(s: GameState): Business {
  const b = activeBusiness(s);
  if (!b) throw new CommandError('Nie prowadzisz działalności.');
  if (s.clock.today < b.startDate) throw new CommandError('Działalność jeszcze się nie rozpoczęła.');
  if (b.closeOn !== null) throw new CommandError('Działalność jest w trakcie zamykania.');
  return b;
}

function purchaseCost(s: GameState, b: Business, net: Grosze, description: string, orderId: string | null = null, date: IsoDate = s.clock.today): { docId: string; taxAmount: Grosze } {
  supplier(s);
  const doc = issueDocument(s, b, { kind: 'cost', issueDate: date, counterpartyId: SUPPLIER_PARTY, orderId, description, net, termDays: 0 });
  return { docId: doc.id, taxAmount: doc.taxAmount };
}

function requireCash(s: GameState, b: Business, net: Grosze): void {
  // dla zwolnionego z VAT dokument kosztowy = kwota końcowa; dla czynnego podatnika płacimy netto + VAT dostawcy
  const need = b.vat.status === 'active' ? grossOfNet(net, R.vat.rateBps) : net;
  const have = availableCash(s, b);
  if (have < need) throw new CommandError(`Za mało środków na rachunku firmowym (dostępne ${formatPLN(Math.max(0, have))}, potrzeba ${formatPLN(need)}). Zrób wkład własny na rachunek firmowy.`);
}

/* ---------- Komendy: sprzęt, materiały, reklama, specjalizacje ---------- */

export function buyEquipment(s: GameState, catalogId: string): string {
  const b = requireBusiness(s);
  const def = EQUIPMENT_BY_ID.get(catalogId);
  if (!def) throw new CommandError('Nieznany sprzęt.');
  const owned = ownedEquipment(s, catalogId);
  if (owned && owned.conditionBps > 0) throw new CommandError('Masz już ten sprzęt w użyciu. Zużyty (0%) można kupić ponownie.');
  requireCash(s, b, def.priceNet);
  const { docId, taxAmount } = purchaseCost(s, b, def.priceNet, `Sprzęt: ${def.label}`);
  const n = nextCounter(s, 'reno:equipment');
  reno(s).equipment.push({ id: `eq:${n}`, catalogId, purchasedOn: s.clock.today, cost: taxAmount, docId, conditionBps: 10_000, usedCenti: 0 });
  logEvent(s, { id: `reno.stock:eq:${n}`, date: s.clock.today, type: 'reno.stock', tone: 'neutral', title: `Kupiono sprzęt: ${def.label}`, detail: `${formatPLN(taxAmount)} — wydatek firmy (koszt podatkowy w dacie zakupu, SIMPLIFIED) i jednocześnie aktywo wyceniane wg stanu technicznego`, amount: -taxAmount, category: 'koszt_dzialalnosci' });
  return `Kupiono: ${def.label}. Zapłata z rachunku firmowego do jutra.`;
}

export function maintainEquipment(s: GameState, itemId: string): string {
  const b = requireBusiness(s);
  const item = reno(s).equipment.find((e) => e.id === itemId);
  if (!item) throw new CommandError('Nie ma takiego sprzętu.');
  if (item.conditionBps >= 9_500) throw new CommandError('Sprzęt jest w bardzo dobrym stanie — konserwacja nie jest potrzebna.');
  const def = EQUIPMENT_BY_ID.get(item.catalogId)!;
  requireCash(s, b, def.maintenanceNet);
  purchaseCost(s, b, def.maintenanceNet, `Konserwacja: ${def.label}`);
  item.conditionBps = Math.min(10_000, item.conditionBps + 3_000);
  return `Konserwacja wykonana. Stan techniczny: ${Math.round(item.conditionBps / 100)}%. Koszt konserwacji jest wydatkiem, nie powiększa wartości sprzętu ponad stan techniczny.`;
}

export function buyMaterial(s: GameState, key: string, qty: number): string {
  const b = requireBusiness(s);
  const { materialId, std } = splitKey(key);
  const def = MATERIAL_BY_ID.get(materialId);
  if (!def || !(std in STANDARDS)) throw new CommandError('Nieznany materiał.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 5_000) throw new CommandError('Ilość: od 1 do 5000.');
  const today = s.clock.today;
  if (!materialAvailable(s, key, today)) throw new CommandError(`${def.label} (${STANDARDS[std].label}) jest dziś niedostępny w hurtowni — spróbuj jutro lub wybierz inny standard.`);
  const net = qty * materialPrice(s, key, today);
  requireCash(s, b, net);
  const { docId, taxAmount } = purchaseCost(s, b, net, `Materiały: ${def.label} (${STANDARDS[std].label}) × ${qty} ${def.unit}`);
  const stock = reno(s).stock[key] ?? { qty: 0, value: 0 };
  reno(s).stock[key] = { qty: stock.qty + qty, value: stock.value + taxAmount };
  const n = nextCounter(s, 'reno:move');
  reno(s).stockMoves.push({ id: `move:${n}`, date: today, key, qty, value: taxAmount, kind: 'purchase', jobId: null, docId });
  logEvent(s, { id: `reno.stock:move:${n}`, date: today, type: 'reno.stock', tone: 'neutral', title: `Zakup materiałów: ${def.label} × ${qty} ${def.unit}`, detail: `${formatPLN(taxAmount)} · zapas to aktywo — koszt ekonomiczny powstaje dopiero przy zużyciu`, amount: -taxAmount, category: 'koszt_dzialalnosci' });
  return `Kupiono ${qty} ${def.unit}: ${def.label} (${STANDARDS[std].label}) za ${formatPLN(taxAmount)}.`;
}

/** Kupuje wszystko, czego brakuje do kontraktu (jedna komenda, tyle zakupów, ile potrzeba). Zwraca opis. */
export function buyMissingForJob(s: GameState, jobId: string): string {
  const job = reno(s).jobs.find((j) => j.id === jobId);
  if (!job || job.stage === 'done' || job.stage === 'cancelled') throw new CommandError('Ten kontrakt nie wymaga zakupów.');
  const parts: string[] = [];
  for (const [key, need] of Object.entries(job.need)) {
    const missing = need - (job.consumed[key]?.qty ?? 0) - stockQty(s, key);
    if (missing > 0) parts.push(buyMaterial(s, key, missing));
  }
  if (parts.length === 0) throw new CommandError('Masz już wszystkie materiały potrzebne do tego kontraktu.');
  return parts.join(' ');
}

export function setAdvertising(s: GameState, level: 'none' | 'local' | 'intensive'): string {
  const b = requireBusiness(s);
  const def = ADVERTISING.find((a) => a.id === level);
  if (!def) throw new CommandError('Nieznany poziom reklamy.');
  const ad = reno(s).advertising;
  if (ad.level === level) throw new CommandError('Ten poziom reklamy jest już ustawiony.');
  const month = monthKey(s.clock.today);
  if (def.monthlyNet > 0 && ad.paidMonth !== month) {
    requireCash(s, b, def.monthlyNet);
    purchaseCost(s, b, def.monthlyNet, `Reklama: ${def.label} — ${month}`);
    ad.paidMonth = month;
  }
  ad.level = level;
  ad.since = s.clock.today;
  return level === 'none' ? 'Reklama wyłączona (bez zwrotu opłaconego miesiąca).' : `Reklama włączona: ${def.label}. Opłata miesięczna ${formatPLN(def.monthlyNet)} netto, pobierana 1. dnia miesiąca.`;
}

export function addSpecialization(s: GameState, serviceId: string): string {
  const b = requireBusiness(s);
  if (!SERVICE_BY_ID.has(serviceId)) throw new CommandError('Nieznana usługa.');
  if (isSpecialized(s, serviceId)) throw new CommandError('Masz już tę specjalizację.');
  requireCash(s, b, SPECIALIZATION_COURSE);
  purchaseCost(s, b, SPECIALIZATION_COURSE, `Szkolenie: ${SERVICE_BY_ID.get(serviceId)!.label}`);
  reno(s).specializations.push(serviceId);
  reno(s).skillXp[serviceId] = Math.max(reno(s).skillXp[serviceId] ?? 0, SKILL_START_CENTI);
  return `Dodano specjalizację: ${SERVICE_BY_ID.get(serviceId)!.label} (poziom 2). Kolejne poziomy zdobywasz wyłącznie wykonując prace.`;
}

/* ---------- Zapytania klientów ---------- */

function priceIndexBps(s: GameState): number {
  const recent = reno(s).quotes.slice(-5);
  if (recent.length === 0) return 10_000;
  let sum = 0;
  for (const q of recent) {
    const enq = reno(s).enquiries.find((e) => e.id === q.enquiryId);
    const ref = referencePrice(q.serviceId, q.units, q.complexity, enq?.qualityReq ?? 2);
    sum += roundDiv(q.priceNet * 10_000, ref);
  }
  return roundDiv(sum, recent.length);
}

function availabilityBps(s: GameState, date: IsoDate): number {
  let ok = 0;
  for (let i = 1; i <= 14; i++) if (budgetFor(s, addDays(date, i)).free >= 2) ok += 1;
  return 4_000 + roundDiv(6_000 * ok, 14);
}

export function enquiryRateBps(s: GameState, date: IsoDate): { total: number; parts: { season: number; reputation: number; advertising: number; price: number; availability: number } } {
  const month = parseIso(date).month;
  const season = SEASONALITY_BPS[month]!;
  const rep = repFactorBps(reputation(s, date).score);
  const ad = ADVERTISING.find((a) => a.id === reno(s).advertising.level)!.leadBps;
  const idx = priceIndexBps(s);
  const price = clamp(10_000 + roundDiv(10_000 - idx, 2), 8_000, 12_000);
  const avail = availabilityBps(s, date);
  let p = BASE_ENQUIRY_BPS;
  for (const f of [season, rep, ad, price, avail]) p = roundDiv(p * f, 10_000);
  return { total: p, parts: { season, reputation: rep, advertising: ad, price, availability: avail } };
}

function maybeGenerateEnquiry(s: GameState, b: Business, date: IsoDate): void {
  const open = reno(s).enquiries.filter((e) => e.status === 'open' || e.status === 'quoted').length;
  if (open >= MAX_OPEN_ENQUIRIES || reno(s).specializations.length === 0) return;
  const rate = enquiryRateBps(s, date).total;
  const rng = createRng(s.seed, `reno:enq:${b.id}:${date}`);
  if (rng.int(0, 9_999) >= rate) return;
  const specs = reno(s).specializations;
  const others = SERVICES.filter((d) => !specs.includes(d.id));
  const def = others.length > 0 && rng.int(0, 99) < 12 ? others[rng.int(0, others.length - 1)]! : SERVICE_BY_ID.get(specs[rng.int(0, specs.length - 1)]!)!;
  const [lo, hi] = def.qtyRange;
  const step = def.unit === 'm²' ? 5 : 2;
  const units = Math.max(lo, Math.floor(rng.int(lo, hi) / step) * step);
  const complexity: Complexity = rng.int(0, 99) < 22 ? 'trudne' : 'standard';
  const rq = rng.int(0, 99);
  const qualityReq = rq < 30 ? 1 : rq < 80 ? 2 : 3;
  const norm = normCenti(def.id, units, complexity);
  const ref = referencePrice(def.id, units, complexity, qualityReq);
  const budgetGross = roundTo(roundDiv(ref * rng.int(78, 130), 100), zl(10));
  const walkAwayGross = roundTo(roundDiv(budgetGross * rng.int(95, 118), 100), zl(10));
  const n = nextCounter(s, 'reno:enquiry');
  const id = `enq:${n}`;
  const clientId = `party:client:${id}`;
  const clientName = `${CLIENT_NAMES[rng.int(0, CLIENT_NAMES.length - 1)]} (klient indywidualny, fikcyjny)`;
  ensureParty(s, { id: clientId, name: clientName, role: 'service' });
  const location = DISTRICTS[rng.int(0, DISTRICTS.length - 1)]!;
  const enq: RenoEnquiry = {
    id, businessId: b.id, clientId, clientName, location, serviceId: def.id, units, complexity, qualityReq,
    desiredStart: addDays(date, rng.int(4, 24)), maxDays: clamp(Math.ceil(norm / 100 / 3) + rng.int(2, 10), 3, 60), budgetGross: Math.max(zl(10), budgetGross),
    walkAwayGross: Math.max(zl(10), walkAwayGross), haggler: rng.int(0, 99) < 35, flexDays: rng.int(0, 6), receivedOn: date, respondBy: addDays(date, rng.int(5, 9)), status: 'open',
  };
  reno(s).enquiries.push(enq);
  logEvent(s, { id: `reno.enquiry:${id}`, date, type: 'reno.enquiry', tone: 'neutral', title: `Nowe zapytanie: ${def.label}, ${units} ${def.unit} (${location})`, detail: `${clientName} · budżet ok. ${formatPLN(enq.budgetGross, { round: true })} brutto · odpowiedz do ${formatDatePL(enq.respondBy)}`, amount: null, category: null });
}

export function declineEnquiry(s: GameState, enquiryId: string): string {
  const e = reno(s).enquiries.find((x) => x.id === enquiryId);
  if (!e || e.status !== 'open') throw new CommandError('To zapytanie nie jest już otwarte.');
  e.status = 'declined';
  return 'Zapytanie odrzucone.';
}

/* ---------- Wysłanie oferty, decyzja klienta, negocjacje ---------- */

export function sendQuote(s: GameState, enquiryId: string, input: QuoteInput): string {
  const b = requireBusiness(s);
  const enq = reno(s).enquiries.find((e) => e.id === enquiryId);
  if (!enq || enq.status !== 'open') throw new CommandError('To zapytanie nie jest już otwarte.');
  if (s.clock.today > enq.respondBy) throw new CommandError('Termin odpowiedzi na to zapytanie minął.');
  if (input.serviceId !== enq.serviceId || input.units !== enq.units || input.complexity !== enq.complexity) throw new CommandError('Oferta musi dotyczyć zakresu z zapytania.');
  const p = previewQuote(s, input, { forSending: true });
  if (p.errors.length) throw new CommandError(p.errors[0]!);
  const n = nextCounter(s, 'reno:quote');
  const id = `quote:${n}`;
  const today = s.clock.today;
  const decideOn = addDays(today, createRng(s.seed, `reno:decide:${id}`).int(1, 3));
  const q: RenoQuote = {
    id, enquiryId, businessId: b.id, serviceId: input.serviceId, units: input.units, complexity: input.complexity, standard: input.standard, priceNet: input.priceNet,
    vatRateBps: p.vatRateBps, advanceBps: input.advanceBps, paymentTermDays: input.paymentTermDays, startDate: input.startDate, durationDays: input.durationDays,
    hoursPerDay: input.hoursPerDay, laborRate: input.laborRate, planned: p.planned, plannedCenti: p.plannedCenti, sentOn: today, decideOn, status: 'sent', counter: null,
    held: false, note: '', acceptedOn: null, signBy: null, replyDays: diffDays(today, enq.receivedOn),
  };
  reno(s).quotes.push(q);
  enq.status = 'quoted';
  logEvent(s, { id: `reno.quote:${id}`, date: today, type: 'reno.quote', tone: 'neutral', title: `Wysłano ofertę: ${SERVICE_BY_ID.get(q.serviceId)!.label} dla ${enq.clientName}`, detail: `${formatPLN(q.priceNet)} netto (${formatPLN(p.priceGross)} dla klienta) · odpowiedź klienta w ciągu kilku dni`, amount: null, category: null });
  return `Oferta wysłana. Klient odpowie do ${formatDatePL(decideOn)}.`;
}

export interface Decision { pAccept: number; outcome: 'accept' | 'counter' | 'reject'; counter: RenoQuote['counter']; reason: string }

/** Deterministyczna decyzja klienta (seed + id oferty). Prawdopodobieństwa wynikają z ceny, jakości, terminów, reputacji, zaliczki i komunikacji. */
export function clientAcceptanceBps(s: GameState, q: RenoQuote, enq: RenoEnquiry, date: IsoDate): { pAccept: number; notes: string[] } {
  const gross = grossOfNet(q.priceNet, q.vatRateBps);
  const notes: string[] = [];
  let base: number;
  if (gross <= mulBps(enq.budgetGross, 9_200)) base = 8_500;
  else if (gross <= enq.budgetGross) base = 7_000;
  else if (gross <= enq.walkAwayGross) base = 7_000 - roundDiv((gross - enq.budgetGross) * 5_500, Math.max(1, enq.walkAwayGross - enq.budgetGross));
  else { base = 300; notes.push('cena powyżej budżetu klienta'); }
  const lvl = STANDARDS[q.standard].level;
  if (lvl < enq.qualityReq) { base -= 1_500 * (enq.qualityReq - lvl); notes.push('standard materiałów poniżej oczekiwań'); }
  else if (lvl > enq.qualityReq) base += 300;
  const lateStart = Math.max(0, diffDays(q.startDate, enq.desiredStart) - enq.flexDays);
  if (lateStart > 0) { base -= Math.min(2_500, lateStart * 250); notes.push('późny termin rozpoczęcia'); }
  const overDuration = Math.max(0, q.durationDays - enq.maxDays);
  if (overDuration > 0) { base -= Math.min(2_500, overDuration * 300); notes.push('zbyt długi czas realizacji'); }
  base += (reputation(s, date).score - 70) * 30;
  if (q.advanceBps > 3_000) { base -= 1_000; notes.push('wysoka zaliczka'); } else if (q.advanceBps > 2_000) base -= 400; else if (q.advanceBps <= 1_000) base += 200;
  if (q.replyDays > 3) { base -= Math.min(1_500, 300 * (q.replyDays - 3)); notes.push('późna odpowiedź na zapytanie'); } else if (q.replyDays <= 1) base += 200;
  return { pAccept: clamp(base, 100, 9_500), notes };
}

export function decideQuote(s: GameState, q: RenoQuote, enq: RenoEnquiry, date: IsoDate): Decision {
  const { pAccept, notes } = clientAcceptanceBps(s, q, enq, date);
  const rng = createRng(s.seed, `reno:client:${q.id}`);
  const roll = rng.int(0, 9_999);
  const gross = grossOfNet(q.priceNet, q.vatRateBps);
  const makeCounter = (): RenoQuote['counter'] => {
    const kind = rng.int(0, 99) < 60 ? 'discount' : 'deadline';
    const timelineMismatch = q.startDate > addDays(enq.desiredStart, enq.flexDays) || q.durationDays > enq.maxDays;
    if (kind === 'deadline' && timelineMismatch) {
      return { kind: 'deadline', discountBps: 0, newStart: q.startDate > addDays(enq.desiredStart, enq.flexDays) ? addDays(enq.desiredStart, enq.flexDays) : q.startDate, newDuration: Math.min(q.durationDays, enq.maxDays) };
    }
    return { kind: 'discount', discountBps: rng.int(300, 1_200), newStart: null, newDuration: null };
  };
  if (roll < pAccept) {
    if (enq.haggler && gross > mulBps(enq.budgetGross, 8_500) && rng.int(0, 9_999) < 4_000) return { pAccept, outcome: 'counter', counter: makeCounter(), reason: 'klient chce negocjować' };
    return { pAccept, outcome: 'accept', counter: null, reason: '' };
  }
  const counterZone = gross <= mulBps(enq.walkAwayGross, 10_500) ? 3_500 : 800;
  if (roll < pAccept + roundDiv((10_000 - pAccept) * counterZone, 10_000)) return { pAccept, outcome: 'counter', counter: makeCounter(), reason: notes[0] ?? 'klient prosi o korektę' };
  return { pAccept, outcome: 'reject', counter: null, reason: notes[0] ?? 'klient wybrał inną ofertę' };
}

function processQuotes(s: GameState, date: IsoDate): void {
  for (const q of reno(s).quotes) {
    const enq = reno(s).enquiries.find((e) => e.id === q.enquiryId)!;
    if (q.status === 'sent' && date >= q.decideOn) {
      const d = decideQuote(s, q, enq, date);
      if (d.outcome === 'accept') {
        q.status = 'accepted'; q.acceptedOn = date; q.signBy = addDays(date, 5); enq.status = 'won';
        logEvent(s, { id: `reno.quote:${q.id}:accepted`, date, type: 'reno.quote', tone: 'positive', title: `Klient zaakceptował ofertę: ${enq.clientName}`, detail: `Podpisz umowę do ${formatDatePL(q.signBy)} — inaczej oferta wygaśnie.`, amount: null, category: null });
      } else if (d.outcome === 'counter') {
        q.status = 'counter'; q.counter = d.counter; q.note = d.reason;
        const c = d.counter!;
        logEvent(s, { id: `reno.quote:${q.id}:counter`, date, type: 'reno.quote', tone: 'warning', title: `Klient proponuje zmianę warunków: ${enq.clientName}`, detail: c.kind === 'discount' ? `Rabat ${c.discountBps / 100}% od ceny netto. Odpowiedz w ciągu 5 dni.` : `Zmiana terminu: start ${formatDatePL(c.newStart!)}, czas realizacji ${c.newDuration} dni. Odpowiedz w ciągu 5 dni.`, amount: null, category: null });
      } else {
        q.status = 'rejected'; q.note = d.reason; enq.status = 'lost';
        logEvent(s, { id: `reno.quote:${q.id}:rejected`, date, type: 'reno.quote', tone: 'negative', title: `Klient odrzucił ofertę: ${enq.clientName}`, detail: `Powód: ${d.reason}`, amount: null, category: null });
      }
    } else if (q.status === 'counter' && date > addDays(q.decideOn, 5)) {
      q.status = 'expired'; enq.status = 'lost';
      logEvent(s, { id: `reno.quote:${q.id}:expired`, date, type: 'reno.quote', tone: 'warning', title: `Klient nie doczekał się odpowiedzi: ${enq.clientName}`, detail: 'Negocjacje wygasły.', amount: null, category: null });
    } else if (q.status === 'accepted' && q.signBy && date > q.signBy) {
      q.status = 'expired'; enq.status = 'lost';
      logEvent(s, { id: `reno.quote:${q.id}:unsigned`, date, type: 'reno.quote', tone: 'warning', title: `Oferta wygasła bez podpisania umowy: ${enq.clientName}`, detail: '', amount: null, category: null });
    }
  }
  for (const e of reno(s).enquiries) {
    if (e.status === 'open' && date > e.respondBy) {
      e.status = 'expired';
      logEvent(s, { id: `reno.enquiry:${e.id}:expired`, date, type: 'reno.enquiry', tone: 'warning', title: `Zapytanie wygasło bez odpowiedzi: ${e.clientName}`, detail: 'Brak odpowiedzi pogarsza opinię o komunikacji.', amount: null, category: null });
    }
  }
}

export function respondToCounter(s: GameState, quoteId: string, action: 'accept' | 'decline' | 'hold'): string {
  const q = reno(s).quotes.find((x) => x.id === quoteId);
  if (!q || q.status !== 'counter' || !q.counter) throw new CommandError('Ta oferta nie czeka na Twoją odpowiedź.');
  const enq = reno(s).enquiries.find((e) => e.id === q.enquiryId)!;
  const today = s.clock.today;
  if (action === 'decline') {
    q.status = 'declined'; enq.status = 'lost';
    return 'Odrzucono propozycję klienta — negocjacje zakończone.';
  }
  if (action === 'hold') {
    if (q.held) throw new CommandError('Podtrzymałeś już swoje warunki — możesz je teraz tylko przyjąć zmianę albo zrezygnować.');
    q.held = true;
    const { pAccept } = clientAcceptanceBps(s, q, enq, today);
    const win = createRng(s.seed, `reno:hold:${q.id}`).int(0, 9_999) < roundDiv(pAccept * 6_000, 10_000);
    if (win) { q.status = 'accepted'; q.acceptedOn = today; q.signBy = addDays(today, 5); enq.status = 'won'; q.counter = null; return 'Klient przyjął Twoje pierwotne warunki. Podpisz umowę.'; }
    q.status = 'rejected'; q.note = 'klient nie zgodził się na podtrzymane warunki'; enq.status = 'lost';
    return 'Klient nie zgodził się i zrezygnował.';
  }
  const c = q.counter;
  if (c.kind === 'discount') {
    q.priceNet = Math.max(1, q.priceNet - mulBps(q.priceNet, c.discountBps));
  } else {
    const minDays = Math.ceil(q.plannedCenti / (q.hoursPerDay * 100));
    if (c.newDuration! < minDays) throw new CommandError(`Przy ${q.hoursPerDay} godz. dziennie potrzebujesz ${minDays} dni, a klient chce ${c.newDuration}. Odrzuć propozycję albo podtrzymaj warunki.`);
    if (c.newStart! <= today) throw new CommandError('Proponowany termin rozpoczęcia już minął — podtrzymaj warunki lub zrezygnuj.');
    q.startDate = c.newStart!;
    q.durationDays = c.newDuration!;
  }
  q.status = 'accepted'; q.acceptedOn = today; q.signBy = addDays(today, 5); enq.status = 'won';
  return 'Zaakceptowano zmianę warunków. Podpisz umowę.';
}

/* ---------- Podpisanie umowy ---------- */

export function signContract(s: GameState, quoteId: string): string {
  const b = requireBusiness(s);
  const today = s.clock.today;
  const q = reno(s).quotes.find((x) => x.id === quoteId);
  if (!q || q.status !== 'accepted') throw new CommandError('Ta oferta nie czeka na podpisanie umowy.');
  if (q.signBy && today > q.signBy) throw new CommandError('Termin podpisania umowy minął.');
  if (isSuspendedOn(b, today) || b.suspensions.some((x) => x.from > today)) throw new CommandError('Działalność jest zawieszona — nie można podpisywać nowych umów.');
  const enq = reno(s).enquiries.find((e) => e.id === q.enquiryId)!;
  const def = SERVICE_BY_ID.get(q.serviceId)!;
  const difficulty = jobDifficulty(def, q.complexity);
  if (skillLevel(s, q.serviceId) < difficulty) throw new CommandError('Poziom umiejętności jest za niski na to zlecenie.');
  const eq = equipmentStatus(s, def);
  if (eq.missing.length || eq.broken.length) throw new CommandError(`Sprzęt: ${[...eq.missing, ...eq.broken].join(', ')} — uzupełnij lub skonserwuj przed podpisaniem.`);
  const start = q.startDate > today ? q.startDate : tomorrow(s);
  const deadline = addDays(start, q.durationDays - 1);
  const clash = firstOverload(s, start, deadline, { extraHoursPerDay: q.hoursPerDay });
  if (clash) throw new CommandError(`Brak wolnych godzin: ${formatDatePL(clash.date)} brakuje ${clash.missing} godz. Zmień plan dnia, zakończ inny kontrakt albo odrzuć umowę.`);

  const n = nextCounter(s, 'reno:job');
  const jobId = `job:${n}`;
  const orderId = `order:${jobId}`;
  const commitmentId = `commit:${orderId}`;
  s.commitments.push({ id: commitmentId, label: `Remont: ${def.label} — ${enq.clientName}`, startDate: start, endDate: deadline, hoursPerDay: q.hoursPerDay, sourceEventId: null });
  const norm = normCenti(q.serviceId, q.units, q.complexity);
  const order: ServiceOrder = {
    id: orderId, offerId: q.id, clientId: enq.clientId, title: `${def.label}: ${q.units} ${def.unit}, ${enq.location}`, netValue: q.priceNet, hoursTotal: Math.max(1, Math.ceil(q.plannedCenti / 100)),
    progressCentiHours: 0, hoursPerDay: q.hoursPerDay, costNet: q.planned.materials + q.planned.transport + q.planned.other, paymentTermDays: q.paymentTermDays,
    latePenaltyBps: DELAY_PENALTY_BPS_PER_WEEK, acceptedOn: today, startDate: start, deadline, status: 'in_progress', completedOn: null, salesDocumentId: null, commitmentId, late: false, kind: 'renovation',
  };
  s.serviceOrders.push(order);
  const advanceNet = roundDiv(q.priceNet * q.advanceBps, 10_000);
  let advanceDocId: string | null = null;
  if (advanceNet > 0) {
    const doc = issueDocument(s, b, { kind: 'sales', issueDate: today, counterpartyId: enq.clientId, orderId, description: `Zaliczka: ${order.title}`, net: advanceNet, termDays: 2, part: 'advance', noDelay: true });
    advanceDocId = doc.id;
  }
  const job: RenoJob = {
    id: jobId, orderId, quoteId: q.id, businessId: b.id, clientId: enq.clientId, clientName: enq.clientName, location: enq.location, serviceId: q.serviceId, units: q.units,
    complexity: q.complexity, difficulty, standard: q.standard, qualityReq: enq.qualityReq, budgetGross: enq.budgetGross, priceNet: q.priceNet, vatRateBps: vatRateNow(b), advanceNet, advanceDocId,
    finalDocId: null, paymentTermDays: q.paymentTermDays, planned: q.planned, plannedCenti: q.plannedCenti, laborRate: q.laborRate, lastDay: null, pauseUntil: null, normCenti: norm, extraCenti: 0, progressCenti: 0,
    hoursPerDay: q.hoursPerDay, startDate: start, deadline, signedOn: today, stage: 'preparation', need: materialNeeds(q.serviceId, q.units, q.complexity, q.standard), consumed: {},
    actual: { materials: 0, transport: 0, other: 0, rework: 0 }, workedDays: 0, blockedDays: 0, perfSumBps: 0, perfDays: 0, issues: [], reworkDone: false, quality: null, finishedOn: null,
    handoverOn: null, settledOn: null, lateDays: 0, penaltyNet: 0, blockedReason: null,
  };
  reno(s).jobs.push(job);
  q.status = 'signed';
  logEvent(s, { id: `reno.contract:${jobId}`, date: today, type: 'reno.contract', tone: 'positive', title: `Podpisano umowę: ${order.title}`, detail: `${enq.clientName} · ${formatPLN(q.priceNet)} netto · start ${formatDatePL(start)}, termin ${formatDatePL(deadline)} · ${advanceNet > 0 ? `zaliczka ${formatPLN(advanceNet)} netto` : 'bez zaliczki'} · kara za zwłokę ${DELAY_PENALTY_BPS_PER_WEEK / 100}% za każdy rozpoczęty tydzień (max ${DELAY_PENALTY_CAP_BPS / 100}%)`, amount: null, category: null });
  return `Umowa podpisana. Prace od ${formatDatePL(start)}, termin ${formatDatePL(deadline)}. Kup materiały przed rozpoczęciem.`;
}

/** Rozwiązanie kontraktu przez gracza — zaliczka wraca do klienta (jako koszt, SIMPLIFIED), reputacja spada. */
export function terminateJob(s: GameState, jobId: string): string {
  const b = requireBusiness(s);
  const job = reno(s).jobs.find((j) => j.id === jobId);
  if (!job || job.stage === 'done' || job.stage === 'cancelled') throw new CommandError('Ten kontrakt jest już zakończony.');
  cancelJob(s, b, job, s.clock.today, 'Wykonawca rozwiązał umowę');
  return 'Umowa rozwiązana. Zaliczka została zwrócona klientowi, a opinia firmy ucierpiała.';
}

function cancelJob(s: GameState, b: Business, job: RenoJob, date: IsoDate, reason: string): void {
  job.stage = 'cancelled';
  job.settledOn = date;
  const order = s.serviceOrders.find((o) => o.id === job.orderId)!;
  order.status = 'failed';
  order.completedOn = date;
  const c = s.commitments.find((x) => x.id === order.commitmentId);
  if (c) c.endDate = date < c.startDate ? c.startDate : date;
  if (job.advanceNet > 0) {
    // zwrot zaliczki: korekta faktury zaliczkowej nie jest modelowana — ujmujemy jako koszt (SIMPLIFIED, FE-RENO-ADVANCE)
    supplier(s);
    issueDocument(s, b, { kind: 'cost', issueDate: date, counterpartyId: job.clientId, orderId: job.orderId, description: `Zwrot zaliczki: ${order.title}`, net: job.advanceNet, termDays: 0 });
    job.actual.rework += job.advanceNet;
  }
  const n = nextCounter(s, 'reno:review');
  reno(s).reviews.push({ id: `review:${n}`, jobId: job.id, date, rating10: 10, parts: { quality: 10, punctuality: 10, conformity: 10, price: 30, communication: 20 }, comment: `Umowa rozwiązana: ${reason}.` });
  logEvent(s, { id: `reno.contract:${job.id}:cancelled`, date, type: 'reno.contract', tone: 'negative', title: `Umowa rozwiązana: ${order.title}`, detail: `${reason}. Zaliczka zwrócona, opinia 1,0★.`, amount: null, category: null });
}

/* ---------- Realizacja prac ---------- */

export interface JobForecast { etaDate: IsoDate | null; remainingCenti: number; risk: 'niskie' | 'średnie' | 'wysokie'; reasons: string[]; progressPct: number }

export function jobForecast(s: GameState, job: RenoJob, date: IsoDate = s.clock.today): JobForecast {
  const total = job.normCenti + job.extraCenti;
  const remaining = Math.max(0, total - job.progressCenti);
  const reasons: string[] = [];
  const speed = speedBps(s, job.serviceId);
  const perf = performanceBps(s.life.fatigue);
  const perDay = Math.max(1, roundDiv(job.hoursPerDay * 100 * perf * speed, 100_000_000));
  const days = Math.ceil(remaining / perDay);
  const startOfWork = date < job.startDate ? job.startDate : date;
  const etaDate = job.stage === 'done' || job.stage === 'cancelled' ? null : addDays(startOfWork, Math.max(0, days - (date < job.startDate ? 1 : 0)));
  let score = 0;
  if (etaDate && etaDate > job.deadline) { score += 2; reasons.push(`prognozowane zakończenie ${formatDatePL(etaDate)} po terminie ${formatDatePL(job.deadline)}`); }
  else if (etaDate && diffDays(job.deadline, etaDate) <= 2) { score += 1; reasons.push('mały zapas czasu do terminu'); }
  const short = Object.entries(job.need).filter(([k, need]) => need - (job.consumed[k]?.qty ?? 0) - stockQty(s, k) > 0);
  if (short.length && job.stage !== 'done') { score += date >= addDays(job.startDate, -3) ? 2 : 1; reasons.push('brakuje materiałów'); }
  const def = SERVICE_BY_ID.get(job.serviceId)!;
  const eq = equipmentStatus(s, def);
  if (eq.broken.length) { score += 2; reasons.push('sprzęt wymaga konserwacji'); }
  if (s.life.fatigue >= 60) { score += 1; reasons.push('wysokie zmęczenie obniża wydajność'); }
  if (job.issues.length >= 2) { score += 1; reasons.push('problemy techniczne wydłużają pracę'); }
  return { etaDate, remainingCenti: remaining, risk: score >= 3 ? 'wysokie' : score >= 1 ? 'średnie' : 'niskie', reasons, progressPct: Math.min(100, Math.round((job.progressCenti * 100) / total)) };
}

function wearEquipment(s: GameState, serviceId: string, hours: number): void {
  for (const item of relevantEquipment(s, serviceId)) {
    const def = EQUIPMENT_BY_ID.get(item.catalogId)!;
    item.conditionBps = Math.max(0, item.conditionBps - Math.max(1, roundDiv(hours * 10_000, def.durabilityHours)));
    item.usedCenti += hours * 100;
  }
}

function consumeMaterials(s: GameState, job: RenoJob, date: IsoDate): void {
  const progress = Math.min(job.progressCenti, job.normCenti);
  for (const [key, need] of Object.entries(job.need)) {
    const target = Math.ceil((need * progress) / job.normCenti);
    const have = job.consumed[key] ?? { qty: 0, value: 0 };
    const dq = Math.min(target - have.qty, stockQty(s, key));
    if (dq <= 0) continue;
    const st = reno(s).stock[key]!;
    const value = dq === st.qty ? st.value : roundDiv(st.value * dq, st.qty);
    st.qty -= dq;
    st.value -= value;
    job.consumed[key] = { qty: have.qty + dq, value: have.value + value };
    job.actual.materials += value;
    const n = nextCounter(s, 'reno:move');
    reno(s).stockMoves.push({ id: `move:${n}`, date, key, qty: -dq, value: -value, kind: 'use', jobId: job.id, docId: null });
  }
}

function maxProgressByStock(s: GameState, job: RenoJob): number {
  if (job.progressCenti >= job.normCenti) return Number.MAX_SAFE_INTEGER;
  let max = job.normCenti;
  for (const [key, need] of Object.entries(job.need)) {
    const have = (job.consumed[key]?.qty ?? 0) + stockQty(s, key);
    max = Math.min(max, Math.floor((have * job.normCenti) / need));
  }
  return max;
}

const ISSUES_ORG: { title: string; centi: [number, number]; pause: [number, number] }[] = [
  { title: 'Klient nie zapewnił dostępu do lokalu w umówionym dniu', centi: [200, 500], pause: [1, 2] },
  { title: 'Opóźnienie dostawy drobnych materiałów u dostawcy', centi: [100, 300], pause: [1, 1] },
  { title: 'Klient zmienił zakres prac w trakcie realizacji', centi: [300, 800], pause: [0, 1] },
];

function maybeIssue(s: GameState, job: RenoJob, date: IsoDate): void {
  const def = SERVICE_BY_ID.get(job.serviceId)!;
  const rng = createRng(s.seed, `reno:issue:${job.id}:${date}`);
  const level = skillLevel(s, job.serviceId);
  const bps = 250 + job.difficulty * 80 + (job.complexity === 'trudne' ? 150 : 0) + Math.max(0, job.difficulty - level + 1) * 100;
  if (rng.int(0, 9_999) >= bps) return;
  const technical = rng.int(0, 99) < 60;
  let title: string;
  let addedCenti: number;
  let delayDays = 0;
  if (technical) {
    title = `Problem techniczny: ${def.risks[rng.int(0, def.risks.length - 1)]}`;
    addedCenti = rng.int(600, 1_600);
  } else {
    const o = ISSUES_ORG[rng.int(0, ISSUES_ORG.length - 1)]!;
    title = o.title;
    addedCenti = rng.int(o.centi[0], o.centi[1]);
    delayDays = rng.int(o.pause[0], o.pause[1]);
  }
  job.extraCenti += addedCenti;
  if (delayDays > 0) job.pauseUntil = addDays(date, delayDays);
  const id = `issue:${job.id}:${date}`;
  job.issues.push({ id, date, kind: technical ? 'techniczny' : 'organizacyjny', title, addedCenti, delayDays });
  logEvent(s, { id: `reno.issue:${id}`, date, type: 'reno.issue', tone: 'warning', title: `${job.clientName}: ${title}`, detail: `Dodatkowa praca ok. ${(addedCenti / 100).toFixed(1).replace('.', ',')} godz.${delayDays > 0 ? ` · przerwa ${delayDays} dn.` : ''}`, amount: null, category: null });
}

function workJob(s: GameState, b: Business, job: RenoJob, date: IsoDate): void {
  const order = s.serviceOrders.find((o) => o.id === job.orderId)!;
  const commitment = s.commitments.find((c) => c.id === order.commitmentId);
  if (job.lastDay !== null && date <= job.lastDay) return;
  job.lastDay = date;
  if (date < job.startDate) { job.stage = 'preparation'; return; }
  if (date > addDays(job.deadline, CANCEL_AFTER_DEADLINE_DAYS)) { cancelJob(s, b, job, date, 'Klient odstąpił od umowy po przekroczeniu terminu o 45 dni'); return; }
  const def = SERVICE_BY_ID.get(job.serviceId)!;
  const total = job.normCenti + job.extraCenti;

  // praca po terminie umowy zajmuje godziny tylko wtedy, gdy doba na to pozwala (inne kontrakty mają pierwszeństwo — bez przekroczenia 24 godzin)
  if (commitment && date > commitment.endDate) {
    if (budgetFor(s, date).free >= job.hoursPerDay) commitment.endDate = date;
    else { job.blockedDays += 1; job.blockedReason = 'Brak wolnych godzin — doba zajęta przez inne zobowiązania'; return; }
  }
  if (job.pauseUntil && date <= job.pauseUntil) { job.blockedDays += 1; job.blockedReason = 'Przerwa organizacyjna (klient/dostawca)'; return; }
  const eq = equipmentStatus(s, def);
  if (eq.missing.length || eq.broken.length) { job.blockedDays += 1; job.stage = 'materials'; job.blockedReason = `Brak sprawnego sprzętu: ${[...eq.missing, ...eq.broken].join(', ')}`; return; }
  const perf = performanceBps(s.life.fatigue);
  const speed = speedBps(s, job.serviceId);
  const raw = roundDiv(job.hoursPerDay * 100 * perf * speed, 100_000_000);
  let p = Math.min(Math.max(1, raw), total - job.progressCenti);
  if (job.progressCenti < job.normCenti) p = Math.min(p, maxProgressByStock(s, job) - job.progressCenti);
  if (p <= 0) {
    job.blockedDays += 1;
    job.stage = 'materials';
    const short = Object.entries(job.need).filter(([k, need]) => need - (job.consumed[k]?.qty ?? 0) - stockQty(s, k) > 0).map(([k]) => MATERIAL_BY_ID.get(splitKey(k).materialId)!.label);
    job.blockedReason = `Brak materiałów: ${short.join(', ') || 'zapas'}`;
    return;
  }
  job.stage = 'execution';
  job.blockedReason = null;
  job.progressCenti += p;
  job.workedDays += 1;
  job.perfSumBps += perf;
  job.perfDays += 1;
  order.progressCentiHours = job.progressCenti;
  consumeMaterials(s, job, date);
  wearEquipment(s, job.serviceId, job.hoursPerDay);
  const gained = roundDiv(job.hoursPerDay * 100 * perf, 10_000); // doświadczenie = faktycznie przepracowany czas, nie kliknięcia
  reno(s).skillXp[job.serviceId] = (reno(s).skillXp[job.serviceId] ?? 0) + gained;
  maybeIssue(s, job, date);
  if (job.progressCenti >= job.normCenti + job.extraCenti) {
    job.stage = 'handover';
    job.finishedOn = date;
    job.lateDays = Math.max(0, diffDays(date, job.deadline));
    if (commitment) commitment.endDate = date;
    logEvent(s, { id: `reno.work:${job.id}:finished:${job.reworkDone ? 2 : 1}`, date, type: 'reno.work', tone: 'neutral', title: `Prace zakończone: ${order.title}`, detail: 'Odbiór przez klienta następnego dnia.', amount: null, category: null });
  }
}

/** Wynik jakości 0–100: umiejętności, standard materiałów, sprzęt, różnica trudności, zmęczenie i niewielka losowość. */
export function jobQuality(s: GameState, job: RenoJob): number {
  const level = clamp(skillLevel(s, job.serviceId), 1, 5);
  let q: number = SKILL_QUALITY[level]!;
  q += STANDARDS[job.standard].quality;
  q += equipmentQuality(s, job.serviceId);
  q += Math.min(6, Math.max(0, level - job.difficulty) * 2);
  const avgPerf = job.perfDays > 0 ? roundDiv(job.perfSumBps, job.perfDays) : 10_000;
  q -= Math.round((10_000 - avgPerf) / 200);
  if (job.reworkDone) q += 8;
  q += createRng(s.seed, `reno:quality:${job.id}:${job.reworkDone ? 2 : 1}`).int(-4, 4);
  return clamp(q, 10, 100);
}

function ratingParts(job: RenoJob, quote: RenoQuote | undefined, gross: Grosze): RenoJobRating {
  const q = job.quality ?? 50;
  const quality = clamp(Math.round(10 + q * 0.4), 10, 50);
  const punctuality = job.lateDays === 0 ? 50 : Math.max(10, 50 - 4 * job.lateDays);
  const overrun = job.extraCenti * 100 > job.normCenti * 30;
  let conformity = 50 - (job.reworkDone ? 12 : 0) - (overrun ? 8 : 0);
  if (STANDARDS[job.standard].level < job.qualityReq) conformity -= 8;
  conformity = clamp(conformity, 10, 50);
  const ratio = roundDiv(gross * 10_000, job.budgetGross);
  const price = ratio <= 9_000 ? 50 : ratio <= 10_000 ? 45 : ratio <= 11_000 ? 35 : 22;
  const rd = quote?.replyDays ?? 2;
  const communication = Math.max(10, (rd <= 1 ? 50 : rd === 2 ? 45 : rd === 3 ? 40 : 30) - (quote?.held ? 5 : 0));
  const rating10 = clamp(Math.round(quality * 0.4 + punctuality * 0.2 + conformity * 0.15 + price * 0.15 + communication * 0.1), 10, 50);
  return { parts: { quality, punctuality, conformity, price, communication }, rating10 };
}
interface RenoJobRating { parts: { quality: number; punctuality: number; conformity: number; price: number; communication: number }; rating10: number }

const COMMENTS: Record<string, string[]> = {
  quality: ['Efekt mógłby być dokładniejszy.', 'Wykonanie poniżej oczekiwań.'],
  punctuality: ['Prace skończone z opóźnieniem.', 'Termin nie został dotrzymany.'],
  conformity: ['Nie wszystko zgodne z ustaleniami.', 'Konieczne były poprawki.'],
  price: ['Cena wyższa, niż zakładałem.', 'Drogo jak na ten zakres.'],
  communication: ['Kontakt mógł być szybszy.', 'Długo czekałem na wycenę.'],
  good: ['Polecam — solidna robota.', 'Wszystko zgodnie z umową, jestem zadowolony.', 'Czysto, terminowo, sprawnie.'],
};

function handover(s: GameState, b: Business, job: RenoJob, date: IsoDate): void {
  const order = s.serviceOrders.find((o) => o.id === job.orderId)!;
  const quote = reno(s).quotes.find((x) => x.id === job.quoteId);
  const quality = jobQuality(s, job);
  job.quality = quality;
  const threshold = QUALITY_THRESHOLD[job.qualityReq]!;
  if (!job.reworkDone && quality < threshold - 3) {
    job.reworkDone = true;
    job.extraCenti += roundDiv(job.normCenti * 1_200, 10_000);
    job.stage = 'execution';
    job.finishedOn = null;
    logEvent(s, { id: `reno.work:${job.id}:rework`, date, type: 'reno.work', tone: 'warning', title: `Uwagi przy odbiorze: ${order.title}`, detail: `Jakość ${quality}/100 poniżej oczekiwań klienta (${QUALITY_REQ_LABEL[job.qualityReq]}, min. ${threshold}). Poprawki wydłużają pracę.`, amount: null, category: null });
    return;
  }
  // rozliczenie: koszty dojazdów i drobne (dokumenty kosztowe), przychód = cena − zaliczka − kara umowna
  supplier(s);
  const def = SERVICE_BY_ID.get(job.serviceId)!;
  const transport = job.workedDays * roundDiv(def.transportPerDay * (10_000 - transportSaveBps(s)), 10_000);
  const other = mulBps(job.actual.materials, OTHER_COSTS_BPS);
  if (transport > 0) { issueDocument(s, b, { kind: 'cost', issueDate: date, counterpartyId: SUPPLIER_PARTY, orderId: order.id, description: `Dojazdy i transport: ${order.title}`, net: transport, termDays: 7 }); job.actual.transport = transport; }
  if (other > 0) { issueDocument(s, b, { kind: 'cost', issueDate: date, counterpartyId: SUPPLIER_PARTY, orderId: order.id, description: `Pozostałe koszty (odpady, drobiazgi): ${order.title}`, net: other, termDays: 7 }); job.actual.other = other; }
  const weeksLate = Math.ceil(job.lateDays / 7);
  const penaltyBps = Math.min(DELAY_PENALTY_CAP_BPS, DELAY_PENALTY_BPS_PER_WEEK * weeksLate);
  job.penaltyNet = mulBps(job.priceNet, penaltyBps);
  const finalNet = Math.max(1, job.priceNet - job.advanceNet - job.penaltyNet);
  const doc = issueDocument(s, b, { kind: 'sales', issueDate: date, counterpartyId: job.clientId, orderId: order.id, description: `${order.title}${job.advanceNet > 0 ? ' — rozliczenie końcowe po zaliczce' : ''}`, net: finalNet, termDays: job.paymentTermDays, part: job.advanceNet > 0 ? 'final' : 'full' });
  job.finalDocId = doc.id;
  job.handoverOn = date;
  job.settledOn = date;
  job.stage = 'done';
  order.status = 'completed';
  order.completedOn = date;
  order.salesDocumentId = doc.id;
  order.late = job.lateDays > 0;
  const gross = grossOfNet(job.priceNet - job.penaltyNet, job.vatRateBps);
  const r = ratingParts(job, quote, gross);
  const n = nextCounter(s, 'reno:review');
  const lowest = (Object.entries(r.parts).sort((a, b2) => a[1] - b2[1])[0] ?? ['quality', 50]) as [string, number];
  const pool = r.rating10 >= 42 || lowest[1] >= 40 ? COMMENTS.good! : COMMENTS[lowest[0]]!;
  reno(s).reviews.push({ id: `review:${n}`, jobId: job.id, date, rating10: r.rating10, parts: r.parts, comment: pool[createRng(s.seed, `reno:comment:${job.id}`).int(0, pool.length - 1)]! });
  logEvent(s, { id: `reno.review:${job.id}`, date, type: 'reno.review', tone: r.rating10 >= 40 ? 'positive' : r.rating10 >= 30 ? 'neutral' : 'negative', title: `Odbiór i rozliczenie: ${order.title}`, detail: `Ocena ${(r.rating10 / 10).toFixed(1).replace('.', ',')}★ · jakość ${quality}/100 · wystawiono ${doc.number}${job.penaltyNet > 0 ? ` · kara za zwłokę ${formatPLN(job.penaltyNet)}` : ''}`, amount: null, category: null });
  scheduleComplaint(s, job, date, quality);
}

/** Prawdopodobieństwo reklamacji (pkt bazowe): rośnie wraz z niską jakością, problemami, poprawkami, opóźnieniem i niedopasowaniem standardu materiałów. */
export function complaintBps(job: RenoJob, quality: number): number {
  const bps = (80 - quality) * 220 + job.issues.length * 250 + (job.reworkDone ? 800 : 0) + (job.lateDays > 0 ? 400 : 0) + (STANDARDS[job.standard].level < job.qualityReq ? 600 : 0);
  return clamp(bps, 100, 7_500);
}

function scheduleComplaint(s: GameState, job: RenoJob, date: IsoDate, quality: number): void {
  const bps = complaintBps(job, quality);
  const rng = createRng(s.seed, `reno:complaint:${job.id}`);
  if (rng.int(0, 9_999) >= bps) return;
  const severity = quality < 45 ? 3 : quality < 60 ? 2 : 1;
  const raisedOn = addDays(date, rng.int(5, 20));
  const def = SERVICE_BY_ID.get(job.serviceId)!;
  const descriptions = [`Poprawki wymagane: ${def.risks[0]}`, 'Widoczne niedociągnięcia wykończenia', 'Klient zgłasza usterki po użytkowaniu'];
  const n = nextCounter(s, 'reno:complaint');
  reno(s).complaints.push({ id: `complaint:${n}`, jobId: job.id, raisedOn, deadline: addDays(raisedOn, COMPLAINT_WINDOW_DAYS), severity, description: descriptions[severity - 1]!, status: 'pending', commitmentId: null, costDocId: null, resolvedOn: null, ratingDelta10: 0 });
}

/* ---------- Reklamacje ---------- */

function adjustReview(s: GameState, jobId: string, delta10: number): void {
  const r = reno(s).reviews.find((x) => x.jobId === jobId);
  if (r) r.rating10 = clamp(r.rating10 + delta10, 10, 50);
}

export function resolveComplaint(s: GameState, complaintId: string, action: 'repair' | 'discount' | 'reject'): string {
  const b = requireBusiness(s);
  const c = reno(s).complaints.find((x) => x.id === complaintId);
  if (!c || c.status !== 'open') throw new CommandError('Ta reklamacja nie czeka na Twoją decyzję.');
  const job = reno(s).jobs.find((j) => j.id === c.jobId)!;
  const today = s.clock.today;
  if (action === 'repair') {
    const hours = c.severity * 4;
    const days = Math.ceil(hours / 2);
    const start = tomorrow(s);
    const end = addDays(start, days - 1);
    const clash = firstOverload(s, start, end, { extraHoursPerDay: 2 });
    if (clash) throw new CommandError(`Brak wolnych godzin na poprawki: ${formatDatePL(clash.date)} brakuje ${clash.missing} godz.`);
    const material = Math.max(zl(60), roundDiv(job.priceNet * c.severity * 200, 10_000));
    requireCash(s, b, material);
    const { docId } = purchaseCost(s, b, material, `Materiały do poprawek: ${job.clientName}`, job.orderId);
    job.actual.rework += material;
    const commitmentId = `commit:${c.id}`;
    s.commitments.push({ id: commitmentId, label: `Poprawki po reklamacji: ${job.clientName}`, startDate: start, endDate: end, hoursPerDay: 2, sourceEventId: null });
    c.status = 'repairing'; c.commitmentId = commitmentId; c.costDocId = docId;
    return `Poprawki zaplanowane (${hours} godz. w ${days} dn.). Materiały: ${formatPLN(material)}.`;
  }
  if (action === 'discount') {
    const refund = Math.max(zl(100), roundDiv(job.priceNet * c.severity * 400, 10_000));
    requireCash(s, b, refund);
    // zwrot części ceny to w rzeczywistości korekta faktury — tu ujęty jako koszt (SIMPLIFIED, FE-RENO-COMPLAINTS)
    const { docId } = purchaseCost(s, b, refund, `Rabat z tytułu reklamacji: ${job.clientName}`, job.orderId);
    job.actual.rework += refund;
    c.status = 'refunded'; c.costDocId = docId; c.resolvedOn = today; c.ratingDelta10 = -2;
    adjustReview(s, job.id, -2);
    return `Klientowi przyznano rabat ${formatPLN(refund)}. Opinia nieznacznie spadła.`;
  }
  const escalate = createRng(s.seed, `reno:reject:${c.id}`).int(0, 99) < 60;
  c.resolvedOn = today;
  if (escalate) {
    c.status = 'escalated'; c.ratingDelta10 = -10; adjustReview(s, job.id, -10);
    logEvent(s, { id: `reno.complaint:${c.id}:escalated`, date: today, type: 'reno.complaint', tone: 'negative', title: `Reklamacja odrzucona — klient zostawił negatywną opinię: ${job.clientName}`, detail: 'Spory prawne i rękojmia nie są modelowane (FE-RENO-COMPLAINTS).', amount: null, category: null });
    return 'Klient nie zgodził się i zostawił negatywną opinię (−1,0★).';
  }
  c.status = 'resolved'; c.ratingDelta10 = -3; adjustReview(s, job.id, -3);
  return 'Klient przyjął odmowę, ale opinia nieznacznie spadła.';
}

function processComplaints(s: GameState, date: IsoDate): void {
  for (const c of reno(s).complaints) {
    const job = reno(s).jobs.find((j) => j.id === c.jobId)!;
    if (c.status === 'pending' && date >= c.raisedOn) {
      c.status = 'open';
      logEvent(s, { id: `reno.complaint:${c.id}:open`, date, type: 'reno.complaint', tone: 'warning', title: `Reklamacja: ${job.clientName}`, detail: `${c.description}. Odpowiedz do ${formatDatePL(c.deadline)}: napraw, daj rabat albo odrzuć.`, amount: null, category: null });
    } else if (c.status === 'open' && date > c.deadline) {
      c.status = 'escalated'; c.resolvedOn = date; c.ratingDelta10 = -12; adjustReview(s, job.id, -12);
      logEvent(s, { id: `reno.complaint:${c.id}:ignored`, date, type: 'reno.complaint', tone: 'negative', title: `Nieobsłużona reklamacja — klient odszedł: ${job.clientName}`, detail: 'Brak odpowiedzi w terminie obniżył ocenę (−1,2★).', amount: null, category: null });
    } else if (c.status === 'repairing') {
      const com = s.commitments.find((x) => x.id === c.commitmentId);
      if (com && date >= com.endDate) {
        c.status = 'resolved'; c.resolvedOn = date; c.ratingDelta10 = 3; adjustReview(s, job.id, 3);
        logEvent(s, { id: `reno.complaint:${c.id}:resolved`, date, type: 'reno.complaint', tone: 'positive', title: `Poprawki zakończone: ${job.clientName}`, detail: 'Klient jest zadowolony (+0,3★).', amount: null, category: null });
      }
    }
  }
}

/* ---------- Przetwarzanie dnia i rejestracja modułu ---------- */

function chargeAdvertising(s: GameState, b: Business, date: IsoDate): void {
  const ad = reno(s).advertising;
  const month = monthKey(date);
  if (ad.level === 'none' || ad.paidMonth === month || parseIso(date).day !== 1) return;
  const def = ADVERTISING.find((a) => a.id === ad.level)!;
  purchaseCost(s, b, def.monthlyNet, `Reklama: ${def.label} — ${month}`, null, date);
  ad.paidMonth = month;
}

export function processRenovation(s: GameState, b: Business, date: IsoDate): void {
  const key = `reno:day:${b.id}:${date}`;
  if (s.processed[key]) return;
  s.processed[key] = true;
  chargeAdvertising(s, b, date);
  for (const job of reno(s).jobs) {
    if (job.businessId !== b.id) continue;
    if (job.stage === 'done' || job.stage === 'cancelled') continue;
    if (job.stage === 'handover') { if (job.finishedOn && date > job.finishedOn) handover(s, b, job, date); continue; }
    workJob(s, b, job, date);
  }
  processQuotes(s, date);
  processComplaints(s, date);
  maybeGenerateEnquiry(s, b, date);
}

export function renovationGaps(s: GameState, b: Business, date: IsoDate): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (const job of reno(s).jobs) {
    if (job.businessId !== b.id || job.stage === 'done' || job.stage === 'cancelled') continue;
    if (date >= addDays(job.startDate, -3) && date <= job.deadline) {
      const short = Object.entries(job.need).filter(([k, need]) => need - (job.consumed[k]?.qty ?? 0) - stockQty(s, k) > 0);
      if (short.length) out.push({ key: `materials:${job.id}`, text: `Brak materiałów do kontraktu „${job.clientName}” (start ${formatDatePL(job.startDate)}): ${short.map(([k, n]) => `${MATERIAL_BY_ID.get(splitKey(k).materialId)!.label} (brakuje ${n - (job.consumed[k]?.qty ?? 0) - stockQty(s, k)})`).join(', ')}.` });
    }
  }
  for (const c of reno(s).complaints) if (c.status === 'open') out.push({ key: `complaint:${c.id}`, text: `Reklamacja czeka na decyzję do ${formatDatePL(c.deadline)}.` });
  return out;
}

export function initRenovation(s: GameState, specialization: string | undefined): void {
  const st = reno(s);
  if (specialization && SERVICE_BY_ID.has(specialization) && !st.specializations.includes(specialization)) {
    st.specializations.push(specialization);
    st.skillXp[specialization] = Math.max(st.skillXp[specialization] ?? 0, SKILL_START_CENTI);
  }
}

/* ---------- Podsumowania dla UI ---------- */

export interface JobFinancials {
  revenueNet: Grosze;
  plannedCost: Grosze;
  plannedMarginBps: number;
  actualMaterials: Grosze;
  actualOther: Grosze;
  actualLaborValue: Grosze;
  actualCost: Grosze;
  /** Wynik ekonomiczny (bez własnej robocizny): przychód − materiały zużyte − transport − inne − poprawki. */
  economicResult: Grosze;
  actualMarginBps: number | null;
  workedHours: number;
  hourlyPay: Grosze | null;
  settled: boolean;
}

export function jobFinancials(job: RenoJob): JobFinancials {
  const settled = job.stage === 'done';
  const revenue = job.priceNet - (settled ? job.penaltyNet : 0);
  const nonLabor = job.actual.materials + job.actual.transport + job.actual.other + job.actual.rework;
  const workedCenti = job.workedDays * job.hoursPerDay * 100;
  const laborValue = roundDiv(workedCenti * job.laborRate, 100);
  const actualCost = nonLabor + laborValue;
  return {
    revenueNet: revenue, plannedCost: job.planned.total, plannedMarginBps: roundDiv((job.priceNet - job.planned.total) * 10_000, job.priceNet),
    actualMaterials: job.actual.materials, actualOther: job.actual.transport + job.actual.other + job.actual.rework, actualLaborValue: laborValue, actualCost,
    economicResult: revenue - nonLabor, actualMarginBps: settled ? roundDiv((revenue - actualCost) * 10_000, revenue) : null,
    workedHours: workedCenti / 100, hourlyPay: workedCenti > 0 ? roundDiv((revenue - nonLabor) * 100, workedCenti) : null, settled,
  };
}

export interface RenoDashboard {
  openEnquiries: number;
  quotesPending: number;
  quotesAwaitingYou: number;
  activeJobs: number;
  complaintsOpen: number;
  reputation: Reputation;
  stockValue: Grosze;
  equipmentValue: Grosze;
  scheduleLoadPct: number;
  jobsAtRisk: number;
  plannedCostActive: Grosze;
  actualCostActive: Grosze;
  contractedNet: Grosze;
  doneJobs: number;
  economicResultDone: Grosze;
  revenueDone: Grosze;
}

export function renoDashboard(s: GameState): RenoDashboard {
  const st = reno(s);
  const active = st.jobs.filter((j) => j.stage !== 'done' && j.stage !== 'cancelled');
  const done = st.jobs.filter((j) => j.stage === 'done');
  let hours = 0;
  let days = 0;
  for (let i = 1; i <= 14; i++) {
    const d = addDays(s.clock.today, i);
    const bd = budgetFor(s, d);
    hours += bd.commitments;
    days += 1;
    void bd;
  }
  const load = days > 0 ? roundDiv(hours * 100, days * 8) : 0;
  return {
    openEnquiries: st.enquiries.filter((e) => e.status === 'open').length,
    quotesPending: st.quotes.filter((q) => q.status === 'sent').length,
    quotesAwaitingYou: st.quotes.filter((q) => q.status === 'counter' || q.status === 'accepted').length,
    activeJobs: active.length,
    complaintsOpen: st.complaints.filter((c) => c.status === 'open').length,
    reputation: reputation(s),
    stockValue: inventoryValue(s),
    equipmentValue: equipmentValue(s),
    scheduleLoadPct: Math.min(100, load),
    jobsAtRisk: active.filter((j) => jobForecast(s, j).risk === 'wysokie').length,
    plannedCostActive: active.reduce((a, j) => a + j.planned.total, 0),
    actualCostActive: active.reduce((a, j) => a + jobFinancials(j).actualCost, 0),
    contractedNet: active.reduce((a, j) => a + j.priceNet, 0),
    doneJobs: done.length,
    economicResultDone: done.reduce((a, j) => a + jobFinancials(j).economicResult, 0),
    revenueDone: done.reduce((a, j) => a + jobFinancials(j).revenueNet, 0),
  };
}

export type { Std };
