# PROJECT_STATUS — stan projektu

> Aktualizuj po każdym zadaniu. Opisuje **stan faktyczny**, nie plany. Ostatnia aktualizacja: 2026-10-18.

## Wersja

**v0.6.0 — Pracownicy, ekipy i rozwój firmy** (zakończona; v0.7 czeka na zatwierdzenie). Zapisy: `SAVE_VERSION = 6` (migracje v1 → … → v6). Wcześniej: v0.5 (branża remontowa), v0.4 (rozliczenia roczne), v0.3 (JDG), v0.2.1, v0.2, v0.1.
Rejestr rozwoju mechanik: [`FEATURE_EVOLUTION.md`](FEATURE_EVOLUTION.md) · rejestr reguł prawnych: [`LEGAL_SOURCES.md`](LEGAL_SOURCES.md).

## Co działa (v0.6, zweryfikowane testami)

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
- **Wykonawcy wybierani wprost w wycenie**: sekcja „Kto wykona pracę” — pola wyboru: właściciel, zatrudnieni pracownicy (z rolą i poziomem do tej usługi) i podwykonawcy (z ceną za całość); nie trzeba wcześniej tworzyć ekipy w „Ekipy” (gotowa ekipa nadal jest do wyboru). Przy zbyt niskim poziomie, braku specjalizacji lub sprzętu formularz od razu proponuje pracownika lub podwykonawcę („Zleć pracownikowi” / „Zleć i wyceń”; cena z narzutem 25%, jeśli obecna nie pokrywa kosztów). Skład to wirtualna ekipa w podglądzie (`crew:…`); prawdziwa ekipa powstaje przy wysłaniu oferty i jest używana ponownie. Po podpisaniu umowy podwykonawcy od razu przysyłają ofertę do zaakceptowania w „Podwykonawcy” (ważna 5 dni).
- **Powiadomienia w menu (kropki)**: przy pozycji menu (pulpit, panel mobilny, nagłówek grupy i przycisk „Więcej”) świeci złota kropka, gdy w danym ekranie coś czeka: otwarte zapytania, negocjacje/umowy, kontrakt zablokowany, reklamacje, zużyty sprzęt/pojazd, nowi kandydaci, pracownik z niskim morale/zmęczeniem, oferty podwykonawców, zagrożona płynność, zaległe zobowiązania firmy, nowe powiadomienia biura rachunkowego (te gasną po wejściu na ekran; reszta po załatwieniu sprawy). Logika: `src/ui/navAlerts.ts`; tylko widok — nie zmienia stanu ani zapisu.
- **Prawo**: 77 reguł: 38 VERIFIED, 29 SIMPLIFIED, 10 DEFERRED (13 nowych/zmienionych; patrz `LEGAL_SOURCES.md`).
- **Zapisy**: migracja v5 → v6 na **prawdziwym zapisie z v0.5**; historia nietknięta; niezmienniki pilnują list płac, zaliczek, przedpłat, przydziałów i pojazdów.

## Zweryfikowane i niezweryfikowane przepisy

Zweryfikowane w v0.3 (VERIFIED): skala i kwota zmniejszająca, liniowy 19%, limit odliczenia zdrowotnej 14 100 zł (liniowy), brak odliczenia zdrowotnej w skali, odliczenia przy ryczałcie, terminy zaliczek (20.) i salda rocznego (30.04), próg 1 000 zł, minimalne wynagrodzenie 4 806 zł, podstawy i stopy ZUS 2026 (5 652 zł / 1 441,80 zł; 19,52 / 8 / 2,45 / 1,67 / 2,45%), ulga na start i składki preferencyjne (warunki, 6 i 24 mies.), zbieg z etatem, minimalna składka zdrowotna i progi ryczałtowców, limit VAT 240 000 zł i utrata zwolnienia, termin VAT (25.), ograniczenie usług dla pracodawcy. **Uproszczone (SIMPLIFIED)**: stawka ryczałtu na profil (zamiast wg PKWiU), PKD dwóch profili, proporcja limitu VAT, wyłączenia z VAT (art. 113 ust. 13), stawka VAT 23% dla wszystkich usług, brak odliczenia VAT przez zwolnionego, PIT przy etacie (bez łączenia dochodów), moment przychodu, wybór formy przy rejestracji. **Odłożone (DEFERRED)**: Mały ZUS Plus (zweryfikowany, niewdrożony), wakacje składkowe i składki przy zawieszeniu, zawieszenie działalności, roczne rozliczenie zdrowotnej, straty i ulgi, zaokrąglanie do zł, KSeF/korekty/metoda kasowa. Szczegóły i znalezione rozbieżności źródeł: `LEGAL_SOURCES.md`.

## Czego NIE ma (świadomie poza zakresem)

Spółki i wspólnicy, zatrudnianie pracowników, branża remontowa, giełda, nieruchomości inwestycyjne, kredyty i leasing, integracje z urzędami i KSeF, backend. **Vercel**: repo przygotowane do importu (`vercel.json`, `npm ci`, build statyczny); projekt Vercel jest tworzony przez właściciela. Pełna lista uproszczeń (po v0.4): `FEATURE_EVOLUTION.md` §14.

