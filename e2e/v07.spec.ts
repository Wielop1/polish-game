import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name, exact: true });
  for (let i = 0; i < 6 && !(await item.first().isVisible()); i++) await menu.locator('button[aria-expanded="false"]').first().click();
  await item.click();
};

async function registerReno(page: Page, seed: string) {
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill(seed);
  await page.getByTestId('start-game').click();
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 lutego 2026');
  await page.getByTestId('advance-month').click(); // pierwszy zamknięty miesiąc rynku
}

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('rynek: ekrany Rynek lokalny, Konkurencja i Analiza popytu pokazują koniunkturę, konkurentów (jako oszacowania) i lejek popytu', async ({ page }) => {
  await registerReno(page, 'e2e-market-1');
  await nav(page, 'Rynek lokalny');
  await expect(page.getByRole('heading', { name: 'Rynek lokalny' })).toBeVisible();
  await expect(page.getByTestId('market-phase')).toBeVisible();
  await expect(page.getByTestId('macro-bars')).toBeVisible();
  await expect(page.getByTestId('segment-structure')).toContainText('Budżetowy');
  await expect(page.getByTestId('market-calibration')).toContainText('kalibracyjne');
  await nav(page, 'Konkurencja');
  await expect(page.getByRole('heading', { name: 'Konkurencja' })).toBeVisible();
  const rows = page.getByTestId('competitors-table').locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(8);
  await expect(page.getByTestId('market-competition')).toContainText('oszacowania');
  await nav(page, 'Analiza popytu');
  await expect(page.getByRole('heading', { name: 'Analiza popytu' })).toBeVisible();
  await expect(page.getByTestId('funnel-table')).toContainText('Popyt w mieście');
  await expect(page.getByTestId('market-demand')).toContainText('Zatrudnienie pracownika samo nie zwiększa liczby zapytań');
});

test('marketing: budżet kanału ustawia się z ekranu i obowiązuje od następnego miesiąca; strategia zmienia się stopniowo i ma odstęp między zmianami', async ({ page }) => {
  await registerReno(page, 'e2e-market-2');
  await nav(page, 'Marketing');
  await expect(page.getByRole('heading', { name: 'Marketing' })).toBeVisible();
  await page.getByTestId('budget-search').fill('800');
  await page.getByTestId('set-budget-search').click();
  await expect(page.getByTestId('notice')).toContainText('Obowiązuje od 1. dnia następnego miesiąca');
  await expect(page.getByTestId('marketing-total')).toContainText('800');
  await page.getByTestId('advance-month').click();
  await nav(page, 'Marketing');
  await expect(page.getByTestId('channel-search')).toContainText('800');
  await nav(page, 'Strategia firmy');
  await page.getByTestId('set-positioning-premium').click();
  await expect(page.getByTestId('notice')).toContainText('Pozycjonowanie: Wysoka jakość');
  await expect(page.getByTestId('transition')).toContainText('0% efektu');
  await expect(page.getByTestId('cooldown')).toContainText('dni');
  await expect(page.getByTestId('set-positioning-low')).toBeDisabled();
  await expect(page.getByTestId('strategy-history')).toContainText('Zrównoważona oferta → Wysoka jakość');
});

test('rynek: stan rynku i strategia przeżywają zapis i wczytanie; menu mobilne ma sekcję Rynek', async ({ page }) => {
  await registerReno(page, 'e2e-market-3');
  await nav(page, 'Strategia firmy');
  await page.getByTestId('set-positioning-low').click();
  await nav(page, 'Nowa gra / Wczytaj');
  await page.getByRole('button', { name: 'Zapisz' }).first().click();
  await page.reload();
  await page.getByRole('button', { name: 'Wczytaj' }).first().click();
  await nav(page, 'Strategia firmy');
  await expect(page.getByTestId('positioning-low')).toContainText('aktualne');
  await nav(page, 'Konkurencja');
  await expect(page.getByTestId('competitors-table').locator('tbody tr').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: 'Więcej' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu.getByText('Rynek', { exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Analiza popytu' }).click();
  await expect(page.getByRole('heading', { name: 'Analiza popytu' })).toBeVisible();
});
