# FEATURE_EVOLUTION — rejestr rozwoju mechanik

> **Trwały rejestr**: porównuje mechaniki zaimplementowane w v0.1–v0.4 z ich docelowym zachowaniem w realistycznym symulatorze polskiego przedsiębiorcy. Obowiązuje wszystkich agentów (`AGENTS.md` §0): przed zadaniem sprawdź pozycje, których ono dotyka; po zadaniu **zaktualizuj wyłącznie te pozycje** (status, stan obecny, brakujące funkcje) i dopisz nowe uproszczenia. **Nie usuwaj** pozycji ani pomysłów tylko dlatego, że nie należą do bieżącego etapu — zmień im status.
>
> Kolumna „Etap” to **sugestia kolejności, nie termin**. Plan wersji: `IMPLEMENTATION_PLAN.md`.
> Legenda statusu: ✅ zaimplementowane (może być uproszczone) · 🟡 częściowo · ⬜ nie rozpoczęte · ⏸ odłożone (wymaga weryfikacji źródeł/decyzji). Priorytet: **P1** — warunkuje realizm lub kolejne etapy, **P2** — ważne, **P3** — uzupełnienie.
> Ostatnia aktualizacja: v0.4 (2026-10-18).

## 1. Silnik, czas i dane

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-CORE-01 | Pieniądze | Całkowite grosze, `mulBps`/`roundDiv`, bez float | j.w. + wielowalutowość tylko jeśli potrzebna | Zaokrąglanie podatków do złotych (`PIT-ROUNDING`), waluty obce (kontrakty zagraniczne) | P3 | LEGAL_SOURCES | ✅ | późno |
| FE-CORE-02 | Czas i kalendarz | Dzień po dniu, ISO, pon–pt roboczy, bez świąt | Polski kalendarz: święta państwowe, dni wolne, tygodnie rozliczeniowe, urlopy | Święta i dni wolne od pracy, urlop wypoczynkowy, terminy przesuwane na dzień roboczy (płatności w sobotę/niedzielę) | P2 | FE-WORK-03, FE-TAX-01 | 🟡 | v0.4–v0.5 |
| FE-CORE-03 | Losowość | Strumień z (seed, id zdarzenia), bez stanu RNG w zapisie | j.w. | Kalibracja rozkładów na danych z rozgrywek; kontrolowane „sezony” rynkowe | P3 | FE-ECON-01 | ✅ | w miarę potrzeb |
| FE-CORE-04 | Rejestr, zobowiązania, niezmienniki | Rejestr, zobowiązania/należności z rachunkiem i ewidencją (prywatna/firmowa), idempotencja, tożsamość księgowa | Pełna księgowość podwójna (konta, dowody księgowe), kursy, odsetki za zwłokę, windykacja | Odsetki za zwłokę, płatności częściowe, kompensaty, korekty, zamknięcia okresów | P1 | FE-BANK-02 | 🟡 | v0.4+ |
| FE-CORE-05 | Wersjonowanie prawa | `legal.ts` (2026), flaga `carriedForward` dla lat późniejszych | Tabele przepisów z datami i źródłami dla każdego roku, automatyczne przełączanie w grze | Zestawy wartości 2027+, mechanizm `valueAt(data)`, porównanie z poprzednim rokiem (zmiana prawa jako zdarzenie) | P1 | LEGAL_SOURCES | 🟡 | v0.4 |
| FE-CORE-06 | Przyrost czasu i symulacja w tle | Skok o dzień / do 1. miesiąca; klon stanu na akcję | Tryb „pauza/ciągły”, automatyczne zatrzymanie na zdarzeniach wymagających decyzji | Auto-stop na decyzjach i terminach, wsad komend (kolejka poleceń) | P3 | FE-UI-01 | ⬜ | później |

