import { useState } from 'react';
import type { ReactNode } from 'react';
import { businessState } from '../../engine/business.ts';
import { formatDatePL } from '../../engine/date.ts';
import { MACRO_PHASE_LABEL } from '../../engine/macro.ts';
import type { MacroPhase } from '../../engine/macro.ts';
import { positioningBlend, segmentShares } from '../../engine/market.ts';
import {
  capacityOverview, channelReport, competitorViews, employmentProfitability, macroHistory, marketOverview, marketPrices, playerFunnel, segmentReport,
} from '../../engine/marketAnalytics.ts';
import { CHANNELS, MARKET_PARAMS_STATUS, POSITIONING, POSITIONINGS, SEGMENTS, SEGMENT_IDS, STRATEGY } from '../../engine/marketConfig.ts';
import { formatPLN, roundDiv, zl } from '../../engine/money.ts';
import { RENOVATION_MARKET } from '../../engine/renovationMarket.ts';
import { SERVICE_BY_ID } from '../../engine/renovationCatalog.ts';
import { seasonalityFor } from '../../engine/market.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { useOpGame } from '../useOperator.ts';
import { currentOperator } from '../../engine/operator.ts';
import { ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, ScreenHeader, StatCard, cx } from '../components/ui.tsx';
import { parseZloty } from '../format.ts';

const pct = (bps: number) => `${Math.round(bps / 100)}%`;
const pct1 = (frac: number) => `${(frac * 100).toFixed(1).replace('.', ',')}%`;
const MONTH_NAMES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const PHASE_TONE: Record<MacroPhase, 'gain' | 'sky' | 'gold' | 'loss'> = { wzrost: 'gain', stabilizacja: 'sky', spowolnienie: 'gold', recesja: 'loss' };
const PHASE_BAR: Record<MacroPhase, string> = { wzrost: 'bg-gain/70', stabilizacja: 'bg-sky/60', spowolnienie: 'bg-gold/70', recesja: 'bg-loss/70' };

function useMarket() {
  const game = useOpGame();
  const biz = currentOperator(game);
  return { game, biz, active: !!biz && businessState(biz, game.clock.today) !== 'closed' };
}

function NoBusinessNote({ title }: { title: string }) {
  return (
    <div className="space-y-5">
      <ScreenHeader title={title} subtitle="Rynek lokalny działa od chwili, gdy prowadzisz firmę remontową." />
      <Card><Empty>Załóż firmę w branży remontowej (Firma → Rejestracja JDG), aby zobaczyć rynek, konkurencję i marketing.</Empty></Card>
    </div>
  );
}

function Calibration() {
  return <p className="text-xs text-slate-500" data-testid="market-calibration">Parametry modelu rynku (popyt, ceny konkurentów, skuteczność kanałów) są <strong>{MARKET_PARAMS_STATUS}</strong> — dobrane do wiarygodnych rzędów wielkości, nie pochodzą z danych GUS ani badań rynku. Informacje o konkurencji to oszacowania.</p>;
}

/* ---------- 1. Rynek lokalny ---------- */

