import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name, exact: true }).click();

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
  const dot = page.getByTestId('nav-dot-renoEnquiries');
  for (let i = 0; i < 60 && (await dot.count()) === 0; i++) await page.getByTestId('advance-day').click();
  await expect(dot).toBeVisible();
  await expect(page.getByTestId('group-dot-Remonty')).toBeVisible();
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
  const dot = page.getByTestId('nav-dot-renoEnquiries');
  for (let i = 0; i < 60 && (await dot.count()) === 0; i++) await page.getByTestId('advance-day').click();
  await nav(page, 'Zapytania klientów');
  await page.getByRole('button', { name: 'Wyceń' }).first().click();
  const sel = page.locator('#q-team');
  const opt = sel.locator('optgroup option:not([disabled])').first();
  await expect(opt).toHaveCount(1);
  await sel.selectOption({ value: (await opt.getAttribute('value'))! });
  await expect(page.getByTestId('outsource-box')).toContainText('Całość wykona podwykonawca');
  await expect(page.getByTestId('quote-preview')).toContainText('Robocizna');
});