## 2. Praca i rynek zatrudnienia

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-WORK-01 | Oferty pracy | 8 stałych fikcyjnych ofert, tylko umowa o pracę, aplikacja → decyzja (szansa z umiejętności i zmęczenia) | Dynamiczny rynek: oferty zależne od regionu, koniunktury, sezonu; rekrutacja wieloetapowa; negocjacja płacy | Odświeżanie i wygasanie ofert, negocjacje, wiele ofert naraz, referencje, CV/doświadczenie | P1 | FE-ECON-01 | 🟡 | v0.5 |
| FE-WORK-02 | Formy zatrudnienia | Wyłącznie umowa o pracę (`employmentForm` w modelu) | Umowa zlecenie, o dzieło, B2B, praca tymczasowa, staż; różne składki i podatki | Modelowanie każdej formy i jej oskładkowania | P2 | FE-TAX-01, FE-ZUS-01 | ⬜ | v0.5+ |
| FE-WORK-03 | Awanse i staż | Awans jako wydarzenie z decyzją; staż w firmie (ciągłość) i na stanowisku rozdzielone | Ścieżki kariery, oceny okresowe, premie roczne, podwyżki inflacyjne, zmiana działu | Oceny pracownicze, ścieżki i szczeble, podwyżki, staż jako podstawa uprawnień (urlop, wypowiedzenie, odprawa) | P2 | FE-WORK-05 | 🟡 | v0.5 |
| FE-WORK-04 | Wypowiedzenia i zwolnienia | Okres wypowiedzenia z umowy; ryzyko zwolnienia z przyczyn (wydajność, kondycja pracodawcy, recesja) | Okresy wypowiedzenia z Kodeksu pracy zależne od stażu, zwolnienia grupowe, ochrona przed wypowiedzeniem | Okresy z Kodeksu pracy (2 tyg./1 mies./3 mies.), tryby zwolnienia, świadectwo pracy, ekwiwalent za urlop | P2 | FE-WORK-03 | 🟡 | v0.5 |
| FE-WORK-05 | Odprawy i świadczenia | Brak | Odprawy przy zwolnieniach grupowych, zasiłek dla bezrobotnych (rejestracja w urzędzie pracy), świadczenia chorobowe | Zasiłek dla bezrobotnych, odprawy, zasiłek chorobowy i wynagrodzenie chorobowe | P1 | FE-ZUS-02 | ⬜ | v0.5 |
| FE-WORK-06 | Umiejętności | 5 poziomów 0–5, wzrost tylko przez kursy | Umiejętności rosnące z pracy, nauki i praktyki; certyfikaty; wygasanie bez używania | Wzrost z doświadczenia, certyfikaty, dziedziny branżowe (budowlane), uprawnienia | P2 | FE-LIFE-03 | 🟡 | v0.5 |

## 3. Czas, zmęczenie i zdrowie

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-TIME-01 | Budżet czasu | 24 h/dobę: praca, sen, obowiązki, rezerwa na firmę, zobowiązania czasowe (kursy, zlecenia, zlecenia JDG), czas wolny jako reszta | j.w. + rodzina, dojazdy zależne od miejsc, harmonogramy zmian, tygodniowe plany | Godziny pracy zmianowej, dojazdy zależne od lokalizacji, czas na rodzinę, harmonogram tygodniowy | P2 | FE-LIFE-01 | ✅ | v0.5 |
| FE-TIME-02 | Zmęczenie i wydajność | Zmęczenie 0–100, wydajność wpływa na premię, awans, zwolnienia, rekrutację i tempo zleceń | Rozbudowa: stres, wypalenie, regeneracja urlopem | Urlop i regeneracja, stres z długów, wpływ na zdrowie | P2 | FE-HEALTH-01 | ✅ | v0.5 |
| FE-HEALTH-01 | Zdrowie | Brak (zmęczenie jako zastępnik) | Choroby, wizyty, ubezpieczenie zdrowotne i prywatna opieka, absencje chorobowe, zwolnienia lekarskie (L4) | Model stanu zdrowia, absencje, L4 i świadczenia chorobowe, koszty leczenia | P1 | FE-TIME-02, FE-ZUS-02 | ⬜ | v0.5–v0.6 |

