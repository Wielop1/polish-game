import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name, exact: true });
  for (let i = 0; i < 8 && !(await item.first().isVisible()); i++) await menu.locator('button[aria-expanded="false"]').first().click();
  await item.click();
};

async function start(page: Page, seed: string) {
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill(seed);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 stycznia 2026');
}

/** Gracz startuje z 5 000 zł i odkłada ok. 1,4 tys. zł miesięcznie — czekamy, aż stać go na wkład (minimum kapitału to 5 000 zł). */
async function waitForAffordable(page: Page) {
  const btn = page.getByTestId('sign-agreement-btn');
  for (let i = 0; i < 12 && (await btn.isDisabled()); i++) await page.getByTestId('advance-month').click();
  await expect(btn).toBeEnabled();
}

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('spółka z o.o.: walidacja kapitału, szkic, umowa S24, rejestracja w KRS, uruchomienie działalności i ekrany własności', async ({ page }) => {
  await start(page, 'e2e-corp-1');
  await nav(page, 'Załóż spółkę');
  await expect(page.getByRole('heading', { name: 'Załóż spółkę z o.o.' })).toBeVisible();
  await expect(page.getByTestId('corp-banner')).toContainText('nie porada prawna');
  // kapitał poniżej minimum jest odrzucany
  await page.getByLabel('Kapitał zakładowy (zł)').fill('4900');
  await expect(page.getByTestId('found-error')).toContainText('co najmniej');
  await expect(page.getByTestId('found-draft-btn')).toBeDisabled();
  await page.getByLabel('Kapitał zakładowy (zł)').fill('5000');
  await expect(page.getByTestId('found-costs')).toContainText('brak (od 29.11.2025)');
  await page.getByTestId('found-draft-btn').click();
  await expect(page.getByTestId('notice')).toContainText('Szkic spółki');
  await waitForAffordable(page);
  await page.getByTestId('sign-agreement-btn').click();
  await expect(page.getByTestId('notice')).toContainText('Wniosek o wpis');
  await expect(page.getByTestId('org-steps-co:1')).toContainText('Umowa spółki zawarta');
  // spółka nie jest zarejestrowana przed wpisem
  await nav(page, 'Moje spółki');
  await expect(page.getByTestId('company-co:1')).toBeVisible();
  await expect(page.getByText('w organizacji').first()).toBeVisible();
  await page.getByTestId('advance-day').click();
  await page.getByTestId('advance-day').click();
  await nav(page, 'Moje spółki');
  await expect(page.getByText('zarejestrowana').first()).toBeVisible();
  await expect(page.getByTestId('company-co:1')).toContainText('Gotówka spółki');
  await page.getByTestId('start-op-btn-co:1').click();
  await expect(page.getByTestId('notice')).toContainText('Działalność spółki rozpocznie się');
  // udziały i zarząd
  await nav(page, 'Udziały i kapitał');
  await expect(page.getByTestId('share-table')).toContainText('100,0%');
  await expect(page.getByTestId('dilution-sim')).toContainText('Nowe udziały');
  await nav(page, 'Zarząd');
  await expect(page.getByTestId('board-table')).toContainText('prezes zarządu');
  await nav(page, 'Uchwały');
  await expect(page.getByRole('heading', { name: 'Uchwały wspólników' })).toBeVisible();
  await nav(page, 'Finanse i CIT');
  await expect(page.getByTestId('balance-sheet')).toContainText('Aktywa netto');
  await expect(page.getByTestId('cit-rate')).toContainText('9%');
  await nav(page, 'Dywidendy');
  await expect(page.getByTestId('distributable')).toContainText('Zysk do podziału');
  await expect(page.getByTestId('div-blockers')).toContainText('brak zysku do podziału');
  await nav(page, 'Wspólnicy');
  await expect(page.getByTestId('partner-list')).toContainText('Zaufanie do Ciebie');
  await nav(page, 'Inwestorzy i negocjacje');
  await expect(page.getByTestId('propose-deal-btn')).toBeVisible();
  // jedyny wspólnik płaci ZUS: zobowiązanie pojawia się w finansach prywatnych
  await page.getByTestId('advance-month').click();
  await page.getByTestId('advance-month').click();
  await nav(page, 'Finanse');
  await expect(page.getByText('wspólnika jednoosobowej').first()).toBeVisible();
});

test('JDG i spółka obok siebie: przełącznik aktywnego podmiotu zmienia dane ekranów zleceń i rynku', async ({ page }) => {
  await start(page, 'e2e-corp-2');
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  await nav(page, 'Załóż spółkę');
  await page.getByLabel('Nazwa spółki (bez „sp. z o.o.”)').fill('Spółka Dwa');
  await page.getByTestId('found-draft-btn').click();
  await waitForAffordable(page);
  await page.getByTestId('sign-agreement-btn').click();
  await page.getByTestId('advance-day').click();
  await page.getByTestId('advance-day').click();
  await nav(page, 'Moje spółki');
  await page.getByTestId('start-op-btn-co:1').click();
  await page.getByTestId('advance-month').click();
  await page.getByTestId('advance-month').click();
  await nav(page, 'Moje spółki');
  await expect(page.getByTestId('entity-compare')).toContainText('JDG');
  await expect(page.getByTestId('entity-compare')).toContainText('osoba prawna');
  await page.getByTestId('select-op-co:1').click();
  await nav(page, 'Pulpit zleceń');
  await expect(page.getByTestId('operator-bar')).toBeVisible();
  await expect(page.getByTestId('operator-co:1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('operator-jdg').click();
  await expect(page.getByTestId('operator-jdg')).toHaveAttribute('aria-pressed', 'true');
  await nav(page, 'Marketing');
  await expect(page.getByTestId('operator-bar')).toBeVisible();
});
