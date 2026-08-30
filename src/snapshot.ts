import { Page } from 'playwright';
import { PageSnapshot, SnapshotElement } from './types';

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox',
  'checkbox', 'radio', 'menuitem', 'option', 'tab', 'switch', 'slider',
  'spinbutton', 'menuitemcheckbox', 'menuitemradio', 'treeitem',
]);

export async function takeSnapshot(page: Page): Promise<PageSnapshot> {
  const [url, title] = await Promise.all([
    page.url(),
    page.title(),
  ]);

  let axSnapshot: any = null;

  // Try standard page.accessibility.snapshot if available
  try {
    if (typeof (page as any).accessibility?.snapshot === 'function') {
      axSnapshot = await (page as any).accessibility.snapshot({ interestingOnly: false });
    }
  } catch {
    /* fallback to CDP */
  }

  // If page.accessibility is not available (Playwright 1.50+), extract via CDP
  if (!axSnapshot) {
    try {
      const client = await page.context().newCDPSession(page);
      const { nodes } = await client.send('Accessibility.getFullAXTree');
      await client.detach().catch(() => {});

      if (Array.isArray(nodes)) {
        const rootNodes = nodes.filter((n: any) => !n.parentId);
        const nodeMap = new Map<string, any>();
        nodes.forEach((n: any) => {
          nodeMap.set(n.nodeId, {
            role: n.role?.value,
            name: n.name?.value,
            value: n.value?.value,
            disabled: n.disabled?.value === true,
            focused: n.focused?.value === true,
            children: [],
          });
        });

        nodes.forEach((n: any) => {
          if (n.childIds && Array.isArray(n.childIds)) {
            const parent = nodeMap.get(n.nodeId);
            if (parent) {
              parent.children = n.childIds
                .map((cid: string) => nodeMap.get(cid))
                .filter(Boolean);
            }
          }
        });

        axSnapshot = {
          role: 'RootWebArea',
          children: rootNodes.map((rn: any) => nodeMap.get(rn.nodeId)).filter(Boolean),
        };
      }
    } catch {
      /* ignore */
    }
  }

  const elements: SnapshotElement[] = [];
  let refCounter = 1;
  const refMap = new Map<number, { role: string; name: string }>();

  function traverse(node: any, depth: number) {
    if (!node || !node.role || node.role === 'none' || node.role === 'generic') {
      (node?.children ?? []).forEach((c: any) => traverse(c, depth + 1));
      return;
    }

    const isInteractive = INTERACTIVE_ROLES.has(node.role);
    const hasName = typeof node.name === 'string' && node.name.trim().length > 0;

    if (isInteractive || (hasName && depth < 5)) {
      const ref = refCounter++;
      const trimmedName = node.name?.trim() ?? '';
      elements.push({
        ref,
        role: node.role,
        name: trimmedName,
        value: typeof node.value === 'string' ? node.value : undefined,
        checked: node.checked,
        disabled: node.disabled === true,
        focused: node.focused === true,
      });
      refMap.set(ref, { role: node.role, name: trimmedName });
    }

    (node.children ?? []).forEach((c: any) => traverse(c, depth + 1));
  }

  if (axSnapshot) traverse(axSnapshot, 0);

  // Cap at 40, prioritising: focused > interactive > named
  let sorted = elements
    .sort((a, b) => {
      const score = (el: SnapshotElement) =>
        (el.focused ? 100 : 0) +
        (INTERACTIVE_ROLES.has(el.role) ? 10 : 0) +
        (el.name.length > 0 ? 1 : 0);
      return score(b) - score(a);
    })
    .slice(0, 40);

  // Fallback: If accessibility tree found 0 elements (e.g. React SPA or custom div buttons),
  // extract live interactive DOM elements directly via page.$$eval
  if (sorted.length === 0) {
    try {
      const domElements = await page.$$eval(
        'button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex="0"]',
        (nodes) => {
          return nodes.map((node, index) => {
            const rect = node.getBoundingClientRect();
            const text = (node.textContent || (node as any).value || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '').trim();
            const tag = node.tagName.toLowerCase();
            const role = node.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'input' ? 'textbox' : 'button');
            return {
              ref: index + 1,
              role,
              tag,
              name: text.slice(0, 80),
              value: (node as any).value || undefined,
              bbox: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            };
          }).filter((el) => el.name.length > 0 || el.tag === 'input' || el.tag === 'textarea');
        }
      );
      if (domElements.length > 0) {
        sorted = domElements.slice(0, 40);
      }
    } catch {}
  }

  // Attach bounding boxes for cursor animation
  for (const el of sorted) {
    if (el.bbox) continue;
    try {
      const locInfo = refMap.get(el.ref);
      if (!locInfo) continue;
      const loc = locInfo.name
        ? page.getByRole(locInfo.role as any, { name: locInfo.name, exact: false }).first()
        : page.locator(`role=${locInfo.role}`).first();
      const box = await loc.boundingBox({ timeout: 300 }).catch(() => null);
      if (box) {
        el.bbox = {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      }
    } catch {}
  }

  // Re-number sequentially
  sorted.forEach((el, i) => {
    el.ref = i + 1;
  });

  return { url, title, elements: sorted, timestamp: Date.now() };
}

export async function resolveRef(
  page: Page,
  snapshot: PageSnapshot,
  ref: number
) {
  const el = snapshot.elements.find((e) => e.ref === ref);
  if (!el) throw new Error(`No element with ref=${ref} in current snapshot`);
  
  let loc = el.name
    ? page.getByRole(el.role as any, { name: el.name, exact: false }).first()
    : page.locator(`role=${el.role}`).first();

  const count = await loc.count().catch(() => 0);
  if (count === 0 && el.name) {
    loc = page.getByText(el.name, { exact: false }).first();
  }

  return { locator: loc, element: el };
}
