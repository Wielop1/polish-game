# PROJECT_STATUS — stan projektu

> Aktualizuj po każdym zadaniu. Opisuje **stan faktyczny**, nie plany. Ostatnia aktualizacja: 2026-10-18.

## Wersja

**v0.4.0 — Poprawność rozliczeń i rozwój JDG** (zakończona; v0.5 czeka na zatwierdzenie). Zapisy: `SAVE_VERSION = 4` (migracje v1 → v2 → v3 → v4). Wcześniej: v0.3 (JDG), v0.2.1, v0.2, v0.1.
Rejestr rozwoju mechanik: [`FEATURE_EVOLUTION.md`](FEATURE_EVOLUTION.md) · rejestr reguł prawnych: [`LEGAL_SOURCES.md`](LEGAL_SOURCES.md).

## Co działa (v0.4, zweryfikowane testami)

Wszystko z v0.1–v0.3 (czas, finanse, praca, mieszkanie, czas i zmęczenie, styl życia, oszczędności, wydarzenia, JDG, ZUS, VAT, zlecenia, dokumenty, zapisy) plus:

- **Kalkulator wynagrodzenia z etatu (2026)**: brutto → netto z składkami pracownika (9,76/1,5/2,45%), limitem 30-krotności, składką zdrowotną 9%, kosztami 250 zł, zaliczką 12%/32% narastająco z kwotą zmniejszającą (PIT-2) i **ulgą PIT-0 dla młodych** (do 26. urodzin, limit 85 528 zł; nie dotyczy JDG). Odcinki płacowe w stanie gry; przychód liczony w roku wypłaty. Przykłady wzorcowe w testach: 4 806 zł → 3 605,85 zł netto (przykład ZUS), 6 300 zł (22-latek) → 4 947,01 zł.
- **Roczne rozliczenie PIT** (31 grudnia): PIT-37 (etat), **PIT-36 (skala: etat + JDG łącznie, kwota zmniejszająca raz)**, PIT-36L, PIT-28; rozróżnione zaliczki pracodawcy, zaliczki własne i zobowiązanie roczne; dopłata do 30.04, nadpłata jako należność (+45 dni, nie wpływa „od razu”).
- **Straty podatkowe**: rejestr (rok, forma, kwota, odliczenia); odliczanie do 50% rocznie przez 5 lat; strata podatkowa ≠ strata księgowa ≠ ujemny przepływ gotówki; ryczałt strat nie tworzy.
- **Roczne rozliczenie składki zdrowotnej**: dopłata do 20 maja; nadpłata **tylko na wniosek gracza** (do 31 maja, inaczej wygasa — bez automatycznej gotówki); miesiące zawieszenia pomijane.
- **Zawieszenie i wznowienie JDG**: od 1. dnia miesiąca, ≥ 30 dni (wyjątek: pełny luty), bez składek/zaliczek/nowych zleceń, zobowiązania i należności zostają; zakaz przy trwających zleceniach.
- **Zmiana formy opodatkowania** od 1 stycznia (plan z możliwością anulowania), z historią form i nieruszanymi poprzednimi rozliczeniami; ryczałt blokowany przy przychodzie > 8 517 200 zł.
- **Mały ZUS Plus** (deklaracja gracza, warunki sprawdzane i wyświetlane, coroczny przegląd 1 stycznia); nigdy nie przyznawany automatycznie.
- **Ekrany**: „Rozliczenie roczne”, „Podsumowanie roku” (wynik firmy oddzielony od przepływów właściciela), „Planowanie” (prognoza na kopii stanu, 5+ scenariuszy, **nic nie księguje**, oznaczona jako prognoza), karty zawieszenia / formy / Małego ZUS Plus w „Mojej działalności”.
- **Prawo**: 53 reguły w rejestrze: 36 VERIFIED, 13 SIMPLIFIED, 4 DEFERRED (zmiany v0.4 w `LEGAL_SOURCES.md`). Rozstrzygnięto rozbieżności z v0.3: roczna podstawa zdrowotnej 57 672 zł, limit odliczenia 14 100 zł.
- **Zapisy**: migracja v3 → v4 na **prawdziwym zapisie z v0.3**; bez ponownego księgowania i bez zmian historii (wynagrodzenia sprzed migracji zachowują wypłaconą kwotę).

## Zweryfikowane i niezweryfikowane przepisy

