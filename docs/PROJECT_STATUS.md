# PROJECT_STATUS — stan projektu

> Aktualizuj po każdym zadaniu. Opisuje **stan faktyczny**, nie plany. Ostatnia aktualizacja: 2026-10-18.

## Wersja

**v0.3.0 — Pierwsza działalność gospodarcza (JDG)** (zakończona; v0.4 czeka na zatwierdzenie). Zapisy: `SAVE_VERSION = 3` (migracje v1 → v2 → v3). Wcześniej: v0.2.1 (korekta zatrudnienia, ADR-025), v0.2, v0.1.
Rejestr rozwoju mechanik: [`FEATURE_EVOLUTION.md`](FEATURE_EVOLUTION.md) · rejestr reguł prawnych: [`LEGAL_SOURCES.md`](LEGAL_SOURCES.md).

## Co działa (v0.3, zweryfikowane testami)

Wszystko z v0.1–v0.2.1 (czas, finanse, praca, mieszkanie, czas i zmęczenie, styl życia, oszczędności, wydarzenia, zapisy) plus:

- **JDG** (jedna naraz; **nie jest osobą prawną**): rejestracja z podglądem konsekwencji, 4 profile usługowe z PKD 2025, własny rachunek firmowy należący do osoby fizycznej, odrębna ewidencja (`scope: business`), wkład własny i pobranie właściciela (przelewy własne), zakończenie na koniec miesiąca. Start tylko 1. dnia miesiąca, nie wcześniej niż 1.02.2026.
- **Formy opodatkowania**: skala (12%/32%, kwota zmniejszająca), podatek liniowy 19% (odliczenie zdrowotnej do 14 100 zł), ryczałt (stawka z profilu; składki społeczne i 50% zdrowotnej odliczane od przychodu). Zaliczki miesięczne metodą narastającą (próg 1 000 zł, tylko zapłacone składki), saldo roczne do 30.04.
- **ZUS**: ulga na start (6 mies.), składki preferencyjne (24 mies., 1 441,80 zł), standardowe (5 652 zł), dobrowolna chorobowa, **zbieg z etatem** (etat ≥ 4 806 zł brutto → brak składek społecznych z JDG; niższy → składki). Płatność do 20. dnia. Reguły nie są naliczane automatycznie „każdemu” — zależą od wyboru, stażu działalności i etatu.
- **Składka zdrowotna**: skala 9% / liniowy 4,9% dochodu miesiąca poprzedniego z minimum 432,54 zł; ryczałt wg progów 60/300 tys. zł (498,35 / 830,58 / 1 495,04 zł).
- **VAT**: zwolnienie podmiotowe albo czynny podatnik (23%); limit 240 000 zł (rok startu proporcjonalnie, np. 220 000 zł przy starcie 1.02); utrata zwolnienia od czynności przekraczającej limit; VAT należny i naliczony jako odrębne zobowiązania (25. następnego miesiąca).
- **Zlecenia usługowe**: oferty 1. i 16. dnia miesiąca (deterministyczne), przyjęcie z wyborem godzin dziennie, rezerwacja godzin w **wspólnym budżecie czasu** (nie nakłada się na etat; konflikt = odmowa z wyjaśnieniem), koszty realizacji, postęp zależny od wydajności (wyczerpanie → kara umowna), dokument sprzedaży w dniu wykonania, płatność klienta z deterministycznym opóźnieniem 0–35 dni (przychód ≠ należność ≠ wpływ).
- **Dokumenty**: rejestr sprzedaży i kosztów (numeracja FS/FK, netto/VAT/brutto, status płatności) — **rekord symulacyjny, nie faktura KSeF**.
- **Interfejs — grupa „Firma (JDG)”**: Rejestracja JDG, Moja działalność, Oferty i kontrakty, Finanse firmy, Podatki i ZUS (tabela miesięcy + jawny rejestr reguł ze statusami), Dokumenty, Kalendarz obowiązków; baner „symulacja — nie porada prawna/podatkowa”; HUD pokazuje saldo firmy.
- **Prawo**: 39 reguł w rejestrze (`legal.ts`): 22 VERIFIED, 10 SIMPLIFIED, 7 DEFERRED; źródła urzędowe (podatki.gov.pl, biznes.gov.pl, zus.pl) sprawdzone 2026-10-18.
- **Zapisy**: migracja v2 → v3 na **prawdziwym zapisie wygenerowanym przez v0.2.1**; po wczytaniu rozliczenia nie są naliczane ponownie (klucze idempotencji).

## Zweryfikowane i niezweryfikowane przepisy

Zweryfikowane (VERIFIED): skala i kwota zmniejszająca, liniowy 19%, limit odliczenia zdrowotnej 14 100 zł (liniowy), brak odliczenia zdrowotnej w skali, odliczenia przy ryczałcie, terminy zaliczek (20.) i salda rocznego (30.04), próg 1 000 zł, minimalne wynagrodzenie 4 806 zł, podstawy i stopy ZUS 2026 (5 652 zł / 1 441,80 zł; 19,52 / 8 / 2,45 / 1,67 / 2,45%), ulga na start i składki preferencyjne (warunki, 6 i 24 mies.), zbieg z etatem, minimalna składka zdrowotna i progi ryczałtowców, limit VAT 240 000 zł i utrata zwolnienia, termin VAT (25.), ograniczenie usług dla pracodawcy. **Uproszczone (SIMPLIFIED)**: stawka ryczałtu na profil (zamiast wg PKWiU), PKD dwóch profili, proporcja limitu VAT, wyłączenia z VAT (art. 113 ust. 13), stawka VAT 23% dla wszystkich usług, brak odliczenia VAT przez zwolnionego, PIT przy etacie (bez łączenia dochodów), moment przychodu, wybór formy przy rejestracji. **Odłożone (DEFERRED)**: Mały ZUS Plus (zweryfikowany, niewdrożony), wakacje składkowe i składki przy zawieszeniu, zawieszenie działalności, roczne rozliczenie zdrowotnej, straty i ulgi, zaokrąglanie do zł, KSeF/korekty/metoda kasowa. Szczegóły i znalezione rozbieżności źródeł: `LEGAL_SOURCES.md`.

