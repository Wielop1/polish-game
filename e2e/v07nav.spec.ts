import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name, exact: true });
  if (!(await item.first().isVisible())) for (const h of await menu.locator('button[aria-expanded="false"]').all()) await h.click();
  await item.click();
};

test('kropka w menu: pojawia się przy nowych zapytaniach klientów (menu i grupa), a samo wejście na ekran jej nie gasi', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill('e2e-nav-dot');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('nav-dot-renoEnquiries')).toHaveCount(0);
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  // zapytania klientów wygasają po ~7 dniach, więc przesuwamy czas dzień po dniu, aż pojawi się pierwsze
  // sekcja „Zlecenia” jest zwinięta, więc o nowym zapytaniu informuje kropka przy jej nagłówku
  const dot = page.getByTestId('nav-dot-renoEnquiries');
  const groupDot = page.getByTestId('group-dot-Zlecenia');
  for (let i = 0; i < 60 && (await groupDot.count()) === 0; i++) await page.getByTestId('advance-day').click();
  await expect(groupDot).toBeVisible();
  await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Zlecenia', exact: true }).click();
  await expect(dot).toBeVisible();
  // wejście na ekran nie gasi kropki „do załatwienia” — gasi ją dopiero obsłużenie zapytania
  await nav(page, 'Zapytania klientów');
  await expect(dot).toBeVisible();
});

test('wycena: można zlecić całość podwykonawcy jednym wyborem, bez zakładania ekipy', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill('e2e-outsource');
  await page.getByTestId('start-game').click();
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  const groupDot = page.getByTestId('group-dot-Zlecenia');
  for (let i = 0; i < 60 && (await groupDot.count()) === 0; i++) await page.getByTestId('advance-day').click();
  await nav(page, 'Zapytania klientów');
  await page.getByRole('button', { name: 'Wyceń' }).first().click();
  await page.locator('[data-testid^="crew-sub-"]').first().check();
  await page.getByTestId('crew-owner').uncheck();
  await expect(page.getByTestId('outsource-box')).toContainText('wykonają wybrani wykonawcy');
  await expect(page.getByTestId('quote-preview')).toContainText('Robocizna');
});
