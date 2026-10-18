# GAME_DESIGN — wizja i założenia rozgrywki

> Status: założenia główne (zatwierdzone w specyfikacji startowej). Sekcje oznaczone **[v0.1]** są zaimplementowane; reszta to kierunek, nie obietnica.
> Zmiana głównych założeń wymaga zatwierdzenia właściciela projektu.

## 1. Wizja

Realistyczny symulator życia i prowadzenia przedsiębiorstw w Polsce. Gracz zaczyna jako **osoba fizyczna** i może: pracować na etacie, utrzymywać gospodarstwo domowe, wynajmować lub kupować mieszkania, zakładać JDG i spółki, zatrudniać, współpracować ze wspólnikami, zawierać umowy i realizować kontrakty, korzystać z kredytów i leasingu, kupować akcje/obligacje/nieruchomości, otrzymywać dywidendy, budować firmy niezależne od swojej codziennej pracy i rozwijać wiele przedsiębiorstw w różnych branżach — ponosząc realistyczne konsekwencje swoich decyzji.

- **Otwarty sandbox**, bez obowiązkowej fabuły. Gracz może wygrać albo przegrać.
- **Realizm bez nudy**: odwzorowujemy polską rzeczywistość (prawo, podatki, ZUS, rynek), ale pomijamy nużące czynności administracyjne (formularze, kolejki). Automatyzujemy to, co w grze nie jest decyzją.
- **Silnik liczy, nie model językowy.** Wszystkie wyniki gospodarcze są deterministyczne i weryfikowalne.

## 2. Główna pętla rozgrywki

```
 przegląd sytuacji  →  decyzje  →  przesunięcie czasu  →  rozliczenie zdarzeń  →  skutki
 (pulpit, finanse)     (v0.2+)     (dzień / miesiąc)        (silnik, dziennik)       (majątek, ryzyko)
```

**[v0.1]** działa: przegląd (pulpit, finanse, kalendarz, dziennik), przesuwanie czasu, automatyczne rozliczenia. **Decyzji gracza jeszcze nie ma** — v0.1 jest fundamentem ekonomii, nie pełną grą (patrz `IMPLEMENTATION_PLAN.md`).

## 3. Życie prywatne

**[v0.1]** Postać 22-letnia w Olsztynie, 1 stycznia 2026, 5 000 zł gotówki. Etat (wynagrodzenie netto) i wynajmowane mieszkanie. Miesięczne koszty życia: czynsz, media, telefon/internet, żywność, transport, drobne wydatki (losowe ±15%).

Kierunek: zmiana pracy i mieszkania, styl życia (wpływa na koszty), zdarzenia losowe (awaria, choroba, okazje), rodzina i gospodarstwo domowe (wspólne budżety), wiek i kamienie milowe.

## 4. Ścieżka rozwoju przedsiębiorcy

1. Etat → oszczędzanie → kapitał startowy.
2. Pierwsze zlecenia „po godzinach” → **JDG** (osoba fizyczna prowadząca działalność — bez odrębnej osobowości prawnej, odpowiada całym majątkiem).
3. Zatrudnienie pierwszych pracowników, kontrakty, leasing/kredyt na wyposażenie.
4. **Spółka** (osoba prawna): udziały, wspólnicy, zarząd, dywidendy — rozdzielenie majątku prywatnego i spółki.
5. Wiele firm, różne branże, firmy pracujące bez udziału gracza (zarządzanie zamiast wykonywania).
6. Inwestycje: giełda, obligacje, nieruchomości na wynajem.

Pierwszy moduł branżowy (przyszłość): **remonty i wykończenia**.

## 5. Formy działalności (docelowo)

| Forma | Osobowość prawna | Odpowiedzialność | Uwagi do modelu |
|---|---|---|---|
| Osoba fizyczna (etat) | — | — | **[v0.1]** |
| JDG | brak (to ta sama osoba fizyczna) | całym majątkiem | ewidencja „firmowa” ≠ osobny podmiot |
| Spółka (np. sp. z o.o.) | tak | ograniczona do majątku spółki | udziały, wypłaty, zarząd — osobno |

## 6. Inwestycje (docelowo)

Akcje, obligacje, nieruchomości (wynajem, remont-i-sprzedaż), lokaty. Wyceny z regionalnych rynków i seedowanej losowości; dywidendy i odsetki jako zwykłe należności w silniku.

## 7. Mechanika czasu

Czas jest **dyskretny, w dniach**. Gracz przesuwa go o **1 dzień** albo **do pierwszego dnia następnego miesiąca**. Silnik zawsze przetwarza **każdy dzień po kolei** — przeskok nie pomija żadnych zdarzeń. Brak czasu rzeczywistego i brak „tików” w tle. Szczegóły: `ECONOMY_ENGINE.md`.

## 8. Zagrożenia i porażka

**[v0.1]** Brak środków → zobowiązanie **po terminie** (ostrzeżenie, zdarzenie, wskaźnik na pulpicie); rachunek nie schodzi poniżej zera.

Kierunek: odsetki za zwłokę, windykacja, utrata płynności firmy, zajęcia komornicze, bankructwo, utrata kontraktów, ryzyko kredytowe i rynkowe, błędy podatkowe (kary). Porażka ma być konsekwencją modelu, nie skryptu.

## 9. Cele gracza

Brak narzuconych. Przykładowe cele własne: stabilność finansowa, pierwsza własna firma, wiele firm, dochód pasywny przewyższający koszty życia, majątek netto X, wyjście z firmy. Gra może później oferować opcjonalne „wyzwania”, ale nie linearną fabułę.

## 10. Zasady realizmu danych

Wszystkie liczby (płace, czynsze, stawki podatkowe, ceny) muszą mieć status **zweryfikowane** (ze źródłem i datą obowiązywania) albo **przykładowe** — i być tak oznaczone w UI. Do czasu weryfikacji gra używa wartości przykładowych (patrz `ECONOMY_ENGINE.md`, „Dane i wersjonowanie prawa”).

## Branże biznesowe (v0.5)

Działalność gospodarczą można prowadzić w profilu branżowym — pierwszy to **usługi remontowo-wykończeniowe**: gracz wybiera specjalizację, kupuje sprzęt, pozyskuje klientów (zapytania zależą od reputacji, reklamy, sezonu i dostępności), wycenia, negocjuje, podpisuje umowy, kupuje materiały, realizuje prace własnymi godzinami (dzielonymi z etatem), rozlicza klientów, obsługuje reklamacje i buduje reputację. Rachunki, podatki, czas i należności pozostają we wspólnym silniku. Ceny i normy branży są parametrami symulacyjnymi.