## Czego NIE ma (świadomie poza zakresem)

Spółki i wspólnicy, zatrudnianie pracowników, branża remontowa, giełda, nieruchomości inwestycyjne, kredyty i leasing, integracje z urzędami i KSeF, backend. **Wdrożenie na Vercel odłożone** (repo nadal nie jest podpięte do żadnego projektu Vercel; kod jest na `main`). Netto z etatu nadal jest **szacunkiem 73% brutto** (zweryfikowany kalkulator płac — FE-TAX-02). Pełna lista uproszczeń v0.3: `FEATURE_EVOLUTION.md` §14.

## Wykonane testy (2026-10-18)

| Polecenie | Wynik |
|---|---|
| `npm run typecheck` | ✅ bez błędów |
| `npm test` (Vitest) | ✅ **184/184**: kalendarz 8, pieniądze/RNG/formatowanie 8, silnik bazowy 34, mechaniki v0.2–v0.2.1 60, **JDG, podatki, ZUS, VAT, zlecenia 44**, zapisy 14, **migracje i zapis v2/v3 16** |
| `npm run build` | ✅ JS 569 kB / 169 kB gzip, CSS 43 kB / 7,5 kB gzip |
| `npm run test:e2e` (Chromium) | ✅ **15/15** (4 z v0.1 + 6 z v0.2 + 5 z v0.3: rejestracja, zlecenia i konflikt godzin, podatki i kalendarz, zapis JDG, menu mobilne) |

Jedyna usterka ujawniona przez testy podczas prac: klucz idempotencji rozliczenia rocznego PIT kolidował z `occurrenceId` zobowiązania (saldo roczne nigdy nie powstawało) — naprawiona, objęta testem.
Pomiary (Node 22): 10 lat gry z JDG, 80 zleceń i 156 dokumentami ≈ 3,4 s (w tym ok. 80 komend), zapis ≈ 2,8 MB, serializacja ≈ 30 ms, wczytanie z walidacją ≈ 100 ms. Wygląd ekranów „Firma” sprawdzony na zrzutach (desktop 1360 px); mobilnie przetestowane menu (e2e), pozostałe ekrany bez automatycznego testu mobilnego.

**Kryterium ukończenia v0.3** (mała działalność usługowa równolegle z życiem prywatnym, spójne finansowo konsekwencje) pokrywa test „24 miesiące z JDG równolegle z etatem” (niezmienniki co miesiąc; 24 rozliczenia, dokumenty, bez dubli; deterministyczność) oraz testy poszczególnych reguł.

## Znane problemy i uproszczenia

Pełna lista w `FEATURE_EVOLUTION.md` §14. Najważniejsze:
1. **Firma wymaga finansowania właściciela**: składki, podatki i VAT są płacone z rachunku firmowego; przy braku środków powstaje zaległość bez odsetek (odsetki za zwłokę — FE-BANK-02).
2. **Podatek jest symulacją**: brak zaokrągleń do zł, strat i ulg; przy etacie skala bez kwoty zmniejszającej i bez łączenia dochodów; zeznania roczne tylko jako saldo.
3. **Lata po 2026**: reguły z 2026 r. są przenoszone i oznaczone `carriedForward` (UI ostrzega).
4. **Zlecenia**: tylko 4 profile i szablony; brak negocjacji, reputacji i windykacji; godziny rezerwowane także w weekendy; zlecenia od pracodawcy gracza blokowane.
5. Rozbieżności źródeł ZUS/biznes.gov.pl (roczna podstawa zdrowotnej, okresy kwot) — opisane w `LEGAL_SOURCES.md`; silnik używa tylko wartości potwierdzonych spójnie.
6. Z poprzednich wersji: potwierdzenia przez `window.confirm`, brak routera, asynchroniczny autozapis, zapis rośnie (~2,8 MB po 10 latach z JDG); `LD_LIBRARY_PATH` dla e2e (`AGENTS.md` §5).

## Następne zadanie (propozycja — wymaga zatwierdzenia)

**v0.4 — Domknięcie obowiązków JDG i podatków:** po weryfikacji źródeł wdrożyć pozycje oznaczone v0.4 w `FEATURE_EVOLUTION.md` — zmiana formy opodatkowania w kolejnym roku, zawieszenie/wznowienie działalności, Mały ZUS Plus, roczne rozliczenie składki zdrowotnej, straty z lat ubiegłych, łączne rozliczenie etat + JDG oraz zweryfikowany kalkulator netto z etatu. **Bez** pracowników, spółek i branży remontowej.

Nie rozpoczynać v0.4 bez zatwierdzenia.
