const { test, expect } = require('@playwright/test');
const { loginAndNavigate } = require('../helpers/auth');
const { BugReporter } = require('../helpers/bug-reporter');

test.describe('Custom Keyboard', () => {
  let bug;

  test.beforeEach(async ({ page }, testInfo) => {
    bug = new BugReporter(page, testInfo);
    bug.startTracking();
  });

  test('keyboard opens when tapping input area', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'dragons_hollow');
      const chatInput = page.locator('[data-testid="chat-input"]');
      await expect(chatInput).toBeVisible({ timeout: 10000 });

      // Tap the input to open the keyboard
      await chatInput.click();

      // Keyboard panel should be visible
      const keyboard = page.locator('[data-testid="keyboard-panel"]');
      await expect(keyboard).toBeVisible({ timeout: 5000 });
    } catch (e) {
      await bug.report({
        title: 'Custom keyboard does not open on input tap',
        steps: 'Navigate to location, tap the chat input area',
        expected: 'Custom keyboard panel becomes visible',
        actual: e.message,
      });
      throw e;
    }
  });

  test('extras drawer shows action buttons', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'dragons_hollow');
      const chatInput = page.locator('[data-testid="chat-input"]');
      await expect(chatInput).toBeVisible({ timeout: 10000 });
      await chatInput.click();

      // The plus button opens the extras drawer — it uses onPointerDown
      const plusBtn = page.locator('.chat-plus-btn');
      await expect(plusBtn).toBeVisible({ timeout: 5000 });
      await plusBtn.click();

      // Extras panel should have action buttons (dice, items, gifs, etc.)
      const extrasPanel = page.locator('.ck-extras-panel');
      await expect(extrasPanel).toBeVisible({ timeout: 5000 });
    } catch (e) {
      await bug.report({
        title: 'Keyboard extras drawer does not open',
        steps: 'Open keyboard, tap plus button',
        expected: 'Extras panel appears with action buttons',
        actual: e.message,
      });
      throw e;
    }
  });

  test('dice panel opens from extras drawer', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'dragons_hollow');
      const chatInput = page.locator('[data-testid="chat-input"]');
      await expect(chatInput).toBeVisible({ timeout: 10000 });
      await chatInput.click();

      // Open extras drawer via plus button
      const plusBtn = page.locator('.chat-plus-btn');
      await expect(plusBtn).toBeVisible({ timeout: 5000 });
      await plusBtn.click();

      // Click the dice button in the extras panel
      const diceBtn = page.locator('[data-action="open-dice"]');
      await expect(diceBtn).toBeVisible({ timeout: 5000 });
      await diceBtn.click();

      // Dice panel should be visible
      const dicePanel = page.locator('[data-testid="dice-panel"]');
      await expect(dicePanel).toBeVisible({ timeout: 5000 });
    } catch (e) {
      await bug.report({
        title: 'Dice panel does not open from extras drawer',
        steps: 'Open keyboard, tap plus for extras, tap dice button',
        expected: 'Dice panel renders with dice buttons',
        actual: e.message,
      });
      throw e;
    }
  });

  test('chat input accepts text via keyboard events', async ({ page }) => {
    try {
      await loginAndNavigate(page, 'dragons_hollow');
      const chatInput = page.locator('[data-testid="chat-input"]');
      await expect(chatInput).toBeVisible({ timeout: 10000 });
      await chatInput.click();

      // The custom keyboard intercepts focus, so we dispatch key events
      // The keyboard sends events to the focused input area
      await page.keyboard.press('h');
      await page.keyboard.press('i');
      await page.waitForTimeout(500);

      // Verify the input area has text content (may be in child elements)
      const inputText = await chatInput.textContent();
      expect(inputText.length).toBeGreaterThan(0);
    } catch (e) {
      await bug.report({
        title: 'Chat input does not accept keyboard events',
        steps: 'Open keyboard, press keys',
        expected: 'Input area shows typed characters',
        actual: e.message,
      });
      throw e;
    }
  });
});
