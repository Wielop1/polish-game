# PROJECT_STATUS — stan projektu

> Aktualizuj po każdym zadaniu. Opisuje **stan faktyczny**, nie plany. Ostatnia aktualizacja: 2026-10-18.

## Wersja

**v0.5.0 — Pierwsza branża biznesowa: remonty i wykończenia** (zakończona; v0.6 czeka na zatwierdzenie). Zapisy: `SAVE_VERSION = 5` (migracje v1 → v2 → v3 → v4 → v5). Wcześniej: v0.4 (rozliczenia roczne), v0.3 (JDG), v0.2.1, v0.2, v0.1.
Rejestr rozwoju mechanik: [`FEATURE_EVOLUTION.md`](FEATURE_EVOLUTION.md) · rejestr reguł prawnych: [`LEGAL_SOURCES.md`](LEGAL_SOURCES.md).

## Co działa (v0.5, zweryfikowane testami)

Wszystko z v0.1–v0.4 plus:

- **Moduł branżowy** (`IndustryModule` + rejestr `industries.ts`): profil „Usługi remontowo-wykończeniowe” (PKD 43.34.Z, ryczałt 5,5%) działa na wspólnym silniku — dokumenty (`issueDocument`), zobowiązania, rachunek firmowy, budżet czasu i podatki są te same co dla innych JDG.
- **Specjalizacje i umiejętności**: malowanie, gładzie, panele, drobne prace (norma czasu, materiały, wymagany sprzęt, trudność); poziomy 2–5 rosną **wyłącznie od przepracowanych godzin**; dodatkowa specjalizacja = szkolenie.
- **Sprzęt**: 11 pozycji (ręczne, elektronarzędzia, specjalistyczny, transport) z ceną, stanem technicznym, trwałością, konserwacją i wpływem na wydajność/jakość/transport. Zakup = wydatek + koszt podatkowy (uproszczenie) + aktywo wg stanu technicznego.
- **Materiały**: 9 materiałów × 3 standardy, miesięczne wahania cen, dostępność dzienna, zakup (z kontrolą gotówki), zapas jako aktywo, zużycie proporcjonalne do postępu bez ponownego wydatku, rejestr ruchów magazynowych.
- **Zapytania klientów**: deterministyczne; szansa zależy od reputacji, reklamy (3 poziomy, opłata miesięczna), sezonu, dostępności terminów i oferowanych cen; zapytania zawierają lokalizację, zakres, termin, budżet, wymagania jakościowe i termin odpowiedzi.
- **Wycena**: koszt planowany = materiały + robocizna + transport + pozostałe; narzut ≠ marża; zaliczka, termin płatności, standard, termin realizacji; VAT: netto/brutto jawnie (23% albo zwolnienie).
- **Negocjacje**: klient akceptuje / odrzuca / prosi o rabat lub zmianę terminu; gracz przyjmuje, odrzuca albo podtrzymuje warunki (jednorazowo).
- **Kontrakt** = zlecenie wspólnego silnika (`ServiceOrder kind: renovation`) + zaliczka jako odrębny dokument, rozliczenie końcowe po zaliczce, kara za zwłokę 2%/tydzień (max 15%), rozwiązanie umowy.
- **Realizacja**: etapy (przygotowanie → materiały → realizacja → odbiór → rozliczenie), postęp zależny od czasu, umiejętności, sprzętu, zmęczenia i zapasu; problemy techniczne i organizacyjne; harmonogram z ryzykiem opóźnień; godziny dzielą dobę z etatem (bez nakładania).
- **Jakość, reputacja i reklamacje**: ocena odbioru, poprawki przy odbiorze, opinie (5 składników), reputacja z wygaszaniem, reklamacje z prawdopodobieństwem zależnym od jakości (poprawki / rabat / odmowa / eskalacja po terminie).
- **Księgowość**: samodzielnie albo biuro (3 oferty); abonament jako dokument kosztowy; przypomnienia, braki, automatyczny wniosek o zwrot zdrowotnej, coroczne porównanie form z obliczeń silnika; biuro nie liczy podatków.
- **UI**: sekcja „Remonty” (Pulpit firmy, Zapytania klientów, Wyceny, Kontrakty, Harmonogram, Magazyn i sprzęt, Reputacja i reklamacje), „Księgowość” w sekcji Firma, wybór specjalizacji przy rejestracji, wiersze zapasów i wyniku ekonomicznego w „Podsumowaniu roku”.
- **Prawo**: 66 reguł: 36 VERIFIED, 23 SIMPLIFIED, 7 DEFERRED (13 nowych — wszystkie SIMPLIFIED/DEFERRED, patrz `LEGAL_SOURCES.md`).
- **Zapisy**: migracja v4 → v5 na **prawdziwym zapisie z v0.4**; niezmienniki pilnują zapasów, ruchów magazynowych, zaliczek, rozliczeń, reklamacji i opinii.

## Zweryfikowane i niezweryfikowane przepisy

