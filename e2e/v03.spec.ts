import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name });
  for (let i = 0; i < 6 && !(await item.first().isVisible()); i++) await menu.locator('button[aria-expanded="false"]').first().click();
  await item.click();
};

async function startGame(page: Page, seed: string) {
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill(seed);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 stycznia 2026');
}

async function registerAndStart(page: Page, seed: string) {
  await startGame(page, seed);
  await nav(page, 'Rejestracja JDG');
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  await page.getByTestId('advance-month').click(); // 1 lutego — start działalności
  await expect(page.getByTestId('game-date')).toHaveText('1 lutego 2026');
}

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('rejestracja JDG: konsekwencje wyboru, oznaczenia prawne i tożsamość prawna', async ({ page }) => {
  await startGame(page, 'e2e-biz-2');
  await nav(page, 'Rejestracja JDG');
  await expect(page.getByTestId('sim-banner')).toContainText('porada prawna');
  await expect(page.getByTestId('reg-preview')).toContainText('ulga na start');
  await expect(page.getByTestId('reg-preview')).toContainText('432,54'); // minimalna składka zdrowotna
  await expect(page.getByTestId('reg-warnings')).toContainText('etat'); // zbieg z etatem
  await page.getByText('Ryczałt —').click();
  await expect(page.getByTestId('reg-warnings')).toContainText('PKWiU');
  await page.getByTestId('register-business').click();
  await expect(page.getByTestId('notice')).toContainText('zarejestrowana');
  await expect(page.getByText('JDG to osoba fizyczna')).toBeVisible();
  await expect(page.getByText('cały majątek prywatny')).toBeVisible();
  // druga rejestracja jest niemożliwa
  await nav(page, 'Rejestracja JDG');
  await expect(page.getByText(/Prowadzisz już działalność/)).toBeVisible();
});

test('zlecenie: przyjęcie, rezerwacja czasu, konflikt godzin i dokument kosztowy', async ({ page }) => {
  await registerAndStart(page, 'e2e-biz-2');
  await nav(page, 'Oferty i kontrakty');
  await expect(page.getByTestId('free-hours')).toHaveText('4 godz.'); // doba − etat − sen − obowiązki
  const offer = page.getByTestId('offers-list').locator('[data-testid^="service-offer-"]').first();
  await expect(offer).toContainText('Strona internetowa');
  // 8 godzin dziennie nie mieści się w czasie wolnym (godziny etatu są nienaruszalne)
  await offer.getByLabel(/Godzin dziennie/).selectOption('8');
  await offer.getByRole('button', { name: 'Przyjmij zlecenie' }).click();
  await expect(page.getByTestId('notice')).toContainText('Brak wolnych godzin');
  await page.getByTestId('notice').getByRole('button', { name: 'Zamknij komunikat' }).click();
  await offer.getByLabel(/Godzin dziennie/).selectOption('2');
  await offer.getByRole('button', { name: 'Przyjmij zlecenie' }).click();
  await expect(page.getByTestId('notice')).toContainText('Zlecenie przyjęte');
  await expect(page.getByTestId('orders-list')).toContainText('w realizacji');
  await nav(page, 'Dokumenty');
  await expect(page.getByTestId('documents')).toContainText('FK/2026/02/001'); // koszt realizacji
  await expect(page.getByTestId('sim-banner')).toContainText('KSeF');
});

test('podatki i ZUS: rozliczenie miesiąca z regułami, wkład własny i płynność', async ({ page }) => {
  await registerAndStart(page, 'e2e-biz-2');
  await nav(page, 'Moja działalność');
  await page.locator('#bizamount').fill('1000');
  await page.getByTestId('biz-transfer').click();
  await expect(page.getByTestId('hud-business')).toContainText(/1\s?000,00/);
  for (let i = 0; i < 27; i++) await page.getByTestId('advance-day').click(); // do 28 lutego
  await page.getByTestId('advance-day').click(); // 1 marca: luty zamknięty
  await nav(page, 'Podatki i ZUS');
  const table = page.getByTestId('tax-periods');
  await expect(table).toContainText('Luty 2026');
  await expect(table).toContainText('pokryte etatem'); // etat ≥ minimalnego wynagrodzenia → brak składek społecznych z JDG
  await expect(table).toContainText('432,54'); // składka zdrowotna (skala, minimum)
  await expect(page.getByTestId('legal-rules')).toContainText('PIT-SCALE-2026');
  await expect(page.getByTestId('legal-rules')).toContainText('odłożone'); // reguły DEFERRED są jawne
  await nav(page, 'Kalendarz obowiązków');
  await expect(page.getByTestId('duties')).toContainText('Składka zdrowotna');
  await expect(page.getByTestId('duties')).toContainText('20 marca 2026');
});

test('zapis i wczytanie zachowuje działalność, rachunek firmowy i dokumenty', async ({ page }) => {
  await registerAndStart(page, 'e2e-biz-2');
  await nav(page, 'Moja działalność');
  await page.locator('#bizamount').fill('900');
  await page.getByTestId('biz-transfer').click();
  await nav(page, 'Nowa gra / Wczytaj');
  await page.getByTestId('save-slot-1').click();
  await expect(page.getByTestId('slot-slot-1')).toContainText('Jan Kowalski');
  await page.reload();
  await page.getByTestId('load-slot-1').click();
  await expect(page.getByTestId('hud-business')).toContainText(/900,00/);
  await nav(page, 'Moja działalność');
  await expect(page.getByTestId('biz-balance')).toContainText(/900,00/);
});

test('mobilne menu zawiera grupę Firma', async ({ page }) => {
  await startGame(page, 'e2e-biz-2');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Więcej' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toContainText('Firma (JDG)');
  await menu.getByRole('button', { name: 'Rejestracja JDG' }).click();
  await expect(page.getByRole('heading', { name: 'Rejestracja JDG' })).toBeVisible();
});
