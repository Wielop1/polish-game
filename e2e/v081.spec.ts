import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name, exact: true });
  for (let i = 0; i < 8 && !(await item.first().isVisible()); i++) await menu.locator('button[aria-expanded="false"]').first().click();
  await item.click();
};

const startJdg = async (page: Page, seed: string) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill(seed);
  await page.getByTestId('start-game').click();
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
};

test('v0.8.1: ekrany klientów B2B, projektów, pakietów i referencji renderują się; nowa firma ma zablokowane poziomy dostępu', async ({ page }) => {
  await startJdg(page, 'e2e-v081-screens');
  for (let i = 0; i < 35; i++) await page.getByTestId('advance-day').click();
  await nav(page, 'Klienci B2B');
  await expect(page.getByRole('heading', { name: 'Klienci B2B' })).toBeVisible();
  await expect(page.getByTestId('b2b-clients')).toContainText('Deweloper');
  await nav(page, 'Większe projekty');
  await expect(page.getByRole('heading', { name: 'Większe projekty' })).toBeVisible();
  await nav(page, 'Pakiety robót');
  await expect(page.getByRole('heading', { name: 'Pakiety robót' })).toBeVisible();
  await expect(page.getByText('Brak podpisanych projektów')).toBeVisible();
  await nav(page, 'Referencje firmy');
  await expect(page.getByRole('heading', { name: 'Referencje firmy' })).toBeVisible();
  await expect(page.getByTestId('tier-ladder')).toContainText('zablokowany');
  await expect(page.getByTestId('next-tier-tips')).toContainText('Ukończ jeszcze');
  await nav(page, 'Klienci B2B');
  await expect(page.getByTestId('b2b-clients')).toContainText('Spółdzielnia mieszkaniowa');
  await expect(page.getByTestId('b2b-clients')).toContainText('Sieć handlowa');
});

test('v0.8.1: wycena pokazuje osobno koszty rzeczywiste, nadwyżkę, kalkulacyjną pracę właściciela, zysk ekonomiczny i płynność', async ({ page }) => {
  await startJdg(page, 'e2e-outsource');
  const groupDot = page.getByTestId('group-dot-Zlecenia');
  for (let i = 0; i < 60 && (await groupDot.count()) === 0; i++) await page.getByTestId('advance-day').click();
  await nav(page, 'Zapytania klientów');
  await page.getByRole('button', { name: 'Wyceń' }).first().click();
  const econ = page.getByTestId('quote-economics');
  await expect(econ).toBeVisible();
  for (const t of ['Koszty rzeczywiste — pieniądze wydane przez firmę', 'Nadwyżka przed obciążeniami właściciela', 'Kalkulacyjna wartość Twojej pracy', 'Zysk ekonomiczny', 'Wpływ na płynność firmy', 'nie wypłata i nie koszt podatkowy JDG', 'Ile zostaje po wszystkim', 'Zostaje do kieszeni']) await expect(econ).toContainText(t);
});

test('nowy gracz: pulpit podpowiada założenie firmy, menu ukrywa ekrany firmowe, przewodnik tłumaczy grę; po rejestracji menu się rozszerza, a marketing ma szybki start', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill('e2e-onboarding');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('next-steps')).toContainText('Załóż własną firmę remontową');
  await expect(page.getByTestId('screen-help')).toContainText('Do czego służy ten ekran');
  await expect(page.getByTestId('no-business-callout')).toBeVisible();
  // pomoc można ukryć i przywrócić
  await page.getByTestId('help-hide').click();
  await expect(page.getByTestId('screen-help')).toHaveCount(0);
  await page.getByTestId('help-show').click();
  await expect(page.getByTestId('screen-help')).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  await expect(menu.getByRole('button', { name: 'Zapytania klientów', exact: true })).toHaveCount(0);
  await nav(page, 'Przewodnik: jak grać');
  await expect(page.getByTestId('guide')).toContainText('O co w tej grze chodzi');
  await expect(page.getByTestId('first-steps')).toContainText('Załóż firmę');
  await expect(page.getByTestId('glossary')).toContainText('Zysk ekonomiczny');
  await expect(page.getByTestId('nav-map')).toContainText('Większe projekty (B2B)');
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  await expect(page.getByTestId('no-business-callout')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Zlecenia', exact: true })).toBeVisible();
  await nav(page, 'Marketing');
  await expect(page.getByTestId('marketing-quickstart')).toBeVisible();
  await page.getByTestId('marketing-quickstart-btn').click();
  await expect(page.getByTestId('marketing-total')).toContainText('550');
  await expect(page.getByTestId('marketing-quickstart')).toHaveCount(0);
});
