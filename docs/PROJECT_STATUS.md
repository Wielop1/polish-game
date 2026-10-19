# PROJECT_STATUS — stan projektu

> Aktualizuj po każdym zadaniu. Opisuje **stan faktyczny**, nie plany. Ostatnia aktualizacja: 2026-10-19.

## Wersja

**v0.7.0 — Rynek, konkurencja i balans gospodarki** (zakończona; v0.8 czeka na zatwierdzenie). Zapisy: `SAVE_VERSION = 7` (migracje v1 → … → v7). Wcześniej: v0.6 (pracownicy, ekipy, podwykonawcy; commit bazowy 979bae3 + poprawki UI do e4e04e4), v0.5 (branża remontowa), v0.4 (rozliczenia roczne), v0.3 (JDG), v0.2.1, v0.2, v0.1.
Rejestr rozwoju mechanik: [`FEATURE_EVOLUTION.md`](FEATURE_EVOLUTION.md) · rejestr reguł prawnych: [`LEGAL_SOURCES.md`](LEGAL_SOURCES.md) · analiza balansu: [`BALANCE_REPORT.md`](BALANCE_REPORT.md).

## Co działa (v0.7, zweryfikowane testami)

Wszystko z v0.1–v0.6 plus:

- **Rynek lokalny jako wspólna warstwa silnika** (`market.ts`, `marketConfig.ts`, `macro.ts`, `renovationMarket.ts`; ADR-055–059): popyt miasta (kalibracyjnie ≈ 300 projektów/mies. na 170 tys. mieszkańców) → klienci szukający wykonawców → zestaw 2–3 firm → zapytania do gracza. Oddzielone: popyt rynkowy, szukający wykonawców, zapytania, konwersja i możliwa liczba obsłużonych kontraktów. Stary mechanizm „szansy dziennej” usunięty; zatrudnienie samo nie zwiększa liczby zapytań.
- **Konkurenci**: 15 firm na start (solo / mała / średnia) z usługami, pozycjonowaniem, cenami, jakością, reputacją, marketingiem, zaległością pracy i uproszczoną gotówką; zmieniają ceny, marketing i moce, wychodzą z rynku i wchodzą nowi; **nie znają stanu gracza** (test). Gracz widzi oszacowania (wielkość jako przedział, ceny względem średniej, gwiazdki ±).
- **Segmenty klientów** (budżetowy / standardowy / premium): wrażliwość na cenę, oczekiwana jakość, reputacja, termin, budżet, negocjacje, ryzyko reklamacji (wpływa na `complaintBps`); struktura zależna od koniunktury.
- **Wybór oferty przez klienta**: klient porównujący firmy wybiera między Tobą a najsilniejszym konkurentem (cena względem budżetu, jakość z uwzględnieniem standardu materiałów, reputacja, termin, dopasowanie marki); przegrane zlecenie trafia do konkurenta; po wygranej działa dotychczasowa decyzja klienta. Nie wygrywa się samą najniższą ceną.
- **Marketing**: 6 kanałów (wyszukiwarka, reklamy lokalne, portale, polecenia, wizytówka, współpraca z przedsiębiorcami) z malejącymi korzyściami, opóźnieniem efektu, wrażliwością na koniunkturę i „tłokiem”; budżet rozdziela gracz, obowiązuje od 1. dnia następnego miesiąca (dokument kosztowy „Marketing: …”); koszt pozyskania zapytania i umowy; dawna reklama (3 poziomy) zastąpiona.
- **Strategia firmy**: pozycjonowanie niska cena / zrównoważone / premium; wdrażanie liniowo 90 dni, odstęp ≥ 60 dni, koszt utrzymania, historia decyzji; reputacja nie jest zerowana.
- **Koniunktura i sezonowość**: miesięczna koniunktura w 4 fazach **zakotwiczona w istniejącym klimacie rocznym** (to samo źródło co ryzyko zwolnień); wpływ na popyt, skłonność do wydatków, ceny materiałów, oczekiwania płacowe kandydatów (płaca minimalna obowiązuje zawsze) i konkurentów; sezonowość ogólna i per usługa; elastyczność popytu względem cen rynkowych.
- **UI** (sekcja „Rynek”): Rynek lokalny, Konkurencja, Marketing, Strategia firmy, Analiza popytu (lejek, segmenty, moc, **rentowność zatrudnienia**); karta zapytania pokazuje segment i konkurencję, kreator wyceny — orientacyjne ceny rynkowe; „Reputacja i reklamacje” kieruje do Marketingu. Parametry modelu oznaczone jako „kalibracyjne”.
- **Symulator balansu** (`npm run balance`, ADR-061, `tools/balance/`): ten sam silnik, bot gra przez `commands.*`, 7 strategii firmy, wątki robocze, raport JSON i podsumowanie, tryb szybki i debug jednego seeda (`--trace`). Wyniki i wnioski: [`BALANCE_REPORT.md`](BALANCE_REPORT.md).
- **Zapisy**: `migrateV6ToV7` — bez danych wstecznych (model rynku startuje „od teraz”), dawna reklama → budżety kanałów, zapytania dostają segment; test na prawdziwym zapisie wygenerowanym przez v0.6 przed zmianami (`save-v6.json`). **Poprawka znaleziona testem migracji:** limit `blockedReason` zwiększony (120 → 400 znaków), bo komunikat przestoju z nazwą podwykonawcy mógł uniemożliwić wczytanie zapisu.
- **Menu i E2E**: poprawka z wcześniejszej sesji (licznik „decyzje do podjęcia” widoczny także przy zwiniętej sekcji „Życie”; helper `nav` w testach); E2E uruchomione w pełni (`LD_LIBRARY_PATH`, `AGENTS.md` §5).

