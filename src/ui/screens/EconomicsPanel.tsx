import type { ReactNode } from 'react';
import { formatDatePL } from '../../engine/date.ts';
import type { JobFinancials, QuoteEconomics } from '../../engine/renovation.ts';
import { Money, cx, moneyTone } from '../components/ui.tsx';

export function Row({ k, v, tone, hint }: { k: ReactNode; v: ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="py-1.5 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-slate-400">{k}</dt>
        <dd className={cx('tabular text-right', tone ?? 'text-slate-100')}>{v}</dd>
      </div>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const Head = ({ children }: { children: ReactNode }) => <div className="pt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</div>;
const hours = (centi: number) => `${(centi / 100).toFixed(1).replace('.', ',')} godz.`;

/** Zarobek przedsiębiorcy z jednego zlecenia: przychód → koszty rzeczywiste → nadwyżka → (kalkulacyjna) praca właściciela → zysk ekonomiczny → płynność. */
export function QuoteEconomicsPanel({ e, laborRate, priceGross, vatRateBps }: { e: QuoteEconomics; laborRate: number; priceGross: number; vatRateBps: number }) {
  const x = e.external;
  return (
    <dl className="divide-y divide-ink-700/60 rounded-xl border border-ink-700 px-3" data-testid="quote-economics">
      <Head>Przychód</Head>
      <Row k="Cena kontraktu netto" v={<strong><Money value={e.revenueNet} /></strong>} />
      <Row k={vatRateBps ? `Cena brutto (VAT ${vatRateBps / 100}%)` : 'Cena dla klienta (bez VAT — zwolnienie)'} v={<Money value={priceGross} />} />
      <Head>Koszty rzeczywiste — pieniądze wydane przez firmę</Head>
      <Row k="Materiały (cena z dziś)" v={<Money value={x.materials} />} />
      {x.hiredLabor > 0 && <Row k="Płace pracowników i podwykonawcy" v={<Money value={x.hiredLabor} />} />}
      <Row k="Transport" v={<Money value={x.transport} />} />
      <Row k="Pozostałe (odpady, drobiazgi)" v={<Money value={x.other} />} />
      <Row k="Zużycie sprzętu (szacunek, nie gotówka)" v={<Money value={x.equipmentWear} />} />
      <Row k="Koszty rzeczywiste razem" v={<strong><Money value={x.total} /></strong>} />
      <Head>Co zostaje i ile to jest za Twoją pracę</Head>
      <Row k="Nadwyżka przed obciążeniami właściciela" v={<strong><Money value={e.surplusBeforeOwner} signed /></strong>} tone={moneyTone(e.surplusBeforeOwner)}
        hint="Z tego firma płaci składki ZUS, podatek i księgowość — reszta zostaje Tobie. To nie jest jeszcze wypłata." />
      <Row k={`Szacowany zarobek za własną pracę${e.ownerCenti > 0 ? ` (${hours(e.ownerCenti)})` : ''}`} v={e.ownerHourly === null ? '— (delegujesz)' : <span><Money value={e.ownerHourly} signed /> / godz.</span>} tone={e.ownerHourly === null ? undefined : moneyTone(e.ownerHourly - laborRate)}
        hint={e.ownerHourly === null ? 'Nie poświęcasz godzin — cała nadwyżka jest zwrotem z kapitału i organizacji pracy.' : `Nadwyżka podzielona przez Twoje godziny. Przyjęta stawka kalkulacyjna: ${(laborRate / 100).toFixed(0)} zł/godz.`} />
      <Row k="Kalkulacyjna wartość Twojej pracy" v={<Money value={e.ownerLabor} />}
        hint="Godziny × przyjęta stawka — to wartość porównawcza, nie wypłata i nie koszt podatkowy JDG." />
      <Row k="Zysk ekonomiczny (po wartości Twojej pracy)" v={<strong><Money value={e.economicProfit} signed /></strong>} tone={moneyTone(e.economicProfit)} />
      <Head>Wpływ na płynność firmy</Head>
      <Row k="Wydatki gotówkowe przed zapłatą końcową" v={<Money value={e.liquidity.cashOutBeforePayment} />} hint="Brakujące materiały, płace, transport i drobne." />
      <Row k="Zaliczka od klienta" v={<Money value={e.liquidity.advance} />} />
      <Row k="Maksymalne zapotrzebowanie na gotówkę" v={<Money value={e.liquidity.peakNeed} />} tone={e.liquidity.peakNeed > 0 ? 'text-gold' : undefined} />
      <Row k={`Zapłata końcowa ok. ${formatDatePL(e.liquidity.finalPaymentDate)}`} v={<Money value={e.liquidity.finalPayment} />} hint={`Pieniądze są zamrożone w kontrakcie ok. ${e.liquidity.daysExposed} dni.`} />
    </dl>
  );
}

/** Rozliczenie zrealizowanego/trwającego kontraktu (z faktycznych danych). */
export function JobEconomicsRows({ f, laborRate }: { f: JobFinancials; laborRate: number }) {
  return (
    <>
      <Row k="Przychód netto" v={<Money value={f.revenueNet} />} />
      <Row k="Koszty rzeczywiste" v={<Money value={f.externalCost} />} hint="Materiały, płace i podwykonawcy, transport, pojazd, drobne, poprawki i zużycie sprzętu." />
      <Row k="Nadwyżka przed obciążeniami właściciela" v={<Money value={f.surplusBeforeOwner} signed />} tone={moneyTone(f.surplusBeforeOwner)} />
      <Row k={`Kalkulacyjna wartość Twojej pracy (${f.workedHours.toFixed(1).replace('.', ',')} godz. × ${(laborRate / 100).toFixed(0)} zł)`} v={<Money value={f.actualLaborValue} />} hint="Nie jest wypłatą ani kosztem podatkowym." />
      <Row k="Zysk ekonomiczny" v={<Money value={f.economicProfit} signed />} tone={moneyTone(f.economicProfit)} />
      <Row k="Zarobek za godzinę własnej pracy" v={f.hourlyPay === null ? '—' : <span><Money value={f.hourlyPay} /> / godz.</span>} />
    </>
  );
}
