import { expect, test, type Page } from '@playwright/test';

/**
 * The stealth HUD on its own page (`?scene=hud`, M1-15): every sample state laid out at the reference phone (844x390,
 * touch) and at desktop size (1280x720, mouse), with nothing overlapping, every tap target at least 44px (UI.md
 * "Screen layout"), and the hotkeys of §20.7.
 */

interface Box { name: string; x: number; y: number; w: number; h: number }

async function open(page: Page, state: string, extra = ''): Promise<string[]> {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/?scene=hud&bare&state=${state}${extra}`);
    await page.waitForSelector('.sh [data-region="confirm"]');
    await page.evaluate(() => document.fonts.ready);
    return errors;
}

/** The visible HUD regions and buttons, as boxes. */
async function layout(page: Page): Promise<{ regions: Box[]; buttons: Box[]; recap: boolean }> {
    return page.evaluate(() => {
        const box = (e: Element, name: string) => { const r = e.getBoundingClientRect(); return { name, x: r.x, y: r.y, w: r.width, h: r.height }; };
        const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        const regions = [...document.querySelectorAll('.sh [data-region]')].filter(visible).map(e => box(e, (e as HTMLElement).dataset.region!));
        const buttons = [...document.querySelectorAll('.sh button')].filter(visible).map(e => box(e, e.getAttribute('aria-label') ?? e.className));
        const recap = !!document.querySelector('.sh-recap-back:not([hidden])');
        return { regions, buttons, recap };
    });
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function checkLayout(page: Page, state: string, size: { width: number; height: number }): Promise<void> {
    const { regions, buttons, recap } = await layout(page);
    for (const r of regions) {
        expect(r.x, `${state}: ${r.name} inside the screen`).toBeGreaterThanOrEqual(0);
        expect(r.y, `${state}: ${r.name} inside the screen`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `${state}: ${r.name} inside the screen`).toBeLessThanOrEqual(size.width);
        expect(r.y + r.h, `${state}: ${r.name} inside the screen`).toBeLessThanOrEqual(size.height);
    }
    // The recap card sits over everything until the player resumes; otherwise no two regions may touch.
    if (!recap) {
        for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
            expect(overlaps(regions[i]!, regions[j]!), `${state}: ${regions[i]!.name} overlaps ${regions[j]!.name}`).toBe(false);
        }
    }
    for (const b of buttons) {
        expect(b.w, `${state}: ${b.name} is ${b.w}px wide`).toBeGreaterThanOrEqual(44);
        expect(b.h, `${state}: ${b.name} is ${b.h}px high`).toBeGreaterThanOrEqual(44);
    }
}

async function states(page: Page): Promise<string[]> {
    await open(page, 'select');
    return page.evaluate(() => (window as any).hudSamples as string[]);
}

test.describe('the stealth HUD on a phone', () => {
    const size = { width: 844, height: 390 };
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test('lays out every state at 844x390 without overlaps, with 44px targets', { tag: '@smoke' }, async ({ page }) => {
        for (const state of await states(page)) {
            const errors = await open(page, state);
            await checkLayout(page, state, size);
            expect(errors).toEqual([]);
            await page.screenshot({ path: `screenshots/hud/844-${state}.png` });
        }
        await open(page, 'preview');
        await page.screenshot({ path: 'screenshots/hud-844.png' });
    });

    test('keeps its layout with the text scaled up (§20.8)', async ({ page }) => {
        for (const state of ['select', 'carriers', 'alarm']) {
            await open(page, state, '&text=1.3');
            await checkLayout(page, `${state} ×1.3`, size);
        }
    });

    test('names an action on long-press instead of pressing it', async ({ page }) => {
        await open(page, 'select');
        const knockout = page.locator('[data-action="interact"]');
        const b = (await knockout.boundingBox())!;
        await page.touchscreen.tap(b.x + 26, b.y + 26);
        expect(await page.evaluate(() => (window as any).hudLog)).toEqual(['action:interact']);
        // A long press: pointer down, wait, up.
        await knockout.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, bubbles: true });
        await page.waitForTimeout(600);
        await expect(page.locator('.sh-tag')).toBeVisible();
        await expect(page.locator('.sh-tag')).toHaveText('Interact');
    });

    test('ends the turn on a hold, asking first when crew still have actions', async ({ page }) => {
        await open(page, 'select');
        const end = page.locator('[data-region="end-turn"]');
        const b = (await end.boundingBox())!;
        // A tap is not enough.
        await page.touchscreen.tap(b.x + 20, b.y + 20);
        await expect(page.locator('[data-region="prompt"]')).toBeHidden();
        await end.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, pointerId: 1, bubbles: true });
        await expect(page.locator('[data-region="prompt"]')).toBeVisible();
        await end.dispatchEvent('pointerup', { pointerType: 'touch', button: 0, pointerId: 1, bubbles: true });
        expect(await page.evaluate(() => (window as any).hudLog)).toEqual([]);
        await page.locator('[aria-label="End turn anyway"]').click();
        expect(await page.evaluate(() => (window as any).hudLog)).toEqual(['endTurn']);
    });
});

test.describe('the stealth HUD on a desktop', () => {
    const size = { width: 1280, height: 720 };
    test.use({ viewport: size });

    test('lays out every state at 1280x720 without overlaps, with 44px targets and key caps', async ({ page }) => {
        for (const state of await states(page)) {
            const errors = await open(page, state);
            await checkLayout(page, state, size);
            expect(errors).toEqual([]);
            await page.screenshot({ path: `screenshots/hud/1280-${state}.png` });
        }
        await open(page, 'preview');
        await expect(page.locator('.sh-kc').first()).toBeVisible();
        await page.screenshot({ path: 'screenshots/hud-1280.png' });
    });

    test('answers the hotkeys of §20.7', async ({ page }) => {
        await open(page, 'preview');
        const log = () => page.evaluate(() => (window as any).hudLog as string[]);
        await page.keyboard.press('1');
        await page.keyboard.press('4');
        await page.keyboard.press('z');
        await page.keyboard.press('Enter');
        expect(await log()).toEqual(['selectCrew:mara', 'selectCrew:sol', 'undo', 'confirm']);
        await expect(page.locator('[data-region="crew-sol"]')).toHaveAttribute('aria-pressed', 'true');

        await page.keyboard.press('Tab');
        await expect(page.locator('[data-region="ledger"]')).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(page.locator('[data-region="ledger"]')).toBeHidden();
        await page.keyboard.press('o');
        await expect(page.locator('[data-region="drawer"]')).toBeVisible();
        await page.locator('[data-overlay="cones"]').click();
        await expect(page.locator('[data-overlay="cones"]')).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-region="drawer"]')).toBeHidden();

        // Space is held to end the turn; with actions left it asks, and Space again ends it.
        await page.keyboard.down(' ');
        await expect(page.locator('[data-region="prompt"]')).toBeVisible();
        await page.keyboard.up(' ');
        await page.keyboard.press(' ');
        expect((await log()).slice(-2)).toEqual(['toggleOverlay:cones:true', 'endTurn']);
    });

    test('jumps to a ledger row and resumes from the recap card', async ({ page }) => {
        await open(page, 'carriers');
        await page.locator('.sh-row').first().click();
        expect(await page.evaluate(() => (window as any).hudLog)).toEqual(['ledgerJump:teller']);
        await open(page, 'recap');
        await page.locator('[aria-label="Resume"]').click();
        await expect(page.locator('.sh-recap-back')).toBeHidden();
        expect(await page.evaluate(() => (window as any).hudLog)).toEqual(['resume']);
    });
});
