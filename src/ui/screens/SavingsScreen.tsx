import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { PLACEHOLDER_NOTICE } from '../../engine/config.ts';
import { categoryInfo } from '../../engine/categories.ts';
import { formatDatePL } from '../../engine/date.ts';
import { roundDiv } from '../../engine/money.ts';
import { cash, savingsAccount } from '../../engine/selectors.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, PlaceholderBadge, ScreenHeader, Segmented, StatCard, moneyTone } from '../components/ui.tsx';
import { formatPLN } from '../../engine/money.ts';
import { parseZloty } from '../format.ts';

type Direction = 'toSavings' | 'toMain';

export function SavingsScreen() {
  const game = useGameStore((s) => s.game)!;
  const transfer = useGameStore((s) => s.transferFunds);
  const [direction, setDirection] = useState<Direction>('toSavings');
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const main = game.accounts[game.playerAccountId]!;
  const sv = savingsAccount(game)!;
  const interest = sv.interest!;
  const from = direction === 'toSavings' ? main : sv;
  const to = direction === 'toSavings' ? sv : main;
  const accrued = roundDiv(interest.accumulator * interest.rateBps, 10_000 * 365);
  const available = cash(game);

  const rows = useMemo(() => {
    let running = 0;
    const list = game.ledger.filter((t) => t.accountId === sv.id).map((tx) => {
      running += tx.amount;
      return { tx, balance: running };
    });
    return list.reverse();
  }, [game.ledger, sv.id]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = parseZloty(amountText);
    if (amount === null || amount <= 0) {
      setError('Podaj kwotę w złotych, np. 500 lub 1 250,50.');
      return;
    }
    setError(null);
    if (transfer(from.id, to.id, amount)) setAmountText('');
  };

  return (
    <div className="space-y-5">
      <ScreenHeader title="Oszczędności" subtitle="Rachunek oszczędnościowy z miesięczną kapitalizacją odsetek. Przelewy między własnymi rachunkami nie zmieniają majątku netto." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="sv-main" label="Rachunek bieżący" icon="wallet" accent="gain" value={<Money value={main.balance} />} hint="płatności i wynagrodzenie" />
        <StatCard testId="sv-savings" label="Oszczędności" icon="trend" accent="sky" value={<Money value={sv.balance} />} hint={sv.name} />
        <StatCard label="Oprocentowanie nominalne" icon="briefcase" accent="gold" value={`${(interest.rateBps / 100).toFixed(2).replace('.', ',')}% rocznie`} hint={<span className="flex items-center gap-1.5">kapitalizacja miesięczna {interest.dataStatus === 'placeholder' && <PlaceholderBadge />}</span>} />
        <StatCard label="Narosłe w tym miesiącu" icon="calendar" accent="violet" value={<Money value={accrued} />} hint="szacunek przed podatkiem, wypłata ostatniego dnia miesiąca" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Przelew między rachunkami">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Segmented<Direction> label="Kierunek przelewu" value={direction} onChange={(d) => { setDirection(d); setError(null); }} options={[{ value: 'toSavings', label: 'Bieżący → Oszczędności' }, { value: 'toMain', label: 'Oszczędności → Bieżący' }]} />
            <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-3 text-sm text-slate-300">
              Z: <strong>{from.name}</strong> (<Money value={from.balance} />) → Na: <strong>{to.name}</strong>
            </div>
            <div>
              <label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-slate-200">Kwota (zł)</label>
              <div className="flex gap-2">
                <input id="amount" inputMode="decimal" autoComplete="off" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="np. 1000" aria-invalid={!!error} aria-describedby={error ? 'amount-error' : undefined}
                  className="w-full rounded-xl border border-ink-600 bg-ink-900/80 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30" />
                <Button type="button" variant="secondary" onClick={() => setAmountText((from.balance / 100).toFixed(2).replace('.', ','))}>Maks.</Button>
              </div>
              {error && <p id="amount-error" role="alert" className="mt-1 text-xs text-loss">{error}</p>}
              {direction === 'toSavings' && available <= 0 && <p className="mt-1 text-xs text-gold">Brak środków na rachunku bieżącym.</p>}
            </div>
            <Button type="submit" variant="primary" className="w-full" data-testid="transfer-submit">Wykonaj przelew</Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">Oprocentowanie i podatek od odsetek to konfigurowalne parametry przykładowe. Odsetki i podatek księgowane są jako dwie osobne operacje. {PLACEHOLDER_NOTICE}</p>
        </Card>

        <Card title="Zasady odsetek (konfiguracja)">
          <dl className="divide-y divide-ink-700/60 text-sm">
            <div className="flex justify-between py-2"><dt className="text-slate-400">Oprocentowanie nominalne</dt><dd className="tabular text-slate-100">{(interest.rateBps / 100).toFixed(2).replace('.', ',')}% rocznie</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-400">Naliczanie</dt><dd className="text-slate-100">saldo dzienne × stawka / 365</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-400">Kapitalizacja</dt><dd className="text-slate-100">ostatniego dnia miesiąca</dd></div>
            <div className="flex justify-between py-2"><dt className="text-slate-400">Podatek od odsetek (parametr)</dt><dd className="tabular text-slate-100">{(interest.taxBps / 100).toFixed(2).replace('.', ',')}% <Badge tone="gold">przykładowy</Badge></dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">Podatek nie jest potwierdzonym faktem prawnym — to wartość konfiguracyjna do czasu weryfikacji zasad w wersji podatkowej (v0.3).</p>
        </Card>
      </div>

      <Card title="Historia operacji na rachunku oszczędnościowym">
        {rows.length === 0 ? <Empty>Brak operacji. Wykonaj pierwszy przelew na konto oszczędnościowe.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="savings-ledger">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Opis</th><th className="pb-2 font-medium">Kategoria</th><th className="pb-2 text-right font-medium">Kwota</th><th className="pb-2 text-right font-medium">Saldo po</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {rows.map(({ tx, balance }) => (
                  <tr key={tx.id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{formatDatePL(tx.date)}</td>
                    <td className="py-2 pr-3 text-slate-100">{tx.description}</td>
                    <td className="py-2 pr-3 text-slate-300"><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: categoryInfo(tx.category).color }} />{categoryInfo(tx.category).label}</span></td>
                    <td className={`py-2 pr-3 text-right font-medium ${moneyTone(tx.amount)}`}>{tx.amount > 0 ? '+' : ''}{formatPLN(tx.amount)}</td>
                    <td className="py-2 text-right text-slate-400"><Money value={balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
