# DECISIONS — dziennik decyzji architektonicznych

Format: **ID · tytuł** — status — kontekst — decyzja — konsekwencje. Nowe decyzje dopisuj na końcu. Nie zmieniaj treści zaakceptowanych decyzji — dodaj nową, która je zastępuje (i oznacz starą jako *Zastąpiona przez ADR-xxx*).
Statusy: *Zaakceptowana* · *Proponowana* (czeka na zatwierdzenie) · *Zastąpiona*.

---

## ADR-001 · Aplikacja SPA: Vite + React + TypeScript, statyczny build — *Zaakceptowana* (specyfikacja startowa)
**Kontekst:** gra ma działać w przeglądarce i być wdrażana przez Vercel; na start bez backendu.
**Decyzja:** Vite + React 19 + TypeScript (strict) + Tailwind 4 + Zustand + Zod + Vitest + Playwright. Bez Next.js, Supabase, n8n, logowania, multiplayera, płatnych API, generatywnego AI w grze.
**Konsekwencje:** prosty, szybki build statyczny; wszystko po stronie klienta; dodanie backendu lub SSR wymaga nowej decyzji i zatwierdzenia.

## ADR-002 · Pieniądze jako całkowite grosze — *Zaakceptowana*
**Kontekst:** błędy zmiennoprzecinkowe niszczą spójność finansową (`0.1 + 0.2`).
**Decyzja:** `Grosze = number` (safe integer), `assertGrosze`, ułamki przez `mulBps/roundDiv`; `Intl` tylko do wyświetlania. Zod odrzuca nie-całkowite kwoty w zapisie.
**Konsekwencje:** zakres ±9·10¹⁵ groszy (≈ 90 bln zł) — wystarcza; zamiast `BigInt` zachowujemy prostotę i serializację JSON. Zmiana na `BigInt` wymagałaby migracji zapisu.

## ADR-003 · Silnik czysty, deterministyczny, oddzielony od UI — *Zaakceptowana*
**Decyzja:** `src/engine` bez I/O, DOM, zegara i `Math.random`; zależy tylko od `zod`. UI i store wywołują funkcje silnika. `advanceDays` klonuje stan raz (`structuredClone`) i zwraca nowy stan.
**Konsekwencje:** pełna testowalność w Node, łatwe przyszłe przeniesienie silnika do workera/serwera; koszt: klon stanu przy każdej akcji czasu. Pomiar (2026-10-18, Node 22): 120 miesięcy ≈ 0,9 s łącznie; jeden miesiąc na stanie po 10 latach ≈ 14 ms.

## ADR-004 · Daty jako napisy ISO bez `Date` — *Zaakceptowana*
**Decyzja:** `IsoDate = "YYYY-MM-DD"`, własna arytmetyka na numerze dnia. **Konsekwencje:** brak problemów ze strefami czasowymi/DST i niedeterminizmem; własny kod kalendarza ma testy odwracalności 1900–2200.

## ADR-005 · Losowość wyprowadzana z (seed, id zdarzenia) — *Zaakceptowana*
**Kontekst:** powtarzalność i brak konieczności zapisywania stanu generatora.
**Decyzja:** `createRng(seed, streamId)` (xmur3 → mulberry32); każde losowanie ma własny strumień z id wystąpienia reguły.
**Konsekwencje:** wynik nie zależy od kolejności losowań ani od przeskoku/zapisu; nie nadaje się do kryptografii (nie jest potrzebne); nowe losowe mechaniki muszą mieć stabilne id strumienia — zmiana id zmienia historię seedów.

## ADR-006 · Model naliczenie → rozliczenie (zobowiązania i należności) — *Zaakceptowana*
**Kontekst:** wymóg: przychód ≠ wpływ gotówki; koszt ≠ wypływ tego samego dnia; zobowiązania mają wierzyciela, dłużnika, kwotę i termin.
**Decyzja:** każdy przychód/koszt cykliczny to `Obligation`; gotówka rusza przy rozliczeniu w terminie. Rejestr transakcji jest jedyną drogą zmiany salda.
**Konsekwencje:** majątek netto uwzględnia należności i zobowiązania; tożsamość księgowa jest sprawdzalna; wykresy majątku mają „piłę” (pensja uznawana ostatniego dnia miesiąca) — świadome uproszczenie (alternatywa: naliczanie dzienne, do rozważenia w v0.2+).

## ADR-007 · Pensja: naliczenie ostatniego dnia miesiąca, wypłata 10. następnego — *Zaakceptowana (parametr przykładowy)*
**Decyzja:** zgodnie z modelem ADR-006; dni i kwoty to placeholdery w `config.ts`. **Konsekwencje:** pierwsza pensja wpływa 10.02.2026 — styczeń jest „chudy” (5 000 zł startu musi wystarczyć), co daje wczesne napięcie płynności bez żadnego skryptu.

## ADR-008 · Automatyczne płatności, brak debetu, brak płatności częściowych (v0.1) — *Zaakceptowana*
**Decyzja:** zobowiązania są regulowane automatycznie w terminie, w całości lub wcale; saldo nie spada poniżej 0; brak środków ⇒ `overdueSince` + jedno zdarzenie ostrzegawcze; ponawianie codziennie.
**Konsekwencje:** prosty i przewidywalny model; brak odsetek/windykacji (v0.4). Znane uproszczenie: kolejność „od najstarszego terminu”, każde zobowiązanie próbowane niezależnie.

## ADR-009 · Parametry startowe kopiowane do stanu, oznaczone `placeholder` — *Zaakceptowana*
**Kontekst:** wymóg: nie wymyślać obowiązujących wartości; zapisy muszą być stabilne.
**Decyzja:** `config.ts` tworzy umowy i reguły w `createNewGame`; od tej pory żyją w stanie z `dataStatus: 'placeholder'`; UI pokazuje „przykładowe”. Prawo/podatki — docelowo tabele z datami obowiązywania (v0.3).
**Konsekwencje:** zmiana `config.ts` nie rusza istniejących zapisów; zweryfikowane wartości będą wymagały źródła i zmiany `dataStatus`.

## ADR-010 · Zapis: koperta JSON w IndexedDB + walidacja Zod + niezmienniki + migracje — *Zaakceptowana*
**Decyzja:** koperta `{format, version, savedAt, meta, state}`; `SAVE_VERSION = 1`; `MIGRATIONS[n]`; wczytanie = parse → migracje → schemat Zod → `checkInvariants`; sloty `autosave` + 3 ręczne; autozapis po każdej akcji czasu; fallback do pamięci, gdy IndexedDB niedostępne.
**Konsekwencje:** zmanipulowany/uszkodzony zapis jest odrzucany z komunikatem; zapisy są lokalne (brak synchronizacji między urządzeniami); rozmiar zapisu rośnie z historią — pomiar: po 10 latach gry ≈ 1,4 MB JSON (3 653 punkty historii dziennej, 840 transakcji, 1 691 zdarzeń), serializacja ≈ 50 ms, wczytanie z walidacją ≈ 70 ms. Największy udział ma dzienna historia majątku; przy większych modelach rozważyć kompaktowanie (np. dzienne punkty tylko z ostatniego roku, starsze miesięczne) — wymagałoby nowej decyzji i migracji.

## ADR-011 · Własne wykresy SVG zamiast biblioteki — *Zaakceptowana*
**Decyzja:** `LineChart`, `BarChart`, `Donut`, `ProgressBar` w `src/ui/components/charts.tsx`. **Konsekwencje:** brak zależności i mały bundle (≈ 117 kB gzip całość); koszt: własne utrzymanie, brak zaawansowanych interakcji. Zmiana na bibliotekę — nowa decyzja.

## ADR-012 · Nawigacja bez routera (stan `screen`) + `vercel.json` z fallbackiem SPA — *Zaakceptowana*
**Decyzja:** ekran to pole w store; brak adresów podstron w v0.1. `vercel.json` zawiera rewrite `/(.*) → /index.html` (system plików ma pierwszeństwo) na wypadek przyszłego routingu. **Konsekwencje:** brak głębokich linków i przycisku „wstecz” między ekranami — do rewizji, gdy pojawi się potrzeba udostępniania/podstron.

## ADR-013 · Obsługa środowiska testów e2e bez roota — *Zaakceptowana*
**Kontekst:** w środowisku deweloperskim (WSL) brakowało bibliotek systemowych Chromium (`libnspr4`, `libnss3`, `libasound2`) i brak sudo.
**Decyzja:** biblioteki z `.deb` (`apt-get download`) rozpakowane lokalnie poza repozytorium + `LD_LIBRARY_PATH`; opis w `AGENTS.md` §5. **Konsekwencje:** `npm run test:e2e` wymaga działającego Chromium; w CI użyć `npx playwright install --with-deps`.

