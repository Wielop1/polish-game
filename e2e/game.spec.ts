import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Polski Intl nie grupuje liczb 4-cyfrowych („5000,00 zł”), ale grupuje dłuższe („12 000,00 zł”). */
const money = (s: string) => new RegExp(s.replace(/ /g, '\\s?'));

async function startGame(page: Page) {
  await page.goto('/');
  await page.getByLabel('Imię').fill('Jan');
  await page.getByLabel('Nazwisko').fill('Kowalski');
  await page.getByLabel(/Ziarno losowości/).fill('e2e-seed');
  await page.getByTestId('start-game').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 stycznia 2026');
}

test('walidacja formularza nowej gry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nowa gra / Wczytaj' })).toBeVisible();
  await page.getByTestId('start-game').click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByTestId('game-date')).toHaveCount(0);
  await page.getByLabel('Imię').fill('123');
  await page.getByLabel('Nazwisko').fill('Nowak');
  await page.getByTestId('start-game').click();
  await expect(page.getByText(/Dozwolone są litery/)).toBeVisible();
});

test('nowa gra, upływ czasu i spójność finansów', async ({ page }) => {
  await startGame(page);
  await expect(page.getByTestId('hud-cash')).toContainText(money('5 000,00'));
  // 1 stycznia naliczony czynsz 1 700 zł zmniejsza majątek netto, ale nie gotówkę
  await expect(page.getByTestId('hud-networth')).toContainText(money('3 300,00'));

  await page.getByTestId('advance-day').click();
  await expect(page.getByTestId('game-date')).toHaveText('2 stycznia 2026');

  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 lutego 2026');
  await expect(page.getByTestId('notice')).toHaveCount(0);

  await page.getByRole('button', { name: 'Finanse' }).first().click();
  await expect(page.getByRole('heading', { name: 'Finanse' })).toBeVisible();
  await expect(page.getByTestId('ledger').getByText('Czynsz — Styczeń 2026')).toBeVisible();
  await expect(page.getByTestId('ledger').getByText('Środki na start')).toBeVisible();
  await expect(page.getByTestId('month-summary')).toBeVisible();

  // pensja za styczeń wpłynie dopiero 10 lutego
  await expect(page.getByTestId('ledger').getByText('Wynagrodzenie netto — Styczeń 2026')).toHaveCount(0);
  for (let i = 0; i < 10; i++) await page.getByTestId('advance-day').click();
  await expect(page.getByTestId('game-date')).toHaveText('11 lutego 2026');
  await expect(page.getByTestId('ledger').getByText('Wynagrodzenie netto — Styczeń 2026')).toBeVisible();
});

test('wszystkie ekrany się renderują', async ({ page }) => {
  await startGame(page);
  await page.getByTestId('advance-month').click();
  for (const [nav, heading] of [
    ['Postać', 'Postać'],
    ['Kalendarz', 'Kalendarz'],
    ['Historia zdarzeń', 'Historia zdarzeń'],
    ['Pulpit', 'Pulpit gracza'],
  ] as const) {
    await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: nav, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Postać', exact: true }).click();
  await expect(page.getByTestId('character-name')).toHaveText('Jan Kowalski');
  await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Kalendarz', exact: true }).click();
  await expect(page.getByTestId('calendar-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click(); // kalendarz pokazuje luty
  await page.getByRole('button', { name: /^10 stycznia 2026/ }).click();
  await expect(page.getByTestId('day-details')).toContainText('Zapłacono: Czynsz');
});

test('zapis ręczny i autozapis przeżywają przeładowanie strony', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await startGame(page);
  await page.getByTestId('advance-month').click();
  await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Nowa gra / Wczytaj' }).click();
  await page.getByTestId('save-slot-1').click();
  await expect(page.getByTestId('slot-slot-1')).toContainText('Jan Kowalski');
  await expect(page.getByTestId('slot-slot-1')).toContainText('1 lutego 2026');

  await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Pulpit', exact: true }).click();
  await page.getByTestId('advance-month').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 marca 2026');
  // autozapis jest asynchroniczny — czekamy, aż slot pokaże zatwierdzony zapis, zanim przeładujemy stronę
  await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Nowa gra / Wczytaj' }).click();
  await expect(page.getByTestId('slot-autosave')).toContainText('1 marca 2026');

  await page.reload();
  await expect(page.getByTestId('game-date')).toHaveCount(0); // po przeładowaniu brak aktywnej gry
  await expect(page.getByTestId('slot-autosave')).toContainText('1 marca 2026');
  await expect(page.getByTestId('slot-slot-1')).toContainText('1 lutego 2026');

  await page.getByTestId('load-slot-1').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 lutego 2026');
  await page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('button', { name: 'Nowa gra / Wczytaj' }).click();
  await page.getByTestId('load-autosave').click();
  await expect(page.getByTestId('game-date')).toHaveText('1 marca 2026');
});