## Co działa (v0.6 — bez zmian, poza opisanymi wyżej)

Wszystko z v0.1–v0.5 plus:

- **Pracownicy (wspólny silnik, nie moduł branży)**: osoba (`WorkerPerson`) oddzielona od umowy o pracę (`Employment`) — historia zatrudnienia i wynagrodzeń zostaje przy osobie; umiejętności jako doświadczenie, oczekiwania, dostępność, morale, zmęczenie, staranność, lojalność. Limit 8 pracowników (stopa wypadkowa 1,67%).
- **Rekrutacja**: ogłoszenie (koszt jako dokument firmy + 1 godz. dziennie przez 5 dni), zgłoszenia deterministyczne (różne poziomy — także poniżej wymaganego, oczekiwania ≥ płaca minimalna), negocjacja (akceptacja / kontrpropozycja / odmowa), walidacje (płaca minimalna proporcjonalnie do wymiaru, dostępność kandydata).
- **Płace i koszty pracodawcy 2026**: kalkulator płac z v0.4 (netto, ZUS i PIT pracownika, ulga dla młodych) + składki pracodawcy (emerytalna 9,76%, rentowa 6,5%, wypadkowa 1,67%, FP 2,45%, FGŚP 0,10%; przykład wzorcowy 4 806 zł → 984,28 zł). Lista płac = jeden dokument kosztowy + 3 zobowiązania (netto do 10., ZUS i PIT do 20.). Proporcja dni w pierwszym/ostatnim miesiącu, zmiana wynagrodzenia od następnego miesiąca z historią.
- **Wypowiedzenie** wg stażu (art. 36 KP): 2 tygodnie / 1 miesiąc / 3 miesiące; płaca i składki do końca okresu, potem zatrudnienie wygasa.
- **Podwykonawcy (B2B)**: pula 5 firm (cennik, jakość, niezawodność, historia), oferta → umowa → zaliczka (przedpłata, nie koszt) → odbiór → rozliczenie (koszt na pełną cenę bez VAT, zapłata reszty); ryzyko opóźnień i wad (wpływ na jakość i reklamacje); bez pracowniczego ZUS.
- **Ekipy i równoległe kontrakty**: ekipa z właściciela, pracowników i podwykonawców; kalendarz zasobów (pracownicy, podwykonawcy, sprzęt, pojazdy — bez nakładania); wydajność z składu (komplety narzędzi, koordynacja, limit sensownej obsady, transport); wspólny zapas materiałów z priorytetem kontraktów; kilka kontraktów naraz.
- **Delegowanie**: właściciel pracuje / nadzoruje (1 godz. dziennie) / bez nadzoru (0 godzin; −4 pkt jakości, większe ryzyko problemów).
- **Pojazdy**: kombi, mały dostawczy, bus; zakup za gotówkę, aktywo wg stanu technicznego, pojemność (wąskie gardło), koszty eksploatacji i stałe; bez kosztu podatkowego i reguł podatkowych (VEH-TAX-DEFERRED).
- **Rentowność**: koszty przypisane do kontraktów (materiały, praca wg godzin, podwykonawcy, pojazd) oddzielone od kosztów stałych (bezczynność płac, pojazdy, reklama, księgowość, rekrutacja, ZUS właściciela); rentowność ekip vs właściciel; prognoza płynności 60 dni; panel firmy w „Pulpicie firmy”.
- **Korekta zaliczek**: zaliczka to gotówka i zobowiązanie do wykonania usługi (nie przychód i nie majątek netto do czasu wykonania); przychód podatkowy i ekonomiczny po wykonaniu usługi; VAT od zaliczki w dacie otrzymania; zwrot zaliczki likwiduje zobowiązanie (bez kosztu). Zaliczki dla podwykonawców jako przedpłata. Zapisy v5 zachowują stare ujęcie (`legacy`).
- **UI**: „Pracownicy”, „Rekrutacja” (sekcja Firma); „Podwykonawcy”, „Ekipy”, „Harmonogram wielu kontraktów”, „Pojazdy”, „Rentowność” (sekcja Remonty); wybór ekipy, nadzoru i pojazdu przy wycenie; panel firmy (pracownicy, koszty zatrudnienia, kontrakty, obłożenie ekip, prognoza płynności).
- **Zajętość terminów przy wycenie**: karta zapytania („Zapytania klientów”) pokazuje werdykt „Termin klienta jest wolny / Masz zajęty termin” z listą trwających kontraktów, najbliższym wolnym startem (z uwagą, gdy wykracza poza elastyczność klienta) i paskiem 3 tygodni; kreator wyceny ma kalendarz z zajętymi dniami (kliknięcie dnia ustawia start), kolizjami, przyciskiem „Ustaw najbliższy wolny start” i listą zajętych terminów (kontrakty i oferty bez umowy). Ostrzeżenie o zajętym pojeździe już w podglądzie wyceny. Silnik: `quoteSchedule` (czysta projekcja).
- **Podpisanie umowy ze zmianą wykonawcy**: przy zaakceptowanej ofercie („Wyceny”) można wskazać, kto wykona pracę (jak w ofercie / sam / mój pracownik / podwykonawca) — przydatne, gdy właściciel nie ma wolnego sprzętu lub godzin. Ekran od razu pokazuje, czy podpisanie jest możliwe i dlaczego nie (próba na kopii stanu, te same reguły), a przy podwykonawcy — jego cenę i szacunek zarobku. Cena umowy zostaje z oferty; podwykonawca po podpisaniu przysyła ofertę do akceptacji. Silnik: `signContract(s, quoteId, crew?)`.
- **Zajęty podwykonawca**: wycena ostrzega, gdy wybrany podwykonawca jest przydzielony do innego kontraktu w tym terminie (z datą, od kiedy mógłby zacząć), lista wykonawców pokazuje „zajęty do …”, a sugerowany start go omija. Przestój kontraktu podaje konkretną przyczynę (nazwa podwykonawcy i data startu / oferta czeka na akceptację / brak umowy) zamiast ogólnego „ekipa nieprzydzielona”; komunikaty przy podpisaniu umowy i akceptacji oferty ostrzegają, gdy podwykonawca zaczyna po starcie kontraktu.
- **Wykonawcy wybierani wprost w wycenie**: sekcja „Kto wykona pracę” — pola wyboru: właściciel, zatrudnieni pracownicy (z rolą i poziomem do tej usługi) i podwykonawcy (z ceną za całość); nie trzeba wcześniej tworzyć ekipy w „Ekipy” (gotowa ekipa nadal jest do wyboru). Przy zbyt niskim poziomie, braku specjalizacji lub sprzętu formularz od razu proponuje pracownika lub podwykonawcę („Zleć pracownikowi” / „Zleć i wyceń”; cena z narzutem 25%, jeśli obecna nie pokrywa kosztów). Skład to wirtualna ekipa w podglądzie (`crew:…`); prawdziwa ekipa powstaje przy wysłaniu oferty i jest używana ponownie. Po podpisaniu umowy podwykonawcy od razu przysyłają ofertę do zaakceptowania w „Podwykonawcy” (ważna 5 dni).
- **Powiadomienia w menu (kropki)**: przy pozycji menu (pulpit, panel mobilny, nagłówek grupy i przycisk „Więcej”) świeci złota kropka, gdy w danym ekranie coś czeka: otwarte zapytania, negocjacje/umowy, kontrakt zablokowany, reklamacje, zużyty sprzęt/pojazd, nowi kandydaci, pracownik z niskim morale/zmęczeniem, oferty podwykonawców, zagrożona płynność, zaległe zobowiązania firmy, nowe powiadomienia biura rachunkowego (te gasną po wejściu na ekran; reszta po załatwieniu sprawy). Logika: `src/ui/navAlerts.ts`; tylko widok — nie zmienia stanu ani zapisu.
- **Prawo**: 77 reguł: 38 VERIFIED, 29 SIMPLIFIED, 10 DEFERRED (13 nowych/zmienionych; patrz `LEGAL_SOURCES.md`).
- **Zapisy**: migracja v5 → v6 na **prawdziwym zapisie z v0.5**; historia nietknięta; niezmienniki pilnują list płac, zaliczek, przedpłat, przydziałów i pojazdów.