## ADR-014 · Wersja i zakres wzorców UI v0.1 — *Zaakceptowana*
**Decyzja:** ciemny interfejs „HUD”: pasek daty/gotówki/majątku + sterowanie czasem zawsze widoczne; nawigacja boczna (desktop) i dolna (telefon); karty wskaźników, wykresy, kalendarz miesięczny z projekcją przyszłych zdarzeń. **Konsekwencje:** UI nie zawiera logiki gospodarczej; wszystkie liczby pochodzą z silnika/selektorów.

---

# v0.2 — decyzje gracza i życie prywatne

## ADR-015 · Komendy gracza: czyste funkcje na kopii stanu, błąd walidacji bez efektów ubocznych — *Zaakceptowana*
**Decyzja:** wszystkie decyzje gracza przechodzą przez `commands.*` (`src/engine/commands.ts`). `runCommand` klonuje stan, wykonuje logikę, odświeża migawkę historii dnia i zwraca `{ok, state, message}` albo `{ok:false, error}` (`CommandError`). Stan wejściowy nigdy nie jest mutowany, a odrzucona komenda nie zostawia śladów.
**Konsekwencje:** UI nie liczy niczego sam; testy komend są proste (stan wejściowy vs wyjściowy). Komendy działają „dziś” — dzień jest już zamknięty, więc nowe zobowiązania rozliczą się najwcześniej następnego dnia.

## ADR-016 · Akcje zaplanowane (`pending`) zamiast zdarzeń w przyszłości — *Zaakceptowana*
**Decyzja:** skutki w przyszłości (decyzja pracodawcy, wygaśnięcie propozycji, zwrot kaucji, koszt przeprowadzki, wypłata za zlecenie, +1 umiejętność, termin decyzji) są jednorazowymi akcjami w `state.pending`, wykonywanymi na początku `processDay` w kolejności (data, id), idempotentnie (`processed`). Dziennik zdarzeń zawiera wyłącznie to, co już się stało.
**Konsekwencje:** brak „przyszłych” wpisów w dzienniku; zapis zawiera kolejkę, więc wczytanie nie gubi ani nie dubluje skutków.

## ADR-017 · Kaucja jest aktywem, nie kosztem — *Zaakceptowana*
**Decyzja:** wpłata kaucji = transakcja gotówkowa + `Asset` (`held`); zwrot po wyprowadzce (14 dni po końcu umowy) = transakcja + status `refunded`. Aktywo wlicza się do majątku netto. Tożsamość księgowa pozostaje: majątek netto (rachunki + kaucje + należności − zobowiązania) = kapitał początkowy + przychody − koszty, bo kaucje nie są zobowiązaniami P&L. Kategorie `kaucja`, `zwrot_kaucji`, `przelew_wlasny` są poza przepływami miesięcznymi.
**Konsekwencje:** pełny zwrot (bez potrąceń za szkody) — uproszczenie v0.2. Mieszkanie startowe jest bez kaucji (parametr przykładowy), więc nie ma zwrotu przy pierwszej przeprowadzce.

## ADR-018 · Zmiana mieszkania: przyszłe naliczenia z reguł wiązanych z umową; nakładanie świadome, bezdomność niemożliwa — *Zaakceptowana*
**Decyzja:** każda umowa najmu ma własne reguły czynszu i opłat (`rule.contractId`); koniec umowy ustawia `endDate` reguł (niezmiennik: reguła kończy się razem z umową). Przeprowadzka tylko na 1. dzień miesiąca, od najbliższego do dnia po wygaśnięciu obecnej umowy (wypowiedzenie = ostatni dzień miesiąca po okresie wypowiedzenia). Wcześniejsza data = nakładanie się umów (podwójny czynsz, pokazany w podglądzie); późniejszej nie ma. Umowy o pracę nie mogą się nakładać (jedna praca naraz).
**Konsekwencje:** brak naliczania dwóch czynszów poza jawnym nakładaniem; brak proporcjonalnych czynszów za część miesiąca.

## ADR-019 · Jedna mechanika wynagrodzeń; netto to oznaczony szacunek — *Zaakceptowana*
**Decyzja:** zmiana pracy, awans i utrata pracy działają przez `Contract(employment)` + `rule:salary:<contractId>` — ta sama reguła naliczenia ostatniego dnia miesiąca i wypłaty 10. następnego co w v0.1; brak drugiego systemu pensji. Oferta ma brutto; netto = `estimateNet` (73% brutto, `NET_ESTIMATE_BPS`, placeholder) i jest tak opisane w UI. Zapisy v1 mają `grossMonthly: null` (brak danych nie jest zgadywany).
**Konsekwencje:** do v0.3 (zweryfikowany kalkulator płac) żadna liczba netto nie jest wyliczeniem prawnym.

## ADR-020 · Budżet czasu, zmęczenie i wydajność — *Zaakceptowana*
**Decyzja:** doba = praca + sen + obowiązki + działalność (rezerwa) + zobowiązania czasowe + czas wolny (reszta). Każda zmiana (plan dnia, nowa praca, kurs, zlecenie) jest walidowana na rok do przodu, uwzględniając podpisane przyszłe umowy — nie można przeznaczyć tych samych godzin na dwie rzeczy. Zmęczenie (0–100) zmienia się o całkowitą deltę dzienną z budżetu godzin (wzory w `ECONOMY_ENGINE.md`); wydajność = 100% − 0,7 p.p. za każdy punkt zmęczenia powyżej 30. Wydajność wpływa na premię, awans, ryzyko utraty pracy i szansę w rekrutacji — nie na pensję bezpośrednio.
**Konsekwencje:** brak rozbudowanego systemu zdrowia; święta i urlopy nieuwzględnione (dzień roboczy = pon–pt).

## ADR-021 · Jakość życia nie jest funkcją majątku — *Zaakceptowana*
**Decyzja:** wskaźnik 0–100 = styl życia 25% + standard mieszkania 20% + czas na odpoczynek 20% + kondycja (100 − zmęczenie) 20% + bezpieczeństwo finansowe 15%. Bezpieczeństwo ma sufit (bufor ≥ 3 miesiące kosztów = 100) i kary za zaległości i bezrobocie.
**Konsekwencje:** pieniądze pomagają tylko pośrednio (wybór stylu życia/mieszkania, bufor); wagi i progi są parametrami do kalibracji.

## ADR-022 · Oszczędności: odsetki z sumy sald dziennych, jedno zaokrąglenie, odrębne operacje — *Zaakceptowana*
**Decyzja:** codziennie saldo na początek dnia jest dodawane do akumulatora (grosze·dni); ostatniego dnia miesiąca odsetki = `round(akumulator × stawka_bps / (10 000 × 365))` (jedno zaokrąglenie, brak dryfu), księgowane jako należność na rachunku oszczędnościowym; podatek od odsetek to osobne zobowiązanie (`taxBps`, 0 = brak). Stawki to konfigurowalne parametry (`dataStatus: placeholder`), nie fakty prawne. Przelew własny to dwa wpisy o sumie zero z wspólnym `transferId`, poza przepływami miesięcznymi i bez wpływu na majątek netto.
**Konsekwencje:** zobowiązania i należności mają teraz `accountId` (rozliczenie z właściwego rachunku); invariants sprawdzają saldo każdego rachunku i pary przelewów.

## ADR-023 · Wydarzenia życiowe: katalog z losowaniem miesięcznym, decyzje z domyślnym wygaśnięciem — *Zaakceptowana*
**Decyzja:** 7 szablonów (awaria sprzętu, niespodziewany wydatek, premia, awans, utrata pracy, dorywcze zlecenie, kurs). W `rollDay` każdego miesiąca losowane jest wystąpienie z prawdopodobieństwem zależnym od stanu (umowa, staż, wydajność, czas wolny, gotówka). Losowanie i wynik mają osobne strumienie z (seed, id wydarzenia[, opcja]), więc wynik decyzji nie zależy od momentu jej podjęcia. Decyzje mają termin; po jego upływie stosowana jest opcja domyślna. Skutki liczy ten sam silnik zobowiązań/umów; status wydarzenia i `processed` chronią przed podwójnym zastosowaniem. Opcja `settings.lifeEvents` (domyślnie włączona) pozwala testom mechaniki bazowej wyłączyć losowość.
**Konsekwencje:** zmiana id szablonu/strumienia zmienia historię seedów; kalibracja częstości wymaga danych z rozgrywek.

## ADR-024 · Migracja zapisu v1 → v2 z zamrożonymi wartościami domyślnymi — *Zaakceptowana*
**Decyzja:** `migrateV1ToV2` (`src/persistence/migrations.ts`) nie zmienia historii finansowej, dodaje nowe struktury z zamrożonymi stałymi (nie importuje `config.ts`), nie zgaduje nieznanych danych (`grossMonthly`, standard i powierzchnia lokalu → `null`), przenosi opłaty z reguły „media” do umowy najmu, a wydatki stylu życia mapuje tak, że „standardowy” = kwoty z v1. Test używa **prawdziwego zapisu wygenerowanego przez v0.1** (`fixtures/save-v1.json`).
**Konsekwencje:** zapisy v1 działają dalej bez resetu; kolejne migracje dopisujemy w `MIGRATIONS`, fixture’ów nie usuwamy.

