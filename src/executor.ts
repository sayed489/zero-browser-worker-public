import { Page } from 'playwright';
import { Action, ActionResult, PageSnapshot } from './types';
import { takeSnapshot, resolveRef } from './snapshot';

export async function executeAction(
  page: Page,
  action: Action,
  lastSnapshot: PageSnapshot | null
): Promise<ActionResult> {
  try {
    const act: any = action;
    const actionType: string = act.type || act.action;

    // Auto-take snapshot if not provided so actions never fail on missing snapshot
    if (!lastSnapshot && ['click', 'type', 'clear', 'extract', 'hover', 'select'].includes(actionType)) {
      try {
        lastSnapshot = await takeSnapshot(page);
      } catch {
        /* proceed */
      }
    }

    switch (actionType) {
      case 'navigate': {
        const targetUrl = act.url;
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'click': {
        if (!lastSnapshot) {
          lastSnapshot = await takeSnapshot(page);
        }
        let clickedBbox = undefined;
        try {
          const { locator, element } = await resolveRef(page, lastSnapshot, act.ref);
          clickedBbox = element.bbox;
          await locator.click({ timeout: 4000 });
        } catch (locErr) {
          // Fallback: click directly at coordinates if locator failed
          const el = lastSnapshot.elements.find((e) => e.ref === act.ref);
          if (el && el.bbox && el.bbox.width > 0) {
            const clickX = el.bbox.x + Math.round(el.bbox.width / 2);
            const clickY = el.bbox.y + Math.round(el.bbox.height / 2);
            await page.mouse.click(clickX, clickY);
            clickedBbox = el.bbox;
          } else {
            throw locErr;
          }
        }
        await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot, clickedBbox };
      }

      case 'type': {
        if (!lastSnapshot) {
          lastSnapshot = await takeSnapshot(page);
        }
        try {
          const { locator } = await resolveRef(page, lastSnapshot, act.ref);
          await locator.fill(act.text, { timeout: 4000 });
        } catch (locErr) {
          const el = lastSnapshot.elements.find((e) => e.ref === act.ref);
          if (el && el.bbox && el.bbox.width > 0) {
            await page.mouse.click(el.bbox.x + 5, el.bbox.y + 5);
            await page.keyboard.type(act.text);
          } else {
            throw locErr;
          }
        }
        if (act.press_enter || act.pressEnter) {
          await page.keyboard.press('Enter');
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        }
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'clear': {
        if (!lastSnapshot) {
          lastSnapshot = await takeSnapshot(page);
        }
        const { locator } = await resolveRef(page, lastSnapshot, act.ref);
        await locator.fill('', { timeout: 4000 });
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'scroll': {
        const amounts: Record<string, number> = { up: -1, down: 1, left: -1, right: 1 };
        const dir = act.direction || 'down';
        const axis = dir === 'up' || dir === 'down' ? 'y' : 'x';
        const mult = amounts[dir] ?? 1;
        const amt = act.amount || 500;
        await page.mouse.wheel(
          axis === 'x' ? amt * mult : 0,
          axis === 'y' ? amt * mult : 0
        );
        await page.waitForTimeout(300);
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'wait': {
        await page.waitForTimeout(act.ms || 1000);
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'snapshot': {
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'extract': {
        if (!lastSnapshot) {
          lastSnapshot = await takeSnapshot(page);
        }
        const { locator } = await resolveRef(page, lastSnapshot, act.ref);
        const text = await locator.innerText({ timeout: 4000 });
        return { ok: true, extracted: text };
      }

      case 'hover': {
        if (!lastSnapshot) {
          lastSnapshot = await takeSnapshot(page);
        }
        const { locator, element } = await resolveRef(page, lastSnapshot, act.ref);
        await locator.hover({ timeout: 4000 });
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot, clickedBbox: element.bbox };
      }

      case 'press': {
        await page.keyboard.press(act.key);
        await page.waitForTimeout(300);
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'select': {
        if (!lastSnapshot) {
          lastSnapshot = await takeSnapshot(page);
        }
        const { locator } = await resolveRef(page, lastSnapshot, act.ref);
        await locator.selectOption(act.value, { timeout: 4000 });
        const snapshot = await takeSnapshot(page);
        return { ok: true, snapshot };
      }

      case 'web_search': {
        const q = encodeURIComponent(act.query);
        await page.goto(`https://html.duckduckgo.com/html/?q=${q}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        const snapshot = await takeSnapshot(page);
        const results = snapshot.elements
          .filter((e) => e.role === 'link' && e.name && !e.name.match(/^(next|prev|more|duckduck)/i))
          .slice(0, 10)
          .map((e) => ({ title: e.name, ref: e.ref }));
        return { ok: true, snapshot, extracted: JSON.stringify(results) };
      }

      default:
        return { ok: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}