## Zweryfikowane i niezweryfikowane przepisy

Zweryfikowane w v0.3 (VERIFIED): skala i kwota zmniejszająca, liniowy 19%, limit odliczenia zdrowotnej 14 100 zł (liniowy), brak odliczenia zdrowotnej w skali, odliczenia przy ryczałcie, terminy zaliczek (20.) i salda rocznego (30.04), próg 1 000 zł, minimalne wynagrodzenie 4 806 zł, podstawy i stopy ZUS 2026 (5 652 zł / 1 441,80 zł; 19,52 / 8 / 2,45 / 1,67 / 2,45%), ulga na start i składki preferencyjne (warunki, 6 i 24 mies.), zbieg z etatem, minimalna składka zdrowotna i progi ryczałtowców, limit VAT 240 000 zł i utrata zwolnienia, termin VAT (25.), ograniczenie usług dla pracodawcy. **Uproszczone (SIMPLIFIED)**: stawka ryczałtu na profil (zamiast wg PKWiU), PKD dwóch profili, proporcja limitu VAT, wyłączenia z VAT (art. 113 ust. 13), stawka VAT 23% dla wszystkich usług, brak odliczenia VAT przez zwolnionego, PIT przy etacie (bez łączenia dochodów), moment przychodu, wybór formy przy rejestracji. **Odłożone (DEFERRED)**: Mały ZUS Plus (zweryfikowany, niewdrożony), wakacje składkowe i składki przy zawieszeniu, zawieszenie działalności, roczne rozliczenie zdrowotnej, straty i ulgi, zaokrąglanie do zł, KSeF/korekty/metoda kasowa. Szczegóły i znalezione rozbieżności źródeł: `LEGAL_SOURCES.md`.