---

# v0.2.1 — korekta zatrudnienia

## ADR-025 · Zwolnienia z przyczyn (nie z upływu czasu) i rozdzielenie stażu w firmie od stażu na stanowisku — *Zaakceptowana* (zmienia fragmenty ADR-023)
**Kontekst:** w v0.2 utrata pracy miała stałe ryzyko 1,2%/mies. od 90. dnia stażu, więc samo przewijanie czasu kończyło się zwolnieniem (ok. 50% w 5 lat), a awans (nowa umowa) zerował staż.
**Decyzja:**
1. Ryzyko zwolnienia (`layoffRisk`, `src/engine/labor.ts`) jest sumą czynników; bez czynników wynosi 0: wydajność/absencje z wyczerpania (+150 pkt bazowych/mies. przy wydajności < 60%, +40 przy < 80%), trudna sytuacja pracodawcy (+50; 15% lat), recesja (+50; 15% lat). Klimat gospodarczy i kondycja pracodawcy są losowane deterministycznie z (seed, rok) i (seed, pracodawca, rok), niezależnie od działań gracza. Okres próbny: bez ryzyka przy stażu w firmie < 90 dni. Wydarzenie podaje przyczynę (największy czynnik); ekran „Oferty pracy” pokazuje poziom ryzyka i czynniki.
2. Staż w firmie = ciągłość zatrudnienia u tego samego pracodawcy: łańcuch umów, w którym każda następna zaczyna się dzień po końcu poprzedniej, a poprzednia zakończyła się zmianą warunków (`terminatedBy: null`), nie wypowiedzeniem. Staż na stanowisku = od początku bieżącej umowy. Premia i ryzyko zwolnienia używają stażu w firmie; awans wymaga obu (≥ 180 dni w firmie i na stanowisku) oraz 12 miesięcy od poprzedniego.
**Konsekwencje:** brak zmian schematu i migracji — łańcuch wynika z istniejących pól, więc zapisy v1 i v2 działają bez zmian (awanse z v0.2 mają `terminatedBy: null`). Pomiar na 60 seedach × 5 lat: bierna gra traci pracę w ok. 8% przypadków (przyczyny zewnętrzne), wyczerpujący plan dnia w ok. 53%. Bez absencji jako osobnej mechaniki — „absencje” to opis niskiej wydajności z wyczerpania. Wartości są przykładowe.

---

# v0.3 — pierwsza działalność gospodarcza (JDG)

## ADR-026 · JDG jako ewidencja osoby fizycznej: rachunek firmowy + `scope: 'business'` — *Zaakceptowana*
**Kontekst:** JDG nie jest osobą prawną (wymóg specyfikacji); nie wolno modelować jej jako spółki z własnym właścicielem.
**Decyzja:** `Business` należy do osoby gracza (`ownerId`); ma własny rachunek `type: 'business'` (własność osoby fizycznej) i odrębną ewidencję: zobowiązania/należności z `scope: 'business'` rozliczane z rachunku firmowego. Majątek netto obejmuje saldo firmowe. Prywatne podsumowania miesięczne pomijają ewidencję firmową; firmowe (`businessSummaries`) pomijają VAT jako przepływ przelotowy. Finansowanie działalności to zwykłe przelewy własne (`transferFunds`: wkład/pobranie) — nie przychód ani koszt. Niezmienniki wymuszają: rachunek firmowy należy do właściciela-osoby, ewidencja zgodna z rachunkiem.
**Konsekwencje:** brak równoległego systemu pieniędzy; składki, podatek i VAT z rachunku firmowego → brak środków = zaległość (gracz musi finansować firmę). Jedna aktywna JDG; start tylko 1. dnia miesiąca (≥ 1.02.2026), zakończenie na koniec miesiąca.

## ADR-027 · Rejestr reguł prawnych ze statusami i źródłami; 2026 zweryfikowane, później przenoszone z flagą — *Zaakceptowana*
**Decyzja:** `src/engine/legal.ts` zawiera `LEGAL_RULES` (id, zakres, daty, źródło urzędowe, data weryfikacji, `VERIFIED`/`SIMPLIFIED`/`DEFERRED`, ograniczenia) oraz `RULES_2026` (wartości w groszach/pkt bazowych). `docs/LEGAL_SOURCES.md` jest generowany z rejestru. Kalkulatory (`tax.ts`) są czyste. Rozliczenia zapisują identyfikatory użytych reguł (`taxPeriods.ruleIds`) i flagę `carriedForward` dla lat po 2026. Testy sprawdzają zweryfikowane przykłady liczbowe.
**Konsekwencje:** reguł niezweryfikowanych (Mały ZUS Plus, wakacje składkowe, zawieszenie, roczna zdrowotna, KSeF, straty/ulgi) nie ma w silniku, a UI je pokazuje jako „odłożone”. Weryfikacja kolejnych lat = nowy zestaw wartości, nie nadpisanie.

## ADR-028 · Rozliczenia podatkowo-składkowe na koniec miesiąca, metoda narastająca — *Zaakceptowana*
**Decyzja:** ostatniego dnia miesiąca `closeMonth` tworzy zobowiązania: składki społeczne (reżim: ulga → 24 mies. preferencyjnych → standard, albo „pokryte etatem” przy zbiegu), składkę zdrowotną i zaliczkę PIT — termin 20. dnia następnego miesiąca. Zaliczka = podatek narastający od początku roku − dotychczasowe zaliczki; ≤ 1 000 zł nie jest wpłacana i kumuluje się; odliczane są tylko **zapłacone** składki. Grudzień (lub zakończenie działalności) tworzy saldo roczne do 30 kwietnia. Klucze idempotencji (`processed`) chronią przed ponownym naliczeniem po wczytaniu zapisu. (Test wykrył i naprawił błąd: klucz rozliczenia rocznego kolidował z `occurrenceId` zobowiązania.)
**Konsekwencje:** brak odsetek za nieterminowe płatności i kwartalnych rozliczeń; zaokrąglanie do zł niewdrożone.

## ADR-029 · VAT i dokumenty przez wspólny silnik zobowiązań — *Zaakceptowana*
**Decyzja:** dokument sprzedaży/kosztu (`Document`) nie jest fakturą KSeF; przy czynnym VAT rozbijany jest na zobowiązania: netto (przychód/koszt), VAT od/dla kontrahenta oraz VAT należny/naliczony wobec US (termin 25. następnego miesiąca). Kategorie VAT są przepływem przelotowym (poza wynikiem firmy; tożsamość księgowa zachowana). Zwolnienie podmiotowe: dokument bez VAT, koszt brutto. Limit 240 000 zł (rok startu: proporcjonalnie do pełnych miesięcy); przekroczenie → status czynny od tej czynności, jej kwota traktowana jako netto + 23%.
**Konsekwencje:** nadwyżka VAT naliczonego trafia jako należność od US z terminem 25. (uproszczenie); brak korekt, metody kasowej, innych stawek.

## ADR-030 · Zlecenia usługowe korzystają z budżetu czasu i wydajności — *Zaakceptowana*
**Decyzja:** przyjęcie zlecenia rezerwuje wybraną liczbę godzin dziennie jako `commitment` i jest walidowane na każdy dzień do terminu (te same godziny nie służą etatowi, snu i zleceniu naraz). Postęp dzienny = godziny × wydajność (zmęczenie), więc wyczerpany wykonawca kończy po terminie i płaci karę umowną (zmniejsza fakturę); po terminie + 30 dni zlecenie przepada. Przychód (dokument w dniu wykonania), należność i wpływ gotówki są odrębnymi zdarzeniami; klient płaci po terminie umownym z deterministycznym opóźnieniem 0–35 dni. Zlecenia od pracodawców gracza są blokowane (ochrona ulg i form opodatkowania).
**Konsekwencje:** brak negocjacji, reputacji i wyceny przez gracza (FEATURE_EVOLUTION: FE-BIZ-05/06).

## ADR-031 · SAVE_VERSION 3 i migracja v2 → v3 — *Zaakceptowana*
**Decyzja:** `migrateV2ToV3` dodaje puste kolekcje JDG i `scope: 'personal'` do istniejących zobowiązań; niczego nie zmyśla. Test używa **prawdziwego zapisu v2 wygenerowanego kodem v0.2.1** (`fixtures/save-v2.json`, wygenerowany przez `git worktree` na commicie 6a6485a) obok fixture v1; łańcuch v1 → v2 → v3 jest testowany.
**Konsekwencje:** zapisy v1 i v2 wczytują się bez resetu; kolejne migracje dopisujemy do `MIGRATIONS`, fixture’ów nie usuwamy.

