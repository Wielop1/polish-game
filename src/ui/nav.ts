import { listOperators } from '../engine/operator.ts';
import type { GameState } from '../engine/state.ts';
import type { Screen } from '../store/gameStore.ts';
import type { IconName } from './components/icons.tsx';

/**
 * Menu gry: grupy ekranów w kolejności „od początku do zaawansowanych”. Każda grupa ma jednozdaniowy opis (widoczny w menu i w przewodniku),
 * a ekrany wymagające firmy (albo firmy remontowej) są ukryte, dopóki gracz jej nie założy — nowy gracz widzi tylko to, czego może użyć.
 */
export type NavRequirement = 'business' | 'renovation' | 'other-industry';

export interface NavItem {
  id: Screen;
  label: string;
  icon: IconName;
  /** Krótko: do czego służy (tooltip i przewodnik). */
  hint: string;
  requires?: NavRequirement;
}
export interface NavBlock { label?: string; items: NavItem[] }
export interface NavSection {
  title: string;
  /** Jedno zdanie: co jest w tej grupie. */
  description: string;
  blocks: NavBlock[];
  /** Grupa zaawansowana — domyślnie zwinięta i oznaczona w przewodniku. */
  advanced?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Start',
    description: 'Przewodnik, pulpit i przegląd Twojej sytuacji.',
    blocks: [{
      items: [
        { id: 'guide', label: 'Przewodnik: jak grać', icon: 'list', hint: 'Cel gry, pętla zarabiania, słownik pojęć i mapa menu' },
        { id: 'dashboard', label: 'Pulpit', icon: 'dashboard', hint: 'Gotówka, majątek netto, najbliższe płatności i co zrobić teraz' },
        { id: 'character', label: 'Postać', icon: 'user', hint: 'Twoje dane i stan' },
        { id: 'finances', label: 'Finanse', icon: 'wallet', hint: 'Rachunki, zobowiązania i historia transakcji' },
        { id: 'calendar', label: 'Kalendarz', icon: 'calendar', hint: 'Co już było i co nadchodzi' },
        { id: 'events', label: 'Historia zdarzeń', icon: 'list', hint: 'Dziennik wszystkiego, co się wydarzyło' },
      ],
    }],
  },
  {
    title: 'Życie prywatne',
    description: 'Etat, mieszkanie, wydatki, czas i oszczędności.',
    blocks: [{
      items: [
        { id: 'jobs', label: 'Oferty pracy', icon: 'briefcase', hint: 'Etat jako alternatywa dla własnej firmy' },
        { id: 'housing', label: 'Mieszkanie', icon: 'home', hint: 'Najem i jego koszty' },
        { id: 'lifestyle', label: 'Styl życia', icon: 'heart', hint: 'Poziom codziennych wydatków' },
        { id: 'time', label: 'Budżet czasu', icon: 'clock', hint: 'Doba ma 24 godziny — na co je przeznaczasz' },
        { id: 'savings', label: 'Oszczędności', icon: 'coins', hint: 'Rachunek oszczędnościowy' },
        { id: 'decisions', label: 'Decyzje i wydarzenia', icon: 'bell', hint: 'Zdarzenia życiowe wymagające wyboru' },
      ],
    }],
  },
  {
    title: 'Moja firma',
    description: 'Rejestracja działalności, finanse firmy, podatki i księgowość.',
    blocks: [
      {
        items: [
          { id: 'bizRegister', label: 'Rejestracja JDG', icon: 'building', hint: 'Załóż jednoosobową działalność — pierwszy krok do własnych zleceń' },
          { id: 'bizOverview', label: 'Moja działalność', icon: 'briefcase', hint: 'Stan firmy w skrócie', requires: 'business' },
          { id: 'bizFinance', label: 'Finanse firmy', icon: 'trend', hint: 'Przychody, koszty, należności i płynność firmy', requires: 'business' },
          { id: 'planning', label: 'Planowanie', icon: 'trend', hint: 'Prognoza scenariuszy (niczego nie zmienia)', requires: 'business' },
        ],
      },
      {
        label: 'Podatki i księgowość',
        items: [
          { id: 'bizTax', label: 'Podatki i ZUS', icon: 'shield', hint: 'Miesięczne składki i zaliczki', requires: 'business' },
          { id: 'bizAccounting', label: 'Księgowość', icon: 'file', hint: 'Samodzielnie albo biuro rachunkowe', requires: 'business' },
          { id: 'bizDocs', label: 'Dokumenty', icon: 'receipt', hint: 'Rejestr faktur sprzedaży i kosztów', requires: 'business' },
          { id: 'bizCalendar', label: 'Kalendarz obowiązków', icon: 'calendar', hint: 'Terminy płatności firmy', requires: 'business' },
          { id: 'bizSettlement', label: 'Rozliczenie roczne', icon: 'receipt', hint: 'PIT i składka zdrowotna za zamknięty rok', requires: 'business' },
          { id: 'bizReport', label: 'Podsumowanie roku', icon: 'list', hint: 'Wynik firmy w skali roku', requires: 'business' },
        ],
      },
    ],
  },
  {
    title: 'Zlecenia',
    description: 'Klient pyta → wyceniasz → podpisujesz umowę → wykonujesz → dostajesz zapłatę.',
    blocks: [{
      items: [
        { id: 'renoDashboard', label: 'Pulpit zleceń', icon: 'dashboard', hint: 'Zapytania, wyceny i kontrakty na jednym ekranie', requires: 'renovation' },
        { id: 'renoEnquiries', label: 'Zapytania klientów', icon: 'bell', hint: 'Nowe zapytania czekają na wycenę (ok. 7 dni)', requires: 'renovation' },
        { id: 'renoQuotes', label: 'Wyceny', icon: 'receipt', hint: 'Wyceń, negocjuj i podpisz umowę', requires: 'renovation' },
        { id: 'renoContracts', label: 'Kontrakty', icon: 'briefcase', hint: 'Prace w toku: materiały, postęp, odbiór', requires: 'renovation' },
        { id: 'renoSchedule', label: 'Harmonogram', icon: 'calendar', hint: 'Obciążenie najbliższych dni i ryzyko opóźnień', requires: 'renovation' },
        { id: 'opsSchedule', label: 'Harmonogram wielu kontraktów', icon: 'calendar', hint: 'Rezerwacje ludzi i sprzętu na 4 tygodnie', requires: 'renovation' },
        { id: 'bizOrders', label: 'Oferty i kontrakty', icon: 'file', hint: 'Zlecenia usługowe (inne branże niż remonty)', requires: 'other-industry' },
      ],
    }],
  },
  {
    title: 'Ludzie i sprzęt',
    description: 'Pracownicy, ekipy, podwykonawcy, pojazdy, materiały i narzędzia.',
    blocks: [{
      items: [
        { id: 'hrEmployees', label: 'Pracownicy', icon: 'user', hint: 'Zatrudnieni: umiejętności, morale, koszt', requires: 'business' },
        { id: 'hrRecruitment', label: 'Rekrutacja', icon: 'bell', hint: 'Ogłoszenia i kandydaci', requires: 'business' },
        { id: 'opsTeams', label: 'Ekipy', icon: 'user', hint: 'Zespoły do kontraktów', requires: 'renovation' },
        { id: 'opsSubcontractors', label: 'Podwykonawcy', icon: 'file', hint: 'Zleć część pracy innej firmie', requires: 'renovation' },
        { id: 'renoStock', label: 'Magazyn i sprzęt', icon: 'coins', hint: 'Umiejętności, narzędzia i materiały', requires: 'renovation' },
        { id: 'opsVehicles', label: 'Pojazdy', icon: 'home', hint: 'Firmowe auta i ich koszty', requires: 'renovation' },
      ],
    }],
  },
  {
    title: 'Rynek i marketing',
    description: 'Skąd biorą się klienci, kto z Tobą konkuruje i jak pozyskać więcej zapytań.',
    blocks: [{
      items: [
        { id: 'marketLocal', label: 'Rynek lokalny', icon: 'trend', hint: 'Popyt, koniunktura i sezon w mieście', requires: 'renovation' },
        { id: 'marketMarketing', label: 'Marketing', icon: 'bell', hint: 'Budżet na kanały reklamy — źródło zapytań', requires: 'renovation' },
        { id: 'marketCompetition', label: 'Konkurencja', icon: 'user', hint: 'Firmy z branży (oszacowania)', requires: 'renovation' },
        { id: 'marketStrategy', label: 'Strategia firmy', icon: 'shield', hint: 'Tania, zrównoważona czy premium', requires: 'renovation' },
        { id: 'marketDemand', label: 'Analiza popytu', icon: 'list', hint: 'Lejek: popyt → zapytania → umowy', requires: 'renovation' },
      ],
    }],
  },
  {
    title: 'Większe projekty (B2B)',
    description: 'Duże kontrakty od firm: pakiety robót, referencje i dłuższe terminy płatności.',
    blocks: [{
      items: [
        { id: 'projects', label: 'Większe projekty', icon: 'briefcase', hint: 'Zapytania o wykończenie całych mieszkań i lokali', requires: 'renovation' },
        { id: 'projectPackages', label: 'Pakiety robót', icon: 'list', hint: 'Etapy i pakiety podpisanych projektów', requires: 'renovation' },
        { id: 'b2bClients', label: 'Klienci B2B', icon: 'user', hint: 'Zarządcy, deweloperzy, firmy budowlane', requires: 'renovation' },
        { id: 'projectReferences', label: 'Referencje firmy', icon: 'shield', hint: 'Co odblokowuje większe projekty', requires: 'renovation' },
      ],
    }],
  },
  {
    title: 'Wyniki',
    description: 'Czy firma naprawdę zarabia: rentowność, zysk ekonomiczny, reputacja.',
    blocks: [{
      items: [
        { id: 'opsProfit', label: 'Rentowność', icon: 'trend', hint: 'Zarobek z kontraktów, ekip i segmentów klientów', requires: 'renovation' },
        { id: 'renoReputation', label: 'Reputacja i reklamacje', icon: 'heart', hint: 'Opinie wpływają na liczbę zapytań', requires: 'renovation' },
      ],
    }],
  },
  {
    title: 'Spółki i inwestycje prywatne',
    description: 'Zaawansowane: spółka z o.o., wspólnicy, udziały, uchwały, CIT i dywidendy.',
    advanced: true,
    blocks: [
      {
        items: [
          { id: 'corpCompanies', label: 'Moje spółki', icon: 'building', hint: 'Spółki z o.o. obok Twojej JDG' },
          { id: 'corpFound', label: 'Załóż spółkę', icon: 'file', hint: 'Umowa przez wzorzec S24 i wpis do KRS' },
        ],
      },
      {
        label: 'Własność i zarządzanie',
        items: [
          { id: 'corpPartners', label: 'Wspólnicy', icon: 'user', hint: 'Zaproś wspólników i inwestorów' },
          { id: 'corpShares', label: 'Udziały i kapitał', icon: 'coins', hint: 'Kto ile ma udziałów, głosów i dywidendy' },
          { id: 'corpBoard', label: 'Zarząd', icon: 'shield', hint: 'Kto może reprezentować spółkę' },
          { id: 'corpResolutions', label: 'Uchwały', icon: 'list', hint: 'Głosowania wspólników' },
        ],
      },
      {
        label: 'Finanse spółki',
        items: [
          { id: 'corpFinance', label: 'Finanse i CIT', icon: 'receipt', hint: 'Zysk, podatek CIT i kapitały' },
          { id: 'corpDividends', label: 'Dywidendy', icon: 'wallet', hint: 'Wypłaty zysku wspólnikom' },
          { id: 'corpInvestors', label: 'Inwestorzy i negocjacje', icon: 'trend', hint: 'Nowe udziały i zakup udziałów' },
        ],
      },
    ],
  },
  { title: 'System', description: 'Zapis, wczytywanie i nowa gra.', blocks: [{ items: [{ id: 'game', label: 'Nowa gra / Wczytaj', icon: 'save', hint: 'Zapisy gry' }] }] },
];

