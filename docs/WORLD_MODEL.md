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
| **LegalEntity** (podmiot prawny) | Wspólna abstrakcja: osoba fizyczna, JDG (jako tryb działania osoby), spółka. Źródło prawdy o *statusie prawnym*. | ❌ |
| **Enterprise** (przedsiębiorstwo) | Działalność gospodarcza (JDG albo spółki): branża, pracownicy, kontrakty, ewidencja. | ❌ |
| **Party** (strona zewnętrzna) | Pracodawca, wynajmujący, dostawca, bank, urząd. W v0.1 bierna i zawsze wypłacalna. | ✅ `parties` |
| **Account** (rachunek) | Rachunek pieniężny należący do podmiotu; saldo = suma wpisów w rejestrze. | ✅ `accounts` (1 rachunek gracza) |
| **LedgerEntry** (wpis w rejestrze) | Niezmienny zapis zmiany salda: data, rachunek, kwota ze znakiem, kategoria, kontrahent, powiązane zobowiązanie, id zdarzenia. | ✅ `ledger` |
| **Obligation** (zobowiązanie/należność) | Wierzyciel, dłużnik, kwota, data naliczenia, **termin**, status (otwarte/rozliczone), data zaległości. | ✅ `obligations` |
| **Contract** (umowa) | Źródło warunków i kwot: umowa o pracę, najem; później kontrakty handlowe, kredyt, leasing. | ✅ `employment`, `lease` |
| **Rule** (reguła harmonogramu) | Cykliczne naliczenia wynikające z umów i stylu życia; generuje zdarzenia. | ✅ `rules` (`obligation`, `birthday`) |
| **GameEvent** (zdarzenie) | Wpis w dzienniku: id, data, typ, ton, tytuł, kwota. | ✅ `events` |
| **Asset** (aktywo) | Nieruchomość, pojazd, wyposażenie, papiery wartościowe, udziały. | ❌ (poza gotówką i należnościami) |
| **Liability** (pasywo) | Kredyt, leasing, zaległości podatkowe. W v0.1 tylko zwykłe zobowiązania. | ⚠️ częściowo (`Obligation`) |
| **Ownership** (własność) | Relacja *podmiot → aktywo/udział* z ułamkiem i datami. | ❌ |
| **Market / Region** (rynek) | Regionalne ceny, popyt, konkurenci. | ❌ |

## 3. Relacje (docelowo)

```
Person ──(jest)──────────────► LegalEntity(osoba fizyczna)
Person ──(prowadzi)──────────► Enterprise(JDG)           ← ten sam podmiot prawny!
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

## 4. Majątek netto

`majątek netto = gotówka + otwarte należności − otwarte zobowiązania` (v0.1). Docelowo: + wartość aktywów wg wyceny − pasywa. **Tożsamość kontrolna** (sprawdzana w `checkInvariants`):

`majątek netto = kapitał początkowy + Σ naliczone przychody − Σ naliczone koszty`

## 5. Ograniczenia modelu v0.1

Jeden gracz, jeden rachunek, brak podatków i składek (kwoty netto), brak odsetek, strony zewnętrzne zawsze wypłacalne i bierne, brak gospodarstwa domowego i aktywów trwałych.