export function MarketLocalScreen() {
  const { game, biz } = useMarket();
  if (!biz) return <NoBusinessNote title="Rynek lokalny" />;
  const ov = marketOverview(game);
  const hist = macroHistory(game, 18);
  const maxAbs = Math.max(60, ...hist.map((h) => Math.abs(h.macro.index)));
  const shares = segmentShares(ov.macro);
  const prices = marketPrices(game);
  const month = Number(game.clock.today.slice(5, 7));
  const seas = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, v: RENOVATION_MARKET.seasonalityBps[i + 1]! }));
  const maxSeas = Math.max(...seas.map((x) => x.v));
  return (
    <div className="space-y-5" data-testid="market-local">
      <ScreenHeader title="Rynek lokalny" subtitle={`${ov.city} (${(ov.population / 1000).toFixed(0)} tys. mieszkańców) · remonty i wykończenia · koniunktura, sezon i struktura klientów`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="market-phase" label="Koniunktura" icon="trend" accent="gold" value={MACRO_PHASE_LABEL[ov.macro.phase]} hint={`indeks ${ov.macro.index > 0 ? '+' : ''}${(ov.macro.index / 100).toFixed(2).replace('.', ',')}`} />
        <StatCard label="Popyt w mieście" icon="list" accent="sky" value={ov.last ? `${ov.last.demand}` : '—'} hint={ov.last ? `projektów w ${monthLabel(ov.last.month)}` : 'brak zamkniętego miesiąca'} />
        <StatCard label="Szukają wykonawcy" icon="user" accent="violet" value={ov.last ? `${ov.last.seekers}` : '—'} hint="reszta robi sama lub odkłada" />
        <StatCard testId="market-share" label="Twój udział (szac.)" icon="dashboard" accent="gain" value={ov.share ? `${pct1(ov.share.low)}–${pct1(ov.share.high)}` : '—'} hint="zleceń rynku, ostatnie 6 mies." />
      </div>
      <Card title="Koniunktura w ostatnich 18 miesiącach">
        <div className="relative flex h-28 items-center gap-1" data-testid="macro-bars" role="img" aria-label="Indeks koniunktury, ostatnie 18 miesięcy">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-ink-600" />
          {hist.map((h) => {
            const px = Math.max(3, Math.round((Math.abs(h.macro.index) / maxAbs) * 50));
            return (
              <div key={h.month} className="flex h-full flex-1 flex-col" title={`${monthLabel(h.month)}: ${MACRO_PHASE_LABEL[h.macro.phase]} (${(h.macro.index / 100).toFixed(2)})`}>
                <div className="flex flex-1 items-end"><div className={cx('w-full rounded-t-sm', h.macro.index >= 0 && PHASE_BAR[h.macro.phase])} style={{ height: h.macro.index >= 0 ? px : 0 }} /></div>
                <div className="flex flex-1 items-start"><div className={cx('w-full rounded-b-sm', h.macro.index < 0 && PHASE_BAR[h.macro.phase])} style={{ height: h.macro.index < 0 ? px : 0 }} /></div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {(['wzrost', 'stabilizacja', 'spowolnienie', 'recesja'] as MacroPhase[]).map((p) => <Badge key={p} tone={PHASE_TONE[p]}>{MACRO_PHASE_LABEL[p]}</Badge>)}
          <span>Bieżąca faza wpływa na: popyt <strong className="text-slate-200">{pct(ov.macro.demandBps)}</strong>, skłonność do wydatków <strong className="text-slate-200">{pct(ov.macro.spendingBps)}</strong>, ceny materiałów <strong className="text-slate-200">{pct(ov.macro.materialsBps)}</strong>, oczekiwania płacowe kandydatów <strong className="text-slate-200">{pct(ov.macro.wageBps)}</strong> (10 000 pkt = 100%). Ta sama koniunktura (rocznie: dobra / przeciętna / recesja) wpływa na ryzyko zwolnień na etacie.</span>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Sezonowość popytu">
          <div className="flex items-end gap-1" data-testid="season-bars" role="img" aria-label="Sezonowość popytu w miesiącach">
            {seas.map((x) => (
              <div key={x.m} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${MONTH_NAMES[x.m - 1]}: ${pct(x.v)}`}>
                <div className={cx('w-full rounded-sm', x.m === month ? 'bg-gold' : 'bg-sky/50')} style={{ height: Math.round((x.v / maxSeas) * 80) }} />
                <span className="text-[10px] text-slate-500">{MONTH_NAMES[x.m - 1]}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Usługi mają własne wahania: malowanie i gładzie szczytują wiosną i latem, panele jesienią i zimą (teraz: {RENOVATION_MARKET.services.map((sv) => `${SERVICE_BY_ID.get(sv.id)!.label.split(' ')[0]!.toLowerCase()} ${pct(seasonalityFor(RENOVATION_MARKET, sv.id, month))}`).join(', ')}).</p>
        </Card>
        <Card title="Struktura klientów (dziś)">
          <ul className="space-y-2 text-sm" data-testid="segment-structure">
            {SEGMENT_IDS.map((id) => (
              <li key={id}>
                <div className="flex justify-between"><strong className="text-slate-100">{SEGMENTS[id].label}</strong><span className="text-slate-300">{pct(shares[id])}</span></div>
                <ProgressBar value={shares[id]} max={10_000} tone={id === 'budget' ? 'gold' : id === 'premium' ? 'gain' : 'gain'} />
                <div className="mt-0.5 text-xs text-slate-500">{SEGMENTS[id].description}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">W recesji rośnie udział klientów budżetowych; w dobrej koniunkturze — premium.</p>
        </Card>
      </div>
      <Card title="Ceny na rynku">
        {prices ? (
          <p className="text-sm text-slate-300" data-testid="market-prices">Szacunkowy poziom cen konkurentów: średnio <strong>{pct(prices.avgPriceBps)}</strong> ceny referencyjnej (zwykle {pct(prices.lowBps)}–{pct(prices.highBps)}). Cena referencyjna to orientacyjna cena zlecenia w symulacji; klient porównuje Twoją ofertę z jego budżetem i z ofertami innych firm.</p>
        ) : <Empty>Brak danych — model rynku uruchomi się pierwszego dnia pracy firmy.</Empty>}
      </Card>
      <Calibration />
    </div>
  );
}

/* ---------- 2. Konkurencja ---------- */

export function MarketCompetitionScreen() {
  const { game, biz } = useMarket();
  if (!biz) return <NoBusinessNote title="Konkurencja" />;
  const views = competitorViews(game).sort((a, b) => Number(a.status === 'exited') - Number(b.status === 'exited') || b.threat - a.threat);
  const events = game.events.filter((e) => e.type === 'market.entry' || e.type === 'market.exit').slice(-8).reverse();
  const active = views.filter((v) => v.status === 'active').length;
  return (
    <div className="space-y-5" data-testid="market-competition">
      <ScreenHeader title="Konkurencja" subtitle={`Firmy z Twojej branży w mieście: ${active} aktywnych. Ich ceny, obłożenie i wyniki są Ci nieznane — poniżej tylko oszacowania na podstawie tego, co widać z zewnątrz.`} />
      <Card title="Główni konkurenci (oszacowania)">
        {views.length === 0 ? <Empty>Rynek jeszcze się nie uruchomił.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm" data-testid="competitors-table">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Firma</th><th className="pb-2 font-medium">Pozycjonowanie</th><th className="pb-2 font-medium">Wielkość</th><th className="pb-2 font-medium">Ceny</th><th className="pb-2 font-medium">Opinie</th><th className="pb-2 font-medium">Marketing</th><th className="pb-2 font-medium">Usługi</th><th className="pb-2 font-medium">Rywalizacja z Tobą</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {views.map((v) => (
                  <tr key={v.id} className={cx(v.status === 'exited' && 'opacity-50')} data-testid={`competitor-${v.id}`}>
                    <td className="py-2 text-slate-200">{v.name.replace(' (fikcyjna)', '')}{v.status === 'exited' && <span className="ml-2"><Badge tone="neutral">wycofała się</Badge></span>}</td>
                    <td className="py-2 text-slate-400">{POSITIONING[v.positioning].label}</td>
                    <td className="py-2 text-slate-400">{v.sizeBand}</td>
                    <td className="py-2"><Badge tone={v.priceLevel === 'niższe' ? 'sky' : v.priceLevel === 'wyższe' ? 'gold' : 'neutral'}>{v.priceLevel}</Badge></td>
                    <td className="py-2 text-slate-300">≈ {v.stars.toString().replace('.', ',')}★</td>
                    <td className="py-2 text-slate-400">{v.marketing}</td>
                    <td className="py-2 text-xs text-slate-500">{v.services.map((x) => SERVICE_BY_ID.get(x)?.label.split(' ')[0] ?? x).join(', ')}</td>
                    <td className="py-2"><div className="w-24"><ProgressBar value={v.threat} max={100} tone={v.threat > 60 ? 'loss' : v.threat > 35 ? 'gold' : 'gain'} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">„Rywalizacja z Tobą” łączy zgodność usług i segmentów klientów z siłą opinii konkurenta. Konkurenci reagują na koniunkturę i własne wyniki (zmieniają ceny, marketing i moce, wchodzą na rynek i z niego wychodzą) — nie znają Twojej gotówki, kosztów ani ofert.</p>
      </Card>
      <Card title="Ostatnie zmiany na rynku">
        {events.length === 0 ? <Empty>Na razie bez zmian.</Empty> : (
          <ul className="divide-y divide-ink-700/60 text-sm" data-testid="market-events">
            {events.map((e) => <li key={e.id} className="py-2"><span className="text-xs text-slate-500">{formatDatePL(e.date)}</span> <span className="text-slate-200">{e.title.replace('Rynek: ', '')}</span><div className="text-xs text-slate-500">{e.detail}</div></li>)}
          </ul>
        )}
      </Card>
      <Calibration />
    </div>
  );
}

/* ---------- 3. Marketing ---------- */

export function MarketMarketingScreen() {
  const { game, biz } = useMarket();
  const setBudget = useGameStore((s) => s.setMarketingBudget);
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!biz) return <NoBusinessNote title="Marketing" />;
  const rows = channelReport(game);
  const total = rows.reduce((a, r) => a + r.budget, 0);
  const funnel = playerFunnel(game, 3);
  const inq3 = funnel.reduce((a, f) => a + f.inquiries, 0);
  const signed3 = funnel.reduce((a, f) => a + f.signed, 0);
  const spend3 = funnel.reduce((a, f) => a + f.marketingSpend, 0);
  const field = 'w-24 rounded-lg border border-ink-600 bg-ink-900/80 px-2 py-1 text-right text-sm text-slate-100 focus:border-sky focus:outline-none';
  return (
    <div className="space-y-5" data-testid="market-marketing">
      <ScreenHeader title="Marketing" subtitle="Rozdziel miesięczny budżet między kanały. Efekt pojawia się z opóźnieniem, maleje przy rosnącym budżecie i zależy od rynku — reklama nie gwarantuje klientów ani zysku." />
      {total === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 p-4 text-sm text-gold" data-testid="marketing-quickstart">
          <div className="max-w-2xl"><strong>Nie masz żadnego marketingu</strong> — rynek pokazuje Cię wtedy tylko kilku klientom miesięcznie. Polecany skromny start: <strong>reklamy lokalne 400 zł + wizytówka firmy 150 zł</strong> miesięcznie (netto, od 1. dnia następnego miesiąca). Później możesz to zmienić w tabeli poniżej.</div>
          <Button variant="primary" onClick={() => { if (setBudget('local_ads', zl(400))) setBudget('card', zl(150)); }} data-testid="marketing-quickstart-btn">Ustaw polecany start (550 zł/mies.)</Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="marketing-total" label="Budżet miesięczny" icon="coins" accent="sky" value={formatPLN(total, { round: true })} hint="netto, pobierany 1. dnia miesiąca" />
        <StatCard label="Wydatki (3 mies.)" icon="wallet" accent="violet" value={formatPLN(spend3, { round: true })} hint="pobrane opłaty" />
        <StatCard label="Koszt zapytania" icon="bell" accent="gold" value={inq3 > 0 && spend3 > 0 ? formatPLN(roundDiv(spend3, inq3), { round: true }) : '—'} hint={`${inq3} zapytań w 3 mies.`} />
        <StatCard label="Koszt umowy" icon="file" accent="gain" value={signed3 > 0 && spend3 > 0 ? formatPLN(roundDiv(spend3, signed3), { round: true }) : '—'} hint={`${signed3} podpisanych umów`} />
      </div>
      <Card title="Kanały">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm" data-testid="channels-table">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Kanał</th><th className="pb-2 text-right font-medium">Budżet / mies. (zł)</th><th className="pb-2 text-right font-medium">Udział w widoczności</th><th className="pb-2 text-right font-medium">Zapytania (3 mies.)</th><th className="pb-2 text-right font-medium">Umowy</th><th className="pb-2 text-right font-medium">Koszt zapytania</th><th className="pb-2 text-right font-medium">Koszt umowy</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {rows.map((r) => {
                const def = CHANNELS[r.id];
                const value = draft[r.id] ?? String(r.budget / 100);
                const parsed = parseZloty(value);
                const changed = parsed !== null && parsed !== r.budget;
                return (
                  <tr key={r.id} data-testid={`channel-${r.id}`}>
                    <td className="py-2 pr-3"><div className="font-medium text-slate-100">{r.label}</div><div className="max-w-md text-xs text-slate-500">{def.description} Opóźnienie efektu ok. {def.delayMonths} mies.</div></td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <input aria-label={`Budżet: ${r.label}`} className={field} value={value} inputMode="decimal" onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} data-testid={`budget-${r.id}`} />
                        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!changed} onClick={() => { if (parsed !== null && setBudget(r.id, parsed)) setDraft({ ...draft, [r.id]: String(parsed / 100) }); }} data-testid={`set-budget-${r.id}`}>Ustaw</Button>
                      </div>
                    </td>
                    <td className="py-2 text-right text-slate-300">{r.sharePct}%</td>
                    <td className="py-2 text-right text-slate-300">{r.inquiries3m}</td>
                    <td className="py-2 text-right text-slate-300">{r.signed3m}</td>
                    <td className="py-2 text-right text-slate-400">{r.costPerInquiry === null ? '—' : formatPLN(r.costPerInquiry, { round: true })}</td>
                    <td className="py-2 text-right text-slate-400">{r.costPerContract === null ? '—' : formatPLN(r.costPerContract, { round: true })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Nowy budżet obowiązuje od 1. dnia następnego miesiąca, a widoczność narasta stopniowo. Kanały różnią się jakością zapytań: portale to dużo porównań i cenowi klienci, polecenia i współpraca z przedsiębiorcami — mniej porównań i większe zlecenia. Konkurenci też się reklamują, więc skuteczność kanału zależy od tłoku na rynku i koniunktury.</p>
      </Card>
      <Calibration />
    </div>
  );
}

/* ---------- 4. Strategia firmy ---------- */

export function MarketStrategyScreen() {
  const { game, biz } = useMarket();
  const setPos = useGameStore((s) => s.setPositioning);
  if (!biz) return <NoBusinessNote title="Strategia firmy" />;
  const st = game.market.strategy;
  const blend = positioningBlend(game, game.clock.today);
  const sinceChange = st.changedOn ? Math.round((Date.parse(game.clock.today) - Date.parse(st.changedOn)) / 86_400_000) : null;
  const cooldownLeft = sinceChange !== null ? Math.max(0, STRATEGY.cooldownDays - sinceChange) : 0;
  const seg = segmentReport(game);
  return (
    <div className="space-y-5" data-testid="market-strategy">
      <ScreenHeader title="Strategia firmy" subtitle="Pozycjonowanie określa, których klientów przyciągasz i czego od Ciebie oczekują. Zmiana działa stopniowo i nie zeruje reputacji — ani nie daje natychmiast sprzedaży." />
      <div className="grid gap-4 lg:grid-cols-3">
        {POSITIONINGS.map((id) => {
          const def = POSITIONING[id];
          const current = st.positioning === id;
          return (
            <div key={id} className={cx('rounded-2xl border p-4 text-sm', current ? 'border-sky bg-sky/10' : 'border-ink-700 bg-ink-900/40')} data-testid={`positioning-${id}`}>
              <div className="flex items-center justify-between gap-2"><strong className="text-slate-100">{def.label}</strong>{current && <Badge tone="sky">aktualne</Badge>}</div>
              <p className="mt-1 text-xs text-slate-400">{def.description}</p>
              <dl className="mt-2 space-y-0.5 text-xs text-slate-400">
                {SEGMENT_IDS.map((g) => <div key={g} className="flex justify-between"><dt>Widoczność: {SEGMENTS[g].label.toLowerCase()}</dt><dd className="text-slate-200">{pct(def.segmentBias[g])}</dd></div>)}
                <div className="flex justify-between"><dt>Koszt utrzymania</dt><dd className="text-slate-200">{def.monthlyCost > 0 ? `${formatPLN(def.monthlyCost, { round: true })} / mies.` : 'brak'}</dd></div>
              </dl>
              <Button variant={current ? 'ghost' : 'primary'} className="mt-3 w-full" disabled={current || cooldownLeft > 0} onClick={() => setPos(id)} data-testid={`set-positioning-${id}`}>{current ? 'Wybrane' : 'Przejdź na tę strategię'}</Button>
            </div>
          );
        })}
      </div>
      <Card title="Wdrażanie zmiany">
        {st.previous && blend.progress < 1 ? (
          <div data-testid="transition">
            <div className="mb-1 text-sm text-slate-300">{POSITIONING[st.previous].label} → {POSITIONING[st.positioning].label}: {Math.round(blend.progress * 100)}% efektu</div>
            <ProgressBar value={Math.round(blend.progress * 100)} max={100} tone="gold" />
          </div>
        ) : <p className="text-sm text-slate-400">Strategia jest w pełni wdrożona.</p>}
        {cooldownLeft > 0 && <p className="mt-2 text-xs text-gold" data-testid="cooldown">Kolejną zmianę można wprowadzić za {cooldownLeft} dni.</p>}
        <p className="mt-2 text-xs text-slate-500">Efekt narasta liniowo przez {STRATEGY.transitionDays} dni; minimalny odstęp między zmianami to {STRATEGY.cooldownDays} dni. Klienci premium oczekują wysokiej jakości i punktualności i mocniej karzą wady — bez dobrych opinii wyższa cena nie wystarczy.</p>
      </Card>
      <Card title="Jak wypadasz w segmentach (12 mies.)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" data-testid="segment-table">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Segment</th><th className="pb-2 text-right font-medium">Zapytania</th><th className="pb-2 text-right font-medium">Umowy</th><th className="pb-2 text-right font-medium">Konwersja</th><th className="pb-2 text-right font-medium">Śr. kontrakt</th><th className="pb-2 text-right font-medium">Reklamacje</th><th className="pb-2 text-right font-medium">Widoczność vs średni konkurent</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {seg.map((r) => (
                <tr key={r.id}><td className="py-2 text-slate-200">{r.label}</td><td className="py-2 text-right text-slate-300">{r.inquiries}</td><td className="py-2 text-right text-slate-300">{r.signed}</td><td className="py-2 text-right text-slate-300">{r.conversionBps === null ? '—' : pct(r.conversionBps)}</td><td className="py-2 text-right text-slate-300">{r.avgContract === null ? '—' : formatPLN(r.avgContract, { round: true })}</td><td className="py-2 text-right text-slate-300">{r.complaints}</td><td className="py-2 text-right text-slate-400">{pct(r.relativeVisibilityBps)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Historia decyzji strategicznych">
        {st.history.length === 0 ? <Empty>Nie zmieniano jeszcze pozycjonowania (start: zrównoważona oferta).</Empty> : (
          <ul className="divide-y divide-ink-700/60 text-sm" data-testid="strategy-history">
            {[...st.history].reverse().map((h, i) => <li key={`${h.date}-${i}`} className="py-2"><span className="text-xs text-slate-500">{formatDatePL(h.date)}</span> <span className="text-slate-200">{h.note}</span></li>)}
          </ul>
        )}
      </Card>
      <Calibration />
    </div>
  );
}

/* ---------- 5. Analiza popytu ---------- */

export function MarketDemandScreen() {
  const { game, biz } = useMarket();
  if (!biz) return <NoBusinessNote title="Analiza popytu" />;
  const funnel = playerFunnel(game, 12);
  const cap = capacityOverview(game);
  const emp = employmentProfitability(game);
  const ov = marketOverview(game);
  const th = 'pb-2 text-right font-medium';
  const td = 'py-1.5 text-right text-slate-300';
  const cell = (v: ReactNode) => <td className={td}>{v}</td>;
  return (
    <div className="space-y-5" data-testid="market-demand">
      <ScreenHeader title="Analiza popytu" subtitle="Skąd biorą się zapytania i co się z nimi dzieje: popyt rynkowy → szukający wykonawcy → zapytania do Ciebie → oferty → umowy. Nie każde zapytanie kończy się sprzedażą." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Zapytania / mies." icon="bell" accent="sky" value={ov.inquiriesPerMonth.toFixed(1).replace('.', ',')} hint="średnia z 6 mies." />
        <StatCard testId="demand-conversion" label="Konwersja" icon="trend" accent="gain" value={ov.conversionBps === null ? '—' : pct(ov.conversionBps)} hint="zapytania → umowy (6 mies.)" />
        <StatCard label="Moc własna" icon="clock" accent="violet" value={`${cap.contractsPerMonth} kontr./mies.`} hint={`właściciel ${cap.ownerFreeHoursPerDay} h/dz. + pracownicy ${cap.employeeHoursPerDay} h/dz.`} />
        <StatCard label="Kontrakty w toku" icon="briefcase" accent="gold" value={`${cap.activeJobs}`} hint="zaległość pracy" />
      </div>
      <Card title="Lejek popytu (12 miesięcy)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm" data-testid="funnel-table">
            <thead className="text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 text-left font-medium">Miesiąc</th><th className={th}>Popyt w mieście</th><th className={th}>Szukają wykonawcy</th><th className={th}>Zapytania do Ciebie</th><th className={th}>Utracone (brak mocy)</th><th className={th}>Oferty</th><th className={th}>Zaakceptowane</th><th className={th}>Umowy</th><th className={th}>Konwersja</th><th className={th}>Koszt umowy</th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {funnel.map((f) => (
                <tr key={f.month}><td className="py-1.5 text-left text-slate-200">{monthLabel(f.month)}</td>{cell(f.demand ?? '—')}{cell(f.seekers ?? '—')}{cell(f.inquiries)}{cell(f.lostCapacity)}{cell(f.quotes)}{cell(f.won)}{cell(f.signed)}{cell(f.conversionBps === null ? '—' : pct(f.conversionBps))}{cell(f.costPerContract === null ? '—' : formatPLN(f.costPerContract, { round: true }))}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Zapytania powstają z popytu rynku: klient wybiera kilka firm (ważone widocznością: marketing, opinie, specjalizacja, pozycjonowanie), a potem porównuje oferty — cenę, jakość, opinie i termin. Zatrudnienie pracownika samo nie zwiększa liczby zapytań; zwiększa tylko to, ile z nich zdołasz obsłużyć.</p>
      </Card>
      <Card title="Rentowność zatrudnienia">
        {emp.employees === 0 ? <Empty>Nie masz pracowników. Gdy zatrudnisz, zobaczysz tu koszt, obłożenie i próg opłacalności.</Empty> : (
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2" data-testid="employment-profit">
            <div className="flex justify-between border-b border-ink-700/60 py-1.5"><dt className="text-slate-400">Pracownicy</dt><dd className="text-slate-200">{emp.employees}</dd></div>
            <div className="flex justify-between border-b border-ink-700/60 py-1.5"><dt className="text-slate-400">Koszt pracodawcy / mies.</dt><dd className="text-slate-200">{formatPLN(emp.payrollMonthly, { round: true })}</dd></div>
            <div className="flex justify-between border-b border-ink-700/60 py-1.5"><dt className="text-slate-400">Płace przypisane do kontraktów</dt><dd className="text-slate-200">{emp.allocatedPct === null ? '—' : `${emp.allocatedPct}%`}</dd></div>
            <div className="flex justify-between border-b border-ink-700/60 py-1.5"><dt className="text-slate-400">Bezczynność (koszt stały) / mies.</dt><dd className="text-slate-200">{formatPLN(emp.idleMonthly, { round: true })}</dd></div>
            <div className="flex justify-between border-b border-ink-700/60 py-1.5"><dt className="text-slate-400">Wkład kontraktu na godzinę pracy</dt><dd className="text-slate-200">{emp.contributionPerHour === null ? '—' : formatPLN(emp.contributionPerHour, { round: true })}</dd></div>
            <div className="flex justify-between border-b border-ink-700/60 py-1.5"><dt className="text-slate-400">Obłożenie, przy którym pracownik na siebie zarabia</dt><dd className="text-slate-200">{emp.breakEvenPct === null ? '—' : `${emp.breakEvenPct}%`}</dd></div>
            <div className="flex justify-between py-1.5 sm:col-span-2"><dt className="text-slate-400">Zapytań miesięcznie potrzeba, by obłożyć załogę w ~70%</dt><dd className="text-slate-200">≈ {emp.inquiriesNeeded}</dd></div>
          </dl>
        )}
        <p className="mt-2 text-xs text-slate-500">Pracownik kosztuje stale, niezależnie od liczby zleceń. Opłaca się, gdy marketing i opinie dostarczają dość zapytań, a Ty je wygrywasz — samo zatrudnienie nie tworzy popytu.</p>
      </Card>
      <Calibration />
    </div>
  );
}

export { zl };