## ADR-032 · Rejestr rozwoju mechanik jako obowiązkowy dokument — *Zaakceptowana* (polecenie właściciela)
**Decyzja:** `docs/FEATURE_EVOLUTION.md` porównuje mechaniki z docelowym zachowaniem; `AGENTS.md` wymaga sprawdzenia go przed zadaniem i aktualizacji tylko dotkniętych pozycji; pozycje i pomysły nie są usuwane. **Konsekwencje:** każde nowe uproszczenie musi trafić do §14.

## ADR-033 · Kalkulator płac i `payrollFrom` (zgodność wsteczna) — *Zaakceptowana*
**Decyzja:** netto z etatu liczy `payroll.ts` (składki, koszty, zaliczka narastająco, PIT-2, ulga dla młodych) zamiast szacunku 73%. Odcinki płacowe (`payslips`) są częścią stanu; przychód PIT liczy się w roku wypłaty. Zapisy v3: wynagrodzenia naliczone do dnia migracji zachowują wypłaconą kwotę (`settings.payrollFrom`, odcinki „legacy” materializowane leniwie) — historia się nie zmienia.
**Konsekwencje:** zmiana netto dla nowych miesięcy; testy wzorcowe (4 806 zł → 3 605,85 zł).

## ADR-034 · Rozliczenie roczne: łączny PIT-36 dla skali, osobne zeznania dla liniowego i ryczałtu — *Zaakceptowana*
**Decyzja:** 31 grudnia powstają rekordy zeznań (`taxReturns`) z rozróżnieniem zaliczek pracodawcy, zaliczek własnych i zobowiązania rocznego; kwota zmniejszająca 3 600 zł raz. Dopłata (30.04) i zwrot (+45 dni) to obligacje; zwrot nie wpływa automatycznie „od razu”. Zaokrąglenie podstawy i podatku do zł (SIMPLIFIED).

## ADR-035 · Straty podatkowe jako odrębny rejestr — *Zaakceptowana*
**Decyzja:** `taxLosses` (rok, forma, kwota, odliczenia); 5 lat, ≤ 50% rocznie; strata podatkowa ≠ księgowa ≠ ujemny przepływ. Jednorazowe odliczenie 1 mln zł — DEFERRED.

## ADR-036 · Roczna składka zdrowotna i wnioski o zwrot — *Zaakceptowana*
**Decyzja:** dopłata jako zobowiązanie do 20 maja; nadpłata nie jest księgowana automatycznie — gracz składa wniosek (komenda) do 31 maja, inaczej wygasa. Powód: przepis wymaga wniosku; unikamy fikcyjnej gotówki.

## ADR-037 · Zawieszenie, zmiana formy i Mały ZUS Plus jako jawne komendy — *Zaakceptowana*
**Decyzja:** zawieszenie w całych miesiącach (≥ 30 dni), zmiana formy tylko od 1 stycznia z planem do anulowania i historią form, Mały ZUS Plus tylko przez deklarację gracza z weryfikacją warunków (nie „po cichu”). Niezweryfikowane warianty — DEFERRED (rejestr reguł).

## ADR-038 · Planowanie jako prognoza na kopii stanu — *Zaakceptowana*
**Decyzja:** `planning.ts` klonuje stan, wstrzykuje założone dokumenty i uruchamia ten sam silnik; nigdy nie zmienia stanu gry (test na równość snapshotu). UI oznacza wynik jako prognozę.

## ADR-039 · SAVE_VERSION 4 i migracja v3 → v4 — *Zaakceptowana*
**Decyzja:** `migrateV3ToV4` dodaje puste kolekcje (payslips, taxReturns, taxLosses, healthSettlements), historię formy, pola zawieszeń/MZP oraz `payrollFrom`; test na prawdziwym zapisie z v0.3 (fixture `save-v3.json`).

## ADR-040 · Moduły branżowe: prosty interfejs i rejestr, bez frameworka pluginów — *Zaakceptowana* (polecenie właściciela, v0.5)
**Decyzja:** `IndustryModule` (`onRegister`, `processDay`, `gaps`) rejestrowany w `industries.ts`; profil działalności wskazuje moduł. Moduł dostarcza treści i mechanikę branży, a podatki, księgowanie, rachunki, czas, należności i zobowiązania zostają we wspólnym silniku (`issueDocument`, `createObligation`, `commitments`). Rejestr wypełnia import `industries.ts` w `simulate.ts` (unika cyklu importów).
**Konsekwencje:** kolejne branże dopisuje się w `industries.ts`; stan modułu żyje w `GameState.reno` (analogicznie można dodać kolejne klucze).

## ADR-041 · Kontrakt remontowy = `ServiceOrder` + `RenoJob` — *Zaakceptowana*
**Decyzja:** kontrakt jest zwykłym zleceniem (`kind: 'renovation'`), więc widać go w istniejących widokach i blokuje zamknięcie/zawieszenie działalności; `RenoJob` przechowuje specyfikę (etapy, materiały, jakość). Szablonowe zlecenia v0.3 pomijają zlecenia typu renovation. Sprzedaż, zaliczka i koszty to dokumenty `issueDocument` — moduł nie tworzy równoległych należności.

## ADR-042 · Zaliczka jako odrębny dokument sprzedaży — *Zaakceptowana*
**Decyzja:** zaliczka to dokument `part: 'advance'` (płatny w 2 dni, bez losowego opóźnienia), a rozliczenie końcowe `part: 'final'` obejmuje cenę − zaliczka − kara umowna. Suma = cena − kara; invariant pilnuje jednej zaliczki i jednego rozliczenia na kontrakt. Uproszczenia podatkowe (moment przychodu, faktury zaliczkowe, korekty) → RENO-ADVANCE-VAT/PIT, FE-BIZ-03.

## ADR-043 · Zapas i sprzęt jako aktywa; koszt podatkowy ≠ koszt ekonomiczny — *Zaakceptowana*
**Decyzja:** zakup materiałów i sprzętu to dokument kosztowy (gotówka przez zobowiązanie, koszt podatkowy w dacie zakupu) i jednocześnie aktywo w majątku netto (`inventory`, `equipment`). Zużycie materiałów przenosi wartość zapasu do kosztu kontraktu bez nowego wydatku; zużycie sprzętu obniża wartość księgową wg stanu technicznego. Rejestr ruchów magazynowych pozwala sprawdzić zapas niezmiennikiem; tożsamość majątku netto uwzględnia aktywa.

## ADR-044 · Doświadczenie wyłącznie z przepracowanych godzin; jakość i reklamacje z przyczyn — *Zaakceptowana*
**Decyzja:** poziom umiejętności zależy od efektywnie przepracowanych godzin (wydajność × czas), a nie od kliknięć. Jakość pracy = umiejętności + standard materiałów + sprzęt − zmęczenie ± niewielka losowość; prawdopodobieństwo reklamacji zależy od jakości, problemów, poprawek, opóźnienia i dopasowania standardu (nie jest stałe). Reputacja to średnia ocen z wygaszaniem i zakotwiczeniem 3,5★.

## ADR-045 · Biuro rachunkowe bez drugiego kalkulatora; porównanie form jako informacja — *Zaakceptowana*
**Decyzja:** biuro pobiera abonament (zwykły dokument kosztowy), wysyła powiadomienia, zgłasza braki i składa wniosek o zwrot nadpłaty (istniejąca komenda); porównanie form używa funkcji z `tax.ts` na danych roku i jest oznaczone jako informacja, nie doradztwo podatkowe (ACC-ADVISORY). Odpowiedzialność pozostaje po stronie przedsiębiorcy (ACC-RESPONSIBILITY).

## ADR-046 · SAVE_VERSION 5 i migracja v4 → v5 — *Zaakceptowana*
**Decyzja:** `migrateV4ToV5` dodaje `part: 'full'` do dokumentów, `kind: 'service'` do zleceń oraz puste `reno` i `accounting`; historia nietknięta. Test na prawdziwym zapisie z v0.4 (`save-v4.json`). Błąd znaleziony przez testy podczas prac: odwrócona kolejność argumentów `diffDays(późniejsza, wcześniejsza)` w pięciu miejscach modułu — naprawiony, objęty testami (wygaszanie opinii, terminowość, czas odpowiedzi).

## ADR-047 · Pracownicy jako element wspólnego silnika: osoba ≠ umowa — *Zaakceptowana* (polecenie właściciela, v0.6)
**Decyzja:** `GameState.ops` (wspólny silnik, nie moduł branży) przechowuje osoby (`WorkerPerson`: umiejętności jako doświadczenie, oczekiwania, dostępność, morale, zmęczenie, staranność, lojalność), umowy o pracę (`Employment`: stanowisko, brutto, wymiar, start/koniec, historia wynagrodzeń) i listy płac. Osoba przeżywa zakończenie umowy (historia zatrudnienia i wynagrodzeń), więc w przyszłości może zmieniać pracodawców i stanowiska. Branża remontowa tylko *używa* pracowników (umiejętności = identyfikatory usług).

