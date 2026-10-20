import { listOperators } from '../../engine/operator.ts';
import { renoDashboard } from '../../engine/renovation.ts';
import { useGameStore } from '../../store/gameStore.ts';
import type { Screen } from '../../store/gameStore.ts';
import { useOpGame } from '../useOperator.ts';
import { Badge, Button, Card, Money, ScreenHeader, cx, moneyTone } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { firstSteps, nextSteps, stepLabel } from '../guide.ts';
import { NAV_SECTIONS, businessKind } from '../nav.ts';

/** „Co zrobić teraz?” — kilka najważniejszych podpowiedzi z przyciskami (Pulpit i Przewodnik). */
export function NextStepsCard({ compact = false }: { compact?: boolean }) {
  const game = useGameStore((s) => s.game)!;
  const navigate = useGameStore((s) => s.navigate);
  const steps = nextSteps(game).slice(0, compact ? 3 : 5);
  return (
    <Card title="Co zrobić teraz?" action={compact ? <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => navigate('guide')}>Przewodnik: jak grać →</Button> : undefined}>
      <ul className="space-y-2.5" data-testid="next-steps">
        {steps.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/40 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">{s.urgent && <span aria-hidden="true" className="size-2 rounded-full bg-gold" />}{s.title}</div>
              <div className="mt-0.5 text-xs text-slate-400">{s.why}</div>
            </div>
            <Button variant={s.urgent ? 'primary' : 'secondary'} onClick={() => navigate(s.screen)} data-testid={`next-${s.id}`}>{stepLabel(s.screen)} →</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Firma w skrócie na Pulpicie: gotówka firmy, zapytania, kontrakty i zysk — osobno od prywatnych finansów. */
export function FirmSnapshot() {
  const game = useOpGame();
  const navigate = useGameStore((s) => s.navigate);
  const root = useGameStore((s) => s.game)!;
  const kind = businessKind(root);
  const ops = listOperators(game);
  const op = ops.find((o) => o.id === (root.corp.selected ?? 'jdg')) ?? ops[0];
  if (!kind.business || !op) return null;
  const cash = game.accounts[op.operator.accountId]?.balance ?? 0;
  const d = kind.renovation ? renoDashboard(game) : null;
  const tile = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="rounded-xl border border-ink-700 bg-ink-900/40 p-3">
      <div className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-100">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
  return (
    <Card title={`Twoja firma — ${op.label}`} action={kind.renovation ? <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => navigate('renoDashboard')}>Pulpit zleceń →</Button> : undefined}>
      <div className="grid gap-3 sm:grid-cols-4" data-testid="firm-snapshot">
        {tile('Gotówka firmy', <Money value={cash} />, 'rachunek firmowy')}
        {d && tile('Zapytania do wyceny', d.openEnquiries, d.openEnquiries > 0 ? 'czekają na odpowiedź' : 'brak nowych')}
        {d && tile('Kontrakty w toku', d.activeJobs, d.jobsAtRisk > 0 ? `${d.jobsAtRisk} zagrożonych opóźnieniem` : 'terminy bezpieczne')}
        {d && tile('Zysk ekonomiczny', <span className={cx(moneyTone(d.economicProfitDone))}><Money value={d.economicProfitDone} signed round /></span>, 'ukończone kontrakty, po wartości Twojej pracy')}
      </div>
    </Card>
  );
}

const LOOP: { title: string; text: string; screen: Screen }[] = [
  { title: '1. Klienci cię znajdują', text: 'Marketing, opinie i sezon decydują, ilu klientów w ogóle do Ciebie napisze.', screen: 'marketMarketing' },
  { title: '2. Zapytanie', text: 'Klient pyta o usługę (np. malowanie 60 m²). Masz około tygodnia na odpowiedź.', screen: 'renoEnquiries' },
  { title: '3. Wycena', text: 'Ustalasz cenę. Panel pokazuje, ile faktycznie zostaje i ile to za godzinę Twojej pracy.', screen: 'renoQuotes' },
  { title: '4. Umowa', text: 'Klient akceptuje ofertę, a Ty ją podpisujesz — powstaje kontrakt z terminem i zaliczką.', screen: 'renoQuotes' },
  { title: '5. Realizacja', text: 'Kupujesz materiały, pracujesz (albo pracują pracownicy i podwykonawcy), pilnujesz terminu i jakości.', screen: 'renoContracts' },
  { title: '6. Zapłata', text: 'Po odbiorze klient płaci resztę w uzgodnionym terminie. Przychód to jeszcze nie gotówka!', screen: 'bizFinance' },
  { title: '7. Rozwój', text: 'Gdy zleceń przybywa: pracownicy, ekipy, podwykonawcy i większe projekty B2B.', screen: 'projectReferences' },
];

const GLOSSARY: [string, string][] = [
  ['Majątek netto', 'Wszystko, co masz (gotówka, oszczędności, wartość sprzętu i zapasów, udziały), minus to, co jesteś komuś winien. To główny wynik gry.'],
  ['Przychód a gotówka', 'Przychód powstaje, gdy wykonasz usługę i wystawisz fakturę. Gotówka — dopiero gdy klient zapłaci. Firma może mieć zysk i brak pieniędzy na rachunku.'],
  ['Koszty rzeczywiste', 'Pieniądze, które firma naprawdę wydaje na zlecenie: materiały, płace pracowników, podwykonawcy, transport, drobne wydatki (plus zużycie sprzętu).'],
  ['Nadwyżka przed obciążeniami właściciela', 'Cena minus koszty rzeczywiste. Z niej firma płaci ZUS, podatek i księgowość — to, co zostaje, jest Twoje. To jeszcze nie wypłata.'],
  ['Wartość Twojej pracy (kalkulacyjna)', 'Godziny, które sam przepracowałeś × stawka, którą uznajesz za swoją wartość (domyślnie 60 zł/godz.). To tylko miara porównawcza — nie jest wypłatą ani kosztem podatkowym.'],
  ['Zysk ekonomiczny', 'Nadwyżka minus wartość Twojej pracy. Ujemny oznacza: firma nie dokłada do zlecenia, ale zarabiasz mniej niż przyjęta stawka za godzinę.'],
  ['Zaliczka', 'Część ceny płacona z góry. To pieniądze i zobowiązanie do wykonania usługi — nie przychód, dopóki praca nie zostanie wykonana.'],
  ['Należność i zobowiązanie', 'Należność: ktoś ma zapłacić Tobie. Zobowiązanie: Ty masz zapłacić komuś. Obie mają termin.'],
  ['JDG a spółka z o.o.', 'JDG to Ty jako osoba fizyczna z działalnością (odpowiadasz majątkiem). Spółka z o.o. to osobny podmiot z własnym majątkiem — zaawansowana opcja w grupie „Spółki i inwestycje prywatne”.'],
  ['Płynność (zapas gotówki)', 'Pieniądze na rachunku firmy. Bez nich nie kupisz materiałów — kontrakty stają, klienci odchodzą, a płace i składki i tak trzeba zapłacić. Największe zakupy (pojazd, zatrudnienie) rób dopiero z zapasem na kilka miesięcy kosztów stałych.'],
  ['Nadzór właściciela', 'Ile godzin dziennie osobiście pilnujesz pracy ekipy. 0 godz. (pełne delegowanie) zwalnia Twój czas, ale obniża jakość o 4 pkt i zwiększa ryzyko problemów; 1 godz. dziennie na każdy kontrakt szybko zjada dobę.'],
  ['VAT', 'Podatek przelotowy: doliczasz go klientowi i odprowadzasz do urzędu. Nie jest Twoim przychodem ani kosztem.'],
  ['Referencje', 'Dowód, że umiesz: ukończone kontrakty, ich wartość, oceny klientów i ukończone projekty. Odblokowują większe projekty.'],
  ['Pakiet robót', 'Część większego projektu (np. gładzie, malowanie) z własnym kosztorysem, terminem i odbiorem. Kolejny pakiet rusza po odbiorze poprzedniego.'],
];

export function GuideScreen() {
  const game = useGameStore((s) => s.game)!;
  const navigate = useGameStore((s) => s.navigate);
  const kind = businessKind(game);
  const steps = firstSteps(game);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div className="space-y-5" data-testid="guide">
      <ScreenHeader title="Przewodnik: jak grać" subtitle="Dla każdego, kto widzi grę pierwszy raz: o co chodzi, od czego zacząć i gdzie co znaleźć." />

      <Card title="O co w tej grze chodzi">
        <div className="grid gap-4 text-sm text-slate-300 md:grid-cols-3">
          <div><div className="mb-1 font-semibold text-slate-100">Cel</div>Jesteś 22-latkiem w Olsztynie z 5 000 zł i etatem. Zbuduj jak największy majątek netto — najlepiej przez własną firmę remontową, która uczciwie zarabia.</div>
          <div><div className="mb-1 font-semibold text-slate-100">Jak płynie czas</div>Czas stoi, dopóki nie klikniesz <strong>„Następny dzień”</strong> lub <strong>„Do następnego miesiąca”</strong> u góry. Między kliknięciami możesz spokojnie decydować.</div>
          <div><div className="mb-1 font-semibold text-slate-100">Zasada gry</div>Nic nie jest gwarantowane. Liczą się koszty, czas (doba ma 24 godziny), konkurencja i przepisy. Gra pokazuje, <em>dlaczego</em> coś wyszło tak, a nie inaczej.</div>
        </div>
      </Card>

      <NextStepsCard />

      <Card title={`Twoje pierwsze kroki (${doneCount} z ${steps.length})`}>
        <ol className="grid gap-2 md:grid-cols-2" data-testid="first-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={cx('flex items-center gap-3 rounded-xl border p-3', s.done ? 'border-gain/30 bg-gain/5' : 'border-ink-700')}>
              <span aria-hidden="true" className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', s.done ? 'bg-gain text-ink-950' : 'bg-ink-700 text-slate-300')}>{s.done ? '✓' : i + 1}</span>
              <div className="min-w-0 flex-1"><div className={cx('text-sm font-medium', s.done ? 'text-slate-400 line-through' : 'text-slate-100')}>{s.label}</div><div className="text-xs text-slate-500">{s.hint}</div></div>
              {!s.done && (kind.business || s.id === 'biz') && <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => navigate(s.screen)}>Przejdź</Button>}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Jak zarabia firma remontowa — pętla gry">
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" data-testid="loop">
          {LOOP.map((l) => (
            <li key={l.title} className="flex flex-col justify-between rounded-xl border border-ink-700 bg-ink-900/40 p-3">
              <div><div className="text-sm font-semibold text-slate-100">{l.title}</div><div className="mt-1 text-xs text-slate-400">{l.text}</div></div>
              <button type="button" onClick={() => navigate(l.screen)} className="mt-2 self-start text-xs text-sky hover:underline">{kind.business || l.screen === 'bizFinance' ? 'Otwórz ekran →' : 'Najpierw załóż firmę'}</button>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Gdzie co jest — mapa menu">
        <div className="grid gap-4 md:grid-cols-2" data-testid="nav-map">
          {NAV_SECTIONS.map((sec) => (
            <div key={sec.title} className="rounded-xl border border-ink-700 p-3">
              <div className="flex items-center gap-2"><span className="text-sm font-semibold text-slate-100">{sec.title}</span>{sec.advanced && <Badge tone="gold">zaawansowane</Badge>}</div>
              <div className="mb-2 text-xs text-slate-400">{sec.description}</div>
              <ul className="flex flex-wrap gap-1.5">
                {sec.blocks.flatMap((b) => b.items).map((n) => (
                  <li key={n.id}><button type="button" title={n.hint} onClick={() => navigate(n.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2 py-1 text-xs text-slate-300 hover:border-sky hover:text-white"><Icon name={n.icon} className="size-3.5" />{n.label}</button></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Ekrany, których jeszcze nie możesz użyć (np. zlecenia przed założeniem firmy), są ukryte w bocznym menu — pojawią się po rejestracji. Kropka przy pozycji menu oznacza, że coś czeka na Twoją reakcję.</p>
      </Card>

      <Card title="Słownik pojęć">
        <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2" data-testid="glossary">
          {GLOSSARY.map(([k, v]) => (
            <div key={k}><dt className="text-sm font-semibold text-slate-100">{k}</dt><dd className="text-xs text-slate-400">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">To symulacja gospodarcza — nie porada prawna ani podatkowa. Liczby i klienci są fikcyjne; parametry modelu rynku oznaczono jako „kalibracyjne”.</p>
      </Card>
    </div>
  );
}
