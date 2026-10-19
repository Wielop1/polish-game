import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { commands } from '../../engine/commands.ts';
import { PROFILE_BY_ID } from '../../engine/businessCatalog.ts';
import { activeBoard, agreementPreview, validateDraft } from '../../engine/company.ts';
import { companyBalance } from '../../engine/companyFinance.ts';
import { CORP, REPRESENTATION_LABELS } from '../../engine/corpConfig.ts';
import { formatDatePL } from '../../engine/date.ts';
import { formatPLN, mulBps, zl } from '../../engine/money.ts';
import { companyFullName, listOperators } from '../../engine/operator.ts';
import { holderName } from '../../engine/partners.ts';
import { SERVICES } from '../../engine/renovationCatalog.ts';
import { activeHoldings, capitalBps, holdingCost, holdingValue, voteBps } from '../../engine/shares.ts';
import { STATUS_LABEL as NEG_STATUS_LABEL, subscriptionTerms } from '../../engine/negotiation.ts';
import { businessSummaries } from '../../engine/selectors.ts';
import type { Company } from '../../engine/state.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { Badge, Button, Card, Empty, Money, ScreenHeader, StatCard, cx } from '../components/ui.tsx';
import { LegalBadge } from './BusinessScreens.tsx';
import { CompanyPicker, CorpBanner, Field, NoCompany, Row, STATUS_LABEL, STATUS_TONE, Th, inputCls, pct, useCorp } from './CorpCommon.tsx';

/* ---------- 1. Moje spółki ---------- */

function CompanyCard({ c }: { c: Company }) {
  const { game, run } = useCorp();
  const navigate = useGameStore((s) => s.navigate);
  const [vat, setVat] = useState<'exempt' | 'active'>(c.vatPlan);
  const bal = c.status === 'registered' ? companyBalance(game, c) : null;
  const mine = capitalBps(game, c.id, game.person.id);
  const myVotes = voteBps(game, c.id, game.person.id);
  const onBoard = activeBoard(c).some((m) => m.personId === game.person.id);
  const pendingRes = game.corp.resolutions.filter((r) => r.companyId === c.id && r.status === 'scheduled');
  const needVote = pendingRes.filter((r) => !r.votes.some((v) => v.holderId === game.person.id)).length;
  const pendingNeg = game.corp.negotiations.filter((n) => n.companyId === c.id && n.status === 'countered').length;
  const selected = game.corp.selected === c.id;
  const warn: string[] = [];
  if (bal && bal.overduePayables > 0) warn.push(`zaległe zobowiązania ${formatPLN(bal.overduePayables, { round: true })} — członkowie zarządu ryzykują odpowiedzialność (art. 299 KSH)`);
  if (bal && c.monthly.length >= 3 && bal.netAssets < c.capital / 2) warn.push('strata ponad połowę kapitału zakładowego (art. 233 KSH)');
  if (!onBoard && c.status !== 'draft') warn.push('nie jesteś członkiem zarządu — nie możesz prowadzić spraw spółki ani jej reprezentować');
  const isSole = activeHoldings(game, c.id).length === 1 && activeHoldings(game, c.id)[0]!.holderId === game.person.id;
  return (
    <Card
      title={<span>{companyFullName(c)} <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge></span>}
      action={c.status === 'registered' && c.operation ? <Button variant={selected ? 'secondary' : 'primary'} disabled={selected} onClick={() => run((g) => commands.selectOperator(g, c.id))} data-testid={`select-op-${c.id}`}>{selected ? 'Aktywny podmiot' : 'Zarządzaj działalnością'}</Button> : undefined}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid={`company-${c.id}`}>
        <StatCard label="Gotówka spółki" icon="wallet" accent="gain" value={<Money value={bal?.cash ?? game.accounts[c.accountId]!.balance} round />} hint="odrębny rachunek — nie Twoja gotówka" />
        <StatCard label="Aktywa netto" icon="coins" accent="sky" value={bal ? <Money value={bal.netAssets} round /> : '—'} hint={`kapitał zakładowy ${formatPLN(c.capital, { round: true })}`} />
        <StatCard label="Wycena spółki" icon="trend" accent="violet" value={c.valuation ? <Money value={c.valuation.estimate} round /> : '—'} hint={c.valuation ? `szacunek ${formatPLN(c.valuation.low, { round: true })}–${formatPLN(c.valuation.high, { round: true })}` : 'po rejestracji'} />
        <StatCard label="Twoje udziały" icon="user" accent="gold" value={`${pct(mine)} kapitału`} hint={`${pct(myVotes)} głosów · ${onBoard ? 'zarząd' : 'poza zarządem'}`} />
      </div>
      <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
        <Row k="KRS" v={c.krsNumber ? `${c.krsNumber} (symulowany)` : c.status === 'organizing' ? (c.decisionOn ? `wniosek złożony, wpis do ${formatDatePL(c.decisionOn)}` : 'wniosek niezłożony') : '—'} />
        <Row k="Reprezentacja" v={REPRESENTATION_LABELS[c.representation]} />
        <Row k="Zobowiązania" v={bal ? <Money value={bal.liabilities} round /> : '—'} />
        <Row k="Wynik 12 mies. (szacunek)" v={c.valuation ? <Money value={c.valuation.profit12} round signed /> : '—'} tone={c.valuation && c.valuation.profit12 < 0 ? 'text-loss' : undefined} />
        <Row k="Decyzje oczekujące" v={`${pendingRes.length} uchwał (do Twojego głosu: ${needVote}) · ${pendingNeg} kontroferty`} />
        <Row k="Działalność" v={c.operation ? `od ${formatDatePL(c.operation.startDate)} · VAT: ${c.operation.vat.status === 'exempt' ? 'zwolnienie' : 'czynny'}` : c.status === 'registered' ? 'nieuruchomiona' : 'po wpisie do KRS'} />
      </dl>
      {isSole && c.status === 'registered' && (
        <p className="mt-2 rounded-lg border border-sky/30 bg-sky/5 p-2 text-xs text-sky">Jesteś jedynym wspólnikiem: z mocy ustawy podlegasz ubezpieczeniom jak przedsiębiorca — składki społeczne (standardowe, bez ulgi na start) i zdrowotna 830,58 zł miesięcznie, niezależnie od działalności spółki. <LegalBadge id="CO-ZUS-SOLE" /></p>
      )}
      {warn.map((w) => <p key={w} className="mt-2 rounded-lg border border-loss/30 bg-loss/5 p-2 text-xs text-loss">⚠ {w}</p>)}
      {c.status === 'registered' && !c.operation && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-ink-600 p-3" data-testid={`start-op-${c.id}`}>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-200">Uruchom działalność remontową spółki</div>
            <div className="flex gap-2 text-sm">
              <label className="flex items-center gap-1.5"><input type="radio" name={`vat-${c.id}`} checked={vat === 'exempt'} onChange={() => setVat('exempt')} className="accent-sky" />VAT: zwolnienie podmiotowe</label>
              <label className="flex items-center gap-1.5"><input type="radio" name={`vat-${c.id}`} checked={vat === 'active'} onChange={() => setVat('active')} className="accent-sky" />czynny podatnik</label>
            </div>
            <p className="mt-1 text-xs text-slate-500">Nie przenosimy automatycznie niczego z Twojej JDG: pracownicy, sprzęt, pieniądze, reputacja i kontrakty zostają tam, gdzie są. <LegalBadge id="CO-APORT" /></p>
          </div>
          <Button variant="primary" onClick={() => run((g) => commands.startCompanyOperation(g, c.id, { vat }))} data-testid={`start-op-btn-${c.id}`}>Uruchom działalność</Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => navigate('corpShares')}>Udziały i kapitał</Button>
        <Button onClick={() => navigate('corpResolutions')}>Uchwały</Button>
        <Button onClick={() => navigate('corpFinance')}>Finanse i CIT</Button>
      </div>
    </Card>
  );
}

