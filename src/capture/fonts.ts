import type { Page } from 'playwright';
import type { SceneNode, SceneIssue, FontUsage } from '../core/scene.js';

/** Chromium reports fonts actually used for the element, including fallback.
 * This evidence is per element, not a recovered glyph-to-font mapping. */
export async function inspectFonts(
  page: Page,
  sources: { nodeId: string; selector: string }[],
  nodes: Map<string, SceneNode>,
  issues: SceneIssue[],
) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const selectors = [...new Set(sources.map((s) => s.selector))].slice(0, 256);
    const evidence = new Map<string, FontUsage[]>();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, selectors.length) }, async () => {
        while (next < selectors.length) {
          const selector = selectors[next++]!;
          const { nodeId } = await session.send('DOM.querySelector', {
            nodeId: root.nodeId,
            selector,
          });
          if (!nodeId) continue;
          const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
          evidence.set(
            selector,
            fonts
              .filter((f) => f.glyphCount > 0)
              .slice(0, 32)
              .map((f) => ({
                family: f.familyName,
                postScriptName: f.postScriptName,
                glyphCount: f.glyphCount,
                isCustomFont: f.isCustomFont,
              })),
          );
        }
      }),
    );
    for (const source of sources) {
      const text = nodes.get(source.nodeId)?.text,
        usage = evidence.get(source.selector);
      if (!text || !usage?.length) continue;
      text.fontUsage = usage;
      const families = new Set(usage.map((f) => f.family));
      if (families.size === 1) text.resolvedFontFamily = usage[0]!.family;
      else
        issues.push({
          code: 'mixed-font-fallback',
          severity: 'warning',
          nodeId: source.nodeId,
          message:
            'Multiple rendered fonts detected. Per-glyph fallback placement requires review in Figma.',
        });
    }
    if (selectors.length < new Set(sources.map((s) => s.selector)).size)
      issues.push({
        code: 'font-evidence-limit',
        severity: 'warning',
        message: 'Font inspection limited to 256 elements in this viewport.',
      });
  } catch {
    issues.push({
      code: 'font-evidence-unavailable',
      severity: 'warning',
      message: 'Browser font evidence unavailable; CSS font stacks require review.',
    });
  } finally {
    await session.detach().catch(() => {});
  }
}
