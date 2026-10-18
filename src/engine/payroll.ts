import { NET_ESTIMATE_BPS } from './config.ts';
import { addMonths, parseIso } from './date.ts';
import type { IsoDate } from './date.ts';
import { RULES_2026 as R } from './legal.ts';
import { mulBps, roundDiv } from './money.ts';
import type { Grosze } from './money.ts';
import { roundZl } from './tax.ts';
import type { EmploymentContract, GameState, Payslip } from './state.ts';

/**
 * Kalkulator wynagrodzenia z umowy o pracę (brutto → netto) wg zasad 2026 (reguły PAY-* w legal.ts).
 * Czyste funkcje; skutki księgowe (zobowiązanie, odcinek płacowy) w `issuePayslip`.
 */
export interface PayrollInput {
  gross: Grosze;
  accrualDate: IsoDate;
  payDate: IsoDate;
  birthDate: IsoDate;
  /** Suma podstaw emerytalnej/rentowej w roku kalendarzowym naliczenia przed tym miesiącem. */
  ytdPensionBase: Grosze;
  /** Suma podstaw zaliczki (zaokrąglonych) w roku wypłaty przed tym miesiącem. */
  ytdPitBase: Grosze;
  /** Wykorzystany w roku wypłaty limit ulgi dla młodych. */
  ytdExempt: Grosze;
  /** Czy pracodawca stosuje kwotę zmniejszającą (PIT-2). */
  pit2: boolean;
}

export type PayrollCalc = Omit<Payslip, 'id' | 'contractId' | 'partyId' | 'month' | 'accrualDate' | 'payDate' | 'legacy'>;

/** Ostatni dzień ulgi dla młodych: dzień 26. urodzin (włącznie). */
export function youthReliefEnds(birthDate: IsoDate): IsoDate {
  return addMonths(birthDate, R.payroll.youthAge * 12);
}

export function computePayroll(i: PayrollInput): PayrollCalc {
  const P = R.payroll;
  const pensionBase = Math.max(0, Math.min(i.gross, P.pensionCap - i.ytdPensionBase));
  const emerytalna = mulBps(pensionBase, P.emerytalnaBps);
  const rentowa = mulBps(pensionBase, P.rentowaBps);
  const chorobowa = mulBps(i.gross, P.chorobowaBps);
  const socialTotal = emerytalna + rentowa + chorobowa;
  const health = mulBps(i.gross - socialTotal, P.healthBps);

  const youth = i.payDate <= youthReliefEnds(i.birthDate);
  const exemptGross = youth ? Math.min(i.gross, Math.max(0, P.youthLimit - i.ytdExempt)) : 0;
  const taxableGross = i.gross - exemptGross;
  const taxableSocial = taxableGross === 0 ? 0 : roundDiv(socialTotal * taxableGross, i.gross);
  const koszty = taxableGross > 0 ? P.costsMonthly : 0;
  const pitBase = roundZl(Math.max(0, taxableGross - taxableSocial - koszty));

  const threshold = R.pit.scaleThreshold;
  const before = i.ytdPitBase;
  const after = before + pitBase;
  let raw: number;
  let reductionApplied = 0;
  if (pitBase === 0) raw = 0;
  else if (after <= threshold) {
    const gross12 = mulBps(pitBase, R.pit.scaleLowBps);
    reductionApplied = i.pit2 ? Math.min(P.reductionMonthly, gross12) : 0;
    raw = gross12 - reductionApplied;
  } else if (before >= threshold) raw = mulBps(pitBase, R.pit.scaleHighBps);
  else {
    const low = threshold - before;
    raw = mulBps(low, R.pit.scaleLowBps) + mulBps(pitBase - low, R.pit.scaleHighBps);
  }
  const pitAdvance = roundZl(Math.max(0, raw));
  const net = i.gross - socialTotal - health - pitAdvance;
  return { gross: i.gross, pensionBase, emerytalna, rentowa, chorobowa, socialTotal, health, exemptGross, taxableSocial, koszty, pitBase, pitAdvance, net, reductionApplied };
}

/** Typowe miesięczne netto (pierwszy miesiąc roku, bez narastania) — do ofert i umów. */
export function typicalMonthlyNet(gross: Grosze, birthDate: IsoDate, onDate: IsoDate): Grosze {
  const { year } = parseIso(onDate);
  const accrual = `${year}-06-30`;
  return computePayroll({ gross, accrualDate: accrual, payDate: `${year}-07-10`, birthDate, ytdPensionBase: 0, ytdPitBase: 0, ytdExempt: 0, pit2: true }).net;
}

/** Skumulowane dane roku z odcinków płacowych (wszystkie umowy). */
export function payrollYtd(s: GameState, accrualYear: number, payYear: number): { pensionBase: Grosze; pitBase: Grosze; exempt: Grosze } {
  let pensionBase = 0;
  let pitBase = 0;
  let exempt = 0;
  for (const p of s.payslips) {
    if (parseIso(p.accrualDate).year === accrualYear) pensionBase += p.pensionBase;
    if (parseIso(p.payDate).year === payYear) {
      pitBase += p.pitBase;
      exempt += p.exemptGross;
    }
  }
  return { pensionBase, pitBase, exempt };
}

export function grossOf(c: EmploymentContract): Grosze {
  return c.grossMonthly ?? roundDiv(c.monthlyAmount * 10_000, NET_ESTIMATE_BPS);
}

/** Buduje odcinek płacowy dla naliczenia wynagrodzenia (nie zmienia stanu). */
export function buildPayslip(s: GameState, c: EmploymentContract, ruleId: string, accrualDate: IsoDate, payDate: IsoDate, gross = grossOf(c)): Payslip {
  const ytd = payrollYtd(s, parseIso(accrualDate).year, parseIso(payDate).year);
  const calc = computePayroll({
    gross, accrualDate, payDate, birthDate: s.person.birthDate,
    ytdPensionBase: ytd.pensionBase, ytdPitBase: ytd.pitBase, ytdExempt: ytd.exempt, pit2: true,
  });
  return {
    id: `payslip:${ruleId}@${accrualDate}`, contractId: c.id, partyId: c.partyId, month: accrualDate.slice(0, 7), accrualDate, payDate, ...calc, legacy: false,
  };
}

/**
 * Wynagrodzenia naliczone przed `payrollFrom` (zapisy v1–v3) pozostają w dotychczasowej kwocie, ale do rozliczenia
 * rocznego potrzebny jest ich odcinek: odtwarzamy go kalkulatorem (podatek/składki), zachowując faktycznie naliczone netto.
 */
export function materializeLegacyPayslips(s: GameState): void {
  if (s.processed['payroll:legacy']) return;
  s.processed['payroll:legacy'] = true;
  const legacy = s.obligations
    .filter((o) => o.category === 'wynagrodzenie' && o.scope === 'personal' && o.issueDate < s.settings.payrollFrom && o.ruleId.startsWith('rule:salary'))
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  for (const o of legacy) {
    const id = `payslip:${o.occurrenceId}`;
    if (s.payslips.some((p) => p.id === id)) continue;
    const rule = s.rules.find((r) => r.id === o.ruleId);
    const contractId = rule && rule.kind === 'obligation' ? rule.contractId : null;
    const c = s.contracts.find((x): x is EmploymentContract => x.type === 'employment' && x.id === contractId);
    if (!c) continue;
    const p = buildPayslip(s, c, o.ruleId, o.issueDate, o.dueDate);
    s.payslips.push({ ...p, id, net: o.amount, legacy: true });
  }
}

