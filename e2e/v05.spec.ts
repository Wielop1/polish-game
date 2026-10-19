import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name, exact: true });
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

async function registerReno(page: Page, seed: string) {
  await startGame(page, seed);
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await expect(page.getByTestId('specialization-picker')).toBeVisible();
  await expect(page.getByTestId('reg-warnings')).toContainText('8% dla remontów mieszkań');
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 lutego 2026');
}

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('remonty: rejestracja ze specjalizacją, sprzęt, zapytanie, wycena z podglądem marży i wysłanie oferty', async ({ page }) => {
  await registerReno(page, 'e2e-reno-1');
  // wkład własny
  await page.locator('#bizamount').fill('1000');
  await page.getByTestId('biz-transfer').click();
  // sprzęt
  await nav(page, 'Magazyn i sprzęt');
  await expect(page.getByTestId('reno-param-note')).toContainText('parametry symulacyjne');
  await expect(page.getByTestId('skills')).toContainText('Malowanie ścian i sufitów');
  await page.getByTestId('buy-eq-paint-basic').click();
  await expect(page.getByTestId('notice')).toContainText('Kupiono');
  // czekamy na zapytanie
  let found = false;
  for (let i = 0; i < 4 && !found; i++) {
    await page.getByTestId('advance-month').click();
    await nav(page, 'Zapytania klientów');
    found = (await page.getByTestId('enquiries-list').count()) > 0;
  }
  expect(found).toBe(true);
  const enquiry = page.getByTestId('enquiries-list').locator('li').first();
  await enquiry.getByRole('button', { name: 'Wyceń' }).click();
  await expect(page.getByRole('heading', { name: 'Wyceny' })).toBeVisible();
  await expect(page.getByTestId('quote-builder')).toBeVisible();
  const preview = page.getByTestId('quote-preview');
  await expect(preview).toContainText('Koszt planowany');
  await expect(preview).toContainText('Narzut (od kosztu)');
  await expect(preview).toContainText('Marża (od ceny)');
  await expect(preview).toContainText('bez VAT');
  const send = page.getByTestId('send-quote');
  if (await send.isEnabled()) {
    await send.click();
    await expect(page.getByTestId('quotes-list')).toContainText('czeka na decyzję klienta');
  } else {
    await expect(preview.getByRole('alert')).toBeVisible(); // powód zablokowania jest wyjaśniony
  }
});

test('remonty: wszystkie ekrany branży i księgowość renderują się; biuro rachunkowe można wybrać i rozwiązać', async ({ page }) => {
  await registerReno(page, 'e2e-reno-2');
  for (const [name, heading] of [['Pulpit zleceń', 'Pulpit zleceń — Remonty'], ['Zapytania klientów', 'Zapytania klientów'], ['Wyceny', 'Wyceny'], ['Kontrakty', 'Kontrakty'], ['Harmonogram', 'Harmonogram'], ['Magazyn i sprzęt', 'Magazyn i sprzęt'], ['Reputacja i reklamacje', 'Reputacja i reklamacje']] as const) {
    await nav(page, name);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await nav(page, 'Oferty i kontrakty');
  await expect(page.getByTestId('offers-status')).toContainText('branży remontowej');
  await page.getByTestId('offers-status').getByRole('button', { name: 'Przejdź do zapytań' }).click();
  await expect(page.getByRole('heading', { name: 'Zapytania klientów' })).toBeVisible();
  await nav(page, 'Reputacja i reklamacje');
  await expect(page.getByTestId('reno-reputation')).toContainText('3,5★');
  await nav(page, 'Księgowość');
  await expect(page.getByTestId('acc-disclaimer')).toContainText('nie regulowane doradztwo podatkowe');
  await expect(page.getByTestId('acc-current')).toContainText('samodzielnie');
  await page.getByTestId('acc-hire-standard').click();
  await expect(page.getByTestId('acc-current')).toContainText('Pakiet Standard');
  await page.getByTestId('acc-terminate').click();
  await expect(page.getByTestId('acc-current')).toContainText('umowa wygasa');
});

test('remonty: stan firmy przeżywa zapis i wczytanie (sprzęt, zapas, specjalizacja)', async ({ page }) => {
  await registerReno(page, 'e2e-reno-3');
  await page.locator('#bizamount').fill('1000');
  await page.getByTestId('biz-transfer').click();
  await nav(page, 'Magazyn i sprzęt');
  await page.getByTestId('buy-eq-paint-basic').click();
  await page.getByLabel('Ilość: Farba do ścian i sufitów').fill('10');
  await page.getByTestId('mat-farba:std').getByRole('button', { name: 'Kup' }).click();
  await expect(page.getByTestId('notice')).toContainText('Kupiono 10 l');
  await nav(page, 'Nowa gra / Wczytaj');
  await page.getByRole('button', { name: 'Zapisz' }).first().click();
  await page.reload();
  await page.getByRole('button', { name: 'Wczytaj' }).first().click();
  await nav(page, 'Magazyn i sprzęt');
  await expect(page.getByTestId('eq-paint-basic')).toContainText('100%');
  await expect(page.getByTestId('mat-farba:std')).toContainText('10 l');
});

test('mobilne menu zawiera sekcję Zlecenia i Księgowość', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill('e2e-reno-m');
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Więcej' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu.getByText('Zlecenia', { exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Magazyn i sprzęt' }).click();
  await expect(page.getByRole('heading', { name: 'Magazyn i sprzęt' })).toBeVisible();
  await page.getByRole('button', { name: 'Więcej' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Księgowość' }).click();
  await expect(page.getByRole('heading', { name: 'Księgowość' })).toBeVisible();
});