## 4. Mieszkanie, najem i nieruchomości

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-HOUSE-01 | Najem mieszkania | 5 stałych ofert Olsztyna, przeprowadzka 1. dnia miesiąca, kaucja jako aktywo, jawne nakładanie umów | Rynek najmu (podaż, ceny, sezon), umowy terminowe/okazjonalne, podwyżki czynszu, wypowiedzenie przez wynajmującego | Dynamiczny rynek, podwyżki, potrącenia z kaucji, czynsz proporcjonalny, umowy terminowe | P2 | FE-ECON-01 | 🟡 | v0.5 |
| FE-HOUSE-02 | Zakup mieszkania | Brak | Zakup za gotówkę/kredyt hipoteczny, koszty transakcyjne (PCC, notariusz), podatki lokalne, utrzymanie | Wycena, kredyt hipoteczny, podatek od nieruchomości, remonty własne | P1 | FE-BANK-03 | ⬜ | po prototypie |
| FE-HOUSE-03 | Nieruchomości inwestycyjne | Brak | Najem krótko- i długoterminowy, rozliczenie najmu (ryczałt ewidencjonowany 8,5%/12,5%), flipowanie | Zakup, najemcy, pustostany, podatki, zarządzanie | P2 | FE-HOUSE-02, FE-TAX-01 | ⬜ | po prototypie |

## 5. Życie prywatne, rodzina, edukacja

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-LIFE-01 | Rodzina i gospodarstwo domowe | Jednoosobowe | Partner, dzieci, wspólny budżet, koszty utrzymania rodziny, świadczenia rodzinne (800+, urlopy rodzicielskie) | Encja Household, członkowie, wspólne rachunki, majątek małżeński (rozdzielność/wspólność), świadczenia | P1 | FE-CORE-04 | ⬜ | v0.6+ |
| FE-LIFE-02 | Styl życia i jakość życia | 3 poziomy kosztów; wskaźnik 0–100 z 5 składników (nie funkcja majątku) | Zróżnicowane kategorie wydatków, wpływ na zdrowie i relacje | Kategorie wydatków (zdrowie, rozrywka, podróże), nawyki, inflacja kosztów życia | P2 | FE-ECON-01 | 🟡 | v0.5 |
| FE-LIFE-03 | Edukacja | Kursy jako wydarzenie (+1 umiejętność) | Studia, kursy zawodowe, certyfikaty, kredyt studencki, uprawnienia zawodowe | Ścieżki edukacji, uprawnienia budowlane/zawodowe, koszty i czas | P2 | FE-WORK-06, FE-TIME-01 | 🟡 | v0.5–v0.6 |
| FE-LIFE-04 | Wydarzenia życiowe | 7 szablonów, losowanie miesięczne zależne od stanu, decyzje z terminem | Szeroki katalog (rodzinne, zdrowotne, prawne, rynkowe), łańcuchy zdarzeń, wpływ koniunktury | Więcej szablonów, łańcuchy, wydarzenia biznesowe (kontrola, reklamacje, kradzież), kalibracja | P2 | wszystkie moduły | 🟡 | ciągle |

## 6. Rachunki, banki, kredyty, oszczędności

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-BANK-01 | Rachunki i oszczędności | Rachunek bieżący, oszczędnościowy (odsetki miesięczne, podatek od odsetek jako parametr), firmowy; przelewy własne | Wiele banków, lokaty, konta walutowe, limity, opłaty, debet | Lokaty terminowe, wiele banków, opłaty za prowadzenie, debet w koncie, weryfikacja podatku od odsetek | P2 | LEGAL_SOURCES | 🟡 | v0.5 |
| FE-BANK-02 | Zaległości i windykacja | Zobowiązanie niezapłacone → zaległość, ponawiane codziennie, brak odsetek | Odsetki za zwłokę, wezwania, windykacja, komornik, wpisy do rejestrów | Odsetki, kary, egzekucja, zajęcia kont | P1 | FE-CORE-04 | 🟡 | v0.5 |
| FE-BANK-03 | Kredyty i leasing | Brak | Kredyt gotówkowy/hipoteczny/firmowy, leasing, zdolność kredytowa, harmonogramy rat | Harmonogramy w groszach, zdolność, scoring, ubezpieczenia, leasing operacyjny/finansowy | P1 | FE-CORE-04, FE-BANK-02 | ⬜ | v0.5–v0.6 |