## ADR-048 · Płace i koszty pracodawcy: kalkulator z v0.4 + składki 2026, trzy zobowiązania i jeden dokument kosztowy — *Zaakceptowana*
**Decyzja:** lista płac używa `computePayroll` (netto, ZUS i PIT pracownika, ulga dla młodych, PIT-2) oraz `employerContributions` (emerytalna 9,76%, rentowa 6,5%, wypadkowa 1,67%, FP 2,45%, FGŚP 0,10%; limit 30-krotności tylko dla emerytalnej i rentowej; FP/FGŚP od progu płacy minimalnej). Koszt = jeden dokument `part: payroll` (koszt podatkowy = brutto + składki pracodawcy), a gotówka = trzy zobowiązania (netto do 10., ZUS i PIT do 20.) — suma równa kosztowi (niezmiennik), brak podwójnego księgowania. Zestawienia firmy i raport roczny liczą przychody i koszty z dokumentów (`taxAmount`), nie z kategorii zobowiązań.

## ADR-049 · Zaliczki: zobowiązanie do wykonania usługi, przychód po wykonaniu; kontrolowana migracja — *Zaakceptowana*
**Decyzja:** zaliczka od klienta to osobny dokument (`part: advance`, `taxAmount: 0`, zobowiązanie kategorii `zaliczka_klienta`); przychód podatkowy i ekonomiczny powstaje w dokumencie rozliczenia końcowego (`taxAmount` = reszta + zaliczka), VAT od zaliczki w dacie otrzymania (czynny podatnik). Majątek netto odejmuje zaliczki do czasu wykonania usługi (`deferredAdvances`). Zwrot zaliczki po rozwiązaniu umowy likwiduje zobowiązanie (bez kosztu), z korektą VAT jako należnością od US. Zapisy v5 migrują do trybu `advanceMode: legacy` (ich zaksięgowana historia się nie zmienia); nowe kontrakty — `deferred`. Zaliczka dla podwykonawcy to przedpłata (aktywo) rozliczana przy odbiorze pracy. Zasady PIT dla zaliczek nie zostały odczytane w tekście ustawy → SIMPLIFIED (ADV-PIT).

## ADR-050 · Kalendarz zasobów: rezerwacje (przydziały) + dzienny zbiór użycia — *Zaakceptowana*
**Decyzja:** przydziały (`ops.assignments`) rezerwują pracowników, podwykonawców, sprzęt i pojazdy na okno umowne kontraktu i są częścią zapisu (kalendarze odtwarzają się po wczytaniu). Przy opóźnieniach obowiązuje dodatkowo dzienny zbiór użytych zasobów w kolejności startu kontraktów (pierwszeństwo wcześniejszego), dzięki czemu zasób nie pracuje przy dwóch kontraktach tego samego dnia, a rezerwacji nie trzeba przedłużać. Niezmiennik pilnuje braku nakładania się rezerwacji.

## ADR-051 · Wydajność ekipy: prosty model wąskich gardeł — *Zaakceptowana*
**Decyzja:** postęp dnia = suma wkładów (godziny × wydajność osoby × szybkość z poziomu i sprzętu × komplet narzędzi 100%/35%), ograniczona liczbą sensownie zatrudnionych osób (1 na 12 godz. normy; nadwyżka 25%), współczynnikiem koordynacji (≤2: 100%, 3: 93%, 4: 88%, ≥5: 84%) i transportu (pojemność pojazdu vs ładunek; bez pojazdu 90% przy ≥ 2 osobach). Materiały wspólne, z priorytetem kontraktów. Ten sam kod liczy wycenę (`assume`) i realizację (`actual`).

## ADR-052 · Delegowanie bez nowych ról zarządczych — *Zaakceptowana*
**Decyzja:** właściciel może pracować (godziny w budżecie czasu), nadzorować (1 godz. dziennie) albo delegować całkowicie (0 godzin; jakość −4 pkt i większe ryzyko problemów). Nie ma jeszcze kierowników ekip ani menedżerów — zapisane w rejestrze rozwoju.

## ADR-053 · Pojazdy bez reguł podatkowych — *Zaakceptowana* (polecenie właściciela)
**Decyzja:** zakup pojazdu to dokument `part: capital` (`taxAmount: 0`) i zobowiązanie `zakup_pojazdu`; wartość = cena × stan techniczny (aktywo). Koszty eksploatacji i koszty stałe księgowane miesięcznie jako zwykły dokument kosztowy. Amortyzacja, limity, VAT od pojazdów, leasing i kredyty — odłożone (VEH-TAX-DEFERRED).

## ADR-054 · SAVE_VERSION 6 i migracja v5 → v6 — *Zaakceptowana*
**Decyzja:** `migrateV5ToV6` dodaje `ops` (z pulą 5 podwykonawców z ziarna gry), pola kontraktów (`crew`, `advanceMode: legacy`, nowe koszty) i oferty (`teamId`, `supervision`, `vehicleId`); historia nietknięta. Test na prawdziwym zapisie z v0.5 (`save-v5.json`). Błędy znalezione przez testy podczas prac: dzielenie zapasu między kontrakty (podwójne liczenie), tytuł zdarzenia > 200 znaków (powiadomienie księgowe), brak rezerwacji czasu dla kontraktów delegowanych (niezmiennik), dokument w całości pokryty zaliczką bez zobowiązania.


## ADR-055 · Rynek lokalny jako wspólna warstwa silnika, branża przekazuje parametry — *Zaakceptowana* (polecenie właściciela, v0.7)
**Kontekst:** do v0.6 zapytania powstawały z jednej dziennej szansy (`enquiryRateBps`) niezależnej od konkurencji, zdolności wykonawczej i klientów, którzy w ogóle szukają wykonawców; zatrudnienie nie miało sensownej ekonomii (stały koszt bez dodatkowego popytu).
**Decyzja:** `market.ts` (wspólny silnik) liczy popyt miasta, dzieli klientów między firmy i zwraca graczowi tylko jego zapytania; branża przekazuje `MarketIndustry` (usługi, udziały, sezonowość, `rollProject`, `estimate`) i punkty zaczepienia `MarketHooks` (tworzenie zapytania, księgowanie opłat). Konfiguracja w jednym pliku `marketConfig.ts`, wszystkie liczby **kalibracyjne** (nie z GUS), oznaczone w UI. Model uruchamia się leniwie (`market.initializedOn`) w pierwszym dniu firmy remontowej.
**Konsekwencje:** stary mechanizm szansy dziennej i `reno.advertising` usunięte; kolejne branże i miasta = nowy `MarketIndustry` + wpis w `MARKET_CITIES` (bez zmian wspólnego kodu). Rynek działa tylko, gdy gracz ma aktywną firmę w branży (konkurenci „stoją”, gdy firma jest zawieszona — luka ≥ 1 miesiąca nie jest nadrabiana).

## ADR-056 · Koniunktura miesięczna zakotwiczona w istniejącym klimacie rocznym — *Zaakceptowana*
**Decyzja:** `macroAt(seed, miesiąc)` interpoluje kotwice roczne z `economicClimate` (używanego przy ryzyku zwolnień) i dodaje wygładzony szum; cztery fazy (wzrost, stabilizacja, spowolnienie, recesja) wpływają na popyt, skłonność do wydatków, ceny materiałów, oczekiwania płacowe kandydatów (płaca minimalna obowiązuje zawsze) i kondycję konkurentów. Wynik jest czystą funkcją (seed, miesiąc), buforowaną; nie ma osobnego stanu.
**Konsekwencje:** brak drugiego, sprzecznego systemu; rok „w recesji” wg `economicClimate` zawsze ma w środku roku spowolnienie lub recesję (test). Zmiana wzoru zmienia przyszłe ceny materiałów i oczekiwania kandydatów w istniejących zapisach (bez zmiany historii).

## ADR-057 · Alokacja klientów: zestaw rozważanych firm + ocena oferty + rozstrzygnięcie z konkurentem — *Zaakceptowana*
**Decyzja:** szukający wykonawcy losuje segment, zlecenie i zestaw 2–3 firm ważony widocznością; kanały marketingowe modyfikują zestaw (polecenia: często „pytam tylko Ciebie”, portale: dodatkowy rywal). Konkurent z zestawu składa ofertę (cena z jego poziomu cen, jakość, reputacja, czas oczekiwania); klient wybiera najlepszą ocenę. Gracz konkuruje dopiero przy decyzji klienta: `contestRival` porównuje ocenę jego oferty z oceną najsilniejszego rywala (tablica logistyczna zamiast `exp`, żeby wyniki nie zależały od implementacji funkcji transcendentalnych); po wygranej działa dotychczasowe `decideQuote`. Przegrane zlecenie trafia do rywala (raz). Segment (budżetowy/standardowy/premium) zmienia wagi: wrażliwość na cenę, jakość, reputację, termin, budżet, skłonność do negocjacji i ryzyko reklamacji.
**Konsekwencje:** najniższa cena nie wygrywa automatycznie; testy: słabe opinie przegrywają w segmencie premium, ale tanio wygrywa w budżetowym. Testy silnika i symulator korzystają z tych samych funkcji.

