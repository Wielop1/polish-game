import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BUSINESS_PROFILES, PROFILE_BY_ID } from '../../engine/businessCatalog.ts';
import { SERVICES } from '../../engine/renovationCatalog.ts';
import { BUSINESS_CATEGORIES, VAT_PASS_THROUGH, activeBusiness, allowedBusinessStarts, isSuspendedOn, docsOf, previewRegistration, profileOf, validateRegistration, zusReliefEligible } from '../../engine/business.ts';
import type { RegisterInput } from '../../engine/business.ts';
import { categoryInfo } from '../../engine/categories.ts';
import { addDays, formatDatePL, formatDateShortPL, formatMonthPL, monthKey, parseIso } from '../../engine/date.ts';
import { LEGAL_RULES, carriedForward } from '../../engine/legal.ts';
import type { LegalStatus } from '../../engine/legal.ts';
import { businessBalance, businessLiquidity, businessSummaries } from '../../engine/selectors.ts';
import type { Business, TaxForm, ZusStart } from '../../engine/state.ts';
import { vatExemptionLimit, zusRegimeFor, monthsBetween } from '../../engine/tax.ts';
import { budgetFor } from '../../engine/time.ts';
import { formatPLN } from '../../engine/money.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { BarChart, ProgressBar } from '../components/charts.tsx';
import { Badge, Button, Card, Empty, Money, ScreenHeader, StatCard, cx, moneyTone } from '../components/ui.tsx';
import { parseZloty } from '../format.ts';
import { MalyZusCard, SuspensionCard, TaxFormCard } from './AnnualScreens.tsx';

/* ---------- wspólne elementy ---------- */

const STATUS_TONE: Record<LegalStatus, 'gain' | 'gold' | 'neutral'> = { VERIFIED: 'gain', SIMPLIFIED: 'gold', DEFERRED: 'neutral' };
const STATUS_LABEL: Record<LegalStatus, string> = { VERIFIED: 'zweryfikowane', SIMPLIFIED: 'uproszczone', DEFERRED: 'odłożone' };

export function LegalBadge({ id }: { id: string }) {
  const rule = LEGAL_RULES.find((r) => r.id === id);
  if (!rule) return null;
  return (
    <span title={`${rule.title}\n${rule.note}\nŹródło: ${rule.source}`}>
      <Badge tone={STATUS_TONE[rule.status]}>{id} · {STATUS_LABEL[rule.status]}</Badge>
    </span>
  );
}

function SimBanner() {
  return (
    <div role="note" data-testid="sim-banner" className="mb-5 rounded-xl border border-gold/30 bg-gold/5 p-3 text-xs leading-relaxed text-gold/90">
      <strong>Symulacja.</strong> Podatki i składki są liczone według zasad zweryfikowanych na stronach urzędowych dla 2026 r. (rejestr: <em>docs/LEGAL_SOURCES.md</em>), z oznaczonymi uproszczeniami.
      To nie jest porada prawna ani podatkowa, a rekordy sprzedaży nie są fakturami w rozumieniu KSeF.
    </div>
  );
}

function useBusiness(): { game: NonNullable<ReturnType<typeof useGameStore.getState>['game']>; biz: Business | null } {
  const game = useGameStore((s) => s.game)!;
  return { game, biz: activeBusiness(game) };
}

function NoBusiness() {
  const navigate = useGameStore((s) => s.navigate);
  return (
    <Card>
      <Empty>
        Nie prowadzisz jeszcze działalności.
        <div className="mt-3"><Button variant="primary" onClick={() => navigate('bizRegister')}>Zarejestruj JDG</Button></div>
      </Empty>
    </Card>
  );
}

function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-slate-400">{k}</dt>
      <dd className={cx('tabular text-right', tone ?? 'text-slate-100')}>{v}</dd>
    </div>
  );
}

const FORM_LABEL: Record<TaxForm, string> = { skala: 'Skala podatkowa (12% / 32%)', liniowy: 'Podatek liniowy 19%', ryczalt: 'Ryczałt od przychodów ewidencjonowanych' };
const REGIME_LABEL = { ulga: 'ulga na start', preferencyjny: 'składki preferencyjne', standard: 'standardowe składki', etat: 'pokryte etatem', maly_plus: 'Mały ZUS Plus', zawieszenie: 'zawieszenie' } as const;

/* ---------- 1. Rejestracja JDG ---------- */

function Choice({ checked, onChange, title, children, name, disabled }: { checked: boolean; onChange: () => void; title: string; children?: ReactNode; name: string; disabled?: boolean }) {
  return (
    <label className={cx('block cursor-pointer rounded-xl border p-3 text-sm transition', checked ? 'border-sky bg-sky/10' : 'border-ink-600 hover:border-ink-500', disabled && 'cursor-not-allowed opacity-40')}>
      <input type="radio" name={name} className="sr-only" checked={checked} disabled={disabled} onChange={onChange} />
      <div className="font-medium text-slate-100">{title}</div>
      {children && <div className="mt-1 text-xs text-slate-400">{children}</div>}
    </label>
  );
}

