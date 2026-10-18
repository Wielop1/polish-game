import { activeBusiness } from '../../engine/business.ts';
import { officeActive, planOf } from '../../engine/accounting.ts';
import { formatDatePL } from '../../engine/date.ts';
import { formatPLN } from '../../engine/money.ts';
import { ACCOUNTING_PLANS } from '../../engine/renovationCatalog.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, ScreenHeader, cx } from '../components/ui.tsx';
import { LegalBadge } from './BusinessScreens.tsx';

const FORM = { skala: 'Skala', liniowy: 'Liniowy 19%', ryczalt: 'Ryczałt' } as const;

export function BizAccountingScreen() {
  const game = useGameStore((s) => s.game)!;
  const hire = useGameStore((s) => s.hireAccountingOffice);
  const terminate = useGameStore((s) => s.terminateAccountingOffice);
  const biz = activeBusiness(game);
  const acc = game.accounting;
  const plan = planOf(game);
  const notices = [...game.events].filter((e) => e.type === 'accounting.notice').reverse().slice(0, 12);
  const fees = game.documents.filter((d) => d.description.startsWith('Obsługa księgowa')).reverse().slice(0, 6);
  const suggestion = acc.suggestions.at(-1);
  if (!biz) {
    return (
      <div className="space-y-5">
        <ScreenHeader title="Księgowość" />
        <Card><Empty>Księgowość dotyczy prowadzonej działalności. Najpierw zarejestruj JDG.</Empty></Card>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <ScreenHeader title="Księgowość" subtitle="Prowadź ewidencję samodzielnie albo zleć rutynową obsługę biuru rachunkowemu." />
      <div role="note" className="rounded-xl border border-gold/30 bg-gold/5 p-3 text-xs leading-relaxed text-gold/90" data-testid="acc-disclaimer">
        <strong>Zakres i odpowiedzialność.</strong> Podatki, składki i VAT liczy wspólny silnik gry — biuro niczego nie liczy drugi raz, tylko pobiera abonament, pilnuje terminów i zgłasza braki. Biuro nie zdejmuje z Ciebie odpowiedzialności za prawidłowość rozliczeń.
        Porównanie form opodatkowania to wynik obliczeń gry (informacja), <em>nie</em> regulowane doradztwo podatkowe. Błędy biura, zmiana księgowego i usługi doradcy podatkowego są przyszłymi rozszerzeniami. <LegalBadge id="ACC-ADVISORY" /> <LegalBadge id="ACC-RESPONSIBILITY" />
      </div>
      <Card title="Obecny sposób prowadzenia księgowości">
        {acc.office && plan ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="acc-current">
            <div>
              <div className="text-slate-100"><strong>{plan.office}</strong> — {plan.label} <Badge tone={officeActive(game) ? 'gain' : 'sky'}>{officeActive(game) ? 'obsługa trwa' : `od ${formatDatePL(acc.office.since)}`}</Badge></div>
              <div className="text-slate-400">Abonament <Money value={plan.monthlyNet} /> netto miesięcznie{acc.office.endsOn ? ` · umowa wygasa ${formatDatePL(acc.office.endsOn)}` : ''}</div>
            </div>
            {!acc.office.endsOn && <Button variant="danger" onClick={() => { if (window.confirm('Wypowiedzieć umowę? Obsługa potrwa do końca bieżącego miesiąca.')) terminate(); }} data-testid="acc-terminate">Rozwiąż umowę</Button>}
          </div>
        ) : <p className="text-sm text-slate-300" data-testid="acc-current">Prowadzisz księgowość <strong>samodzielnie</strong> — bez powiadomień biura i automatycznych wniosków. Rozliczenia liczy silnik gry tak samo jak z biurem.</p>}
      </Card>
      <Card title="Oferty biur rachunkowych (fikcyjne, parametry symulacyjne)">
        <div className="grid gap-3 lg:grid-cols-3" data-testid="acc-offers">
          {ACCOUNTING_PLANS.map((p) => (
            <div key={p.id} className={cx('flex flex-col rounded-xl border p-4 text-sm', acc.office?.planId === p.id ? 'border-sky bg-sky/10' : 'border-ink-600')}>
              <div className="text-xs text-slate-500">{p.office}</div>
              <div className="text-base font-semibold text-slate-100">{p.label}</div>
              <div className="mt-1 text-slate-100"><Money value={p.monthlyNet} round /> <span className="text-xs text-slate-400">netto / mies.</span></div>
              <p className="mt-2 flex-1 text-xs text-slate-400">{p.description}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
                <li>{p.features.reminders ? '✔' : '✖'} przypomnienia o terminach ZUS/PIT/VAT</li>
                <li>{p.features.gaps ? '✔' : '✖'} powiadomienia o brakach</li>
                <li>{p.features.autoClaim ? '✔' : '✖'} wniosek o zwrot nadpłaty zdrowotnej</li>
                <li>{p.features.formComparison ? '✔' : '✖'} porównanie form opodatkowania (paź.–gru.)</li>
              </ul>
              <Button variant="primary" className="mt-3" disabled={!!acc.office} onClick={() => hire(p.id)} data-testid={`acc-hire-${p.id}`}>Wybierz pakiet</Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Obsługa zaczyna się od 1. dnia miesiąca (dziś, jeśli to 1.). Abonament to zwykły dokument kosztowy firmy (z VAT, jeśli jesteś czynnym podatnikiem).</p>
      </Card>
      {suggestion && (
        <Card title={`Porównanie form opodatkowania (${suggestion.year}) — z obliczeń silnika`}>
          <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm" data-testid="acc-suggestion">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Forma</th><th className="pb-2 text-right font-medium">Podatek (z etatem)</th><th className="pb-2 text-right font-medium">Składka zdrowotna</th><th className="pb-2 text-right font-medium">Razem rocznie</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {suggestion.rows.map((r) => (
                <tr key={r.form} className={r.form === suggestion.best ? 'text-gain' : 'text-slate-300'}>
                  <td className="py-2">{FORM[r.form]}{r.form === suggestion.current ? ' (obecna / zaplanowana)' : ''}{r.form === suggestion.best ? ' ← najniższe obciążenie' : ''}</td>
                  <td className="py-2 text-right"><Money value={r.tax} round /></td><td className="py-2 text-right"><Money value={r.health} round /></td><td className="py-2 text-right"><Money value={r.total} round /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="mt-2 text-xs text-slate-500">{suggestion.basis} Zmianę formy zaplanujesz w „Mojej działalności” do 31 grudnia.</p>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Powiadomienia biura">
          {notices.length === 0 ? <Empty>{acc.office ? 'Brak powiadomień — wszystko w terminie.' : 'Powiadomienia wysyła tylko biuro rachunkowe.'}</Empty> : (
            <ul className="divide-y divide-ink-700/60 text-sm" data-testid="acc-notices">
              {notices.map((e) => <li key={e.id} className="py-2"><div className={e.tone === 'warning' ? 'text-gold' : e.tone === 'positive' ? 'text-gain' : 'text-slate-200'}>{e.title.replace('Biuro rachunkowe: ', '')}</div><div className="text-xs text-slate-500">{formatDatePL(e.date)}{e.detail ? ` · ${e.detail}` : ''}</div></li>)}
            </ul>
          )}
        </Card>
        <Card title="Opłacone abonamenty">
          {fees.length === 0 ? <Empty>Brak opłat za obsługę.</Empty> : (
            <ul className="divide-y divide-ink-700/60 text-sm">
              {fees.map((d) => <li key={d.id} className="flex justify-between gap-2 py-2 text-slate-300"><span>{d.description.replace('Obsługa księgowa — ', '')}</span><span className="tabular">{formatPLN(d.net)} netto</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