## ADR-058 · Konkurenci: uproszczona ekonomia, brak wiedzy o graczu, widok jako oszacowania — *Zaakceptowana*
**Decyzja:** konkurent ma rozmiar, usługi, pozycjonowanie, ceny, jakość, reputację, marketing, zaległość pracy (godziny i wartość dodana) i gotówkę; bez księgowości i podatków. Miesięcznie: przychód z wykonanych godzin − koszty; reguły decyzji (ceny, marketing, zatrudnienie/zwolnienie, zmiana pozycjonowania, wyjście z rynku, wejście nowych) zależą wyłącznie od jego wyników i koniunktury — **nigdy od stanu gracza** (test: ścieżka konkurentów identyczna przy różnej gotówce gracza). Gracz widzi oszacowania z szumem (`competitorViews`): wielkość jako przedział, ceny względem średniej, gwiazdki ±, intensywność marketingu — bez gotówki, obciążenia i dokładnych cen.
**Konsekwencje:** 15 firm na start (parametr), cel liczby firm zależy od koniunktury i średniego obłożenia.

## ADR-059 · Marketing: sześć kanałów z malejącymi korzyściami i opóźnieniem; pozycjonowanie wdrażane stopniowo — *Zaakceptowana*
**Decyzja:** kanały (wyszukiwarka, reklamy lokalne, portale, polecenia, wizytówka, współpraca z przedsiębiorcami) mają maksymalną widoczność, nasycenie (budżet dający połowę maksimum), opóźnienie efektu, wagi segmentów, wrażliwość na koniunkturę i tłok (reklama konkurentów). Budżet obowiązuje od 1. dnia następnego miesiąca, koszt = dokument kosztowy „Marketing: …”. Pozycjonowanie (niska cena / zrównoważone / premium) zmienia wagi segmentów, dopasowanie marki i koszt; efekt narasta liniowo 90 dni, zmiana najwcześniej po 60 dniach, historia decyzji w stanie; reputacja nietknięta.
**Konsekwencje:** reklama nie jest mnożnikiem przychodów — te same pieniądze w nasyconym kanale dają mniej, a efekt zależy od rynku.

## ADR-060 · SAVE_VERSION 7 i migracja v6 → v7 bez danych wstecznych — *Zaakceptowana*
**Decyzja:** `migrateV6ToV7` dodaje `market` (nieuruchomiony), konwertuje `reno.advertising` na budżety kanałów (ten sam miesięczny koszt) i dopisuje zapytaniom `segment`/`source`/`rivals…` (brak konkurencji). Nie generuje konkurentów, zdarzeń ani przychodów wstecz; historia nietknięta (test na prawdziwym zapisie z v0.6 wygenerowanym przed zmianami). Przy okazji poprawiono limit `blockedReason` (120 → 400 znaków): komunikat przestoju kontraktu z nazwą podwykonawcy mógł przekroczyć limit i uniemożliwić wczytanie zapisu.

## ADR-061 · Symulator balansu: ten sam silnik, bot przez komendy, bez drugiej implementacji — *Zaakceptowana*
**Decyzja:** `tools/balance/` (`npm run balance`): bot gra wyłącznie przez `commands.*` (a dla bezpiecznych komend walidujących przed mutacją — bezpośrednio na stanie, bo kopiowanie stanu dominowało czas), strategie są jawnymi politykami (struktura firmy, marketing, pozycjonowanie), przebiegi idą w wątkach roboczych, raport = JSON + podsumowanie. `advanceDaysInPlace` (bez kopii) dla wywołujących na wyłączność. Bot nie jest „optymalnym graczem” — to przewidywalny, jednakowy dla wszystkich strategii gracz; jego decyzje (cena względem budżetu klienta, brak podwójnego obiecywania terminów, limity równoległych prac) są opisane w `BALANCE_REPORT.md`.
**Konsekwencje:** wyniki bota to ocena modelu, nie przepis na wygraną; parametry kalibracyjne zmieniamy tylko przy konkretnym problemie wskazanym przez wyniki.


## ADR-062 · Operator gospodarczy: ten sam silnik dla JDG i spółki przez podmianę kontekstu, bez drugiego silnika — *Zaakceptowana* (polecenie właściciela, v0.8)
**Kontekst:** moduły firmowe (remonty, pracownicy, ekipy, pojazdy, marketing) pracowały na jednym stanie JDG (`s.reno`, `s.ops`, `s.market.marketing/strategy`). Spółka z o.o. musi prowadzić tę samą działalność na własnym majątku, bez kopiowania ~5 tys. linii kodu i drugiego silnika podatkowego.
**Decyzja:** wprowadzono minimalną abstrakcję `Operator` (wspólna część JDG i spółki: id, właściciel, profil, VAT, rachunek, zawieszenia) oraz `withOperator(s, id, fn)` (`operator.ts`), który na czas wywołania podstawia stan spółki (`Company.slices`: `reno`, `ops`, marketing, strategia) w miejsce stanu JDG i przywraca go także po wyjątku (`corp.context` jest zawsze `null` w stanie spoczynkowym — niezmiennik). Moduły przyjmują `Operator` zamiast `Business` (zmiana wyłącznie typów); JDG pozostaje w „korzeniu” stanu, więc **nic nie jest przepisywane ani migrowane**. Komendy remontowe/kadrowe/rynkowe wykonują się na wybranym podmiocie (`corp.selected`); UI czyta niezmienny widok `operatorView`.
**Konsekwencje:** nowa branża lub podmiot = nowy wpis, nie nowy silnik; podatki JDG (`business.ts`, `annual.ts`, `tax.ts`) pozostają JDG-owe; spółka ma własny CIT (`cit.ts`). Wymaga dyscypliny: funkcje analityczne muszą filtrować po rachunku operatora (poprawiono `availableCash`, `fixedCosts`, `liquidityForecast`, `businessLiquidity`, `yearReport`, `businessSummaries`, planowanie).

## ADR-063 · Własność wg właściciela rachunku: `type: company`, `scope: company`, majątek netto gracza bez majątku spółki — *Zaakceptowana* (v0.8)
**Decyzja:** rachunek spółki ma `type: 'company'` i `ownerId` = id spółki; `createObligation` wyznacza stronę własną (wierzyciel/dłużnik) z właściciela rachunku, a ewidencję (`scope`) z typu rachunku. Wszystkie dotychczasowe filtry `scope === 'business'` (JDG) automatycznie nie obejmują spółki. `netWorthBreakdown` liczy należności/zobowiązania i salda tylko gracza, plus `shares` (szacunkowa wartość udziałów) i `sharesBook` (koszt nabycia). **Tożsamość księgowa** jest teraz: `(majątek netto − shares) + sharesBook = kapitał początkowy + naliczone przychody − koszty + zapasy/sprzęt/pojazdy/przedpłaty − zaliczki + zrealizowany zysk ze sprzedaży udziałów`. Jedyne dozwolone przepływy osoba↔spółka: wkład na kapitał (para wpisów o sumie zero), dywidenda (osobne zobowiązanie spółki i należność gracza), transakcje na udziałach.
**Konsekwencje:** wartość firmy nie trafia do gotówki gracza; niezmiennik wychwytuje ukryte przelewy. Nie ma pożyczek ani sprzedaży gracz↔spółka (art. 210 KSH).

## ADR-064 · Rejestr udziałów z partiami, zdarzeniami i skutecznością emisji dopiero po wpisie — *Zaakceptowana* (v0.8)
**Decyzja:** `corp.holdings` (wspólnik × spółka: liczba, nominał, prawa głosu na udział, ograniczenia, partie nabycia z kosztem FIFO, historia) i `corp.shareEvents` (zawiązanie, emisja, przeniesienie). Emisja nowych udziałów (art. 262 § 4 KSH) jest skuteczna z wpisem: wpłata subskrybenta trafia na rachunek spółki od razu, ale w bilansie jest zobowiązaniem (`pendingIncrease`) do czasu wpisu; wtedy powstają udziały, rośnie kapitał zakładowy, a nadwyżka (agio) trafia do kapitału zapasowego (art. 154 § 3). Przeniesienie udziałów ma klucz idempotencji. Niezmienniki: suma udziałów = struktura kapitału, kapitał = liczba × nominał, zdarzenia = stan rejestru, brak udziałów „z powietrza”.
**Konsekwencje:** pre-/post-money i rozwodnienie są wyliczane z całkowitej liczby udziałów i ceny emisyjnej w pełnych groszach (rzeczywisty przydział może różnić się o ułamki procenta od celu).