## 7. Gospodarka regionalna

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-ECON-01 | Gospodarka i koniunktura | „Klimat” gospodarczy i kondycja pracodawcy losowane rocznie (ryzyko zwolnień) | Region (Olsztyn/Warmia-Mazury i inne), sektory, inflacja, stopy procentowe, bezrobocie, ceny, sezonowość | Inflacja i waloryzacja płac/kosztów, stopy NBP, regionalne rynki pracy i zleceń, konkurenci | P1 | FE-CORE-05 | 🟡 | v0.5 |
| FE-ECON-02 | Miasta i mapa | Jedno miasto (Olsztyn) | Wiele miast, przeprowadzki, różnice cen i płac, mapa (Phaser) | Katalog miast, koszty życia, dojazdy | P3 | FE-HOUSE-01 | ⬜ | po prototypie |

## 8. Podatki i ZUS (JDG i etat)

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-TAX-01 | PIT dla JDG | Skala, liniowy, ryczałt (jedna stawka na profil); zaliczki narastająco (zaokrąglone do zł), próg 1 000 zł; **roczne zeznanie** PIT-36 (skala: etat + JDG łącznie, 3 600 zł raz) / PIT-36L / PIT-28 / PIT-37, zapłata do 30.04, zwrot +45 dni; **straty** (5 lat, ≤ 50% rocznie, rejestr); **zmiana formy** od 1 stycznia z historią; metoda: data wystawienia | Pełny PIT: ulgi, rozliczenie wspólne, metoda kasowa, wyjątki | Ulgi (IP Box, B+R, internetowa), jednorazowe odliczenie straty (1 mln zł), kwartalne zaliczki, dokładne stawki ryczałtu wg PKWiU, wyjątki zaokrągleń (SIMPLIFIED), metoda kasowa, rozliczenie wspólne z małżonkiem | P1 | LEGAL_SOURCES, FE-CORE-05 | 🟡 | v0.5 |
| FE-TAX-02 | PIT od etatu | **Kalkulator płac 2026** (`payroll.ts`): składki pracownika 9,76/1,5/2,45%, limit 30-krotności, zdrowotna 9%, koszty 250 zł, zaliczka 12%/32% narastająco z kwotą zmniejszającą (PIT-2), ulga dla młodych (do 26. urodzin, limit 85 528 zł), odcinki płacowe, przychód w roku wypłaty | Pełny kalkulator: PPK, składki pracodawcy, koszty podwyższone, kilku pracodawców, inne umowy (zlecenie, o dzieło) | PPK, składki pracodawcy (koszt pracodawcy), podwyższone koszty uzyskania (dojazd 300 zł), kilku pracodawców/PIT-2, inne tytuły (zlecenie), ulgi rodzinne, 13. pensja i premie | P1 | LEGAL_SOURCES | 🟡 | v0.5 |
| FE-ZUS-01 | Składki społeczne JDG | Standard (5 652 zł), preferencyjne (1 441,80 zł), ulga na start, zbieg z etatem, **zawieszenie** (bez składek), **Mały ZUS Plus** (deklaracja gracza, warunki weryfikowane, coroczny przegląd 1 stycznia); płatność do 20. dnia | + wakacje składkowe, część miesiąca (proporcje), zmiany podstaw w czasie | Wakacje składkowe, składki za niepełny miesiąc, start w dowolnym dniu, MZP: podstawa dla dochodu ≥ płaca minimalna i FP/FS (DEFERRED) | P1 | LEGAL_SOURCES | 🟡 | v0.5 |
| FE-ZUS-02 | Świadczenia z ZUS | Brak (chorobowa dobrowolna tylko jako składka) | Zasiłek chorobowy, macierzyński, emerytura (kapitał), renta | Świadczenia i okresy wyczekiwania, konto ubezpieczonego | P2 | FE-HEALTH-01 | ⬜ | v0.6 |
| FE-ZUS-03 | Składka zdrowotna | Skala 9%, liniowy 4,9% (min. 432,54 zł), ryczałt wg 3 progów; podstawa: dochód poprzedniego miesiąca; **roczne rozliczenie** (dopłata do 20 maja; nadpłata tylko na wniosek do 31 maja, wygasa bez gotówki), minimalna podstawa roczna 57 672 zł, miesiące zawieszenia pomijane | Pełna logika z wyjątkami | Wyjątek zbiegu z etatem, zwrot po terminie wniosku (niezweryfikowane), rozwiązania przy stracie | P1 | LEGAL_SOURCES | 🟡 | v0.5 |
| FE-PLAN-01 | Planowanie finansowe | Ekran „Planowanie”: prognoza na **kopii stanu** (5+ scenariuszy: bez zmian, rezygnacja z etatu, połowa etatu, wyższe przychody, zmiana formy), jawne założenia, nic nie księguje | Rozbudowane planowanie: własne scenariusze, wrażliwość, zakupy, kredyt, cele | Własne scenariusze gracza, wykresy, porównanie wariantów formy z progami, scenariusze ryzyka (opóźnienie klienta) | P2 | FE-TAX-01 | 🟡 | v0.5 |
| FE-REPORT-01 | Podsumowanie roku | Ekran „Podsumowanie roku”: wynik firmy (memoriał) oddzielony od przepływów właściciela, należności/zobowiązania, majątek netto | Pełne sprawozdanie: KPiR, rachunek zysków, eksport | KPiR/ewidencja ryczałtowa, eksport, porównania rok do roku | P2 | FE-BIZ-03 | 🟡 | v0.5 |

