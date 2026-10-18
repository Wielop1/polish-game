import { useState } from 'react';
import type { ReactNode } from 'react';
import { HOUSING_CATALOG, PLACEHOLDER_NOTICE, STANDARD_LABELS } from '../../engine/config.ts';
import type { HousingListing } from '../../engine/config.ts';
import { activeLeases, currentLease, upcomingLease } from '../../engine/contracts.ts';
import { formatDatePL } from '../../engine/date.ts';
import { allowedMoveInDates, previewLease } from '../../engine/housing.ts';
import { cash } from '../../engine/selectors.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Money, PlaceholderBadge, ScreenHeader, cx } from '../components/ui.tsx';

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-400">{k}</dt>
      <dd className={cx('tabular', tone ?? 'text-slate-100')}>{v}</dd>
    </div>
  );
}

function ListingCard({ listing, onPick, selected }: { listing: HousingListing; onPick: () => void; selected: boolean }) {
  const game = useGameStore((s) => s.game)!;
  const cur = currentLease(game);
  const isCurrent = cur?.listingId === listing.id;
  return (
    <div data-testid={`listing-${listing.id}`} className={cx('rounded-xl border p-4', selected ? 'border-sky bg-sky/5' : 'border-ink-700 bg-ink-900/50')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-50">{listing.title}</h3>
          <div className="text-sm text-slate-400">{listing.district} · {listing.areaM2} m² · standard {STANDARD_LABELS[listing.standard].toLowerCase()}</div>
        </div>
        {isCurrent && <Badge tone="gain">tu mieszkasz</Badge>}
      </div>
      <p className="mt-2 text-sm text-slate-300">{listing.description}</p>
      <dl className="mt-3 divide-y divide-ink-700/60">
        <Row k="Czynsz najmu" v={<Money value={listing.rent} round />} />
        <Row k="Opłaty eksploatacyjne" v={<Money value={listing.utilities} round />} />
        <Row k="Kaucja (zwrotna)" v={<Money value={listing.deposit} round />} />
        <Row k="Koszt przeprowadzki" v={<Money value={listing.movingCost} round />} />
      </dl>
      <Button className="mt-3 w-full" variant={selected ? 'secondary' : 'primary'} disabled={isCurrent} onClick={onPick} data-testid={`pick-${listing.id}`}>
        {selected ? 'Wybrane — zobacz warunki poniżej' : 'Wybierz to mieszkanie'}
      </Button>
    </div>
  );
}

export function HousingScreen() {
  const game = useGameStore((s) => s.game)!;
  const signLease = useGameStore((s) => s.signLease);
  const [listingId, setListingId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);

  const cur = currentLease(game);
  const next = upcomingLease(game);
  const overlap = activeLeases(game).length > 1;
  const dates = allowedMoveInDates(game);
  const heldDeposit = game.assets.filter((a) => a.status === 'held').reduce((acc, a) => acc + a.amount, 0);
  const effectiveStart = startDate && dates.includes(startDate) ? startDate : (dates[dates.length - 1] ?? null);
  const preview = listingId && effectiveStart ? previewLease(game, listingId, effectiveStart) : null;
  const available = cash(game);

  const confirm = () => {
    if (!preview) return;
    const l = preview.listing;
    const msg = `Podpisać umowę najmu: ${l.title}, ${l.district}?\n\nOd ${formatDatePL(preview.startDate)}. Zapłacisz teraz kaucję ${l.deposit / 100} zł.`;
    if (window.confirm(msg) && signLease(l.id, preview.startDate)) {
      setListingId(null);
      setStartDate(null);
    }
  };

  return (
    <div className="space-y-5">
      <ScreenHeader title="Mieszkanie" subtitle="Najem w Olsztynie. Zmiana mieszkania aktualizuje wszystkie przyszłe zobowiązania." />

      <Card title="Obecna umowa najmu" action={<PlaceholderBadge />}>
        {cur ? (
          <div data-testid="current-lease">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-50">{cur.title}</div>
                <div className="text-sm text-slate-400">
                  {game.parties[cur.partyId]?.name} · od {formatDatePL(cur.startDate)}
                  {cur.areaM2 ? ` · ${cur.areaM2} m²` : ''}{cur.district ? ` · ${cur.district}` : ''}{cur.standard ? ` · standard ${STANDARD_LABELS[cur.standard].toLowerCase()}` : ''}
                </div>
                {cur.endDate && <div className="mt-2 text-sm text-gold">Umowa kończy się {formatDatePL(cur.endDate)}.</div>}
              </div>
              <dl className="min-w-56">
                <Row k="Czynsz" v={<Money value={cur.monthlyAmount} />} />
                <Row k="Opłaty eksploatacyjne" v={<Money value={cur.utilitiesMonthly} />} />
                <Row k="Razem miesięcznie" v={<Money value={cur.monthlyAmount + cur.utilitiesMonthly} />} tone="font-semibold text-loss" />
                <Row k="Kaucja zatrzymana" v={cur.depositAmount > 0 ? <Money value={cur.depositAmount} /> : 'brak (umowa bez kaucji)'} />
              </dl>
            </div>
            {overlap && <div role="alert" className="mt-3 rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm text-gold">Obowiązują dwie umowy najmu jednocześnie — do końca starej umowy płacisz oba czynsze.</div>}
            {next && <div className="mt-3 rounded-xl border border-sky/30 bg-sky/5 p-3 text-sm"><strong className="text-sky">Podpisana umowa od {formatDatePL(next.startDate)}:</strong> {next.title}. Czynsz i opłaty tego lokalu naliczane są od tego dnia.</div>}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-slate-500">Kaucje w posiadaniu wynajmujących: <Money value={heldDeposit} /> — to Twoje aktywo (wlicza się do majątku netto), nie koszt. {PLACEHOLDER_NOTICE}</p>
      </Card>

      {next ? (
        <Card title="Zmiana mieszkania"><p className="text-sm text-slate-400">Masz już podpisaną umowę najmu od {formatDatePL(next.startDate)} — kolejną będzie można podpisać po przeprowadzce.</p></Card>
      ) : (
        <>
          <Card title={`Oferty najmu (${HOUSING_CATALOG.length})`}>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {HOUSING_CATALOG.map((l) => (
                <ListingCard key={l.id} listing={l} selected={listingId === l.id} onPick={() => setListingId(l.id)} />
              ))}
            </div>
          </Card>

          {preview && (
            <Card title={`Warunki przeprowadzki: ${preview.listing.title}, ${preview.listing.district}`}>
              <div className="space-y-4" data-testid="lease-preview">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-slate-200">Data wprowadzenia się</legend>
                  <div className="flex flex-wrap gap-2">
                    {dates.map((d) => {
                      const p = previewLease(game, preview.listing.id, d)!;
                      return (
                        <label key={d} className={cx('cursor-pointer rounded-xl border px-3 py-2 text-sm', d === preview.startDate ? 'border-sky bg-sky/10 text-white' : 'border-ink-600 text-slate-300 hover:border-ink-500')}>
                          <input type="radio" name="startDate" className="sr-only" checked={d === preview.startDate} onChange={() => setStartDate(d)} />
                          {formatDatePL(d)}
                          <span className="block text-xs text-slate-400">{p.overlapMonths > 0 ? `nakładanie: ${p.overlapMonths} mies.` : 'bez nakładania'}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <dl className="divide-y divide-ink-700/60 rounded-xl border border-ink-700 bg-ink-900/50 px-4 py-2">
                  <Row k="Kaucja płatna dziś (aktywo, nie koszt)" v={<Money value={preview.depositNow} />} />
                  <Row k={`Koszt przeprowadzki (${formatDatePL(preview.startDate)})`} v={<Money value={preview.movingCost} />} />
                  <Row k="Nowy czynsz + opłaty miesięcznie" v={<Money value={preview.newMonthlyCost} />} tone="text-loss" />
                  <Row k="Poprzednia umowa kończy się" v={formatDatePL(preview.oldLeaseEnd)} />
                  {preview.overlapMonths > 0 && <Row k={`Nakładanie się umów: ${preview.overlapMonths} mies. — koszt podwójny (szac.)`} v={<Money value={preview.overlapCost} />} tone="text-gold" />}
                  {preview.oldDepositRefund > 0 && preview.oldDepositRefundOn && <Row k={`Zwrot kaucji ze starego mieszkania (${formatDatePL(preview.oldDepositRefundOn)})`} v={<Money value={preview.oldDepositRefund} />} tone="text-gain" />}
                  <Row k="Dostępne na rachunku bieżącym" v={<Money value={available} />} tone={available >= preview.depositNow ? 'text-gain' : 'text-loss'} />
                </dl>
                {available < preview.depositNow && <p role="alert" className="text-sm text-loss">Brak środków na kaucję — przelej środki z oszczędności lub wybierz tańszy lokal.</p>}
                <div className="flex gap-2">
                  <Button variant="primary" disabled={available < preview.depositNow} onClick={confirm} data-testid="sign-lease">Podpisz umowę najmu</Button>
                  <Button variant="secondary" onClick={() => setListingId(null)}>Anuluj</Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
