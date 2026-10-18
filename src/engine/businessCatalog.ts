import { zl } from './money.ts';
import type { Grosze } from './money.ts';

/**
 * Profile działalności usługowej i szablony zleceń (FIKCYJNE klienci i kwoty — wartości przykładowe).
 * Profile dobrano tak, by nie należały do znanych wyłączeń ze zwolnienia z VAT (np. usługi prawnicze).
 */
export interface ServiceTemplate {
  id: string;
  title: string;
  clientName: string;
  description: string;
  netMin: Grosze;
  netMax: Grosze;
  hours: number;
  costMin: Grosze;
  costMax: Grosze;
  termDays: number;
  deadlineDays: number;
  latePenaltyBps: number;
}

export interface BusinessProfile {
  id: string;
  label: string;
  description: string;
  /** Kod PKD 2025 (symbol i nazwa). */
  pkd: string;
  pkdName: string;
  ryczaltRateBps: number;
  ryczaltCategory: string;
  /** Moduł branżowy (v0.5) obsługujący profil — zamiast szablonów zleceń v0.3. */
  industry?: string;
  templates: ServiceTemplate[];
}

export const BUSINESS_PROFILES: readonly BusinessProfile[] = [
  {
    id: 'remonty',
    label: 'Usługi remontowo-wykończeniowe',
    description: 'Malowanie, gładzie, montaż paneli i drobne prace wykończeniowe dla klientów indywidualnych. Moduł branżowy: zapytania, wyceny, negocjacje, kontrakty, materiały, sprzęt, reputacja.',
    pkd: '43.34.Z',
    pkdName: 'Malowanie i szklenie',
    ryczaltRateBps: 550,
    ryczaltCategory: 'roboty budowlane',
    industry: 'renovation',
    templates: [],
  },
  {
    id: 'it-programowanie',
    label: 'Programowanie i tworzenie oprogramowania',
    description: 'Drobne projekty programistyczne, strony i automatyzacje dla małych firm.',
    pkd: '62.10.B',
    pkdName: 'Pozostała działalność w zakresie programowania',
    ryczaltRateBps: 1_200,
    ryczaltCategory: 'niektóre usługi informatyczne',
    templates: [
      { id: 'it-strona', title: 'Strona internetowa firmy usługowej', clientName: 'Pracownia Krajobrazu Mazury (fikcyjna)', description: 'Wykonanie prostej strony wizytówkowej z formularzem kontaktowym.', netMin: zl(5_000), netMax: zl(8_000), hours: 40, costMin: zl(100), costMax: zl(300), termDays: 14, deadlineDays: 30, latePenaltyBps: 1_000 },
      { id: 'it-automatyzacja', title: 'Automatyzacja raportów w arkuszach', clientName: 'Hurtownia Narzędzi Łyna (fikcyjna)', description: 'Skrypty generujące raporty sprzedaży z istniejących danych.', netMin: zl(3_500), netMax: zl(6_000), hours: 25, costMin: 0, costMax: zl(150), termDays: 30, deadlineDays: 21, latePenaltyBps: 1_000 },
      { id: 'it-sklep', title: 'Prosty sklep internetowy', clientName: 'Manufaktura Świec Warmia (fikcyjna)', description: 'Konfiguracja i dostosowanie gotowego sklepu, integracja płatności.', netMin: zl(8_000), netMax: zl(13_000), hours: 70, costMin: zl(300), costMax: zl(700), termDays: 30, deadlineDays: 45, latePenaltyBps: 1_500 },
    ],
  },
  {
    id: 'it-doradztwo',
    label: 'Doradztwo informatyczne i obsługa IT',
    description: 'Wsparcie IT dla małych firm: konfiguracja sprzętu, kont i systemów.',
    pkd: '62.20.B',
    pkdName: 'Pozostała działalność związana z doradztwem w zakresie informatyki oraz zarządzaniem urządzeniami informatycznymi',
    ryczaltRateBps: 1_200,
    ryczaltCategory: 'niektóre usługi informatyczne',
    templates: [
      { id: 'dor-audyt', title: 'Audyt i uporządkowanie infrastruktury biura', clientName: 'Biuro Rachunkowe Jezioro (fikcyjne)', description: 'Przegląd sprzętu i kont, plan porządkowania i backupów.', netMin: zl(3_000), netMax: zl(5_000), hours: 20, costMin: 0, costMax: zl(100), termDays: 14, deadlineDays: 21, latePenaltyBps: 1_000 },
      { id: 'dor-wdrozenie', title: 'Wdrożenie poczty i współdzielenia plików', clientName: 'Klinika Weterynaryjna Pojezierze (fikcyjna)', description: 'Konfiguracja usług chmurowych i szkolenie zespołu.', netMin: zl(4_500), netMax: zl(7_500), hours: 35, costMin: zl(100), costMax: zl(400), termDays: 30, deadlineDays: 30, latePenaltyBps: 1_000 },
    ],
  },
  {
    id: 'jezyki',
    label: 'Nauka języków obcych (korepetycje i kursy)',
    description: 'Zajęcia językowe dla firm i osób prywatnych.',
    pkd: '85.59.A',
    pkdName: 'Nauka języków obcych',
    ryczaltRateBps: 850,
    ryczaltCategory: 'edukacja (pozostałe usługi)',
    templates: [
      { id: 'jez-kurs', title: 'Kurs angielskiego dla pracowników firmy', clientName: 'Transport i Spedycja Olsztyn (fikcyjna)', description: 'Cykl zajęć grupowych dla zespołu biurowego.', netMin: zl(2_500), netMax: zl(4_000), hours: 24, costMin: zl(50), costMax: zl(200), termDays: 14, deadlineDays: 28, latePenaltyBps: 500 },
      { id: 'jez-egzamin', title: 'Przygotowanie do egzaminu językowego', clientName: 'Szkoła Muzyczna Łyna (fikcyjna)', description: 'Indywidualne konsultacje przed egzaminem.', netMin: zl(1_500), netMax: zl(2_500), hours: 15, costMin: 0, costMax: zl(100), termDays: 7, deadlineDays: 21, latePenaltyBps: 500 },
    ],
  },
  {
    id: 'sprzatanie',
    label: 'Usługi sprzątania biur',
    description: 'Sprzątanie małych biur i lokali usługowych.',
    pkd: '81.21.Z',
    pkdName: 'Niespecjalistyczne sprzątanie budynków i obiektów przemysłowych',
    ryczaltRateBps: 850,
    ryczaltCategory: 'pozostałe usługi',
    templates: [
      { id: 'sp-biuro', title: 'Generalne sprzątanie biura po remoncie', clientName: 'Agencja Nieruchomości Kormoran (fikcyjna)', description: 'Jednorazowe sprzątanie powierzchni ok. 120 m².', netMin: zl(2_000), netMax: zl(3_200), hours: 20, costMin: zl(100), costMax: zl(250), termDays: 14, deadlineDays: 14, latePenaltyBps: 1_000 },
      { id: 'sp-umowa', title: 'Miesięczne sprzątanie gabinetu', clientName: 'Gabinet Fizjoterapii Dajtki (fikcyjny)', description: 'Regularne sprzątanie przez miesiąc (zlecenie jednorazowe).', netMin: zl(1_500), netMax: zl(2_400), hours: 18, costMin: zl(50), costMax: zl(150), termDays: 14, deadlineDays: 30, latePenaltyBps: 500 },
    ],
  },
];

export const PROFILE_BY_ID = new Map(BUSINESS_PROFILES.map((p) => [p.id, p]));
