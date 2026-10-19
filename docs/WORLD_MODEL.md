# WORLD_MODEL — encje świata gry

> Kolumna „v0.1” mówi, co jest w kodzie (`src/engine/state.ts`). Reszta to projekt granic i relacji, żeby kolejne moduły pasowały do jednego modelu.

## 1. Zasady modelu

- Każda encja ma **stabilny, tekstowy identyfikator** (np. `person:player`, `acc:player:main`, `party:employer`, `obl:rule:rent@2026-01-01`).
- **Osoba fizyczna jest odrębna od podmiotów posiadających osobowość prawną.**
- **JDG nie jest osobą prawną**: to sposób prowadzenia działalności przez osobę fizyczną. Model ma osobną *ewidencję* działalności (rachunek firmowy, koszty, przychody), ale **zobowiązania JDG są zobowiązaniami osoby fizycznej**.
- **Spółka jest osobą prawną**: ma własny majątek, rachunki, zobowiązania i podatki; wspólnicy mają *udziały*.
- **Własność, zarządzanie i prawa do wypłat to trzy niezależne relacje** (udziały ≠ prawo reprezentacji ≠ prawo do dywidendy w danym roku).
- Kwoty: całkowite **grosze**. Daty: `YYYY-MM-DD`.

## 2. Encje

