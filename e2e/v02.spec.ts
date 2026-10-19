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

test.beforeEach(({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('praca: aplikacja pojawia się na liście i dostaje decyzję pracodawcy', async ({ page }) => {
  await startGame(page, 'e2e-v02');
  await nav(page, 'Oferty pracy');
  await expect(page.getByTestId('current-job')).toContainText('Pracownik biurowy');
  await expect(page.getByTestId('current-job')).toContainText('kalkulator'); // netto z kalkulatora płac (v0.4)
  await expect(page.getByTestId('current-job')).toContainText('4 947,01');
  // brak kompetencji = brak szans, przycisk dalej działa (decyzja będzie odmowna)
  await page.getByTestId('apply-job:handlowiec').click();
  await expect(page.getByTestId('applications')).toContainText('w rozpatrywaniu');
  await expect(page.getByTestId('apply-job:handlowiec')).toBeDisabled();
  for (let i = 0; i < 13; i++) await page.getByTestId('advance-day').click();
  await expect(page.getByTestId('applications')).toContainText('odmowa');
});

test('mieszkanie: kaucja nie zmienia majątku netto, a podpisana umowa jest widoczna', async ({ page }) => {
  await startGame(page, 'e2e-v02');
  const nwBefore = await page.getByTestId('hud-networth').innerText();
  await nav(page, 'Mieszkanie');
  await expect(page.getByTestId('current-lease')).toContainText('Czynsz');
  await page.getByTestId('pick-flat:pokoj-zatorze').click();
  await expect(page.getByTestId('lease-preview')).toContainText('Kaucja płatna dziś');
  await page.getByTestId('sign-lease').click();
  await expect(page.getByTestId('notice')).toContainText('Umowa podpisana');
  await expect(page.getByText(/Podpisana umowa od/)).toBeVisible();
  expect(await page.getByTestId('hud-networth').innerText()).toBe(nwBefore); // kaucja to aktywo, nie koszt
  await expect(page.getByTestId('hud-cash')).toContainText(/4\s?100,00/); // 5 000 − 900 kaucji
});

test('styl życia i budżet czasu: walidacja 24 godzin i zapis planu', async ({ page }) => {
  await startGame(page, 'e2e-v02');
  await nav(page, 'Styl życia');
  await expect(page.getByTestId('qol-score')).toBeVisible();
  const before = Number(await page.getByTestId('qol-score').innerText());
  await page.getByTestId('set-lifestyle-oszczedny').click();
  await expect(page.getByTestId('notice')).toContainText('Styl życia: Oszczędny');
  expect(Number(await page.getByTestId('qol-score').innerText())).toBeLessThan(before);

  await nav(page, 'Budżet czasu');
  await page.locator('#sleep').fill('10');
  await page.locator('#business').fill('6');
  await expect(page.getByTestId('plan-error')).toContainText('24 godzinach');
  await expect(page.getByTestId('save-plan')).toBeDisabled();
  await page.locator('#sleep').fill('7');
  await page.locator('#business').fill('1');
  await expect(page.getByTestId('plan-error')).toHaveCount(0);
  await page.getByTestId('save-plan').click();
  await expect(page.getByTestId('notice')).toContainText('Plan dnia zapisany');
  await expect(page.getByTestId('day-work')).toContainText('Czas wolny');
});

test('oszczędności: przelew nie zmienia majątku netto i zostawia ślad w historii', async ({ page }) => {
  await startGame(page, 'e2e-v02');
  const nwBefore = await page.getByTestId('hud-networth').innerText();
  await nav(page, 'Oszczędności');
  await page.getByLabel('Kwota (zł)').fill('1000');
  await page.getByTestId('transfer-submit').click();
  await expect(page.getByTestId('notice')).toContainText('Przelano');
  await expect(page.getByTestId('hud-savings')).toContainText(/1\s?000,00/);
  expect(await page.getByTestId('hud-networth').innerText()).toBe(nwBefore);
  await expect(page.getByTestId('savings-ledger')).toContainText('Przelew własny');
  // błędna kwota i za duża kwota
  await page.getByLabel('Kwota (zł)').fill('abc');
  await page.getByTestId('transfer-submit').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Podaj kwotę' })).toBeVisible();
  await page.getByLabel('Kwota (zł)').fill('99999');
  await page.getByTestId('transfer-submit').click();
  await expect(page.getByTestId('notice')).toContainText('Brak środków');
});

test('decyzje: wydarzenie życiowe wymaga wyboru, a wybór zostawia ślad w historii', async ({ page }) => {
  await startGame(page, 'v2-0'); // seed z awarią sprzętu 9 lipca 2026
  for (let i = 0; i < 6; i++) await page.getByTestId('advance-month').click();
  for (let i = 0; i < 9; i++) await page.getByTestId('advance-day').click();
  await expect(page.getByTestId('game-date')).toHaveText('10 lipca 2026');
  await expect(page.getByTestId('attention-badge')).toBeVisible();
  await expect(page.getByTestId('decisions-alert')).toBeVisible();
  await nav(page, 'Decyzje i wydarzenia');
  await expect(page.getByTestId('pending-decisions')).toContainText('Awaria sprzętu');
  await page.getByTestId('choose-appliance-repair').click();
  await expect(page.getByTestId('notice')).toContainText('Naprawa kosztowała');
  await expect(page.getByTestId('pending-decisions')).not.toContainText('Awaria sprzętu');
  await expect(page.getByTestId('life-history')).toContainText('Awaria sprzętu');
  await expect(page.getByTestId('attention-badge')).toHaveCount(0);
});

test('zapis i wczytanie zachowuje stan v0.2 (oszczędności, plan dnia)', async ({ page }) => {
  await startGame(page, 'e2e-v02');
  await nav(page, 'Oszczędności');
  await page.getByLabel('Kwota (zł)').fill('500');
  await page.getByTestId('transfer-submit').click();
  await expect(page.getByTestId('hud-savings')).toContainText('500,00');
  await nav(page, 'Nowa gra / Wczytaj');
  await page.getByTestId('save-slot-2').click();
  await expect(page.getByTestId('slot-slot-2')).toContainText('Jan Kowalski');
  await page.reload();
  await page.getByTestId('load-slot-2').click();
  await expect(page.getByTestId('hud-savings')).toContainText('500,00');
});