## 9. JDG, spółki i wspólnicy

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-BIZ-01 | JDG | Jedna JDG, start 1. dnia miesiąca ≥ 02.2026, **zawieszenie/wznowienie** (od 1. dnia miesiąca, ≥ 30 dni, wyjątek lutowy; bez nowych zleceń, zobowiązania zostają), **zmiana formy od 1.01** z historią, aktywna/zamknięta, rachunek firmowy osoby fizycznej, wkład/pobranie; 4 profile usługowe z PKD 2025 | Wiele JDG, zmiana PKD, współpraca z małżonkiem, zakończenie z rozliczeniem majątku | Zmiana PKD, wiele działalności, środki trwałe i amortyzacja, wyposażenie, ubezpieczenia OC, zawieszenie z pracownikami/umowami | P1 | FE-TAX-01, FE-ZUS-01 | 🟡 | v0.5 |
| FE-BIZ-02 | VAT | Zwolnienie podmiotowe vs czynny; limit 240 000 zł (proporcja w pełnych miesiącach); VAT należny/naliczony jako odrębne zobowiązania; stawka 23% | Pełny VAT: stawki 23/8/5/0, WDT/WNT, korekty, zwrot VAT, rozliczenie kwartalne, split payment, KSeF, JPK | Inne stawki, kwartalne rozliczenie, korekty, zwrot nadwyżki w terminach, KSeF, katalog wyłączeń art. 113 ust. 13 i ust. 2, limit po zmianie roku (utrata zwolnienia) | P1 | LEGAL_SOURCES | 🟡 | v0.4–v0.5 |
| FE-BIZ-03 | Dokumenty | Rejestr sprzedaży/kosztów (numer, daty, netto/VAT/brutto, status płatności) — rekord symulacyjny, nie KSeF | Faktury, korekty, noty, paragony/kasa fiskalna, dokumenty kosztowe z rodzajem, ewidencje (KPiR), JPK | KPiR/ewidencja przychodów ryczałtowca, korekty, zaliczki, proformy, rodzaje kosztów (np. samochód), rozliczanie kosztów mieszanych | P2 | FE-BIZ-02 | 🟡 | v0.4–v0.5 |
| FE-BIZ-04 | Spółki (sp. z o.o.) i wspólnicy | Brak | Spółka jako osoba prawna: kapitał, udziały, zarząd ≠ udziały ≠ dywidendy, CIT/estoński CIT, wypłaty, wspólnicy | Cała encja LegalEntity/Ownership/Mandate, CIT, dywidendy, uchwały, KRS | P1 | FE-BIZ-01, FE-TAX-01 | ⬜ | po prototypie |
| FE-BIZ-05 | Zlecenia usługowe | Szablony zleceń per profil (oferty 1. i 16. dnia), godziny z budżetu czasu, koszty, termin płatności, opóźnienia klienta, kara za zwłokę | Rynek zleceń: konkurencja, oferty na przetargach, umowy ramowe, zaliczki, kontrakty cykliczne, reputacja | Reputacja i polecenia, negocjacja ceny, kontrakty cykliczne, zaliczki/transze, reklamacje, wycena zleceń przez gracza | P1 | FE-ECON-01 | 🟡 | v0.4–v0.5 |
| FE-BIZ-06 | Płynność i windykacja należności | Klient płaci z losowym opóźnieniem 0–35 dni; brak działań gracza | Monitowanie płatności, windykacja, odsetki ustawowe, kredyt kupiecki, factoring | Wezwania do zapłaty, odsetki za opóźnienie w transakcjach handlowych, upadłość klienta | P2 | FE-BANK-02 | 🟡 | v0.5 |

