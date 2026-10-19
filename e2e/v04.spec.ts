import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name, exact: true });
  for (let i = 0; i < 6 && !(await item.first().isVisible()); i++) await menu.locator('button[aria-expanded="false"]').first().click();
  await item.click();
};

async function startWithBusiness(page: Page, seed: string) {
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill(seed);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 stycznia 2026');
  await nav(page, 'Rejestracja JDG');
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 lutego 2026');
}

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('zawieszenie i wznowienie JDG oraz zaplanowanie zmiany formy od nowego roku', async ({ page }) => {
  await startWithBusiness(page, 'e2e-v04-a');
  await page.getByTestId('suspend-business').click();
  await expect(page.getByTestId('suspension-status')).toContainText('zaplanowane od 1 marca 2026');
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('suspension-status')).toContainText('zawieszona');
  await expect(page.getByText('zawieszona', { exact: true }).first()).toBeVisible();
  // wznowienie od wybranej daty
  await page.getByLabel('Wznów działalność od').selectOption({ index: 2 });
  await page.getByTestId('resume-business').click();
  await expect(page.getByTestId('notice')).toContainText(/wznow/i);
  // zmiana formy dopiero od 2027
  await page.getByTestId('plan-form-liniowy').click();
  await expect(page.getByTestId('next-form')).toContainText('Liniowy 19%');
  await expect(page.getByTestId('next-form')).toContainText('zaplanowana zmiana');
});

test('planowanie: prognoza z jawnym oznaczeniem i bez zmiany stanu gry', async ({ page }) => {
  await startWithBusiness(page, 'e2e-v04-b');
  await nav(page, 'Planowanie');
  await expect(page.getByTestId('plan-notice')).toContainText('Prognoza, nie gwarancja');
  const dateBefore = await page.getByTestId('game-date').textContent();
  await page.getByTestId('plan-run').click();
  await expect(page.getByTestId('plan-results')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('plan-baseline')).toContainText('Etat i JDG');
  await expect(page.getByTestId('plan-no-job')).toBeVisible();
  await expect(page.getByTestId('game-date')).toHaveText(dateBefore!);
  await page.getByLabel('Horyzont (mies.)').fill('1');
  await page.getByTestId('plan-run').click();
  await expect(page.getByRole('alert')).toContainText('3–36');
});

test('rozliczenie roczne i podsumowanie roku po zamknięciu 2026', async ({ page }) => {
  await startWithBusiness(page, 'e2e-v04-c');
  for (let i = 0; i < 11; i++) await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 stycznia 2027');
  await nav(page, 'Rozliczenie roczne');
  await expect(page.getByTestId('tax-returns')).toContainText('PIT-36');
  await expect(page.getByTestId('tax-returns')).toContainText('etat + JDG');
  await expect(page.getByTestId('health-settlements')).toContainText('2026');
  await nav(page, 'Podsumowanie roku');
  await page.getByRole('button', { name: '2026', exact: true }).click();
  await expect(page.getByTestId('report-business')).toContainText('Wynik netto firmy');
  await expect(page.getByText('Przelewy między Twoimi rachunkami nie są przychodem')).toBeVisible();
});

test('mobilne menu zawiera nowe ekrany (Planowanie, Rozliczenie roczne)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill('e2e-v04-m');
  await page.getByTestId('start-game').click();
  await page.getByRole('button', { name: 'Więcej' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Planowanie' }).click();
  await expect(page.getByRole('heading', { name: 'Planowanie' })).toBeVisible();
  await page.getByRole('button', { name: 'Więcej' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Rozliczenie roczne' }).click();
  await expect(page.getByRole('heading', { name: 'Rozliczenie roczne' })).toBeVisible();
});