| Encja | Opis | v0.1 |
|---|---|---|
| **Person** (osoba) | Osoba fizyczna: imię, nazwisko, data urodzenia, miasto. Gracz i (później) NPC: pracownicy, wspólnicy, członkowie rodziny. | ✅ `person` (tylko gracz) |
| **Household** (gospodarstwo domowe) | Zbiór osób dzielących budżet i mieszkanie; wspólne koszty. | ❌ (gracz = jednoosobowe) |
| **LegalEntity** (podmiot prawny) | Wspólna abstrakcja: osoba fizyczna, JDG (jako tryb działania osoby), spółka. Źródło prawdy o *statusie prawnym*. | 🟡 v0.8: rozróżnienie wynika z **właściciela rachunku** (`Account.ownerId`: osoba gracza albo `Company.id`) — `scope` zobowiązań: `personal` / `business` (JDG) / `company` |
| **Enterprise** (przedsiębiorstwo) | Działalność gospodarcza (JDG albo spółki): branża, pracownicy, kontrakty, ewidencja. | ✅ `Operator` (v0.8): wspólna część — JDG (`businesses`, plus forma opodatkowania i ZUS właściciela) i spółka (`Company.operation`); moduły branżowe pracują na bieżącym operatorze (`withOperator`) |
| **ServiceOffer / ServiceOrder** | Oferta i zlecenie usługowe: klient, wartość, godziny, koszty, termin wykonania i płatności, kara za zwłokę. | ✅ `serviceOffers`, `serviceOrders` (v0.3) |
| **Document** (dokument) | Rekord sprzedaży/kosztu JDG: numer, daty, netto/VAT/brutto, powiązane zobowiązania. Nie jest fakturą KSeF. | ✅ `documents` (v0.3) |
| **WorkerPerson / Employment / EmployerPayslip** | Pracownik jako osoba (umiejętności, morale, zmęczenie, oczekiwania), jego umowa o pracę u pracodawcy i miesięczne listy płac z kosztami pracodawcy; osoba przeżywa zakończenie umowy. | ✅ `ops.people/employments/payslips` |
| **Subcontractor / Subcontract** | Firma B2B wykonująca zakres kontraktu za cenę umowną (przedpłata → odbiór → rozliczenie), bez ZUS i płacy etatowej. | ✅ `ops.subcontractors/subcontracts` |
| **Team / Assignment / Vehicle** | Ekipa z właściciela, pracowników i podwykonawców; rezerwacje zasobów (pracownicy, sprzęt, pojazdy) do kontraktów; pojazdy firmowe jako aktywa. | ✅ `ops.teams/assignments/vehicles` |
| **TaxPeriod** (rozliczenie miesiąca) | Składki ZUS, zdrowotna, zaliczka PIT, wartości narastające i użyte reguły prawne. | ✅ `taxPeriods` (v0.3) |
| **Party** (strona zewnętrzna) | Pracodawca, wynajmujący, dostawca, bank, urząd. W v0.1 bierna i zawsze wypłacalna. | ✅ `parties` |
| **Account** (rachunek) | Rachunek pieniężny należący do podmiotu; saldo = suma wpisów w rejestrze. Typy: bieżący, oszczędnościowy (z zasadami odsetek). | ✅ `accounts` (bieżący + oszczędnościowy, v0.2) |
| **LedgerEntry** (wpis w rejestrze) | Niezmienny zapis zmiany salda: data, rachunek, kwota ze znakiem, kategoria, kontrahent, powiązane zobowiązanie, id zdarzenia. | ✅ `ledger` |
| **Obligation** (zobowiązanie/należność) | Wierzyciel, dłużnik, kwota, data naliczenia, **termin**, status (otwarte/rozliczone), data zaległości. | ✅ `obligations` |
| **Contract** (umowa) | Źródło warunków i kwot: umowa o pracę (brutto, szac. netto, godziny, wypowiedzenie, forma — v0.2 tylko umowa o pracę), najem (czynsz, opłaty, kaucja, standard, powierzchnia); później kontrakty handlowe, kredyt, leasing. | ✅ `employment`, `lease` |
| **Rule** (reguła harmonogramu) | Cykliczne naliczenia wynikające z umów i stylu życia; generuje zdarzenia. | ✅ `rules` (`obligation`, `birthday`) |
| **GameEvent** (zdarzenie) | Wpis w dzienniku: id, data, typ, ton, tytuł, kwota. | ✅ `events` |
| **PendingAction** (akcja zaplanowana) | Jednorazowa akcja na konkretny dzień (decyzja pracodawcy, zwrot kaucji, koszt przeprowadzki, …). | ✅ `pending` (v0.2) |
| **JobApplication** (aplikacja) | Aplikacja na ofertę z katalogu: status, termin decyzji, ważność propozycji. | ✅ `applications` (v0.2) |
| **LifeEvent** (wydarzenie życiowe) | Zdarzenie losowe z opcjonalną decyzją, terminem, wyborem i skutkiem. | ✅ `lifeEvents` (v0.2) |
| **Commitment** (zobowiązanie czasowe) | Godziny dziennie w przedziale dat (kurs, zlecenie) odejmowane od czasu wolnego. | ✅ `commitments` (v0.2) |
| **Life** (stan życia) | Umiejętności, zmęczenie, plan dnia, styl życia. | ✅ `life` (v0.2) |
| **Asset** (aktywo) | Nieruchomość, pojazd, wyposażenie, papiery wartościowe, udziały, **kaucja zwrotna**. | ⚠️ tylko kaucja (`assets`, v0.2) |
| **Liability** (pasywo) | Kredyt, leasing, zaległości podatkowe. W v0.1 tylko zwykłe zobowiązania. | ⚠️ częściowo (`Obligation`) |
| **Ownership** (własność) | Relacja *podmiot → aktywo/udział* z ułamkiem i datami. | ✅ `corp.holdings` + `shareEvents` (v0.8): rejestr udziałów (partie, koszt, głosy, ograniczenia, historia) |
| **Company** (spółka z o.o.) | Osoba prawna: nazwa, kapitał zakładowy (liczba × nominał), kapitał zapasowy, rachunek i strona, zarząd i reprezentacja, status (`draft` → `organizing` → `registered`), działalność (`operation`), własne `reno`/`ops`/marketing (`slices`), wynik roczny, migawki miesięczne, wycena | ✅ `corp.companies` (v0.8) |
| **BoardMember / Mandate** | Członek zarządu (gracz lub postać AI): funkcja (prezes = funkcja organizacyjna), daty, uchwała powołująca. Niezależny od udziałów i od umowy o pracę | ✅ `Company.board` (v0.8) |
| **Partner** (wspólnik/inwestor AI) | Postać z kapitałem, doświadczeniem, kompetencjami, tolerancją ryzyka, celem, preferencją dywidend, horyzontem, zaufaniem i historią współpracy | ✅ `corp.partners` (v0.8) |
| **Resolution / Negotiation / Dividend / CitReturn** | Uchwała wspólników (próg, uprawnieni, głosy, wynik, skutki, historia); negocjacja inwestycyjna (rundy, kontroferty); dywidenda (linie, podatek, terminy); zeznanie CIT-8 i straty | ✅ `corp.*` (v0.8) |
| **Market / Region** (rynek) | Regionalne ceny, popyt, konkurenci. | 🟡 `market` (v0.7): jedno miasto (Olsztyn) i jedna branża (remonty): popyt, koniunktura, konkurenci (`Competitor`), marketing, pozycjonowanie firmy; wiele miast i danych GUS — później |

## 3. Relacje (docelowo)