export function BizRegisterScreen() {
  const { game, biz } = useBusiness();
  const register = useGameStore((s) => s.registerBusiness);
  const navigate = useGameStore((s) => s.navigate);
  const starts = allowedBusinessStarts(game);
  const [name, setName] = useState(`${game.person.firstName} ${game.person.lastName} — usługi`);
  const [profileId, setProfileId] = useState(BUSINESS_PROFILES[0]!.id);
  const [taxForm, setTaxForm] = useState<TaxForm>('skala');
  const [vat, setVat] = useState<'exempt' | 'active'>('exempt');
  const [start, setStart] = useState<string>(starts[0] ?? '');
  const [zus, setZus] = useState<ZusStart>('ulga');
  const [sickness, setSickness] = useState(false);
  const [specialization, setSpecialization] = useState<string>(SERVICES[0]!.id);

  const input: RegisterInput = { name, profileId, taxForm, vatStatus: vat, startDate: start, zusStart: zus, sickness, specialization: PROFILE_BY_ID.get(profileId)?.industry === 'renovation' ? specialization : undefined };
  const eligible = start ? zusReliefEligible(game, start) : false;
  const effectiveZus: ZusStart = !eligible && zus !== 'standard' ? 'standard' : zus;
  const preview = useMemo(() => (start ? previewRegistration(game, { ...input, zusStart: effectiveZus }) : null), [game, profileId, taxForm, vat, start, effectiveZus, sickness]); // eslint-disable-line react-hooks/exhaustive-deps
  const error = validateRegistration(game, { ...input, zusStart: effectiveZus });
  const profile = PROFILE_BY_ID.get(profileId)!;

  if (biz) {
    return (
      <div className="space-y-5">
        <ScreenHeader title="Rejestracja JDG" subtitle="W v0.3 można prowadzić jedną jednoosobową działalność gospodarczą." />
        <Card><Empty>Prowadzisz już działalność „{biz.name}”.<div className="mt-3"><Button variant="primary" onClick={() => navigate('bizOverview')}>Przejdź do „Moja działalność”</Button></div></Empty></Card>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (error) return;
    const msg = `Zarejestrować działalność „${name.trim()}”?\n\nStart: ${formatDatePL(start)} · ${FORM_LABEL[taxForm]} · VAT: ${vat === 'exempt' ? 'zwolnienie podmiotowe' : 'czynny podatnik'} · ZUS: ${effectiveZus === 'ulga' ? 'ulga na start' : effectiveZus === 'preferencyjny' ? 'składki preferencyjne' : 'standardowe'}.\n\nFormę opodatkowania w v0.3 wybierasz raz — zmiana w trakcie działalności jest niedostępna.`;
    if (window.confirm(msg)) register({ ...input, zusStart: effectiveZus });
  };

  return (
    <div className="space-y-5">
      <ScreenHeader title="Rejestracja JDG" subtitle="Jednoosobowa działalność gospodarcza osoby fizycznej — nie jest osobą prawną (odpowiadasz całym majątkiem)." />
      <SimBanner />
      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-5" noValidate>
        <div className="space-y-5 lg:col-span-3">
          <Card title="1. Nazwa i profil działalności">
            <label htmlFor="bizname" className="mb-1.5 block text-sm font-medium text-slate-200">Nazwa działalności</label>
            <input id="bizname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mb-4 w-full rounded-xl border border-ink-600 bg-ink-900/80 px-3.5 py-2.5 text-slate-100 focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/30" />
            <div className="grid gap-2 sm:grid-cols-2">
              {BUSINESS_PROFILES.map((p) => (
                <Choice key={p.id} name="profile" checked={profileId === p.id} onChange={() => setProfileId(p.id)} title={p.label}>
                  PKD 2025: <strong>{p.pkd}</strong> — {p.pkdName}
                  {p.industry && <><br />Moduł branżowy: zapytania, wyceny, materiały, sprzęt, reputacja.</>}
                </Choice>
              ))}
            </div>
            {profile.industry === 'renovation' && (
              <fieldset className="mt-4" data-testid="specialization-picker">
                <legend className="mb-2 text-sm font-medium text-slate-200">Pierwsza specjalizacja (poziom startowy 2; kolejne dokupisz szkoleniem)</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SERVICES.map((d) => (
                    <Choice key={d.id} name="specialization" checked={specialization === d.id} onChange={() => setSpecialization(d.id)} title={d.label}>{d.description}</Choice>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gold">Ceny, stawki i normy czasu w branży remontowej to parametry symulacyjne — nie oficjalny cennik remontów.</p>
              </fieldset>
            )}
          </Card>

          <Card title="2. Forma opodatkowania">
            <div className="grid gap-2">
              <Choice name="form" checked={taxForm === 'skala'} onChange={() => setTaxForm('skala')} title="Skala podatkowa — forma podstawowa"><LegalBadge id="PIT-SCALE-2026" /> 12% do 120 000 zł (minus 3 600 zł), 32% powyżej. Koszty uzyskania przychodu odliczasz. Składka zdrowotna 9% dochodu (min. 432,54 zł), bez odliczenia w PIT.</Choice>
              <Choice name="form" checked={taxForm === 'liniowy'} onChange={() => setTaxForm('liniowy')} title="Podatek liniowy 19%"><LegalBadge id="PIT-LINEAR-2026" /> Koszty odliczasz. Składka zdrowotna 4,9% dochodu (min. 432,54 zł), odliczana do 14 100 zł rocznie.</Choice>
              <Choice name="form" checked={taxForm === 'ryczalt'} onChange={() => setTaxForm('ryczalt')} title={`Ryczałt — ${profile.ryczaltRateBps / 100}% przychodu`}><LegalBadge id="PIT-RYCZALT-RATES-2026" /> Bez kosztów: podatek od przychodu pomniejszonego o składki społeczne i 50% zdrowotnej. Zdrowotna wg progów przychodu (498,35 / 830,58 / 1 495,04 zł).</Choice>
            </div>
            <p className="mt-2 text-xs text-slate-500">Wybór formy jest jednorazowy (zgłoszenie do 20. dnia po pierwszym przychodzie — w symulacji dokonujesz go tutaj).</p>
          </Card>

          <Card title="3. VAT">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice name="vat" checked={vat === 'exempt'} onChange={() => setVat('exempt')} title="Zwolnienie podmiotowe"><LegalBadge id="VAT-LIMIT-2026" /> Bez VAT do limitu {preview ? formatPLN(preview.vatLimit, { round: true }) : '240 000 zł'} (w roku startu proporcjonalnie). Bez odliczenia VAT z kosztów.</Choice>
              <Choice name="vat" checked={vat === 'active'} onChange={() => setVat('active')} title="Czynny podatnik VAT"><LegalBadge id="VAT-RATE-23" /> VAT 23% doliczany do sprzedaży; odliczasz VAT z kosztów; rozliczenie i zapłata do 25. dnia następnego miesiąca.</Choice>
            </div>
          </Card>

          <Card title="4. Start i składki ZUS">
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-medium text-slate-200">Data rozpoczęcia (1. dzień miesiąca)</legend>
              <div className="flex flex-wrap gap-2">
                {starts.map((d) => (
                  <label key={d} className={cx('cursor-pointer rounded-xl border px-3 py-2 text-sm', start === d ? 'border-sky bg-sky/10 text-white' : 'border-ink-600 text-slate-300 hover:border-ink-500')}>
                    <input type="radio" name="start" className="sr-only" checked={start === d} onChange={() => setStart(d)} />{formatDatePL(d)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-2 sm:grid-cols-3">
              <Choice name="zus" checked={effectiveZus === 'ulga'} disabled={!eligible} onChange={() => setZus('ulga')} title="Ulga na start"><LegalBadge id="ZUS-ULGA-START" /> 6 mies. bez składek społecznych (zdrowotna płatna), potem 24 mies. preferencyjnych.</Choice>
              <Choice name="zus" checked={effectiveZus === 'preferencyjny'} disabled={!eligible} onChange={() => setZus('preferencyjny')} title="Składki preferencyjne"><LegalBadge id="ZUS-PREF-BASE-2026" /> 24 mies. od podstawy 1 441,80 zł.</Choice>
              <Choice name="zus" checked={effectiveZus === 'standard'} onChange={() => setZus('standard')} title="Standardowe składki"><LegalBadge id="ZUS-BASE-STANDARD-2026" /> Podstawa 5 652 zł.</Choice>
            </div>
            {!eligible && <p className="mt-2 text-xs text-gold">Ulga i składki preferencyjne niedostępne: działalność w ostatnich 60 miesiącach.</p>}
            <label className="mt-4 flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={sickness} onChange={(e) => setSickness(e.target.checked)} className="size-4 accent-sky" /> Dobrowolne ubezpieczenie chorobowe (2,45% podstawy; świadczenia nie są w grze modelowane)</label>
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card title="Konsekwencje wyboru" className="lg:sticky lg:top-24">
            {preview ? (
              <div data-testid="reg-preview" className="space-y-4 text-sm">
                <div>
                  <div className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">Składki społeczne (miesięcznie)</div>
                  <ul className="space-y-1">
                    {preview.zusPlan.map((p, i) => (
                      <li key={i} className="flex justify-between gap-2 text-slate-300"><span>{REGIME_LABEL[p.regime]} · mies. {p.fromMonth}{p.toMonth ? `–${p.toMonth}` : '+'}</span><span className="tabular text-slate-100"><Money value={p.social} /></span></li>
                    ))}
                  </ul>
                  {preview.etatCoversSocial && <p className="mt-1 text-xs text-sky">Dopóki masz etat ≥ minimalnego wynagrodzenia, składek społecznych z JDG nie płacisz (zbieg tytułów).</p>}
                </div>
                <dl className="divide-y divide-ink-700/60 rounded-xl border border-ink-700 px-3">
                  <Row k="Składka zdrowotna (min.)" v={<Money value={preview.healthMin} />} />
                  <Row k="Limit zwolnienia z VAT" v={<Money value={preview.vatLimit} round />} />
                  <Row k="PKD 2025" v={profile.pkd} />
                  <Row k="Rachunek firmowy" v="osobny, własność osoby fizycznej" />
                </dl>
                {preview.warnings.length > 0 && (
                  <ul className="space-y-1.5 text-xs text-gold" data-testid="reg-warnings">
                    {preview.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
                  </ul>
                )}
              </div>
            ) : <Empty>Wybierz datę startu.</Empty>}
            {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
            <Button type="submit" variant="primary" className="mt-4 w-full" disabled={!!error} data-testid="register-business">Zarejestruj działalność</Button>
            <p className="mt-2 text-xs text-slate-500">Rejestracja w CEIDG jest bezpłatna i w symulacji natychmiastowa. Firma potrzebuje finansowania: po starcie przelej środki na rachunek firmowy.</p>
          </Card>
        </div>
      </form>
    </div>
  );
}

/* ---------- 2. Moja działalność ---------- */

export function BizOverviewScreen() {
  const { game, biz: active } = useBusiness();
  const transfer = useGameStore((s) => s.transferFunds);
  const close = useGameStore((s) => s.closeBusiness);
  const [text, setText] = useState('');
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const biz = active ?? game.businesses[game.businesses.length - 1] ?? null;
  if (!biz) return <div className="space-y-5"><ScreenHeader title="Moja działalność" /><NoBusiness /></div>;
  const profile = profileOf(biz);
  const acc = game.accounts[biz.accountId]!;
  const main = game.accounts[game.playerAccountId]!;
  const today = game.clock.today;
  const year = parseIso(today).year;
  const idx = monthsBetween(monthKey(biz.startDate), monthKey(today));
  const regime = today >= biz.startDate ? zusRegimeFor(biz.zus.start, Math.max(0, idx)) : null;
  const salesYtd = docsOf(game, biz, 'sales').filter((d) => d.issueDate.startsWith(`${year}-`)).reduce((a, d) => a + d.net, 0);
  const limit = vatExemptionLimit(biz.startDate, year);
  const liq = businessLiquidity(game);
  const from = dir === 'in' ? main : acc;
  const to = dir === 'in' ? acc : main;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = parseZloty(text);
    if (amount && transfer(from.id, to.id, amount)) setText('');
  };
  const confirmClose = () => {
    if (window.confirm('Zakończyć działalność? Zakończy się ostatniego dnia bieżącego miesiąca; po zakończeniu przez 60 miesięcy nie skorzystasz z ulgi na start i składek preferencyjnych.')) close();
  };

  return (
    <div className="space-y-5">
      <ScreenHeader title="Moja działalność" subtitle={`${biz.name} · ${profile.label}`} />
      <SimBanner />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testId="biz-balance" label="Rachunek firmowy" icon="wallet" accent="gain" value={<Money value={acc.balance} />} hint="środki właściciela w firmie" />
        <StatCard label="Płynność 30 dni" icon="clock" accent={liq.coverage >= 0 ? 'sky' : 'loss'} value={<Money value={liq.coverage} />} hint="saldo − zobowiązania w 30 dni" />
        <StatCard label="Status" icon="building" accent="violet" value={biz.status === 'closed' ? 'zamknięta' : biz.closeOn ? 'w trakcie zamykania' : today < biz.startDate ? 'zarejestrowana' : isSuspendedOn(biz, today) ? 'zawieszona' : 'aktywna'} hint={`start ${formatDatePL(biz.startDate)}`} />
        <StatCard label="Forma opodatkowania" icon="shield" accent="gold" value={biz.taxForm === 'skala' ? 'Skala' : biz.taxForm === 'liniowy' ? 'Liniowy 19%' : `Ryczałt ${profile.ryczaltRateBps / 100}%`} hint={`PKD ${biz.pkd}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Tożsamość prawna">
          <dl className="divide-y divide-ink-700/60">
            <Row k="Właściciel" v={`${game.person.firstName} ${game.person.lastName}`} />
            <Row k="Osobowość prawna" v="brak — JDG to osoba fizyczna" />
            <Row k="Odpowiedzialność" v="cały majątek prywatny" tone="text-gold" />
            <Row k="Rachunek firmowy" v={acc.name} />
            <Row k="Zarejestrowano" v={formatDatePL(biz.registeredOn)} />
            {biz.closeOn && <Row k="Ostatni dzień działalności" v={formatDatePL(biz.closeOn)} tone="text-gold" />}
          </dl>
        </Card>

        <Card title="VAT i składki ZUS">
          <dl className="divide-y divide-ink-700/60">
            <Row k="Status VAT" v={biz.vat.status === 'active' ? `czynny podatnik${biz.vat.activeFrom ? ` od ${formatDateShortPL(biz.vat.activeFrom)}` : ''}` : 'zwolnienie podmiotowe'} />
            {biz.vat.status === 'exempt' && <Row k={`Sprzedaż ${year} / limit`} v={<span><Money value={salesYtd} round /> / <Money value={limit} round /></span>} />}
            {biz.vat.limitExceededOn && <Row k="Limit przekroczony" v={formatDatePL(biz.vat.limitExceededOn)} tone="text-loss" />}
            <Row k="Bieżący reżim ZUS" v={regime ? REGIME_LABEL[regime] : 'przed startem'} />
            <Row k="Wybór przy rejestracji" v={biz.zus.start === 'ulga' ? 'ulga na start' : biz.zus.start === 'preferencyjny' ? 'składki preferencyjne' : 'standard'} />
            <Row k="Chorobowa dobrowolna" v={biz.zus.sickness ? 'tak' : 'nie'} />
          </dl>
          {biz.vat.status === 'exempt' && <div className="mt-3"><ProgressBar value={salesYtd} max={limit} tone={salesYtd > limit * 0.8 ? 'loss' : 'gain'} /></div>}
          {carriedForward(year) && <p className="mt-3 text-xs text-gold">Przepisy zweryfikowano tylko dla 2026 r.; w {year} r. stosowane są te same wartości.</p>}
        </Card>
      </div>

      <Card title="Finansowanie działalności środkami właściciela">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
          <div className="inline-flex rounded-xl border border-ink-700 bg-ink-900/70 p-0.5" role="group" aria-label="Kierunek">
            {([['in', 'Wkład własny (prywatne → firma)'], ['out', 'Pobranie właściciela (firma → prywatne)']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={dir === v} onClick={() => setDir(v)} className={cx('rounded-lg px-3 py-1.5 text-xs font-medium', dir === v ? 'bg-ink-600 text-white' : 'text-slate-400')}>{l}</button>
            ))}
          </div>
          <div>
            <label htmlFor="bizamount" className="mb-1 block text-xs text-slate-400">Kwota (zł)</label>
            <input id="bizamount" value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" className="w-40 rounded-xl border border-ink-600 bg-ink-900/80 px-3 py-2 text-slate-100 focus:border-sky focus:outline-none" />
          </div>
          <Button type="submit" variant="primary" data-testid="biz-transfer">Przelej</Button>
        </form>
        <p className="mt-3 text-xs text-slate-500">Wkład i pobranie to przelewy między Twoimi rachunkami — nie są kosztem ani przychodem i nie zmieniają majątku netto. Składki, podatki i VAT są płacone z rachunku firmowego; brak środków = zaległość.</p>
      </Card>

      {biz.status === 'active' && !biz.closeOn && today >= biz.startDate && (
        <>
          <SuspensionCard />
          <TaxFormCard />
          <MalyZusCard />
        </>
      )}

      {biz.status === 'active' && !biz.closeOn && today >= biz.startDate && (
        <Card title="Zakończenie działalności">
          <p className="text-sm text-slate-400">Zakończenie następuje ostatniego dnia miesiąca, po zakończeniu trwających zleceń. Ostatnią zaliczkę i składki zapłacisz do 20. dnia następnego miesiąca, zeznanie roczne rozliczy podatek (do 30 kwietnia).</p>
          <Button variant="danger" className="mt-3" onClick={confirmClose} data-testid="close-business">Zakończ działalność</Button>
        </Card>
      )}
    </div>
  );
}

/* ---------- 3. Oferty i kontrakty ---------- */

export function BizOrdersScreen() {
  const { game, biz } = useBusiness();
  const accept = useGameStore((s) => s.acceptServiceOffer);
  const decline = useGameStore((s) => s.declineServiceOffer);
  const [hours, setHours] = useState<Record<string, number>>({});
  if (!biz) return <div className="space-y-5"><ScreenHeader title="Oferty i kontrakty" /><NoBusiness /></div>;
  const today = game.clock.today;
  const started = today >= biz.startDate;
  const open = game.serviceOffers.filter((o) => o.status === 'open' && o.expiresOn >= today);
  const orders = [...game.serviceOrders].sort((a, b) => b.acceptedOn.localeCompare(a.acceptedOn));
  const freeTomorrow = budgetFor(game, addDays(today, 1)).free;
  const freeWeekend = (() => {
    let d = addDays(today, 1);
    while (budgetFor(game, d).workday) d = addDays(d, 1);
    return budgetFor(game, d).free;
  })();

  return (
    <div className="space-y-5">
      <ScreenHeader title="Oferty i kontrakty" subtitle="Proste zlecenia usługowe. Realizacja zajmuje godziny z Twojego wspólnego budżetu czasu — nie nakłada się na etat." />
      <SimBanner />
      <Card title="Twój czas na zlecenia">
        <div className="flex flex-wrap gap-6 text-sm">
          <div><div className="text-xs text-slate-500">Wolne godziny — najbliższy dzień ({budgetFor(game, addDays(today, 1)).workday ? 'roboczy' : 'wolny'})</div><div data-testid="free-hours" className="text-xl font-semibold text-gain">{freeTomorrow} godz.</div></div>
          <div><div className="text-xs text-slate-500">Wolne godziny — najbliższy weekend</div><div className="text-xl font-semibold text-slate-100">{freeWeekend} godz.</div></div>
          <div className="max-w-md text-xs text-slate-500">Zlecenie rezerwuje wybraną liczbę godzin dziennie (także w weekendy) i musi się zmieścić w czasie wolnym każdego dnia do terminu. Zmęczenie obniża wydajność, więc praca trwa dłużej i grozi karą umowną.</div>
        </div>
      </Card>

      <Card title={`Dostępne oferty (${open.length})`}>
        {!started ? <Empty>Oferty pojawią się po starcie działalności ({formatDatePL(biz.startDate)}).</Empty> : open.length === 0 ? <Empty>Brak ofert. Nowe pojawiają się 1. i 16. dnia miesiąca (nie zawsze).</Empty> : (
          <div className="grid gap-3 lg:grid-cols-2" data-testid="offers-list">
            {open.map((o) => {
              const h = hours[o.id] ?? Math.min(4, Math.max(1, Math.ceil(o.hoursTotal / (o.deadlineDays - 1))));
              const days = Math.ceil(o.hoursTotal / h);
              const fits = days <= o.deadlineDays - 1;
              return (
                <div key={o.id} data-testid={`service-offer-${o.id}`} className="rounded-xl border border-ink-700 bg-ink-900/50 p-4">
                  <div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-slate-50">{o.title}</h3><div className="text-right"><div className="text-lg font-semibold text-gain"><Money value={o.netValue} round /></div><div className="text-xs text-slate-500">netto</div></div></div>
                  <div className="text-sm text-slate-400">{game.parties[o.clientId]?.name}</div>
                  <p className="mt-2 text-sm text-slate-300">{o.description}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 text-xs text-slate-400">
                    <div><dt className="text-slate-500">Wymagane godziny</dt><dd className="text-slate-200">{o.hoursTotal} godz.</dd></div>
                    <div><dt className="text-slate-500">Termin wykonania</dt><dd className="text-slate-200">{o.deadlineDays} dni od przyjęcia</dd></div>
                    <div><dt className="text-slate-500">Koszty realizacji (netto)</dt><dd className="text-slate-200"><Money value={o.costNet} round /></dd></div>
                    <div><dt className="text-slate-500">Termin płatności</dt><dd className="text-slate-200">{o.paymentTermDays} dni od wystawienia (klient bywa spóźniony)</dd></div>
                    <div><dt className="text-slate-500">Kara za opóźnienie</dt><dd className="text-slate-200">{o.latePenaltyBps / 100}% wartości</dd></div>
                    <div><dt className="text-slate-500">Oferta ważna do</dt><dd className="text-slate-200">{formatDatePL(o.expiresOn)}</dd></div>
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="text-xs text-slate-400">Godzin dziennie
                      <select value={h} onChange={(e) => setHours({ ...hours, [o.id]: Number(e.target.value) })} className="ml-2 rounded-lg border border-ink-600 bg-ink-900 px-2 py-1 text-sm text-slate-100" aria-label={`Godzin dziennie dla ${o.title}`}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <span className={cx('text-xs', fits ? 'text-slate-400' : 'text-loss')}>≈ {days} dni pracy{fits ? '' : ' — za długo na termin'}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="primary" onClick={() => accept(o.id, h)} data-testid={`accept-offer-${o.id}`}>Przyjmij zlecenie</Button>
                    <Button variant="secondary" onClick={() => decline(o.id)}>Odrzuć</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Zlecenia">
        {orders.length === 0 ? <Empty>Brak zleceń.</Empty> : (
          <ul className="space-y-3" data-testid="orders-list">
            {orders.map((o) => {
              const done = Math.min(100, Math.round(o.progressCentiHours / o.hoursTotal));
              return (
                <li key={o.id} className="rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><div className="font-medium text-slate-100">{o.title}</div><div className="text-xs text-slate-500">{game.parties[o.clientId]?.name} · <Money value={o.netValue} round /> netto · termin {formatDatePL(o.deadline)} · {o.hoursPerDay} godz./dzień</div></div>
                    <Badge tone={o.status === 'in_progress' ? 'sky' : o.status === 'completed' ? (o.late ? 'gold' : 'gain') : 'loss'}>{o.status === 'in_progress' ? 'w realizacji' : o.status === 'completed' ? (o.late ? 'wykonane z opóźnieniem' : 'wykonane') : 'niewykonane'}</Badge>
                  </div>
                  {o.status === 'in_progress' && <div className="mt-2"><div className="mb-1 flex justify-between text-xs text-slate-400"><span>Postęp pracy</span><span className="tabular">{done}%</span></div><ProgressBar value={done} max={100} tone={today > o.deadline ? 'loss' : 'gain'} /></div>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- 4. Finanse firmy ---------- */

export function BizFinanceScreen() {
  const { game, biz } = useBusiness();
  const summaries = businessSummaries(game);
  if (!biz && game.businesses.length === 0) return <div className="space-y-5"><ScreenHeader title="Finanse firmy" /><NoBusiness /></div>;
  const liq = businessLiquidity(game, 30);
  const open = game.obligations.filter((o) => o.scope === 'business' && o.status === 'open');
  const receivables = open.filter((o) => o.direction === 'receivable' && !VAT_PASS_THROUGH.has(o.category)).reduce((a, o) => a + o.amount, 0);
  const payables = open.filter((o) => o.direction === 'payable').reduce((a, o) => a + o.amount, 0);
  const total = summaries.reduce((a, m) => ({ revenue: a.revenue + m.revenue, costs: a.costs + m.costs, zus: a.zus + m.zus, pit: a.pit + m.pit, result: a.result + m.result }), { revenue: 0, costs: 0, zus: 0, pit: 0, result: 0 });
  return (
    <div className="space-y-5">
      <ScreenHeader title="Finanse firmy" subtitle="Odrębna ewidencja działalności: przychody, koszty, należności, zobowiązania i płynność. VAT jest przepływem przelotowym." />
      <SimBanner />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Rachunek firmowy" icon="wallet" accent="gain" value={<Money value={businessBalance(game)} />} hint="dostępne środki" />
        <StatCard label="Należności (bez VAT)" icon="briefcase" accent="gold" value={<Money value={receivables} />} hint="oczekiwane wpłaty od klientów" />
        <StatCard label="Zobowiązania" icon="home" accent="loss" value={<Money value={payables} />} hint="koszty, ZUS, podatki, VAT" />
        <StatCard label="Płynność 30 dni" icon="clock" accent={liq.coverage >= 0 ? 'sky' : 'loss'} value={<Money value={liq.coverage} />} hint={`wymagalne zobowiązania ${formatPLN(liq.payablesDue, { round: true })}`} />
      </div>
      <Card title="Wynik finansowy (od początku działalności)">
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <div className="divide-y divide-ink-700/60">
            <Row k="Przychody netto" v={<Money value={total.revenue} />} tone="text-gain" />
            <Row k="Koszty działalności" v={<Money value={total.costs} />} tone="text-loss" />
            <Row k="Dochód przed składkami i podatkiem" v={<Money value={total.revenue - total.costs} />} />
          </div>
          <div className="divide-y divide-ink-700/60">
            <Row k="Składki ZUS (społeczne + zdrowotna)" v={<Money value={total.zus} />} tone="text-loss" />
            <Row k="Podatek dochodowy (zaliczki i rozliczenie)" v={<Money value={total.pit} />} tone="text-loss" />
            <Row k="Wynik po składkach i podatku" v={<Money value={total.result} signed />} tone={`font-semibold ${moneyTone(total.result)}`} />
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Wynik memoriałowy (wg dat wystawienia dokumentów); gotówka wpływa później — przychód ≠ wpływ pieniędzy.</p>
      </Card>
      <Card title="Przychody i koszty miesięcznie">
        {summaries.length === 0 ? <Empty>Brak danych — działalność jeszcze nie ruszyła.</Empty> : <BarChart groups={summaries.slice(-12).map((m) => ({ label: m.month.slice(5) + '/' + m.month.slice(2, 4), a: Math.max(0, m.revenue), b: m.costs + m.zus + m.pit }))} aLabel="Przychody netto" bLabel="Koszty, ZUS i podatek" ariaLabel="Przychody i koszty działalności" />}
      </Card>
      <Card title="Podsumowanie miesięczne">
        {summaries.length === 0 ? <Empty>Brak danych.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="biz-summary">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Miesiąc</th><th className="pb-2 text-right font-medium">Przychód</th><th className="pb-2 text-right font-medium">Koszty</th><th className="pb-2 text-right font-medium">ZUS</th><th className="pb-2 text-right font-medium">PIT</th><th className="pb-2 text-right font-medium">Wynik</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {[...summaries].reverse().map((m) => (
                  <tr key={m.month}><td className="py-2 text-slate-300">{formatMonthPL(m.month)}</td><td className="py-2 text-right text-gain"><Money value={m.revenue} /></td><td className="py-2 text-right"><Money value={m.costs} /></td><td className="py-2 text-right"><Money value={m.zus} /></td><td className="py-2 text-right"><Money value={m.pit} /></td><td className={`py-2 text-right font-medium ${moneyTone(m.result)}`}><Money value={m.result} signed /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- 5. Podatki i ZUS ---------- */

export function BizTaxScreen() {
  const { game } = useBusiness();
  const periods = [...game.taxPeriods].reverse();
  const used = new Set(game.taxPeriods.flatMap((p) => p.ruleIds));
  const [showAll, setShowAll] = useState(false);
  const rules = LEGAL_RULES.filter((r) => showAll || used.has(r.id) || r.status === 'DEFERRED');
  const anyCarried = game.taxPeriods.some((p) => p.carriedForward);
  if (game.businesses.length === 0) return <div className="space-y-5"><ScreenHeader title="Podatki i ZUS" /><NoBusiness /></div>;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Podatki i ZUS" subtitle="Miesięczne rozliczenia: składki społeczne, składka zdrowotna i zaliczka PIT — z wyszczególnieniem zastosowanych reguł prawnych." />
      <SimBanner />
      {anyCarried && <div role="alert" className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm text-gold">Rozliczenia za 2027 r. i później używają wartości zweryfikowanych dla 2026 r. — w rzeczywistości stawki, limity i kwoty mogą się zmienić.</div>}
      <Card title="Rozliczenia miesięczne">
        {periods.length === 0 ? <Empty>Pierwsze rozliczenie powstanie ostatniego dnia pierwszego miesiąca działalności.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm" data-testid="tax-periods">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Miesiąc</th><th className="pb-2 font-medium">Składki społeczne</th><th className="pb-2 text-right font-medium">Społeczne</th><th className="pb-2 text-right font-medium">Zdrowotna</th><th className="pb-2 text-right font-medium">Przychód narastająco</th><th className="pb-2 text-right font-medium">Podatek narastająco</th><th className="pb-2 text-right font-medium">Zaliczka PIT</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {periods.map((p) => (
                  <tr key={`${p.businessId}-${p.month}`} title={`Reguły: ${p.ruleIds.join(', ')}`}>
                    <td className="py-2 text-slate-300">{formatMonthPL(p.month)}</td>
                    <td className="py-2 text-slate-400">{REGIME_LABEL[p.zusRegime]}</td>
                    <td className="py-2 text-right"><Money value={p.social} /></td>
                    <td className="py-2 text-right"><Money value={p.health} /></td>
                    <td className="py-2 text-right text-slate-400"><Money value={p.cumulativeRevenue} /></td>
                    <td className="py-2 text-right text-slate-400"><Money value={p.taxCumulative} /></td>
                    <td className="py-2 text-right">{p.advanceSkipped ? <Badge tone="gold">≤ 1 000 zł — niewpłacana</Badge> : <Money value={p.advance} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Termin: składki i zaliczka do 20. dnia następnego miesiąca. Odliczane są tylko zapłacone składki. Rozliczenie roczne (saldo do 30 kwietnia) powstaje po zamknięciu grudnia.</p>
      </Card>
      <Card title="Reguły prawne" action={<Button variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Tylko użyte i odłożone' : 'Pokaż wszystkie'}</Button>}>
        <ul className="divide-y divide-ink-700/60" data-testid="legal-rules">
          {rules.map((r) => (
            <li key={r.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge><span className="font-mono text-xs text-slate-500">{r.id}</span><span className="text-slate-200">{r.title}</span></div>
              <div className="mt-0.5 text-xs text-slate-500">{r.note} <a href={r.source} target="_blank" rel="noreferrer" className="text-sky hover:underline">źródło</a> · zweryfikowano {formatDatePL(r.verifiedOn)}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ---------- 6. Dokumenty ---------- */

export function BizDocsScreen() {
  const { game } = useBusiness();
  const [filter, setFilter] = useState<'all' | 'sales' | 'cost'>('all');
  if (game.businesses.length === 0) return <div className="space-y-5"><ScreenHeader title="Dokumenty" /><NoBusiness /></div>;
  const docs = [...game.documents].filter((d) => filter === 'all' || d.kind === filter).reverse();
  const oblById = new Map(game.obligations.map((o) => [o.id, o]));
  const statusOf = (id: string) => {
    const obs = (game.documents.find((d) => d.id === id)?.obligationIds ?? []).map((x) => oblById.get(x)!).filter(Boolean);
    const main = obs[0];
    if (!main) return { label: '—', tone: 'neutral' as const, paid: null as string | null };
    if (main.status === 'settled') return { label: main.settledDate && main.settledDate > (game.documents.find((d) => d.id === id)?.termDate ?? '') ? 'zapłacone po terminie' : 'zapłacone', tone: 'gain' as const, paid: main.settledDate };
    if (main.overdueSince) return { label: 'zaległe (brak środków)', tone: 'loss' as const, paid: null };
    const doc = game.documents.find((d) => d.id === id)!;
    return { label: main.dueDate > doc.termDate && game.clock.today > doc.termDate ? 'klient spóźnia się' : 'oczekuje', tone: 'sky' as const, paid: null };
  };
  return (
    <div className="space-y-5">
      <ScreenHeader title="Dokumenty" subtitle="Rejestr dokumentów sprzedażowych i kosztowych (rekordy symulacyjne — nie faktury KSeF).">
        <div role="group" aria-label="Filtr dokumentów" className="inline-flex rounded-xl border border-ink-700 bg-ink-900/70 p-0.5">
          {([['all', 'Wszystkie'], ['sales', 'Sprzedaż'], ['cost', 'Koszty']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={cx('rounded-lg px-3 py-1 text-xs font-medium', filter === v ? 'bg-ink-600 text-white' : 'text-slate-400')}>{l}</button>)}
        </div>
      </ScreenHeader>
      <SimBanner />
      <Card>
        {docs.length === 0 ? <Empty>Brak dokumentów. Powstają przy przyjęciu i wykonaniu zleceń.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm" data-testid="documents">
              <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><th className="pb-2 font-medium">Numer</th><th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Kontrahent / opis</th><th className="pb-2 text-right font-medium">Netto</th><th className="pb-2 text-right font-medium">VAT</th><th className="pb-2 text-right font-medium">Brutto</th><th className="pb-2 font-medium">Termin</th><th className="pb-2 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-ink-700/60">
                {docs.map((d) => {
                  const st = statusOf(d.id);
                  return (
                    <tr key={d.id}>
                      <td className="py-2 pr-3 font-mono text-xs text-slate-300 whitespace-nowrap">{d.number}</td>
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{formatDateShortPL(d.issueDate)}</td>
                      <td className="py-2 pr-3"><div className="text-slate-100">{game.parties[d.counterpartyId]?.name ?? d.counterpartyId}</div><div className="text-xs text-slate-500">{d.description}</div></td>
                      <td className="py-2 pr-3 text-right"><Money value={d.net} /></td>
                      <td className="py-2 pr-3 text-right text-slate-400">{d.vatTreatment === 'exempt' ? 'zw.' : <Money value={d.vat} />}</td>
                      <td className="py-2 pr-3 text-right"><Money value={d.gross} /></td>
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{formatDateShortPL(d.termDate)}</td>
                      <td className="py-2"><Badge tone={st.tone}>{st.label}{st.paid ? ` ${formatDateShortPL(st.paid)}` : ''}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- 7. Kalendarz obowiązków ---------- */

const DUTY_LABEL: Record<string, string> = {
  [BUSINESS_CATEGORIES.social]: 'Składki społeczne ZUS',
  [BUSINESS_CATEGORIES.health]: 'Składka zdrowotna',
  [BUSINESS_CATEGORIES.pit]: 'Zaliczka PIT',
  [BUSINESS_CATEGORIES.pitAnnual]: 'Rozliczenie roczne PIT',
  [BUSINESS_CATEGORIES.vatDue]: 'VAT należny',
  [BUSINESS_CATEGORIES.cost]: 'Płatność za koszt',
};

export function BizCalendarScreen() {
  const { game, biz } = useBusiness();
  if (game.businesses.length === 0) return <div className="space-y-5"><ScreenHeader title="Kalendarz obowiązków" /><NoBusiness /></div>;
  const today = game.clock.today;
  const open = game.obligations
    .filter((o) => o.scope === 'business' && o.status === 'open')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const orders = game.serviceOrders.filter((o) => o.status === 'in_progress').sort((a, b) => a.deadline.localeCompare(b.deadline));
  const acc = biz ? game.accounts[biz.accountId]! : null;
  let running = acc?.balance ?? 0;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Kalendarz obowiązków" subtitle="Terminy płatności firmy według dat wymagalności; saldo narastająco pokazuje, czy rachunek firmowy je udźwignie (bez nowych wpływów)." />
      <SimBanner />
      <Card title="Terminy płatności">
        {open.length === 0 ? <Empty>Brak otwartych zobowiązań firmy.</Empty> : (
          <ul className="divide-y divide-ink-700/60" data-testid="duties">
            {open.map((o) => {
              if (o.direction === 'payable') running -= o.amount;
              else running += o.amount;
              const overdue = o.overdueSince !== null || o.dueDate < today;
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <div><div className="text-slate-100">{o.direction === 'receivable' ? 'Wpływ: ' : ''}{DUTY_LABEL[o.category] ?? categoryInfo(o.category).label} <span className="text-slate-500">— {o.description}</span></div><div className="text-xs text-slate-500">{game.parties[o.counterpartyId]?.name}</div></div>
                  <div className="flex items-center gap-3">
                    <span className={cx('text-xs', overdue ? 'text-loss' : 'text-slate-400')}>{formatDatePL(o.dueDate)}{overdue ? ' · po terminie' : ''}</span>
                    <span className={cx('tabular font-medium', o.direction === 'receivable' ? 'text-gain' : 'text-loss')}><Money value={o.direction === 'receivable' ? o.amount : -o.amount} signed /></span>
                    <span className={cx('tabular text-xs', running < 0 ? 'text-loss' : 'text-slate-500')} title="Saldo rachunku firmowego po tej pozycji (bez nowych wpływów)">saldo <Money value={running} round /></span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Terminy zleceń">
          {orders.length === 0 ? <Empty>Brak zleceń w realizacji.</Empty> : <ul className="divide-y divide-ink-700/60 text-sm">{orders.map((o) => <li key={o.id} className="flex justify-between gap-3 py-2"><span className="text-slate-100">{o.title}</span><span className={today > o.deadline ? 'text-loss' : 'text-slate-400'}>{formatDatePL(o.deadline)}</span></li>)}</ul>}
        </Card>
        <Card title="Stałe obowiązki">
          <ul className="space-y-1.5 text-sm text-slate-300">
            <li>Ostatniego dnia miesiąca: rozliczenie składek, zdrowotnej i zaliczki PIT.</li>
            <li>Do 20. dnia następnego miesiąca: zapłata ZUS i zaliczki PIT <LegalBadge id="PIT-ADVANCE-DEADLINE" /></li>
            {biz?.vat.status === 'active' && <li>Do 25. dnia następnego miesiąca: VAT <LegalBadge id="VAT-SETTLEMENT-DEADLINE" /></li>}
            <li>Do 30 kwietnia: rozliczenie roczne PIT <LegalBadge id="PIT-ANNUAL-DEADLINE" /></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
