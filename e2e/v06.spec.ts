import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const registerOnMobile = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Więcej' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Rejestracja JDG' }).click();
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
};


const nav = async (page: Page, name: string) => {
  const menu = page.getByRole('navigation', { name: 'Główna nawigacja' });
  const item = menu.getByRole('button', { name, exact: true });
  for (let i = 0; i < 6 && !(await item.first().isVisible()); i++) await menu.locator('button[aria-expanded="false"]').first().click();
  await item.click();
};

async function startRenoBusiness(page: Page, seed: string) {
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill(seed);
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 stycznia 2026');
  await nav(page, 'Rejestracja JDG');
  await page.getByText('Usługi remontowo-wykończeniowe').first().click();
  await page.getByTestId('register-business').click();
  await expect(page.getByRole('heading', { name: 'Moja działalność' })).toBeVisible();
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 lutego 2026');
  await page.locator('#bizamount').fill('1000');
  await page.getByTestId('biz-transfer').click();
}

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('rekrutacja i zatrudnienie: ogłoszenie, zgłoszenia, oferta, pracownik z kosztem pracodawcy i lista płac', async ({ page }) => {
  await startRenoBusiness(page, 'e2e-v06-a');
  await nav(page, 'Rekrutacja');
  await expect(page.getByTestId('ops-param-note')).toContainText('parametry symulacyjne');
  await page.getByLabel('Rodzaj ogłoszenia').selectOption('premium');
  await page.getByTestId('publish-listing').click();
  await expect(page.getByTestId('notice')).toContainText('Ogłoszenie opublikowane');
  await expect(page.getByTestId('listings')).toContainText('Malarz');
  let hired = false;
  for (let round = 0; round < 6 && !hired; round++) {
    for (let i = 0; i < 7; i++) await page.getByTestId('advance-day').click();
    await nav(page, 'Rekrutacja');
    const cand = page.getByTestId('candidates').locator('li').first();
    if ((await page.getByTestId('candidates').count()) === 0) continue;
    await cand.getByRole('button', { name: 'Złóż ofertę' }).click();
    await nav(page, 'Pracownicy');
    hired = (await page.getByTestId('employees-list').count()) + (await page.getByTestId('upcoming-hires').count()) > 0;
  }
  expect(hired).toBe(true);
  // czekamy do startu pracy (najdalej 45 dni)
  for (let i = 0; i < 2 && (await page.getByTestId('employees-list').count()) === 0; i++) { await page.getByTestId('advance-month').click(); await nav(page, 'Pracownicy'); }
  await expect(page.getByTestId('employees-list')).toBeVisible();
  const emp = page.getByTestId('employees-list').locator('li').first();
  await expect(emp).toContainText('Składki pracodawcy');
  await expect(emp).toContainText('Koszt całkowity');
  await expect(page.getByTestId('hr-count')).toContainText('1');
  // po miesiącu pojawia się lista płac
  for (let i = 0; i < 2; i++) await page.getByTestId('advance-month').click();
  await nav(page, 'Pracownicy');
  await expect(page.getByTestId('payslips')).toBeVisible();
  await expect(page.getByTestId('payslips')).toContainText('2026-');
  // ekipa z zatrudnionym pracownikiem (regresja: id z dwukropkiem było ucinane i pracownik był odrzucany)
  await nav(page, 'Ekipy');
  await page.getByLabel('Nazwa ekipy').fill('Malarze');
  await page.getByTestId('team-form').getByText('(pracownik)').click();
  await page.getByTestId('create-team').click();
  await expect(page.getByTestId('teams')).toContainText('Malarze');
  await nav(page, 'Pracownicy');
  // wypowiedzenie
  await emp.getByRole('button', { name: /Wypowiedz umowę/ }).click();
  await expect(emp).toContainText('wypowiedzenie do');
});

test('ekrany pracowników, podwykonawców, ekip, pojazdów, harmonogramu i rentowności renderują się i pokazują komunikaty', async ({ page }) => {
  await startRenoBusiness(page, 'e2e-v06-b');
  for (const [name, heading] of [['Pracownicy', 'Pracownicy'], ['Rekrutacja', 'Rekrutacja'], ['Podwykonawcy', 'Podwykonawcy'], ['Ekipy', 'Ekipy'], ['Harmonogram wielu kontraktów', 'Harmonogram wielu kontraktów'], ['Pojazdy', 'Pojazdy'], ['Rentowność', 'Rentowność']] as const) {
    await nav(page, name);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
  }
  await nav(page, 'Podwykonawcy');
  await expect(page.getByTestId('sub-pool').locator('[data-testid^="sub-sub:"]')).toHaveCount(5);
  await expect(page.getByTestId('sub-pool')).toContainText('robocizna');
  await nav(page, 'Pojazdy');
  await page.getByTestId('buy-veh-kombi').click();
  await expect(page.getByTestId('notice')).toContainText('Za mało środków'); // kapitał firmy 1 000 zł
  await nav(page, 'Rentowność');
  await expect(page.getByTestId('profit-burn')).toBeVisible();
  await expect(page.getByTestId('liquidity')).toBeVisible();
  await nav(page, 'Pulpit zleceń');
  await expect(page.getByTestId('company-panel')).toContainText('Pracownicy');
  await expect(page.getByTestId('company-panel')).toContainText('Prognoza płynności');
});

test('mobilne menu zawiera nowe ekrany (Pracownicy, Ekipy, Rentowność)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill('e2e-v06-m');
  await page.getByTestId('start-game').click();
  await registerOnMobile(page);
  for (const [name, heading] of [['Pracownicy', 'Pracownicy'], ['Ekipy', 'Ekipy'], ['Rentowność', 'Rentowność']] as const) {
    await page.getByRole('button', { name: 'Więcej' }).click();
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
  }
});