export const sectionItems = (sec: NavSection): NavItem[] => sec.blocks.flatMap((b) => b.items);
export const ALL_NAV: NavItem[] = NAV_SECTIONS.flatMap(sectionItems);
export const SCREEN_LABEL: Partial<Record<Screen, string>> = Object.fromEntries(ALL_NAV.map((n) => [n.id, n.label]));
export const sectionOf = (id: Screen): string | undefined => NAV_SECTIONS.find((sec) => sectionItems(sec).some((n) => n.id === id))?.title;

/** Co gracz już ma: firmę (JDG albo spółka z działalnością) i jakiej branży. */
export function businessKind(game: GameState): { business: boolean; renovation: boolean; otherIndustry: boolean } {
  const ops = listOperators(game);
  const renovation = ops.some((o) => o.operator.profileId === 'remonty');
  return { business: ops.length > 0, renovation, otherIndustry: ops.some((o) => o.operator.profileId !== 'remonty') };
}

export function itemVisible(item: NavItem, kind: ReturnType<typeof businessKind>, current: Screen): boolean {
  if (item.id === current) return true; // bieżący ekran zawsze widoczny (np. po wczytaniu zapisu)
  if (!item.requires) return true;
  if (item.requires === 'business') return kind.business;
  if (item.requires === 'renovation') return kind.renovation;
  return kind.otherIndustry;
}

/** Menu widoczne dla gracza: bez ekranów, których nie da się jeszcze użyć; puste grupy znikają. */
export function visibleSections(game: GameState, current: Screen): NavSection[] {
  const kind = businessKind(game);
  return NAV_SECTIONS
    .map((sec) => ({ ...sec, blocks: sec.blocks.map((b) => ({ ...b, items: b.items.filter((i) => itemVisible(i, kind, current)) })).filter((b) => b.items.length > 0) }))
    .filter((sec) => sec.blocks.length > 0);
}