export function CorpCompaniesScreen() {
  const { game } = useCorp();
  const list = game.corp.companies.filter((c) => c.status !== 'draft' && c.status !== 'closed');
  const drafts = game.corp.companies.filter((c) => c.status === 'draft');
  const navigate = useGameStore((s) => s.navigate);
  const ops = listOperators(game);
  const nw = useMemo(() => businessSummaries(game).slice(-12).reduce((a, m) => a + m.result, 0), [game]);
  return (
    <div className="space-y-5">
      <ScreenHeader title="Moje spółki" subtitle="Spółki z o.o. jako odrębne podmioty prawne — obok Twojej JDG (która nadal jest działalnością osoby fizycznej).">
        <Button variant="primary" onClick={() => navigate('corpFound')}>Załóż spółkę</Button>
      </ScreenHeader>
      <CorpBanner />
      {list.length === 0 && drafts.length === 0 ? <NoCompany /> : null}
      {drafts.map((d) => (
        <Card key={d.id} title={<span>{d.name} sp. z o.o. <Badge tone="neutral">szkic</Badge></span>}>
          <p className="text-sm text-slate-300">Kapitał {formatPLN(d.capital, { round: true })}. Zaproś wspólników (opcjonalnie) i zawrzyj umowę spółki. <Button className="ml-2" onClick={() => navigate('corpFound')}>Kontynuuj</Button></p>
        </Card>
      ))}
      {list.map((c) => <CompanyCard key={c.id} c={c} />)}
      {(list.some((c) => c.operation) || game.businesses.some((b) => b.status === 'active')) && (
        <Card title="Wyniki obu działalności (JDG i spółki) — osobno, bez mieszania majątku">
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm" data-testid="entity-compare">
            <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><Th>Podmiot</Th><Th right>Gotówka</Th><Th right>Zobowiązania</Th><Th right>Wynik 12 mies.</Th><Th>Rodzaj</Th></tr></thead>
            <tbody className="divide-y divide-ink-700/60">
              {game.businesses.filter((b) => b.status === 'active').map((b) => (
                <tr key={b.id}><td className="py-2 text-slate-100">JDG: {b.name}</td><td className="py-2 text-right"><Money value={game.accounts[b.accountId]!.balance} round /></td><td className="py-2 text-right text-slate-400">—</td><td className="py-2 text-right"><Money value={nw} round signed /></td><td className="py-2 text-slate-400">osoba fizyczna (nie osoba prawna)</td></tr>
              ))}
              {list.filter((c) => c.operation).map((c) => {
                const b = companyBalance(game, c);
                return <tr key={c.id}><td className="py-2 text-slate-100">{companyFullName(c)}</td><td className="py-2 text-right"><Money value={b.cash} round /></td><td className="py-2 text-right"><Money value={b.liabilities} round /></td><td className="py-2 text-right"><Money value={c.valuation?.profit12 ?? 0} round signed /></td><td className="py-2 text-slate-400">osoba prawna</td></tr>;
              })}
            </tbody>
          </table></div>
          <p className="mt-2 text-xs text-slate-500">Aktywny podmiot przy zarządzaniu zleceniami, pracownikami i rynkiem: <strong>{ops.find((o) => o.id === game.corp.selected)?.label ?? 'JDG'}</strong> (przełącznik nad ekranami „Zlecenia”, „Ludzie”, „Rynek”).</p>
        </Card>
      )}
    </div>
  );
}