## 10. Pracownicy i kontrakty

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-EMP-01 | Zatrudnianie pracowników | Brak (świadomie poza zakresem v0.3) | Rekrutacja, umowy (praca/zlecenie), koszty pracodawcy (składki, FP, FGŚP, BHP), płace, urlopy, zwolnienia | Cała mechanika pracodawcy: płace brutto→netto, ZUS DRA, PIT-4R, absencje, wydajność, motywacja | P1 | FE-TAX-02, FE-ZUS-01 | ⬜ | po JDG-domknięciu |
| FE-EMP-02 | Wspólnicy i współpraca B2B | Brak | Podwykonawcy B2B, wspólnicy w spółce, umowy partnerskie | Kontrakty B2B, podział zysków, konflikty | P2 | FE-BIZ-04 | ⬜ | po prototypie |

## 11. Inwestycje i giełda

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-INV-01 | Giełda i obligacje | Brak | Akcje GPW, obligacje skarbowe, ETF, notowania symulowane, podatek od zysków kapitałowych (Belka), IKE/IKZE | Model cen, prowizje, podatek, dywidendy, rachunek maklerski | P2 | FE-ECON-01, FE-TAX-01 | ⬜ | po prototypie |
| FE-INV-02 | Lokaty i obligacje oszczędnościowe | Tylko rachunek oszczędnościowy | Lokaty, obligacje detaliczne | Lokaty terminowe, obligacje skarbowe detaliczne | P3 | FE-BANK-01 | ⬜ | później |

## 12. Moduły branżowe

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-IND-01 | Remonty i wykończenia | Brak (uniwersalne zlecenia usługowe v0.3 są bazą) | Wycena, kosztorys, materiały, ekipy, terminy, odbiory, gwarancje, budowlane stawki VAT, ryczałt 5,5% | Cały moduł: kosztorysy, harmonogramy robót, materiały, podwykonawcy, reklamacje, uprawnienia | P1 | FE-BIZ-05, FE-EMP-01, FE-ECON-01 | ⬜ | po prototypie |
| FE-IND-02 | Kolejne branże | Brak | Gastronomia, handel, transport, IT jako własne moduły | — | P3 | FE-IND-01 | ⬜ | później |

## 13. Interfejs, zapis i wydajność