## Czego NIE ma (świadomie poza zakresem)

Spółki i wspólnicy, giełda, nieruchomości inwestycyjne, kredyty i leasing, kolejne branże i miasta (rynek ma architekturę pod nie, ale jest tylko Olsztyn i remonty), dane GUS (parametry rynku są kalibracyjne), integracje z urzędami i KSeF, multiplayer, backend. **Vercel**: repo przygotowane do importu (`vercel.json`, `npm ci`, build statyczny); push na `main` wdraża.

## Wykonane testy (2026-10-19)

| Polecenie | Wynik |
|---|---|
| `npm run typecheck` (`tsc -b`, w tym `tools/`) | ✅ bez błędów |
| `npm test` (Vitest) | ✅ **395/395** (16 plików): w tym 27 testów rynku (`market.test.ts`: koniunktura, popyt i sezonowość, alokacja i konkurencja, segmenty, marketing, strategia, limity mocy, powtarzalność, niezmienniki), 4 testy migracji v6 → v7 na prawdziwym zapisie z v0.6, 5 testów symulatora balansu (`tools/balance/balance.test.ts`), test renderu ekranów zajętości/podpisu |
| `npm run build` | ✅ |
| `npm run test:e2e` (Chromium, `LD_LIBRARY_PATH`) | ✅ **31/31** (28 wcześniejszych + 3 nowe: ekrany rynku, marketing i strategia, zapis/menu mobilne) |
| `npm run balance` | ⚠️ działa; serie kalibracyjne 3-letnie wykonane, **końcowa seria 5-letnia z ostatnią wersją bota NIE została dokończona** (przerwana) — raport ma więc dane z różnych wersji bota (patrz [`BALANCE_REPORT.md`](BALANCE_REPORT.md) §2) |