/* ---------- 2. Załóż spółkę ---------- */

export function CorpFoundScreen() {
  const { game, run } = useCorp();
  const navigate = useGameStore((s) => s.navigate);
  const draft = game.corp.companies.find((c) => c.status === 'draft') ?? null;
  const organizing = game.corp.companies.filter((c) => c.status === 'organizing');
  const [name, setName] = useState('Remonty Olsztyn');
  const [spec, setSpec] = useState(SERVICES[0]!.id);
  const [vat, setVat] = useState<'exempt' | 'active'>('exempt');
  const [capital, setCapital] = useState(5000);
  const [nominal, setNominal] = useState(50);
  const [rep, setRep] = useState<Company['representation']>('each_alone');
  const input = { name, cityId: game.person.cityId, profileId: 'remonty', specialization: spec, vatPlan: vat, capital: zl(capital), nominal: zl(nominal), representation: rep };
  const error = validateDraft(game, input);
  const pccPreview = mulBps(Math.max(0, zl(capital) - CORP.courtFeeRegistration), CORP.pccCompanyBps);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!error) run((g) => commands.createCompanyDraft(g, input)); };

  return (
    <div className="space-y-5">
      <ScreenHeader title="Załóż spółkę z o.o." subtitle="Umowa spółki przez internetowy wzorzec S24 (wkłady wyłącznie pieniężne) → spółka w organizacji → wniosek do KRS → wpis." />
      <CorpBanner />
      {organizing.map((c) => (
        <Card key={c.id} title={<span>{companyFullName(c)} <Badge tone="gold">w organizacji</Badge></span>} >
          <ol className="space-y-1 text-sm text-slate-300" data-testid={`org-steps-${c.id}`}>
            <li>✔ Umowa spółki zawarta {c.agreementOn ? formatDatePL(c.agreementOn) : ''}; kapitał {formatPLN(c.capital, { round: true })} wpłacony w całości; zarząd powołany.</li>
            <li>{c.filedOn ? '✔' : '○'} Wniosek o wpis do KRS {c.filedOn ? `złożony ${formatDatePL(c.filedOn)} (opłata 250 zł, bez opłaty za ogłoszenie w MSiG)` : 'niezłożony'}.</li>
            <li>○ Wpis do KRS {c.decisionOn ? `— sąd rozpozna wniosek do ${formatDatePL(c.decisionOn)}` : ''} (dopiero wtedy spółka istnieje jako osoba prawna).</li>
          </ol>
          {!c.filedOn && <Button className="mt-3" variant="primary" onClick={() => run((g) => commands.fileForRegistration(g, c.id))}>Złóż wniosek o wpis do KRS</Button>}
          <p className="mt-2 text-xs text-slate-500">Do czasu wpisu spółka nie prowadzi działalności. PCC 0,5% od umowy spółki płaci spółka (14 dni). <LegalBadge id="CO-KRS-FEES" /> <LegalBadge id="CO-PCC-COMPANY" /></p>
        </Card>
      ))}
      {!draft ? (
        <form onSubmit={submit} className="grid gap-5 lg:grid-cols-5" noValidate>
          <div className="space-y-5 lg:col-span-3">
            <Card title="1. Nazwa, siedziba i zakres działalności">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nazwa spółki (bez „sp. z o.o.”)" id="co-name"><input id="co-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className={inputCls} /></Field>
                <Field label="Siedziba" id="co-seat"><input id="co-seat" value="Olsztyn" disabled className={inputCls} /></Field>
              </div>
              <fieldset className="mt-4"><legend className="mb-2 text-sm font-medium text-slate-200">Zakres działalności: usługi remontowo-wykończeniowe (PKD {PROFILE_BY_ID.get('remonty')!.pkd}) — pierwsza specjalizacja</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {SERVICES.map((d) => (
                    <label key={d.id} className={cx('cursor-pointer rounded-xl border p-3 text-sm', spec === d.id ? 'border-sky bg-sky/10' : 'border-ink-600 hover:border-ink-500')}>
                      <input type="radio" name="spec" className="sr-only" checked={spec === d.id} onChange={() => setSpec(d.id)} />
                      <div className="font-medium text-slate-100">{d.label}</div>
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>
            <Card title="2. Kapitał zakładowy i udziały">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kapitał zakładowy (zł)" id="co-cap" hint={<>Minimum 5 000 zł. <LegalBadge id="CO-KSH-CAPITAL" /></>}><input id="co-cap" type="number" min={5000} step={50} value={capital} onChange={(e) => setCapital(Number(e.target.value))} className={inputCls} /></Field>
                <Field label="Wartość nominalna udziału (zł)" id="co-nom" hint="Co najmniej 50 zł; udziały równej wartości."><input id="co-nom" type="number" min={50} step={10} value={nominal} onChange={(e) => setNominal(Number(e.target.value))} className={inputCls} /></Field>
              </div>
              <p className="mt-3 text-sm text-slate-300" data-testid="found-shares">Liczba udziałów: <strong>{nominal > 0 && capital % nominal === 0 ? capital / nominal : '—'}</strong>. Wkłady: tylko pieniężne (aporty — odłożone). Środki na wkład pochodzą z Twojego rachunku osobistego (dostępne: <Money value={game.accounts[game.playerAccountId]!.balance} round />).</p>
            </Card>
            <Card title="3. Reprezentacja i VAT">
              <div className="grid gap-2">
                {(Object.keys(REPRESENTATION_LABELS) as Company['representation'][]).map((k) => (
                  <label key={k} className={cx('cursor-pointer rounded-xl border p-3 text-sm', rep === k ? 'border-sky bg-sky/10' : 'border-ink-600 hover:border-ink-500')}>
                    <input type="radio" name="rep" className="sr-only" checked={rep === k} onChange={() => setRep(k)} />
                    <span className="font-medium text-slate-100">{REPRESENTATION_LABELS[k]}</span>
                  </label>
                ))}
                <p className="text-xs text-slate-500">Przy zarządzie jednoosobowym zarządca działa sam. Czynności wiążące spółkę (kontrakt, zatrudnienie, zakup) przy reprezentacji łącznej wymagają podpisu współzarządcy. <LegalBadge id="CO-KSH-REPRESENT" /></p>
              </div>
              <div className="mt-4 flex gap-4 text-sm text-slate-300">
                <label className="flex items-center gap-1.5"><input type="radio" name="vat" checked={vat === 'exempt'} onChange={() => setVat('exempt')} className="accent-sky" />VAT: zwolnienie podmiotowe</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="vat" checked={vat === 'active'} onChange={() => setVat('active')} className="accent-sky" />czynny podatnik VAT</label>
              </div>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card title="Koszty i skutki" className="lg:sticky lg:top-24">
              <dl data-testid="found-costs">
                <Row k="Opłata sądowa (S24)" v={formatPLN(CORP.courtFeeRegistration)} />
                <Row k="Ogłoszenie w MSiG" v="brak (od 29.11.2025)" />
                <Row k="PCC 0,5% (płaci spółka)" v={formatPLN(pccPreview)} />
                <Row k="Kapitał do wpłaty" v={formatPLN(zl(capital))} />
              </dl>
              {error ? <p role="alert" className="mt-3 text-sm text-loss" data-testid="found-error">{error}</p> : <p className="mt-3 text-xs text-gain">Parametry spełniają wymogi art. 154 KSH.</p>}
              <Button type="submit" variant="primary" className="mt-3 w-full" disabled={!!error} data-testid="found-draft-btn">Utwórz szkic spółki</Button>
            </Card>
          </div>
        </form>
      ) : (
        <DraftCard c={draft} onPartners={() => navigate('corpPartners')} />
      )}
    </div>
  );
}

function DraftCard({ c, onPartners }: { c: Company; onPartners: () => void }) {
  const { game, run } = useCorp();
  const pv = agreementPreview(game, c.id);
  const negs = game.corp.negotiations.filter((n) => n.companyId === c.id && n.kind === 'found');
  const founders = [{ personId: game.person.id }, ...negs.filter((n) => n.status === 'agreed').map((n) => ({ personId: n.partnerId }))];
  const [board, setBoard] = useState<string[]>([game.person.id]);
  const [president, setPresident] = useState<string>(game.person.id);
  const toggle = (id: string) => setBoard((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));
  const members = board.filter((id) => founders.some((f) => f.personId === id));
  return (
    <div className="space-y-5">
      <Card title={<span>{c.name} sp. z o.o. <Badge>szkic</Badge></span>} action={<Button variant="danger" onClick={() => run((g) => commands.deleteCompanyDraft(g, c.id))}>Usuń szkic</Button>}>
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <Row k="Kapitał zakładowy" v={`${formatPLN(c.capital, { round: true })} (${c.shareCount} udz. po ${formatPLN(c.nominal, { round: true })})`} />
          <Row k="Reprezentacja" v={REPRESENTATION_LABELS[c.representation]} />
          <Row k="Twój wkład (reszta udziałów)" v={`${pv.playerShares} udz. = ${formatPLN(pv.playerShares * c.nominal, { round: true })}`} />
          <Row k="PCC 0,5% od umowy (płaci spółka)" v={formatPLN(pv.pcc)} />
        </dl>
      </Card>
      <Card title="Wspólnicy zakładający spółkę" action={<Button onClick={onPartners}>Zaproś wspólnika</Button>}>
        {negs.length === 0 ? <Empty>Zakładasz spółkę jednoosobowo. Wspólników możesz zaprosić na ekranie „Wspólnicy”.</Empty> : (
          <ul className="space-y-2 text-sm" data-testid="draft-negotiations">
            {negs.map((n) => (
              <li key={n.id} className="rounded-xl border border-ink-600 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-100">{holderName(game, n.partnerId)} — {n.terms.shares} udz. ({pct(Math.round((n.terms.shares * 10_000) / c.shareCount))}), wkład {formatPLN(n.terms.shares * c.nominal, { round: true })}{n.terms.role !== 'none' ? ', zarząd' : ''}</span>
                  <Badge tone={n.status === 'agreed' ? 'gain' : n.status === 'declined' ? 'loss' : 'gold'}>{NEG_STATUS_LABEL[n.status]}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-400">{n.reason}</p>
                <div className="mt-2 flex gap-2">
                  {n.status === 'countered' && <Button variant="primary" onClick={() => run((g) => commands.acceptCounter(g, n.id))}>Przyjmij kontrofertę</Button>}
                  {(n.status === 'countered' || n.status === 'open' || n.status === 'agreed' || n.status === 'declined') && <Button variant="ghost" onClick={() => run((g) => commands.withdrawDeal(g, n.id))}>Wycofaj</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Umowa spółki i zarząd">
        <p className="mb-3 text-sm text-slate-300">Zarząd musi być powołany przed zgłoszeniem spółki (art. 163 KSH). Członek zarządu nie musi być wspólnikiem, a bycie wspólnikiem nie daje prawa reprezentacji. Funkcja zarządcza jest oddzielona od umowy o pracę — w grze bez wynagrodzenia.</p>
        <fieldset data-testid="board-pick"><legend className="mb-2 text-sm font-medium text-slate-200">Skład zarządu</legend>
          <div className="space-y-1.5">
            {founders.map((f) => (
              <div key={f.personId} className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2 text-slate-200"><input type="checkbox" checked={board.includes(f.personId)} onChange={() => toggle(f.personId)} className="size-4 accent-sky" />{holderName(game, f.personId)}</label>
                {board.includes(f.personId) && <label className="flex items-center gap-1.5 text-xs text-slate-400"><input type="radio" name="president" checked={president === f.personId} onChange={() => setPresident(f.personId)} className="accent-sky" />prezes (funkcja organizacyjna)</label>}
              </div>
            ))}
          </div>
        </fieldset>
        {pv.ready && <p role="alert" className="mt-3 text-sm text-loss" data-testid="agreement-blocker">{pv.ready}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={!!pv.ready || members.length === 0}
            onClick={() => { if (window.confirm(`Zawrzeć umowę spółki „${c.name} sp. z o.o.” i złożyć wniosek o wpis do KRS?\n\nTwój wkład: ${formatPLN(pv.playerShares * c.nominal)} zostanie przelany na rachunek spółki (kapitał, nie koszt). Opłata sądowa 250 zł.`)) run((g) => commands.signAgreement(g, { companyId: c.id, board: members.map((id) => ({ personId: id, role: id === president ? 'president' as const : 'member' as const })), file: true })); }}
            data-testid="sign-agreement-btn">Zawrzyj umowę i złóż wniosek do KRS</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Wkłady: pieniężne, w całości przed zgłoszeniem. <LegalBadge id="CO-KSH-S24" /> <LegalBadge id="CO-KSH-ORGANIZING" /> <LegalBadge id="CO-KRS-TIMING" /></p>
      </Card>
    </div>
  );
}

/* ---------- 3. Wspólnicy ---------- */

export function CorpPartnersScreen() {
  const { game, run } = useCorp();
  const draft = game.corp.companies.find((c) => c.status === 'draft') ?? null;
  const [shares, setShares] = useState<Record<string, number>>({});
  return (
    <div className="space-y-5">
      <ScreenHeader title="Wspólnicy i inwestorzy" subtitle="Postacie AI z własnymi interesami: kapitał, doświadczenie, tolerancja ryzyka, cel, preferencja dywidend, horyzont i zaufanie do Ciebie." />
      <CorpBanner />
      <p className="text-sm text-slate-400">Ich decyzje (zgoda, kontroferta, głosowanie, wnioski o dywidendę, chęć sprzedaży udziałów) wynikają z tych cech i z sytuacji spółki — bez losowych konfliktów i bez modeli językowych. Zaufanie zmienia się tylko od wyników spółki i decyzji zgodnych lub sprzecznych z ich interesami.</p>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="partner-list">
        {game.corp.partners.map((p) => {
          const stakes = game.corp.holdings.filter((h) => h.holderId === p.id && h.count > 0);
          const nShares = shares[p.id] ?? 40;
          return (
            <Card key={p.id} title={<span>{p.firstName} {p.lastName} <Badge tone={p.kind === 'investor' ? 'gold' : 'sky'}>{p.kind === 'investor' ? 'inwestor' : 'wspólnik'}</Badge></span>}>
              <p className="text-xs text-slate-400">{p.bio}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 text-sm">
                <Row k="Dostępny kapitał" v={<Money value={p.capital} round />} />
                <Row k="Doświadczenie / kompetencje" v={`${p.experience} / ${p.competence}`} />
                <Row k="Tolerancja ryzyka" v={`${p.riskTolerance}/100`} />
                <Row k="Cel" v={p.goal === 'income' ? 'dochód' : p.goal === 'growth' ? 'rozwój' : 'wyjście z inwestycji'} />
                <Row k="Preferencja dywidend" v={`${p.dividendPreference}/100`} />
                <Row k="Horyzont" v={`${p.horizonMonths} mies.`} />
                <Row k="Zaufanie do Ciebie" v={<span className={p.trust >= 50 ? 'text-gain' : p.trust < 35 ? 'text-loss' : 'text-gold'}>{p.trust}/100</span>} />
              </dl>
              {stakes.length > 0 && <p className="mt-2 text-xs text-slate-300">Udziały: {stakes.map((h) => `${game.corp.companies.find((c) => c.id === h.companyId)?.name} sp. z o.o. — ${h.count} udz. (${pct(capitalBps(game, h.companyId, p.id))})`).join('; ')}</p>}
              {p.history.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-slate-500">{p.history.slice(-3).reverse().map((h, i) => <li key={i}>{formatDatePL(h.date)} · {h.note}{h.trustDelta !== 0 ? ` (zaufanie ${h.trustDelta > 0 ? '+' : ''}${h.trustDelta})` : ''}</li>)}</ul>}
              {draft && p.kind === 'partner' && (
                <div className="mt-3 flex items-end gap-2 border-t border-ink-700 pt-3">
                  <Field label={`Udziały w ${draft.name} sp. z o.o.`} id={`sh-${p.id}`} hint={`wkład ${formatPLN(nShares * draft.nominal, { round: true })} (nominał ${formatPLN(draft.nominal, { round: true })})`}>
                    <input id={`sh-${p.id}`} type="number" min={1} max={draft.shareCount - 1} value={nShares} onChange={(e) => setShares((m) => ({ ...m, [p.id]: Number(e.target.value) }))} className={cx(inputCls, 'w-28')} />
                  </Field>
                  <Button variant="primary" onClick={() => run((g) => commands.proposeDeal(g, { kind: 'found', companyId: draft.id, partnerId: p.id, terms: { shares: nShares, amount: nShares * draft.nominal, percentBps: Math.round((nShares * 10_000) / draft.shareCount), role: 'none', dividendPolicy: 'none' } }))} data-testid={`invite-${p.id}`}>Zaproś</Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- 4. Udziały i kapitał ---------- */

export function CorpSharesScreen() {
  const { game, companies, company, select } = useCorp();
  const [pctIn, setPctIn] = useState(20);
  const [amountIn, setAmountIn] = useState(100_000);
  if (!company) return (<div className="space-y-5"><ScreenHeader title="Udziały i kapitał" /><NoCompany /></div>);
  const c = company;
  const holdings = activeHoldings(game, c.id);
  const events = game.corp.shareEvents.filter((e) => e.companyId === c.id).slice().reverse();
  const sim = c.status === 'registered' ? subscriptionTerms(c, zl(amountIn), pctIn * 100) : null;
  return (
    <div className="space-y-5">
      <ScreenHeader title="Udziały i kapitał" subtitle="Centralny rejestr udziałów: procent kapitału, prawa głosu, wycena, prawo do dywidendy i kompetencje zarządcze to osobne wielkości." />
      <CorpBanner />
      <CompanyPicker companies={companies} company={company} select={select} />
      <Card title="Struktura kapitału">
        <dl className="grid gap-x-8 sm:grid-cols-3">
          <Row k="Kapitał zakładowy" v={formatPLN(c.capital, { round: true })} />
          <Row k="Udziały" v={`${c.shareCount} × ${formatPLN(c.nominal, { round: true })}`} />
          <Row k="Kapitał zapasowy (agio + zysk)" v={formatPLN(c.supplementary, { round: true })} />
        </dl>
        {c.pendingIncrease && <p className="mt-2 rounded-lg border border-gold/30 bg-gold/5 p-2 text-xs text-gold" data-testid="pending-increase">Podwyższenie kapitału czeka na wpis do KRS (do {formatDatePL(c.pendingIncrease.decisionOn)}): {c.pendingIncrease.shares} nowych udziałów dla {holderName(game, c.pendingIncrease.subscriberId)}, wkład {formatPLN(c.pendingIncrease.contribution, { round: true })} już jest na rachunku spółki, ale udziały powstaną dopiero z wpisem (art. 262 § 4 KSH).</p>}
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-sm" data-testid="share-table">
          <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><Th>Wspólnik</Th><Th right>Udziały</Th><Th right>% kapitału</Th><Th right>% głosów</Th><Th right>Prawo do dywidendy</Th><Th>Zarząd</Th><Th right>Koszt nabycia</Th><Th right>Wartość (szacunek)</Th></tr></thead>
          <tbody className="divide-y divide-ink-700/60">
            {holdings.map((h) => {
              const m = activeBoard(c).find((x) => x.personId === h.holderId);
              return (
                <tr key={h.id}>
                  <td className="py-2 text-slate-100">{holderName(game, h.holderId)}</td>
                  <td className="py-2 text-right tabular">{h.count}</td>
                  <td className="py-2 text-right tabular">{pct(capitalBps(game, c.id, h.holderId))}</td>
                  <td className="py-2 text-right tabular">{pct(voteBps(game, c.id, h.holderId))}</td>
                  <td className="py-2 text-right tabular">{pct(capitalBps(game, c.id, h.holderId))} zysku</td>
                  <td className="py-2">{m ? <Badge tone="sky">{m.role === 'president' ? 'prezes' : 'członek zarządu'}</Badge> : <span className="text-slate-500">poza zarządem</span>}</td>
                  <td className="py-2 text-right"><Money value={holdingCost(h)} round /></td>
                  <td className="py-2 text-right"><Money value={holdingValue(game, h)} round /></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="mt-2 text-xs text-slate-500">Wycena to szacunek, nie cena transakcji. W Twoim majątku netto ujęta jest wyłącznie wartość Twoich udziałów — bez aktywów i gotówki spółki. <LegalBadge id="CO-VALUATION" /> Ograniczenia zbywalności: brak w umowie (art. 182 KSH). <LegalBadge id="CO-KSH-SHARES" /></p>
      </Card>
      {sim && (
        <Card title="Symulator rozwodnienia (nowa emisja)">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Wkład inwestora (zł)" id="sim-amt"><input id="sim-amt" type="number" min={1000} step={1000} value={amountIn} onChange={(e) => setAmountIn(Number(e.target.value))} className={cx(inputCls, 'w-40')} /></Field>
            <Field label="Udział inwestora po emisji (%)" id="sim-pct"><input id="sim-pct" type="number" min={1} max={90} value={pctIn} onChange={(e) => setPctIn(Number(e.target.value))} className={cx(inputCls, 'w-28')} /></Field>
          </div>
          <dl className="mt-3 grid gap-x-8 sm:grid-cols-2" data-testid="dilution-sim">
            <Row k="Nowe udziały" v={`${sim.shares} (cena emisyjna ${formatPLN(Math.floor(sim.amount / sim.shares))} za udział, nominał ${formatPLN(c.nominal)})`} />
            <Row k="Nadwyżka do kapitału zapasowego" v={formatPLN(sim.amount - sim.shares * c.nominal, { round: true })} />
            <Row k="Twój udział po emisji" v={`${pct(Math.round((capitalBps(game, c.id, game.person.id) * c.shareCount) / (c.shareCount + sim.shares)))} (teraz ${pct(capitalBps(game, c.id, game.person.id))})`} />
            <Row k="Pre-money / post-money" v={`${formatPLN(Math.max(0, Math.round((sim.amount * 10_000) / sim.percentBps) - sim.amount), { round: true })} / ${formatPLN(Math.round((sim.amount * 10_000) / sim.percentBps), { round: true })}`} />
          </dl>
        </Card>
      )}
      <Card title="Historia zmian w rejestrze">
        {events.length === 0 ? <Empty>Brak zdarzeń.</Empty> : (
          <ul className="space-y-1 text-sm text-slate-300" data-testid="share-events">
            {events.slice(0, 15).map((e) => (
              <li key={e.id}>{formatDatePL(e.date)} · {e.kind === 'founding' ? 'zawiązanie spółki' : e.kind === 'issue' ? 'emisja (wpis do KRS)' : 'przeniesienie'}: {e.fromId ? `${holderName(game, e.fromId)} → ` : ''}{holderName(game, e.toId)}, {e.count} udz., {formatPLN(e.price, { round: true })}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------- 5. Zarząd ---------- */

export function CorpBoardScreen() {
  const { game, companies, company, select, run } = useCorp();
  const [cand, setCand] = useState<string>('');
  if (!company) return (<div className="space-y-5"><ScreenHeader title="Zarząd" /><NoCompany /></div>);
  const c = company;
  const board = activeBoard(c);
  const meOn = board.some((m) => m.personId === game.person.id);
  const candidates = [game.person.id, ...game.corp.partners.map((p) => p.id)].filter((id) => !board.some((m) => m.personId === id));
  const pick = cand || candidates[0] || '';
  return (
    <div className="space-y-5">
      <ScreenHeader title="Zarząd i reprezentacja" subtitle="Posiadanie większości udziałów nie daje prawa reprezentacji spółki — trzeba być członkiem zarządu." />
      <CorpBanner />
      <CompanyPicker companies={companies} company={company} select={select} />
      <Card title="Członkowie zarządu">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm" data-testid="board-table">
          <thead className="text-left text-xs tracking-wide text-slate-500 uppercase"><tr><Th>Osoba</Th><Th>Funkcja</Th><Th>Od</Th><Th>Udziały</Th><Th>Wynagrodzenie</Th><Th> </Th></tr></thead>
          <tbody className="divide-y divide-ink-700/60">
            {board.map((m) => (
              <tr key={m.id}>
                <td className="py-2 text-slate-100">{holderName(game, m.personId)}</td>
                <td className="py-2 text-slate-300">{m.role === 'president' ? 'prezes zarządu' : 'członek zarządu'}</td>
                <td className="py-2 text-slate-300">{formatDatePL(m.appointedOn)}</td>
                <td className="py-2 text-slate-300">{pct(capitalBps(game, c.id, m.personId))}</td>
                <td className="py-2 text-slate-500">brak (funkcja ≠ umowa o pracę)</td>
                <td className="py-2 text-right">{board.length > 1 && <Button variant="danger" onClick={() => run((g) => commands.proposeResolution(g, c.id, { type: 'dismiss_board', memberId: m.id }))}>Zaproponuj odwołanie</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <Row k="Sposób reprezentacji" v={REPRESENTATION_LABELS[c.representation]} />
          <Row k="Twoja rola" v={meOn ? 'członek zarządu — możesz reprezentować spółkę' : 'wspólnik poza zarządem — nie możesz jej reprezentować'} tone={meOn ? 'text-gain' : 'text-loss'} />
        </dl>
        <p className="mt-2 text-xs text-slate-500">Czynności wiążące spółkę (podpisanie kontraktu, zatrudnienie, zakup sprzętu/pojazdu, umowa z podwykonawcą) wykonuje zarząd; przy reprezentacji łącznej potrzebny jest podpis współzarządcy, który ocenia ryzyko względem gotówki spółki. Funkcja nie daje prawa do wynagrodzenia, składki ZUS od wynagrodzenia zarządu — odłożone. <LegalBadge id="CO-KSH-BOARD" /> <LegalBadge id="CO-KSH-REPRESENT" /> <LegalBadge id="CO-KSH-BOARD-PAY" /></p>
        {meOn && board.length > 1 && <Button className="mt-3" variant="danger" onClick={() => { if (window.confirm('Złożyć rezygnację z zarządu? Udziały zachowasz, ale stracisz prawo reprezentowania spółki.')) run((g) => commands.resignFromBoard(g, c.id)); }}>Złóż rezygnację z zarządu</Button>}
      </Card>
      <Card title="Powołanie członka zarządu (uchwała wspólników)">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Kandydat" id="board-cand">
            <select id="board-cand" value={pick} onChange={(e) => setCand(e.target.value)} className={cx(inputCls, 'w-64')}>
              {candidates.map((id) => <option key={id} value={id}>{holderName(game, id)}</option>)}
            </select>
          </Field>
          <Button variant="primary" disabled={!pick || board.length >= CORP.maxBoard} onClick={() => run((g) => commands.proposeResolution(g, c.id, { type: 'appoint_board', personId: pick, role: 'member' }))} data-testid="appoint-btn">Zaproponuj powołanie</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Powołanie i odwołanie wymaga uchwały (bezwzględna większość głosów), a zmiana wpisu w KRS kosztuje 250 zł. Kandydat spoza Ciebie musi wyrazić zgodę (zależy od jego zaufania i kompetencji).</p>
      </Card>
      <Card title="Zmiana sposobu reprezentacji (zmiana umowy spółki — 2/3 głosów)">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(REPRESENTATION_LABELS) as Company['representation'][]).filter((k) => k !== c.representation).map((k) => (
            <Button key={k} onClick={() => run((g) => commands.proposeResolution(g, c.id, { type: 'change_representation', mode: k }))}>{REPRESENTATION_LABELS[k]}</Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