| ID | Mechanika | Stan obecny | Docelowe zachowanie | Brakujące funkcje | Pr. | Zależności | Status | Etap |
|---|---|---|---|---|---|---|---|---|
| FE-UI-01 | Interfejs | 3 grupy ekranów + System; responsywny; toasty; `window.confirm` do potwierdzeń | Spójny system dialogów, wykresy czasu, tabele z filtrami i eksportem, onboarding, dostępność, router i głębokie linki | Własne okna dialogowe, router (ADR-012), eksport CSV/PDF dokumentów, skróty klawiaturowe, testy komponentów, testy mobilne automatyczne | P2 | — | 🟡 | ciągle |
| FE-SAVE-01 | Zapisy | IndexedDB, 3 sloty + autozapis, `SAVE_VERSION = 4`, migracje na realnych fixture, walidacja Zod + niezmienniki | Eksport/import pliku, synchronizacja opcjonalna, kompaktowanie historii, kopie zapasowe | Eksport/import JSON, kompaktowanie dziennej historii (~1,2–1,5 MB/10 lat), zapis synchroniczny przy zamknięciu karty | P2 | — | ✅ | v0.5 |
| FE-PERF-01 | Wydajność | 120 miesięcy ≈ 0,9 s; miesiąc na 10-letnim stanie ≈ 13 ms; klonowanie stanu na akcję | Skalowanie do wielu podmiotów i tysięcy dokumentów | Indeksy po id (obligacje, dokumenty), Web Worker dla symulacji, kompaktowanie | P2 | FE-BIZ-04, FE-EMP-01 | ✅ | gdy potrzebne |
| FE-TEST-01 | Testy | Jednostkowe (silnik, zapisy, migracje z realnych fixture), e2e (Playwright, Chromium) | Testy własności (property-based), testy regresji prawa na „przykładach wzorcowych” z urzędów, e2e mobilne | Property-based niezmienniki, wzorcowe przypadki podatkowe z interpretacji/kalkulatorów urzędowych, e2e telefon | P2 | FE-CORE-05 | 🟡 | ciągle |

## 14. Uproszczenia do rozwinięcia później (pełna lista, stan po v0.4)

Każde uproszczenie jest świadome i opisane w `LEGAL_SOURCES.md` lub `DECISIONS.md`. **Nie usuwać z listy bez wdrożenia.**