Zweryfikowane w v0.3 (VERIFIED): skala i kwota zmniejszająca, liniowy 19%, limit odliczenia zdrowotnej 14 100 zł (liniowy), brak odliczenia zdrowotnej w skali, odliczenia przy ryczałcie, terminy zaliczek (20.) i salda rocznego (30.04), próg 1 000 zł, minimalne wynagrodzenie 4 806 zł, podstawy i stopy ZUS 2026 (5 652 zł / 1 441,80 zł; 19,52 / 8 / 2,45 / 1,67 / 2,45%), ulga na start i składki preferencyjne (warunki, 6 i 24 mies.), zbieg z etatem, minimalna składka zdrowotna i progi ryczałtowców, limit VAT 240 000 zł i utrata zwolnienia, termin VAT (25.), ograniczenie usług dla pracodawcy. **Uproszczone (SIMPLIFIED)**: stawka ryczałtu na profil (zamiast wg PKWiU), PKD dwóch profili, proporcja limitu VAT, wyłączenia z VAT (art. 113 ust. 13), stawka VAT 23% dla wszystkich usług, brak odliczenia VAT przez zwolnionego, PIT przy etacie (bez łączenia dochodów), moment przychodu, wybór formy przy rejestracji. **Odłożone (DEFERRED)**: Mały ZUS Plus (zweryfikowany, niewdrożony), wakacje składkowe i składki przy zawieszeniu, zawieszenie działalności, roczne rozliczenie zdrowotnej, straty i ulgi, zaokrąglanie do zł, KSeF/korekty/metoda kasowa. Szczegóły i znalezione rozbieżności źródeł: `LEGAL_SOURCES.md`.

## Czego NIE ma (świadomie poza zakresem)

Spółki i wspólnicy, zatrudnianie pracowników, branża remontowa, giełda, nieruchomości inwestycyjne, kredyty i leasing, integracje z urzędami i KSeF, backend. **Vercel**: repo przygotowane do importu (`vercel.json`, `npm ci`, build statyczny); projekt Vercel jest tworzony przez właściciela. Pełna lista uproszczeń (po v0.4): `FEATURE_EVOLUTION.md` §14.

## Wykonane testy (2026-10-18)

| Polecenie | Wynik |
|---|---|
| `npm run typecheck` | ✅ bez błędów |
| `npm test` (Vitest) | ✅ **293/293**, w tym 56 testów v0.5 (`renovation.test.ts`: start działalności, sprzęt, wyceny i marże, negocjacje, zaliczki, zakupy i zapasy, realizacja, konflikty czasu, jakość i reklamacje, reputacja, księgowość, scenariusz 12 miesięcy, deterministyczność) oraz 6 testów migracji v4 → v5 |
| `npm run build` | ✅ JS 752 kB / 224 kB gzip, CSS 44 kB / 7,7 kB gzip |
| `npm run test:e2e` (Chromium) | ✅ **23/23** (19 wcześniejszych + 4 z v0.5: rejestracja ze specjalizacją i wycena, wszystkie ekrany + księgowość, zapis/wczytanie, menu mobilne) |

Scenariusz 12 miesięcy: polityka gracza (sprzęt, wycena wszystkich zapytań, negocjacje, podpisy, zakupy materiałów, poprawki reklamacji, konserwacja, biuro, reklama); niezmienniki co miesiąc; ≥ 8 zakończonych kontraktów, opinie, reputacja, dokumenty i zobowiązania bez dubli, zapas = suma ruchów, deterministyczność i wznowienie po zapisie.
Usterka ujawniona przez testy: odwrócona kolejność argumentów `diffDays(późniejsza, wcześniejsza)` w pięciu miejscach modułu (wygaszanie opinii, terminowość, czas odpowiedzi, termin klienta, prognoza) — naprawiona. Zmiany w testach starszych wersji: asercje wersji zapisu (4 → 5), pole `part` w dokumentach, selektor nawigacji „Pulpit” (exact), lista dopuszczalnych domen źródeł urzędowych (MF, Sejm).

## Znane problemy i uproszczenia

Pełna lista w `FEATURE_EVOLUTION.md` §14. Najważniejsze:
1. **Firma wymaga finansowania właściciela**: składki, podatki i VAT są płacone z rachunku firmowego; przy braku środków powstaje zaległość bez odsetek (odsetki za zwłokę — FE-BANK-02).
2. **Podatek jest symulacją**: zaokrąglenia do zł SIMPLIFIED; brak ulg (IP Box, B+R, internetowa, prorodzinna), PPK, kilku pracodawców; zeznania roczne to rekordy z saldem (bez składania/korekt).
3. **Lata po 2026**: reguły z 2026 r. są przenoszone i oznaczone `carriedForward` (UI ostrzega).
4. **Zlecenia**: tylko 4 profile i szablony; brak negocjacji, reputacji i windykacji; godziny rezerwowane także w weekendy; zlecenia od pracodawcy gracza blokowane.
5. Rozbieżności źródeł rozstrzygnięte w v0.4 (patrz `LEGAL_SOURCES.md`); parametry prawne tylko 2026 — **brak automatycznego przejścia na 2027**.
6. Z poprzednich wersji: potwierdzenia przez `window.confirm`, brak routera, asynchroniczny autozapis, zapis rośnie (~2,8 MB po 10 latach z JDG); `LD_LIBRARY_PATH` dla e2e (`AGENTS.md` §5).

## Następne zadanie (propozycja — wymaga zatwierdzenia)

**v0.6 — kandydaci** (kolejność do decyzji właściciela): pierwszy pracownik / podwykonawca w branży remontowej (składki pracodawcy, PPK, kierownik ekipy) razem z równoległymi kontraktami i pojazdem; albo weryfikacja źródeł i wdrożenie obniżonego VAT 8% oraz zaliczek (faktury zaliczkowe) w VAT; albo parametry prawne 2027. Bez spółek, giełdy i kredytów do osobnej decyzji.

Nie rozpoczynać v0.6 bez zatwierdzenia.