```
Person ──(jest)──────────────► LegalEntity(osoba fizyczna)
Person ──(prowadzi)──────────► Enterprise(JDG)           ← ten sam podmiot prawny! (v0.3: Business.ownerId = person; rachunek firmowy należy do osoby)
Person ──(udziałowiec)───────► LegalEntity(spółka)  via Ownership(udziały %)
Person ──(członek zarządu)───► LegalEntity(spółka)  via Mandate(reprezentacja)   ≠ udziały
LegalEntity ──(posiada)──────► Account*, Asset*, Contract*
Contract ──(generuje)────────► Obligation* (przez Rule)
Obligation ──(rozliczane)────► LedgerEntry (1:1 w v0.1)
Enterprise ──(zatrudnia)─────► Person via Contract(employment)
Enterprise ──(kontrakt)──────► Party via Contract(commercial)
```

### 3.1 Przepływ w v0.1

```
Contract(employment) ──Rule:salary──► Obligation(receivable, issue: ostatni dzień mies., due: 10. następnego)
                                              │ w terminie
                                              ▼
                                       LedgerEntry(+kwota) ─► Account.balance
Contract(lease)  ──Rule:rent──► Obligation(payable, issue: 1., due: 10.)
                                              │ jeśli saldo ≥ kwota
                                              ▼
                                       LedgerEntry(−kwota) ─► Account.balance
                                              │ jeśli saldo < kwota
                                              ▼
                              overdueSince + zdarzenie „Brak środków…” (ponawiane codziennie bez dublowania)
```

## 3a. Spółka z o.o. i separacja majątku (v0.8)

```
Person ──(wspólnik)──► Company   via ShareHolding (kapitał % ≠ głosy % ≠ dywidenda ≠ zarząd)
Person ──(członek zarządu)──► Company   via BoardMember  (reprezentacja ≠ udziały)
Company ──(posiada)──► Account(type: company), Obligation(scope: company), Document(businessId: op:co:N), reno/ops/marketing
Person ⇄ Company : wyłącznie wkład na kapitał (para wpisów) · dywidenda (zobowiązanie spółki + należność gracza) · transakcje na udziałach
JDG ──(nadal)──► Person   (Business.ownerId = person; rachunek type: business) — nie jest spółką
```

Spółka ma własne rachunki, aktywa, zobowiązania, dokumenty, pracowników, kontrakty, wynik i obowiązki podatkowe (CIT, płatnik PIT od dywidend i wynagrodzeń, ZUS do 15.). Majątek netto gracza obejmuje **wyłącznie wartość jego udziałów** (szacunek) — nie gotówkę ani aktywa spółki.

## 3b. Zarobek przedsiębiorcy, projekty i klienci B2B (v0.8.1)

```
Zlecenie (cena) ─► koszty rzeczywiste (materiały, płace, podwykonawcy, transport, drobne) ─► nadwyżka przed obciążeniami właściciela ─► (− kalkulacyjna wartość pracy właściciela) ─► zysk ekonomiczny
                                                                                         └► (z nadwyżki firma płaci ZUS, podatek, księgowość) ─► reszta zostaje właścicielowi (to nie wypłata)
Klient B2B ──(zapytanie)──► Projekt ──► etapy ──► pakiety robót (= kontrakty RenoJob z zależnościami) ──► odbiór ──► referencje firmy ──► dostęp do większych projektów
```

Praca własna właściciela w JDG nie jest przepływem pieniężnym ani kosztem podatkowym; w spółce właściciel nie jest wykonawcą (brak umowy, art. 210 KSH). Klienci B2B to fikcyjna pula z własnym terminem płatności i rzetelnością; relacja z klientem rośnie po terminowych, dobrze ocenionych projektach.

## 4. Majątek netto

`majątek netto = rachunki (bieżący + oszczędności + firmowy) + kaucje + otwarte należności − otwarte zobowiązania` (v0.3; JDG nie jest osobną osobą prawną, więc jej środki to majątek właściciela). Docelowo: + wartość aktywów wg wyceny − pasywa. **Tożsamość kontrolna** (sprawdzana w `checkInvariants`):

`majątek netto − wartość udziałów (szac.) + koszt nabycia udziałów = kapitał początkowy + Σ naliczone przychody − Σ naliczone koszty + aktywa firmowe − zaliczki + zrealizowany zysk ze sprzedaży udziałów`

## 5. Ograniczenia modelu v0.1

Jeden gracz, rachunek bieżący i oszczędnościowy, brak podatków i składek (kwoty netto — oszacowane z brutto), odsetki tylko od oszczędności, strony zewnętrzne zawsze wypłacalne i bierne, brak gospodarstwa domowego i aktywów trwałych.