1. **Start JDG tylko 1. dnia miesiąca, nie wcześniej niż 1.02.2026** — brak składek/zdrowotnej za niepełny miesiąc i brak zweryfikowanych kwot ryczałtowych za styczeń 2026 (FE-ZUS-01, FE-ZUS-03).
2. **Jedna JDG naraz.** ~~Brak zawieszenia~~ — zawieszenie wdrożone w v0.4 (całe miesiące od 1. dnia, ≥ 30 dni; bez pracowników/umów najmu firmowych; `SUSP-*`) (FE-BIZ-01).
3. ~~Forma wybierana raz~~ — zmiana od 1 stycznia wdrożona w v0.4 (`PIT-FORM-CHANGE`); brak niuansów terminów zgłoszenia (liniowy do 20.02 itd. upraszczamy: zmiana zaplanowana przed 1.01) (FE-TAX-01).
4. ~~PIT bez łączenia~~ — w v0.4 skala łączy etat i JDG w PIT-36 (kwota zmniejszająca raz); liniowy/ryczałt osobno od PIT-37 (`PIT-SKALA-WITH-EMPLOYMENT`). Brak rozliczenia wspólnego z małżonkiem (FE-TAX-01).
5. ~~Netto = 73% brutto~~ — kalkulator płac od v0.4; wynagrodzenia sprzed migracji v3→v4 zachowują wypłaconą kwotę (`payrollFrom`, odcinki „legacy”). Brak PPK, składek pracodawcy, kilku pracodawców (FE-TAX-02).
6. **Ryczałt: jedna stawka na profil** (zamiast wg PKWiU) i **PKD** dla 2 profilów zweryfikowane tylko częściowo (FE-TAX-01).
7. **Zaokrąglenie do zł** wdrożone (SIMPLIFIED — oficjalny tekst nieczytelny); straty z lat ubiegłych wdrożone (5 lat/50%); **brak ulg** (IP Box, B+R, internetowa, prorodzinna) i jednorazowego odliczenia straty (FE-TAX-01).
8. **Zeznania roczne** są rekordami (PIT-37/36/36L/28) z saldem i terminem; zwrot nadpłaty +45 dni od terminu składania (uproszczenie terminu), brak składania/korekt zeznań przez gracza (FE-TAX-01).
9. **Składka zdrowotna**: podstawa miesięczna = dochód poprzedniego miesiąca; roczne rozliczenie wdrożone w v0.4; brak wyjątku zbiegu z etatem i zwrotu nadpłaty po terminie wniosku (FE-ZUS-03).
10. **ZUS**: stawka wypadkowa 1,67% dla każdego; Mały ZUS Plus tylko dla zweryfikowanych warunków (opt-in); brak wakacji składkowych; dobrowolna chorobowa to tylko składka, bez świadczeń (FE-ZUS-01, FE-ZUS-02).
11. **VAT**: jedna stawka 23%; limit proporcjonalny w pełnych miesiącach; przekroczenie limitu → kwota umowna traktowana jako netto; podatnik zwolniony nie odlicza; zwrot nadwyżki VAT naliczonego jako należność z terminem 25.; obowiązek podatkowy = data wystawienia (FE-BIZ-02).
12. **Dokumenty** nie są fakturami KSeF; brak korekt, KPiR i ewidencji ryczałtowej (FE-BIZ-03).
13. **Zlecenia**: oferty z szablonów, stała liczba profili (4), godziny rezerwowane każdego dnia (także w weekendy); klient zawsze płaci (z opóźnieniem 0–35 dni); brak negocjacji i reputacji (FE-BIZ-05, FE-BIZ-06).
14. **Zakaz zleceń od pracodawców gracza** zamiast modelowania utraty ulg (FE-BIZ-05, `PIT-EMPLOYER-RESTRICTION`).
15. **Zakończenie działalności tylko na koniec miesiąca**, po zakończeniu zleceń; brak wyrejestrowania ZUS/VAT-Z jako zdarzeń (FE-BIZ-01).
16. **Lata po 2026**: reguły przenoszone z 2026 r. z flagą `carriedForward` (FE-CORE-05); **brak parametrów prawnych na 2027+ — model nie przełącza się automatycznie na 2027** (wymaga weryfikacji źródeł).
17. **Odłożone w v0.4 (świadomie, nie zapomniane):** zaawansowane wyjątki podatkowe (np. ulgi, IP Box, składka zdrowotna a zbieg), **KSeF**, złożony VAT (stawki obniżone, kwartalnie, korekty, WDT/WNT), szczególne przypadki zatrudnienia (zlecenie, o dzieło, kilku pracodawców, PPK), kontrole skarbowe/ZUS, zaawansowane świadczenia i ulgi (rodzinne, chorobowe), brakujące lata parametrów prawnych (2027+).
18. **Planowanie** to prognoza ze stałymi założeniami (stała sprzedaż, brak zdarzeń losowych i opóźnień klientów, 150 zł/h domyślnie); nie optymalizuje i nie zna przyszłych zmian przepisów (FE-PLAN-01).

## 15. Pomysły na przyszłość (zachowane)

Mapa miasta (Phaser) · tryb kariery „wyzwania” bez narzuconej fabuły · reputacja i sieć kontaktów · rynek pracy z agencjami · sezonowość branż · inflacja i waloryzacja umów · zdarzenia prawne (zmiany przepisów w trakcie gry) · kontrole skarbowe/ZUS · ubezpieczenia (OC, majątkowe) · samochód i koszty jego użytkowania w firmie · leasing samochodu (limity kosztów) · współpraca z biurem rachunkowym (koszt vs ryzyko błędów) · tryb nauki (podgląd obliczeń podatkowych krok po kroku) · eksport raportów firmy.

## 16. Jak aktualizować rejestr

1. Przed zadaniem odszukaj pozycje `FE-…` dotknięte zmianą (obszar, ID zależności).
2. Po zadaniu zmień **tylko te pozycje**: status, stan obecny, brakujące funkcje, priorytet (jeśli się zmienił), zależności.
3. Nowe uproszczenie dopisz do §14 (z odniesieniem do ID), nowy pomysł — do §15; nie zmieniaj „Etapu” innych pozycji bez decyzji właściciela.
4. Zmianę docelowego zachowania (kolumna „Docelowe”) uzasadnij w `DECISIONS.md`.
