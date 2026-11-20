import { validateScene, type ScenePackage } from '../core/scene.js';
import { flatten } from '../core/analysis.js';
import { renderScene, preflightFonts, type RenderResult } from './renderer.js';
import { validateFontRequests } from './fonts.js';
import { installedPairingKey, installedVerificationUrl } from './connection.js';
import { errorMessage } from './errors.js';
import { verifyNativeResult } from '../../tests/native-validation.js';
declare const __html__: string;
/** Replaced at build time: false for the shipped plugin, true for the diagnostic build. */
declare const __DIAGNOSTICS__: boolean;
figma.showUI(__html__, { width: 400, height: 510, themeColors: true });
let current: ScenePackage | undefined,
  result: RenderResult | undefined,
  busy = false,
  cancelled = false;
const post = (type: string, data: unknown = {}) =>
  figma.ui.postMessage({ type, ...(data as object), __channel: installedPairingKey() });
figma.ui.onmessage = async (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  const data = message as Record<string, unknown>;
  if (data.__channel !== installedPairingKey()) return;
  try {
    if (data.type === 'READY') {
      const preferences = await figma.clientStorage
        .getAsync('website-preferences')
        .catch(() => undefined);
      post('PREFERENCES', { preferences });
      return;
    }
    if (data.type === 'CONNECT') {
      post('PAIR_SERVICE', { pairingKey: installedPairingKey() });
      return;
    }
    if (data.type === 'SAVE_PREFERENCES') {
      const p = data.preferences as Record<string, unknown> | undefined;
      if (
        p &&
        ['1440', '768', '390', 'desktop-mobile', 'all'].includes(String(p.size)) &&
        ['light', 'dark'].includes(String(p.theme)) &&
        ['original', 'ar', 'en'].includes(String(p.language))
      )
        await figma.clientStorage.setAsync('website-preferences', {
          size: p.size,
          theme: p.theme,
          language: p.language,
        });
      return;
    }
    if (data.type === 'CANCEL') {
      cancelled = true;
      return;
    }
    if (data.type === 'PREFLIGHT') {
      const fonts = await preflightFonts(
        figma,
        validateFontRequests(data.fonts),
        typeof data.fallback === 'string' ? data.fallback : undefined,
      );
      post('PREFLIGHT_RESULT', {
        requestId: data.requestId,
        missing: fonts.missing,
        availableFamilies: fonts.availableFamilies,
      });
      return;
    }
    if (data.type === 'IMPORT') {
      if (busy) throw new Error('An import is already running.');
      busy = true;
      cancelled = false;
      try {
        const scene = validateScene(data.scene);
        if (__DIAGNOSTICS__ && installedVerificationUrl()) {
          const pageName = 'Website capture verification';
          const page = figma.root.children.find((p) => p.name === pageName) ?? figma.createPage();
          page.name = pageName;
          await figma.setCurrentPageAsync(page);
        }
        let last = 0;
        const next = await renderScene(figma, scene, {
          fontPolicy: data.allowSubstitution === true ? 'substitute' : 'stop',
          fallbackFamily: typeof data.fallback === 'string' ? data.fallback : undefined,
          foundations: data.foundations !== false,
          validated: true,
          isCancelled: () => cancelled,
          onProgress: (done, total) => {
            if (done - last >= 15 || done === total) {
              post('IMPORT_PROGRESS', { done, total, requestId: data.requestId });
              last = done;
            }
          },
        });
        current = scene;
        result = next;
        if (__DIAGNOSTICS__ && installedVerificationUrl() === 'fixture:features') {
          try {
            const verified = await verifyNativeResult(figma, scene, next);
            post('NATIVE_FUNCTIONAL', {
              report: {
                status: 'passed',
                checks: verified.checks,
                growthDiagnostic: verified.growthDiagnostic,
              },
            });
          } catch (error) {
            post('NATIVE_FUNCTIONAL', {
              report: { status: 'failed', message: errorMessage(error) },
            });
          }
        }
        post('IMPORT_RESULT', { result, requestId: data.requestId });
      } finally {
        busy = false;
      }
      return;
    }
    if (
      data.type === 'SELECT' &&
      typeof data.nodeId === 'string' &&
      result?.createdNodeIds.includes(data.nodeId)
    ) {
      const node = await figma.getNodeByIdAsync(data.nodeId);
      if (node && 'visible' in node) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
      }
      return;
    }
    if (__DIAGNOSTICS__ && data.type === 'VERIFY_PREVIEW') {
      if (busy || !current || !result) throw new Error('Import not available for native preview.');
      // One preview per imported screen, at source scale, for side-by-side comparison.
      for (const [index, screen] of current.screens.entries()) {
        const root = await figma.getNodeByIdAsync(result.screenIds[index]!);
        if (!root || !('exportAsync' in root) || !('absoluteTransform' in root))
          throw new Error('Imported frame not found.');
        const bytes = await root.exportAsync({
          format: 'JPG',
          constraint: { type: 'WIDTH', value: Math.min(1440, Math.round(root.width)) },
        });
        const nodes = [];
        for (const source of flatten(screen.root)) {
          const id = result.mapping[screen.id + ':' + source.id];
          const native = id ? await figma.getNodeByIdAsync(id) : null;
          if (!native || !('absoluteTransform' in native)) continue;
          let intrinsicWidth: number | undefined;
          if (native.type === 'TEXT' && source.text && !source.text.characters.includes('\n')) {
            const probe = native.clone();
            try {
              if (
                probe.parent &&
                'layoutMode' in probe.parent &&
                probe.parent.layoutMode !== 'NONE'
              )
                probe.layoutPositioning = 'ABSOLUTE';
              probe.textAutoResize = 'WIDTH_AND_HEIGHT';
              intrinsicWidth = probe.width;
            } finally {
              probe.remove();
            }
          }
          nodes.push({
            sourceId: source.id,
            name: source.name,
            kind: source.kind,
            expected: source.bounds,
            actual: {
              x:
                native.absoluteTransform[0][2] -
                root.absoluteTransform[0][2] +
                screen.root.bounds.x,
              y:
                native.absoluteTransform[1][2] -
                root.absoluteTransform[1][2] +
                screen.root.bounds.y,
              width: native.width,
              height: native.height,
            },
            ...(native.type === 'TEXT'
              ? {
                  align: native.textAlignHorizontal,
                  resizing: native.textAutoResize,
                  expectedAlign: source.text?.align,
                  expectedSizing: source.text?.sizing,
                  intrinsicWidth,
                  fontSegments: native
                    .getStyledTextSegments(['fontName', 'fontSize', 'letterSpacing', 'lineHeight'])
                    .map((segment) => ({
                      start: segment.start,
                      end: segment.end,
                      fontName: segment.fontName,
                      fontSize: segment.fontSize,
                      letterSpacing: segment.letterSpacing,
                      lineHeight: segment.lineHeight,
                    })),
                  expectedFont: source.text
                    ? {
                        family: source.text.fontFamily,
                        weight: source.text.fontWeight,
                        size: source.text.fontSize,
                        lineHeight: source.text.lineHeight,
                        letterSpacing: source.text.letterSpacing,
                      }
                    : undefined,
                }
              : {}),
          });
        }
        post('NATIVE_PREVIEW', {
          png: figma.base64Encode(bytes),
          screenId: screen.id,
          nodes,
          nodeId: root.id,
          pageId: figma.currentPage.id,
          requestId: data.requestId,
        });
      }
      return;
    }
    if (__DIAGNOSTICS__ && data.type === 'VERIFY') {
      if (busy || !current || !result || typeof data.screenId !== 'string')
        throw new Error('Import a capture before checking it.');
      const index = current.screens.findIndex((s) => s.id === data.screenId);
      if (index < 0) throw new Error('Screen not found.');
      const source = current.screens[index]!;
      const root = await figma.getNodeByIdAsync(result.screenIds[index]!);
      if (!root || !('absoluteTransform' in root)) throw new Error('Imported frame was removed.');
      if (root.width * root.height > 16000000)
        throw new Error(
          'This frame is too large for a full comparison. Capture and verify a selected section.',
        );
      const origin = root.absoluteTransform;
      const geometry = [];
      for (const node of flatten(source.root)) {
        const id = result.mapping[`${source.id}:${node.id}`];
        if (!id) continue;
        const native = await figma.getNodeByIdAsync(id);
        if (!native || !('absoluteTransform' in native)) continue;
        geometry.push({
          sourceId: node.id,
          bounds: {
            x: native.absoluteTransform[0][2] - origin[0][2] + source.root.bounds.x,
            y: native.absoluteTransform[1][2] - origin[1][2] + source.root.bounds.y,
            width: native.width,
            height: native.height,
          },
          ...(native.type === 'TEXT' ? { text: native.characters } : {}),
        });
      }
      const bytes = await root.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 1 },
      });
      post('VERIFY_EXPORT', { screenId: source.id, png: figma.base64Encode(bytes), geometry });
      return;
    }
  } catch (error) {
    post(data.type === 'IMPORT' && cancelled ? 'CANCELLED' : 'ERROR', {
      message: errorMessage(error),
      requestId: data.requestId,
    });
  }
};
