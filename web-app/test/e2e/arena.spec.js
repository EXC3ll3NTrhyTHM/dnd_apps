const { test, expect } = require('@playwright/test');
const { loginAndNavigate } = require('../helpers/auth');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Arena Combat', () => {
  let bug;

  test.beforeEach(async ({ page }, testInfo) => {
    bug = new BugReporter(page, testInfo);
    bug.startTracking();
  });

  test('monster grid loads with monster cards', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'the_arena');
      const grid = page.locator('[data-testid="arena-monster-grid"]');
      await expect(grid).toBeVisible({ timeout: 15000 });

      // Should have at least one monster card
      const cards = page.locator('[data-testid="arena-monster-card"]');
      await expect(cards.first()).toBeVisible({ timeout: 10000 });
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);
    } catch (e) {
      await bug.report({
        title: 'Arena monster grid fails to load',
        steps: 'Navigate to the_arena location',
        expected: 'Monster grid loads with at least one monster card',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('selecting a monster highlights the card', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'the_arena');
      const cards = page.locator('[data-testid="arena-monster-card"]');
      await expect(cards.first()).toBeVisible({ timeout: 15000 });

      // Click the first monster card
      await cards.first().click();

      // Card should get the selected class
      await expect(cards.first()).toHaveClass(/arena-monster-card-selected/, { timeout: 3000 });
    } catch (e) {
      await bug.report({
        title: 'Arena monster card selection does not highlight',
        steps: 'Navigate to arena, click a monster card',
        expected: 'Card gets arena-monster-card-selected class',
        actual: e.message,
      });
      throw e;
    }
  });

  test('join overlay appears after selecting a monster', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'the_arena');
      const cards = page.locator('[data-testid="arena-monster-card"]');
      await expect(cards.first()).toBeVisible({ timeout: 15000 });

      // Select a monster via JS click to avoid event propagation issues
      await page.evaluate(() => {
        const card = document.querySelector('[data-testid="arena-monster-card"]');
        if (card) card.click();
      });

      // The join overlay should appear (contains the join button)
      const joinOverlay = page.locator('.arena-join-overlay');
      await expect(joinOverlay).toBeVisible({ timeout: 5000 });

      // Join button should be visible within the overlay
      const joinBtn = page.locator('[data-testid="arena-join-btn"]');
      await expect(joinBtn).toBeVisible({ timeout: 5000 });
    } catch (e) {
      await bug.report({
        title: 'Arena join overlay not visible after monster selection',
        steps: 'Navigate to arena, select a monster card',
        expected: 'Join/Summon overlay with button becomes visible',
        actual: e.message,
      });
      throw e;
    }
  });

  test('clicking join starts an encounter', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'the_arena');
      const cards = page.locator('[data-testid="arena-monster-card"]');
      await expect(cards.first()).toBeVisible({ timeout: 15000 });

      // Select a monster
      await page.evaluate(() => {
        const card = document.querySelector('[data-testid="arena-monster-card"]');
        if (card) card.click();
      });

      // Click join button
      const joinBtn = page.locator('[data-testid="arena-join-btn"]');
      await expect(joinBtn).toBeVisible({ timeout: 5000 });
      await joinBtn.click();

      // Should transition to combat — look for initiative button or combat UI
      const combatIndicator = page.locator(
        '[data-testid="arena-initiative-btn"], [data-testid="arena-attack-btn"], .arena-combat-header'
      );
      await expect(combatIndicator.first()).toBeVisible({ timeout: 15000 });
    } catch (e) {
      await bug.report({
        title: 'Arena encounter fails to start after clicking join',
        steps: 'Navigate to arena, select monster, click join/summon',
        expected: 'Combat UI appears with initiative or attack buttons',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });
});