Usterki ujawnione przez testy i symulator podczas v0.7 (naprawione): limit `blockedReason` (120 znaków) mógł uniemożliwić wczytanie zapisu; ujemne zero (`-0`) w stanie psuło porównania po zapisie JSON; test scenariusza 24 miesięcy kopiował stan setki razy (rynek daje ~400 zapytań rocznie) — ograniczony do wyceny 2 zapytań dziennie.

## Znane problemy i uproszczenia

Pełna lista w `FEATURE_EVOLUTION.md` §14. Najważniejsze:
1. **Firma wymaga finansowania właściciela**: składki, podatki i VAT są płacone z rachunku firmowego; przy braku środków powstaje zaległość bez odsetek (odsetki za zwłokę — FE-BANK-02).
2. **Podatek jest symulacją**: zaokrąglenia do zł SIMPLIFIED; brak ulg (IP Box, B+R, internetowa, prorodzinna) i kilku pracodawców u pracownika; zeznania roczne to rekordy z saldem; zaliczki: przychód dopiero po wykonaniu usługi (ADV-PIT SIMPLIFIED); pojazdy bez reguł podatkowych.
3. **Lata po 2026**: reguły z 2026 r. są przenoszone i oznaczone `carriedForward` (UI ostrzega).
4. **Ekonomia zatrudnienia (analiza: `BALANCE_REPORT.md`)**: w v0.7 zatrudnienie nie tworzy popytu — liczba zapytań zależy od rynku, marketingu, reputacji i konkurencji. Wyniki symulatora: samozatrudnienie i „właściciel + 1 pracownik” są opłacalne, firma rosnąca stopniowo bywa opłacalna, a firmy z ≥ 3 pracownikami od startu są nierentowne i przy małym kapitale niewypłacalne (obłożenie pracowników ok. 40–50%, próg opłacalności ≈ 70–75%; umiejętności przypisane do stanowiska ograniczają wypełnianie bezczynności). To skutek modelu rynku i cienkich marż, nie błąd; koszty pracodawcy nie były zmieniane.
5. Rozbieżności źródeł rozstrzygnięte w v0.4 (patrz `LEGAL_SOURCES.md`); parametry prawne tylko 2026 — **brak automatycznego przejścia na 2027**.
6. **Prawo pracy i rynek**: brak urlopów, L4, PPK, nadgodzin, umów na okres próbny i czas określony, odejść pracowników, kierowników ekip (FE-EMP-01, FE-CREW-01); stopa wypadkowa po 31.03.2026 niezweryfikowana. Z poprzednich wersji: potwierdzenia przez `window.confirm`, brak routera, asynchroniczny autozapis, zapis rośnie (~2,8 MB po 10 latach z JDG); `LD_LIBRARY_PATH` dla e2e (`AGENTS.md` §5).

## Następne zadanie (propozycja — wymaga zatwierdzenia)

**v0.8 — kandydaci** (kolejność do decyzji właściciela): (1) generaliści i pomocnicy oraz kierownicy ekip (wypełnianie bezczynności pracowników — główny czynnik nierentowności zespołów w BALANCE_REPORT), z urlopami, L4 i odejściami; (2) klienci powracający, umowy ramowe i zlecenia B2B/przetargi jako stabilny popyt dla większych firm; (3) drugi rynek (miasto lub branża) i dane GUS zamiast parametrów kalibracyjnych; (4) kredyty i leasing (kapitał na rozwój — drugi czynnik: niewypłacalność przy małym kapitale).

Nie rozpoczynać v0.8 bez zatwierdzenia.
