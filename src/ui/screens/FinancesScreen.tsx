import { useMemo, useState } from 'react';
import { categoryInfo } from '../../engine/categories.ts';
import { addMonthsToKey, formatDateShortPL, formatDatePL, formatMonthPL } from '../../engine/date.ts';
import { monthlySummaries, netWorthBreakdown } from '../../engine/selectors.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { BarChart, Donut } from '../components/charts.tsx';
import { Icon } from '../components/icons.tsx';
import { Badge, Button, Card, Empty, Money, PlaceholderBadge, ScreenHeader, Segmented, StatCard, moneyTone } from '../components/ui.tsx';

type TxFilter = 'all' | 'in' | 'out';
type OblFilter = 'open' | 'settled';
const PAGE = 40;

export function FinancesScreen() {
  const game = useGameStore((s) => s.game)!;
  const nw = netWorthBreakdown(game);
  const summaries = useMemo(() => monthlySummaries(game), [game]);
  const [month, setMonth] = useState<string | null>(null);
  const [txFilter, setTxFilter] = useState<TxFilter>('all');
  const [oblFilter, setOblFilter] = useState<OblFilter>('open');
  const [txLimit, setTxLimit] = useState(PAGE);

  const selectedKey = month && summaries.some((m) => m.month === month) ? month : summaries[summaries.length - 1]!.month;
  const summary = summaries.find((m) => m.month === selectedKey)!;
  const first = summaries[0]!.month;
  const last = summaries[summaries.length - 1]!.month;

  const slices = Object.entries(summary.expensesByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => ({ label: categoryInfo(id).label, value, color: categoryInfo(id).color }));

  const ledger = useMemo(() => {
    const running: Record<string, number> = {};
    const rows = game.ledger.filter((tx) => game.accounts[tx.accountId]?.ownerId === game.person.id).map((tx) => {
      running[tx.accountId] = (running[tx.accountId] ?? 0) + tx.amount;
      return { tx, balance: running[tx.accountId]! };
    });
    return rows.reverse();
  }, [game.ledger]);
  const filteredTx = ledger.filter(({ tx }) => (txFilter === 'all' ? true : txFilter === 'in' ? tx.amount > 0 : tx.amount < 0));

  const obligations = useMemo(() => {
    const list = game.obligations.filter((o) => o.status === oblFilter && o.scope !== 'company');
    return oblFilter === 'open'
      ? [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      : [...list].sort((a, b) => (b.settledDate ?? '').localeCompare(a.settledDate ?? '')).slice(0, 30);
  }, [game.obligations, oblFilter]);

  const chartMonths = summaries.filter((m) => m.complete).slice(-12);

  return (
    <div className="space-y-5">
      <ScreenHeader title="Finanse" subtitle="Rachunek, zobowiązania, rejestr transakcji i podsumowania miesięczne." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Rachunki" icon="wallet" accent="gain" value={<Money value={nw.cash + nw.savings} />} hint={<span>bieżący <Money value={nw.cash} round /> · oszczędności <Money value={nw.savings} round /></span>} />
        <StatCard label="Należności" icon="briefcase" accent="gold" value={<Money value={nw.receivables} />} hint="+ do otrzymania" />
        <StatCard label="Zobowiązania" icon="home" accent="loss" value={<Money value={nw.payables} />} hint="− do zapłaty" />
        <StatCard label="Majątek netto" icon="trend" accent="sky" value={<Money value={nw.netWorth} />} hint={nw.shares > 0 ? <span>w tym udziały w spółkach (szacunek) <Money value={nw.shares} round /></span> : nw.deposits > 0 ? 'rachunki + kaucje + należności − zobowiązania' : 'rachunki + należności − zobowiązania'} />
      </div>

      <Card
        title={`Podsumowanie miesiąca — ${formatMonthPL(summary.month)}`}
        action={
          <div className="flex items-center gap-2">
            {!summary.complete && <Badge tone="gold">miesiąc w toku</Badge>}
            <Button variant="ghost" aria-label="Poprzedni miesiąc" disabled={selectedKey <= first} onClick={() => setMonth(addMonthsToKey(selectedKey, -1))}><Icon name="chevronLeft" className="size-4" /></Button>
            <Button variant="ghost" aria-label="Następny miesiąc" disabled={selectedKey >= last} onClick={() => setMonth(addMonthsToKey(selectedKey, 1))}><Icon name="chevronRight" className="size-4" /></Button>
          </div>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <table className="w-full text-sm" data-testid="month-summary">
            <tbody className="divide-y divide-ink-700/70">
              <tr><th scope="row" className="py-2 text-left font-normal text-slate-400">Przychody (naliczone)</th><td className="py-2 text-right text-gain"><Money value={summary.income} /></td></tr>
              <tr><th scope="row" className="py-2 text-left font-normal text-slate-400">Koszty (naliczone)</th><td className="py-2 text-right text-loss"><Money value={summary.expenses} /></td></tr>
              <tr><th scope="row" className="py-2 text-left font-semibold text-slate-200">Wynik miesiąca</th><td className={`py-2 text-right font-semibold ${moneyTone(summary.result)}`}><Money value={summary.result} signed /></td></tr>
              <tr><th scope="row" className="py-2 text-left font-normal text-slate-400">Wpływy gotówki</th><td className="py-2 text-right"><Money value={summary.cashIn} /></td></tr>
              <tr><th scope="row" className="py-2 text-left font-normal text-slate-400">Wypływy gotówki</th><td className="py-2 text-right"><Money value={summary.cashOut} /></td></tr>
              <tr><th scope="row" className="py-2 text-left font-normal text-slate-400">Gotówka na koniec {summary.complete ? 'miesiąca' : 'dzisiejszego dnia'}</th><td className="py-2 text-right">{summary.closingCash !== null && <Money value={summary.closingCash} />}</td></tr>
              <tr><th scope="row" className="py-2 text-left font-normal text-slate-400">Majątek netto na koniec {summary.complete ? 'miesiąca' : 'dzisiejszego dnia'}</th><td className="py-2 text-right">{summary.closingNetWorth !== null && <Money value={summary.closingNetWorth} />}</td></tr>
            </tbody>
          </table>
          <div>
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">Struktura kosztów</h3>
            {slices.length === 0 ? <Empty>Brak kosztów w tym miesiącu.</Empty> : <Donut slices={slices} centerLabel="koszty" ariaLabel={`Struktura kosztów — ${formatMonthPL(summary.month)}`} />}
          </div>
        </div>
      </Card>

      <Card title="Przychody i koszty — zakończone miesiące">
        {chartMonths.length === 0 ? <Empty>Wykres pojawi się po zakończeniu pierwszego miesiąca gry.</Empty> : (
          <BarChart groups={chartMonths.map((m) => ({ label: m.month.slice(5) + '/' + m.month.slice(2, 4), a: m.income, b: m.expenses }))} aLabel="Przychody" bLabel="Koszty" ariaLabel="Przychody i koszty miesięczne" />
        )}
      </Card>

      <Card
        title="Zobowiązania i należności"
        action={<Segmented label="Status" value={oblFilter} onChange={setOblFilter} options={[{ value: 'open', label: 'Otwarte' }, { value: 'settled', label: 'Rozliczone (30 ost.)' }]} />}
      >
        {obligations.length === 0 ? <Empty>Brak pozycji.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="obligations">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase">
                <tr><th className="pb-2 font-medium">Opis</th><th className="pb-2 font-medium">Kontrahent</th><th className="pb-2 font-medium">Termin</th><th className="pb-2 font-medium">Status</th><th className="pb-2 text-right font-medium">Kwota</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-700/60">
                {obligations.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2 pr-3 text-slate-100">{o.description}</td>
                    <td className="py-2 pr-3 text-slate-400">{game.parties[o.counterpartyId]?.name}</td>
                    <td className="py-2 pr-3 text-slate-400">{formatDateShortPL(o.dueDate)}</td>
                    <td className="py-2 pr-3">
                      {o.status === 'settled' ? <Badge tone="gain">rozliczone {o.settledDate ? formatDateShortPL(o.settledDate) : ''}</Badge> : o.overdueSince ? <Badge tone="loss">po terminie</Badge> : <Badge tone="sky">{o.direction === 'receivable' ? 'oczekiwana wpłata' : 'do zapłaty'}</Badge>}
                    </td>
                    <td className={`py-2 text-right ${o.direction === 'receivable' ? 'text-gain' : 'text-loss'}`}><Money value={o.direction === 'receivable' ? o.amount : -o.amount} signed /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Historia transakcji"
        action={<Segmented label="Filtr transakcji" value={txFilter} onChange={(v) => { setTxFilter(v); setTxLimit(PAGE); }} options={[{ value: 'all', label: 'Wszystkie' }, { value: 'in', label: 'Wpływy' }, { value: 'out', label: 'Wydatki' }]} />}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="ledger">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase">
              <tr><th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Opis</th><th className="pb-2 font-medium">Kategoria</th><th className="pb-2 font-medium">Rachunek</th><th className="pb-2 text-right font-medium">Kwota</th><th className="pb-2 text-right font-medium">Saldo rachunku po</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {filteredTx.slice(0, txLimit).map(({ tx, balance }) => (
                <tr key={tx.id}>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{formatDatePL(tx.date)}</td>
                  <td className="py-2 pr-3 text-slate-100">{tx.description}</td>
                  <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5 text-slate-300"><i className="size-2 rounded-full" style={{ background: categoryInfo(tx.category).color }} />{categoryInfo(tx.category).label}</span></td>
                  <td className="py-2 pr-3 text-slate-400">{game.accounts[tx.accountId]?.type === 'savings' ? 'oszczędnościowy' : 'bieżący'}</td>
                  <td className={`py-2 pr-3 text-right font-medium ${moneyTone(tx.amount)}`}><Money value={tx.amount} signed /></td>
                  <td className="py-2 text-right text-slate-400"><Money value={balance} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredTx.length > txLimit && <div className="mt-3 text-center"><Button variant="secondary" onClick={() => setTxLimit((n) => n + PAGE)}>Pokaż więcej ({filteredTx.length - txLimit})</Button></div>}
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><PlaceholderBadge /> Wszystkie kwoty w grze są przykładowe; brak jeszcze podatków i składek.</div>
      </Card>
    </div>
  );
}