## Wykonane testy (2026-10-19)

| Polecenie | Wynik |
|---|---|
| `npm run typecheck` | ✅ bez błędów |
| `npm test` (Vitest) | ✅ **353/353** (w tym 5 testów UI: kropki menu i klucz członka ekipy; 4 testy wyboru wykonawców w wycenie), w tym 51 testów v0.6: rekrutacja i zatrudnianie (16), podwykonawcy, ekipy, pojazdy, rentowność, zaliczki (27), scenariusz 24 miesięcy i deterministyczność (2) oraz 6 testów migracji v5 → v6 |
| `npm run build` | ✅ JS 861 kB / 255 kB gzip, CSS 45 kB / 7,8 kB gzip |
| `npm run test:e2e` (Chromium) | ✅ **28/28** (23 wcześniejsze + 3 z v0.6 + kropka menu + zlecenie podwykonawcy: rekrutacja i zatrudnienie z listą płac, wszystkie nowe ekrany, menu mobilne) |

Scenariusz 24 miesięcy (`scenario24.test.ts`): reklama, biuro, rekrutacja pracownika i ekipa bez nadzoru właściciela, pojazd, wyceny z ekipą lub samodzielnie, podwykonawcy dla zleceń bez ekipy; niezmienniki co miesiąc; pracownik z ≥ 12 listami płac, ≥ 3 kontrakty ekipy, ≥ 3 rozliczeni podwykonawcy, pojazd użyty, równoległe kontrakty, zaliczki bez przychodu do wykonania usługi, deterministyczność i wznowienie po zapisie.
Usterki ujawnione przez testy podczas prac (naprawione): wspólny zapas materiałów liczony podwójnie przy równoległych kontraktach; tytuł zdarzenia > 200 znaków (powiadomienie księgowe) odrzucał zapis; niezmiennik wymagał rezerwacji czasu także dla kontraktów delegowanych; dokument w całości pokryty zaliczką podwykonawcy; umowy z podwykonawcą bez wykonanej pracy rozliczane jako „zero”. Zmiany w starszych testach: wersje zapisu (5 → 6), zwrot zaliczki (zobowiązanie zamiast kosztu), drugi egzemplarz sprzętu dozwolony, domeny źródeł urzędowych.

## Znane problemy i uproszczenia

Pełna lista w `FEATURE_EVOLUTION.md` §14. Najważniejsze:
1. **Firma wymaga finansowania właściciela**: składki, podatki i VAT są płacone z rachunku firmowego; przy braku środków powstaje zaległość bez odsetek (odsetki za zwłokę — FE-BANK-02).
2. **Podatek jest symulacją**: zaokrąglenia do zł SIMPLIFIED; brak ulg (IP Box, B+R, internetowa, prorodzinna) i kilku pracodawców u pracownika; zeznania roczne to rekordy z saldem; zaliczki: przychód dopiero po wykonaniu usługi (ADV-PIT SIMPLIFIED); pojazdy bez reguł podatkowych.
3. **Lata po 2026**: reguły z 2026 r. są przenoszone i oznaczone `carriedForward` (UI ostrzega).
4. **Ekonomia zatrudnienia**: pracownik kosztuje stale (ok. 7 tys. zł miesięcznie przy 5,4 tys. brutto), a popyt jest ograniczony (kilka zapytań miesięcznie, więcej przy reklamie i reputacji) — przy małym wolumenie zatrudnienie jest nieopłacalne (bezczynność), podwykonawcy dają zmienny koszt. To zamierzone, ale wymaga uwagi przy balansie.
5. Rozbieżności źródeł rozstrzygnięte w v0.4 (patrz `LEGAL_SOURCES.md`); parametry prawne tylko 2026 — **brak automatycznego przejścia na 2027**.
6. **Prawo pracy i rynek**: brak urlopów, L4, PPK, nadgodzin, umów na okres próbny i czas określony, odejść pracowników, kierowników ekip (FE-EMP-01, FE-CREW-01); stopa wypadkowa po 31.03.2026 niezweryfikowana. Z poprzednich wersji: potwierdzenia przez `window.confirm`, brak routera, asynchroniczny autozapis, zapis rośnie (~2,8 MB po 10 latach z JDG); `LD_LIBRARY_PATH` dla e2e (`AGENTS.md` §5).

## Następne zadanie (propozycja — wymaga zatwierdzenia)

**v0.7 — kandydaci** (kolejność do decyzji właściciela): balans ekonomii zatrudnienia i popytu (więcej klientów dla firm z ekipami, kontrakty B2B i przetargi), kierownicy ekip i rozwój pracowników (szkolenia, urlopy, L4, odejścia), albo weryfikacja i wdrożenie VAT 8% i faktur zaliczkowych. Bez spółek, giełdy i kredytów do osobnej decyzji.

Nie rozpoczynać v0.7 bez zatwierdzenia.