## ADR-065 · Uchwały: progi z KSH i decyzje postaci AI z reguł, nie z losowości — *Zaakceptowana* (polecenie właściciela, v0.8)
**Decyzja:** próg zależy od rodzaju uchwały (art. 245: bezwzględna większość; art. 246 § 1: 2/3 dla zmiany umowy, w tym podwyższenia kapitału; 3/4 przy istotnej zmianie przedmiotu — zapisane, niedostępne). Głos = udział (art. 242); od v0.8.1 rozróżnione: za / przeciw / wstrzymujące się / nieważne / nieoddane — patrz ADR-072. Zgromadzenie po 14 dniach (art. 238), jedyny wspólnik od razu (art. 156). Postać AI głosuje według użyteczności z jej cech (zaufanie, cel, preferencja dywidend, tolerancja ryzyka, kompetencje, wycena emisji) z niewielkim deterministycznym szumem (seed + uchwała + postać); powód głosu zapisany w historii. Przegrana uchwała nie wykonuje skutków; uchwała podjęta, lecz niewykonalna (np. brak środków) ma status `failed`. Zaufanie zmienia się po głosowaniach tylko wtedy, gdy decyzja przeszła wbrew głosowi postaci lub zgodnie z nim.
**Konsekwencje:** brak losowych konfliktów; dwa te same stany dają te same głosy (test).

## ADR-066 · Dywidenda jako dwie strony zobowiązań rozliczane razem — *Zaakceptowana* (v0.8)
**Decyzja:** uchwała o podziale zysku wymaga zatwierdzonego sprawozdania, kwoty do podziału (art. 192: suma zysków zamkniętych lat − wykonane podziały), aktywów netto po wypłacie ≥ kapitał zakładowy (art. 189 § 2) i wolnej gotówki. Po uchwale spółka ma zobowiązania: netto dla każdego wspólnika (termin wypłaty) i zryczałtowany podatek 19% (do 20. następnego miesiąca); gracz ma należność netto, której **silnik nie rozlicza automatycznie** — rozlicza ją `syncDividends` dopiero po tym, jak spółka faktycznie zapłaciła swoje zobowiązanie (niezmiennik: gracz nie otrzymuje dywidendy, której spółka nie wypłaciła). Wypłata nie jest kosztem CIT.
**Konsekwencje:** brak „dywidendy z powietrza”; gdy spółce zabraknie gotówki, wypłata czeka (zaległość), a należność gracza pozostaje otwarta.

## ADR-067 · CIT z dokumentów, 9% po sprawdzeniu warunków, automatyczne zamknięcie roku 31.12 — *Zaakceptowana* (v0.8)
**Decyzja:** podstawa = przychody − koszty z dokumentów spółki (kwoty `taxAmount` wspólnego silnika); zaliczki miesięczne narastająco; stawka 9% tylko, gdy przychody roku ≤ 2 mln € i (mały podatnik lub rok rozpoczęcia), inaczej 19% (cały rok); strata 5 lat/50% rocznie; zeznanie CIT-8 składane automatycznie 31 grudnia, saldo płatne do 31 marca. Wynik finansowy roku = zmiana aktywów netto − wpłaty na kapitał + uchwalone dywidendy (zysk księgowy ≠ podstawa ≠ gotówka). Podatek minimalny niestosowany (wszystkie spółki spełniają wyłączenie).
**Konsekwencje:** kwoty podatkowe dziedziczą uproszczenia wspólnego silnika (sprzęt jednorazowo, pojazdy bez kosztu); estoński CIT i zaliczki kwartalne odłożone.

## ADR-068 · Rynek z wieloma firmami gracza — *Zaakceptowana* (v0.8)
**Decyzja:** `processMarketDay(s, date, firms)` przyjmuje listę `MarketFirm` (JDG: `player`, spółka: `player:<id>`), każda z własnym marketingiem, strategią, reputacją i zapytaniami (liczonymi w kontekście operatora); klient nie rozważa dwóch firm tego samego właściciela. Wywołanie przeniesiono z `processRenovation` do `processMarket` (po przetworzeniu operatorów, raz dziennie).
**Konsekwencje:** zachowanie dla samego JDG bez zmian (wszystkie testy v0.7 przechodzą); statystyki `market.months` są sumą dla firm gracza.

## ADR-069 · Właściciel nie jest wykonawcą w spółce; brak umów gracz↔spółka — *Zaakceptowana* (v0.8)
**Decyzja:** w kontekście spółki `ownerAvailable` jest fałszywe — nie można wyceniać „własnymi rękami”, tworzyć ekip z właścicielem ani przydzielać go do kontraktu; praca wspólnika dla spółki wymagałaby odrębnej umowy (a przy jedynym wspólniku-zarządzie — aktu notarialnego, art. 210 KSH). Czynności wiążące spółkę wymagają członkostwa w zarządzie (udziały nie wystarczą) i podpisu współzarządcy przy reprezentacji łącznej.
**Konsekwencje:** zgodność z odrębnością majątku; „praca właściciela w spółce” i wynagrodzenia zarządu zapisane jako rozszerzenia (FE-CORP-05, FE-CORP-11).

## ADR-070 · Wycena spółki i ZUS wspólnika jednoosobowej spółki — *Zaakceptowana* (v0.8)
**Decyzja:** wycena = aktywa netto + część (50%) nadwyżki wartości dochodowej (zysk 12 mies. × mnożnik 2,0–7,0 zależny od stabilności przychodów, koniunktury, płynności i zaległości), dyskonto przy stracie; odświeżana co miesiąc i po zdarzeniach kapitałowych (migawki `monthly`). Jedyny wspólnik (osoba gracza) płaci składki jak przedsiębiorca od wpisu do KRS (art. 8 ust. 6 pkt 4, art. 13 pkt 4a SUS): standardowe społeczne i zdrowotną 830,58 zł (art. 81 ust. 2za).
**Konsekwencje:** wartość udziałów w majątku gracza zmienia się skokowo (miesięcznie), nie codziennie; model jest kalibracyjny.

## ADR-071 · SAVE_VERSION 8 i migracja v7 → v8 bez przepisywania historii — *Zaakceptowana* (v0.8)
**Decyzja:** `migrateV7ToV8` dodaje wyłącznie `corp` (puste listy, pula 10 postaci deterministyczna z ziarna, `selected: 'jdg'`, `context: null`). Stare JDG pozostają JDG (nie spółkami), historia, dokumenty, kontrakty i rynek nietknięte. Test na prawdziwym zapisie wygenerowanym przez v0.7 przed zmianami (`save-v7.json`). Uszkodzony rejestr udziałów odrzuca wczytanie (niezmienniki).
**Konsekwencje:** zapisy v1–v7 migrują łańcuchowo; brak ponownej emisji udziałów, dubli dywidend i przeniesień (klucze `processed`, testy).

## ADR-072 · Głosowania: za / przeciw / wstrzymujące się / nieważne / nieoddane — *Zaakceptowana* (polecenie właściciela, v0.8.1)
**Decyzja:** uchwała ma pięć kategorii głosów. Zgodnie z art. 4 § 1 pkt 9–10 KSH „głosy” to głosy za, przeciw i wstrzymujące się, a bezwzględna większość to więcej niż połowa głosów **oddanych** (wstrzymujący się wchodzi do mianownika, nie jest głosem „za”). Głosy nieważne (wspólnik wyłączony z głosowania, art. 244) i **nieoddane** (brak głosu — dotychczasowy błąd: v0.8 zapisywał brak głosu gracza jako „wstrzymujący się”) nie są głosami oddanymi. Kworum nie obowiązuje (art. 241). 2/3 i 3/4 liczone od głosów oddanych (SIMPLIFIED), jednomyślność (art. 246 § 3) = głosy „za” wszystkich uprawnionych. `Resolution.tally` ma pola `invalid`, `notCast`, `eligible` (domyślnie 0 — zapisy starsze zachowują wynik).
**Konsekwencje:** brak głosu gracza nie działa już „przeciw”; testy czystych progów i integracyjne (`corp.test.ts`).