Zweryfikowane w v0.3 (VERIFIED): skala i kwota zmniejszająca, liniowy 19%, limit odliczenia zdrowotnej 14 100 zł (liniowy), brak odliczenia zdrowotnej w skali, odliczenia przy ryczałcie, terminy zaliczek (20.) i salda rocznego (30.04), próg 1 000 zł, minimalne wynagrodzenie 4 806 zł, podstawy i stopy ZUS 2026 (5 652 zł / 1 441,80 zł; 19,52 / 8 / 2,45 / 1,67 / 2,45%), ulga na start i składki preferencyjne (warunki, 6 i 24 mies.), zbieg z etatem, minimalna składka zdrowotna i progi ryczałtowców, limit VAT 240 000 zł i utrata zwolnienia, termin VAT (25.), ograniczenie usług dla pracodawcy. **Uproszczone (SIMPLIFIED)**: stawka ryczałtu na profil (zamiast wg PKWiU), PKD dwóch profili, proporcja limitu VAT, wyłączenia z VAT (art. 113 ust. 13), stawka VAT 23% dla wszystkich usług, brak odliczenia VAT przez zwolnionego, PIT przy etacie (bez łączenia dochodów), moment przychodu, wybór formy przy rejestracji. **Odłożone (DEFERRED)**: Mały ZUS Plus (zweryfikowany, niewdrożony), wakacje składkowe i składki przy zawieszeniu, zawieszenie działalności, roczne rozliczenie zdrowotnej, straty i ulgi, zaokrąglanie do zł, KSeF/korekty/metoda kasowa. Szczegóły i znalezione rozbieżności źródeł: `LEGAL_SOURCES.md`.

## Czego NIE ma (świadomie poza zakresem)

Spółki i wspólnicy, zatrudnianie pracowników, branża remontowa, giełda, nieruchomości inwestycyjne, kredyty i leasing, integracje z urzędami i KSeF, backend. **Vercel**: repo przygotowane do importu (`vercel.json`, `npm ci`, build statyczny); projekt Vercel jest tworzony przez właściciela. Pełna lista uproszczeń (po v0.4): `FEATURE_EVOLUTION.md` §14.

## Wykonane testy (2026-10-18)

| Polecenie | Wynik |
|---|---|
| `npm run typecheck` | ✅ bez błędów |
| `npm test` (Vitest) | ✅ **231/231**, w tym 41 testów v0.4 (`v04.test.ts`: kalkulator płac, zaokrąglenia, PIT roczny etat i etat+JDG, straty, zdrowotna roczna, zawieszenie, zmiana formy, Mały ZUS Plus, planowanie, raport roczny, scenariusz wieloletni) oraz 6 testów migracji v3 → v4 |
| `npm run build` | ✅ JS 633 kB / 188 kB gzip, CSS 44 kB / 7,6 kB gzip |
| `npm run test:e2e` (Chromium) | ✅ **19/19** (15 wcześniejszych + 4 z v0.4: zawieszenie i zmiana formy, planowanie, rozliczenie roczne i podsumowanie, menu mobilne) |

Test wieloletni (ponad 3 lata): etat + JDG, strata w 2026, zmiana formy skala → liniowy od 2027, zawieszenie sierpień–październik 2027, Mały ZUS Plus w 2028; niezmienniki co miesiąc, brak dubli w rejestrze/zobowiązaniach, deterministyczność.
Usterka ujawniona podczas pracy: zmiana asercji e2e v0.2 (tekst „szacunek” → „kalkulator”) — zmiana zamierzona, nie regresja silnika.

## Znane problemy i uproszczenia

Pełna lista w `FEATURE_EVOLUTION.md` §14. Najważniejsze:
1. **Firma wymaga finansowania właściciela**: składki, podatki i VAT są płacone z rachunku firmowego; przy braku środków powstaje zaległość bez odsetek (odsetki za zwłokę — FE-BANK-02).
2. **Podatek jest symulacją**: zaokrąglenia do zł SIMPLIFIED; brak ulg (IP Box, B+R, internetowa, prorodzinna), PPK, kilku pracodawców; zeznania roczne to rekordy z saldem (bez składania/korekt).
3. **Lata po 2026**: reguły z 2026 r. są przenoszone i oznaczone `carriedForward` (UI ostrzega).
4. **Zlecenia**: tylko 4 profile i szablony; brak negocjacji, reputacji i windykacji; godziny rezerwowane także w weekendy; zlecenia od pracodawcy gracza blokowane.
5. Rozbieżności źródeł rozstrzygnięte w v0.4 (patrz `LEGAL_SOURCES.md`); parametry prawne tylko 2026 — **brak automatycznego przejścia na 2027**.
6. Z poprzednich wersji: potwierdzenia przez `window.confirm`, brak routera, asynchroniczny autozapis, zapis rośnie (~2,8 MB po 10 latach z JDG); `LD_LIBRARY_PATH` dla e2e (`AGENTS.md` §5).

## Następne zadanie (propozycja — wymaga zatwierdzenia)

**v0.5 — kandydaci** (kolejność do decyzji właściciela): uzupełnienie ulg i wyjątków podatkowych (ulga internetowa, IP Box, składka zdrowotna a zbieg), parametry prawne 2027 po weryfikacji źródeł, podstawowe zatrudnianie pracownika (składki pracodawcy, PPK) lub rozbudowa rynku zleceń (reputacja, windykacja). Bez spółek i branży remontowej do osobnej decyzji.

Nie rozpoczynać v0.5 bez zatwierdzenia.
