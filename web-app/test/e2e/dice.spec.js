const { test, expect } = require('@playwright/test');
const { loginAndNavigate } = require('../helpers/auth');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Dice System', () => {
  let bug;

  test.beforeEach(async ({ page }, testInfo) => {
    bug = new BugReporter(page, testInfo);
    bug.startTracking();
  });

  /** Helper to open the dice panel from keyboard extras */
  async function openDicePanel(page) {
    // The plus button uses onPointerDown — dispatch the event directly via JS
    // to avoid any Playwright click interception issues with pointer events
    const plusBtn = page.locator('.chat-plus-btn');
    await expect(plusBtn).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.querySelector('.chat-plus-btn');
      if (btn) btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    // Wait for extras panel to appear
    const diceBtn = page.locator('[data-action="open-dice"]');
    await expect(diceBtn).toBeVisible({ timeout: 5000 });
    // Dice button also uses onPointerDown in the keyboard
    await page.evaluate(() => {
      const btn = document.querySelector('[data-action="open-dice"]');
      if (btn) btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    // Verify dice panel is open
    const dicePanel = page.locator('[data-testid="dice-panel"]');
    await expect(dicePanel).toBeVisible({ timeout: 5000 });
    return dicePanel;
  }

  test('dice panel renders from keyboard extras', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'dragons_hollow');
      await openDicePanel(page);
    } catch (e) {
      await bug.report({
        title: 'Dice panel fails to render from keyboard',
        steps: 'Open keyboard, navigate to extras, tap dice button',
        expected: 'Dice panel renders with roll options',
        actual: e.message,
      });
      throw e;
    }
  });

  test('triggering a dice roll shows result banner', async ({ page }) => {
    test.setTimeout(60000); // Dice rolls can be slow with WebGL

    try {
      await loginAndNavigate(page, 'dragons_hollow');
      await openDicePanel(page);

      // Click a die button (e.g., d20) to add it to the notation
      const dieBtn = page.locator('.dice-btn').first();
      await expect(dieBtn).toBeVisible({ timeout: 5000 });
      await dieBtn.click();

      // Click the Roll button to execute the roll
      const rollBtn = page.locator('.dice-panel-roll-btn');
      await expect(rollBtn).toBeVisible({ timeout: 3000 });
      await rollBtn.click();

      // Wait for the dice result banner to appear (WebGL can be slow in headless)
      const resultBanner = page.locator('[data-testid="dice-result-banner"]');
      await expect(resultBanner).toBeVisible({ timeout: 30000 });

      // Verify result total is a number
      const resultTotal = page.locator('[data-testid="dice-result-total"]');
      await expect(resultTotal.first()).toBeVisible({ timeout: 5000 });
      const totalText = await resultTotal.first().textContent();
      expect(Number(totalText)).toBeGreaterThan(0);
    } catch (e) {
      await bug.report({
        title: 'Dice roll does not show result banner',
        steps: 'Open dice panel, trigger a roll',
        expected: 'Result banner appears with numeric total',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });

  test('multiple dice rolls do not leak DOM nodes', async ({ page }) => {
    test.setTimeout(60000); // Multiple rolls take time

    try {
      await loginAndNavigate(page, 'dragons_hollow');
      await openDicePanel(page);

      // Get baseline DOM node count
      const baselineNodes = await page.evaluate(() => document.querySelectorAll('*').length);

      // Perform 5 rolls
      for (let i = 0; i < 5; i++) {
        // Add a die and roll
        const dieBtn = page.locator('.dice-btn').first();
        if (await dieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await dieBtn.click();
          const rollBtn = page.locator('.dice-panel-roll-btn');
          await rollBtn.click();
          // Wait for result or timeout
          try {
            await page.locator('[data-testid="dice-result-banner"]').waitFor({ timeout: 20000 });
          } catch {
            // DiceBox may not render in headless — that's ok for memory test
          }
          // Wait for the overlay to auto-dismiss (1.2s timer) or dismiss via JS
          await page.waitForTimeout(2000);
          await page.evaluate(() => {
            const overlay = document.querySelector('[data-testid="dice-overlay"]');
            if (overlay) overlay.click();
          });
          await page.waitForTimeout(500);
        }
      }

      // Check DOM node count hasn't grown excessively (allow 50% growth)
      const finalNodes = await page.evaluate(() => document.querySelectorAll('*').length);
      const growth = finalNodes - baselineNodes;
      const maxGrowth = baselineNodes * 0.5;
      expect(growth).toBeLessThan(maxGrowth);
    } catch (e) {
      await bug.report({
        title: 'Dice rolls leak DOM nodes (memory)',
        steps: 'Perform 5 dice rolls in sequence',
        expected: 'DOM node count stays within 50% of baseline',
        actual: e.message,
        priority: 'high',
      });
      throw e;
    }
  });
});