## ADR-073 · Rzeczywisty zarobek: koszty rzeczywiste ≠ kalkulacyjna praca właściciela — *Zaakceptowana* (polecenie właściciela, v0.8.1)
**Decyzja:** wycena i rozliczenie pokazują osobno: przychód, koszty rzeczywiste (materiały, płace pracowników, podwykonawcy, transport, drobne, zużycie sprzętu), kalkulacyjną wartość pracy właściciela (godziny × stawka), nadwyżkę przed obciążeniami właściciela (cena − koszty rzeczywiste), zysk ekonomiczny (nadwyżka − praca właściciela), stawkę za godzinę pracy właściciela i wpływ na płynność (`QuoteEconomics`, `JobFinancials`). Plan kosztów dostaje pola `ownerLabor` i `equipment` (domyślnie 0; `total` bez zmian). Praca własna w JDG nie tworzy przepływu pieniężnego ani kosztu podatkowego (test); w spółce właściciel nie jest wykonawcą (brak umowy, art. 210 KSH) — nie ma pracy wspólnika ani wypłat.
**Konsekwencje:** gracz widzi, że „zysk” z karty zlecenia nie jest pensją; ostrzeżenia rozróżniają stratę gotówkową od ujemnego zysku ekonomicznego.

## ADR-074 · Większe projekty jako kontener nad kontraktami, pakiety aktywowane „na czas” — *Zaakceptowana* (polecenie właściciela, v0.8.1)
**Decyzja:** projekt (`RenoProject`: klient B2B, wymagania, warunki płatności, kara, pakiety z zależnościami) NIE jest drugim silnikiem — pakiet robót to zwykły `RenoJob` (kosztorys, materiały, zasoby, termin, postęp, jakość, odbiór z istniejącego modułu) z `projectId`, `packageId`, `dependsOn`. Pakiety bez poprzedników powstają przy podpisaniu umowy projektu, pozostałe — dzień po odbiorze poprzedników (zaliczka etapu, nowe okno czasu, rezerwacje zasobów dopiero wtedy). Powód: pakiety podpisane z góry „starzały się” przy opóźnieniach (kaskadowe anulowanie po 45 dniach, rezerwacje w przeszłości). Aktywacja w ciągu dnia jest próbowana na kopii stanu (nieudana — brak godzin/wykonawców — nie zostawia częściowych zapisów) i ponawiana następnego dnia. Kara za zwłokę dotyczy własnego opóźnienia pakietu.
**Konsekwencje:** istniejące mechaniki (jakość, reklamacje, materiały, harmonogram) działają bez zmian; „zadania” to dziś wyprowadzony cykl pakietu — struktura pozwala rozszerzyć je na domy, bloki i inne obiekty (FE-SCALE-01).

## ADR-075 · Referencje i poziomy dostępu niezależne od formy prawnej — *Zaakceptowana* (polecenie właściciela, v0.8.1)
**Decyzja:** dostęp do projektów (poziom 1: do 25 tys. zł, 2: do 90 tys. zł, 3: powyżej) zależy od referencji wynikających z rzeczywiście wykonanych robót (liczba i wartość ukończonych kontraktów, średnia ocena, ukończone projekty niższego poziomu) i zdolności realizacyjnej (wykonawcy, wolne godziny, gotówka na start), nie od formy prawnej. Zapytania o poziom wyższy niż dostępny („na wyrost”) są widoczne razem z brakującymi wymaganiami, ale nie dają się wycenić; zapytania są rzadkie i ograniczone (≤ 2 otwarte, ≤ 3 w realizacji).
**Konsekwencje:** nowa firma nie dostaje wielkich kontraktów; JDG nie jest blokowana z powodu formy.

## ADR-076 · Kalibracja v0.8.1 — mierzona, osobno dla składników — *Zaakceptowana* (polecenie właściciela, v0.8.1)
**Decyzja:** zmiany tylko tam, gdzie pomiar wskazał konkretny problem (`tools/balance/audit.ts`, `BALANCE_REPORT.md` §10): (1) cena referencyjna gładzi 48 → 54 zł/m² (zarobek godzinowy gładzi, trudniejszej i wymagającej szkolenia, był niższy niż malowania); (2) jeden problem na budowie nie dołoży więcej niż 40% normy kontraktu (stała pula 6–16 godz. podwajała robociznę małych pakietów). Wielkość rynku, liczba zapytań, konwersja, ceny pozostałych usług i normy czasu — bez zmian (nie ma dowodu na ich błąd; nie zwiększano jednocześnie cen i liczby klientów).
**Konsekwencje:** wyniki przed/po na tym samym bocie, seedach i horyzoncie (`docs/balance/`).

## ADR-077 · SAVE_VERSION 9 i migracja v8 → v9 — *Zaakceptowana* (v0.8.1)
**Decyzja:** `migrateV8ToV9` dodaje puste `b2bClients`/`projects` do stanu remontowego JDG i spółek, pola powiązania pakietów (`projectId`, `packageId`, `dependsOn`, `paymentDelayDays`) w kontraktach, `ownerLabor`/`equipment` w planach kosztów (0) oraz kategorie głosów w uchwałach. Historia księgowa i kwoty kontraktów nietknięte; pula klientów B2B powstaje deterministycznie z ziarna przy pierwszym dniu po migracji. Test na prawdziwym zapisie wygenerowanym przez v0.8 (`save-v8.json`).
**Konsekwencje:** zapisy v1–v8 migrują łańcuchowo; nowy model wyceny działa na nowych kontraktach.

## ADR-078 · Domyślny nadzór właściciela 0 godz. — *Zaakceptowana* (polecenie właściciela, v0.8.1)
**Decyzja:** zlecenie pracy podwykonawcy lub ekipie bez właściciela domyślnie nie zajmuje godzin właściciela („pełne delegowanie”, −4 pkt jakości, większe ryzyko — bez zmian); nadzór 1 godz. dziennie jest opcją. Powód: podpisanie umowy z podwykonawcą blokowało się brakiem 1 wolnej godziny, mimo że właściciel nie miał wykonywać pracy.
**Konsekwencje:** domyślne wartości w wycenie, podpisie oferty, zmianie wykonawców i silniku (`'supervise'` tylko przy jawnym wyborze).


## ADR-079 · Korekta po przeglądzie: bot v2, dane rynkowe, zabezpieczenia B2B — *Zaakceptowana* (polecenie właściciela, v0.8.1)
**Decyzja:** (1) wnioski o nierentowności zespołów z pierwszej serii pomiarów były artefaktem bota (jawny nadzór 1 godz./kontrakt, pojazd 38 tys. zł z 45 tys. zł gotówki, 25–38 kontraktów w toku na 3 wykonawców) — bot v2 używa domyślnych ustawień gry i zachowuje podstawową dyscyplinę (nadzór 0, pojazd przy 90 tys. zł, ≤ 4 kontrakty na wykonawcę); (2) cena malowania 34 → 38 zł/m² (robocizna do mediany rynku ok. 28 zł/m²; źródła: cenauslug.pl, kb.pl — orientacyjne); (3) wykonawcy pakietów projektu: zatrudnieni przed właścicielem, skład dopasowany przy aktywacji (zwolnienie w ciągu 7 dni), brak długich przerw; (4) gotówka: płace zatrudnionych nie są dodatkowym wydatkiem na start pakietu, środki do dyspozycji = najniższe saldo prognozy 60 dni minus niekupione materiały trwających kontraktów, przekroczenie blokuje ofertę projektu; (5) zaliczki B2B 10–30%, ceny B2B 94–100% prywatnych; (6) projekt przerwany po 45 dniach bez możliwości startu pakietu.
**Konsekwencje:** zespoły są na cienkiej marży, ale nie bankrutują systematycznie; B2B ma sens dla firm z mocą (`BALANCE_REPORT.md` §11); wciąż brakuje kredytu/zaliczek finansujących start (v0.9).


## ADR-080 · „Zostaje do kieszeni”, bot v3, pula 10 podwykonawców — *Zaakceptowana* (uwaga właściciela, v0.8.1)
**Decyzja:** (1) wycena pokazuje szacunek „zostaje po wszystkim” (nadwyżka − udział w kosztach stałych − orientacyjny podatek) obok zysku ekonomicznego; kalkulacyjna praca właściciela pozostaje miarą porównawczą, nie kosztem; (2) oferta pracy pokazuje próg obłożenia, od którego zatrudnienie się opłaca, i zapas gotówki na pensję; (3) pula podwykonawców 5 → 10 firm (identyfikatory `sub:1–5` i ich parametry bez zmian; migracje zapisów dostają szerszą pulę); (4) bot: zapas terminu +2 dni kalendarzowe (pomiar w `BALANCE_REPORT.md` §11.7), limit zleceń w toku dla „tylko podwykonawcy” liczy 6 wykonawców. Ceny i płace bez zmian — pomiar nie wykazał błędu kalibracji; marża zespołu jest cienka z natury modelu.
**Konsekwencje:** gracz widzi realny wynik zlecenia i ryzyko zatrudnienia; zespoły i B2B nadal wymagają finansowania (v0.9), bo przy płatnościach 54–60 dni zamrożona gotówka powoduje niewypłacalność w ogonie rozkładu (25–33% przebiegów).
