import { renderScene } from '../src/plugin/renderer.js';
import { flatten } from '../src/core/analysis.js';
import type { ScenePackage } from '../src/core/scene.js';

/** Run only in a real Figma editor. Export images independently so font
 * substitution cannot distort image-only pixel comparison coordinates. */
export async function runNativeFidelity(api: PluginAPI, scene: ScenePackage) {
  const result = await renderScene(api, scene, {
    fontPolicy: 'substitute',
    metadata: false,
    foundations: false,
    components: false,
  });
  const source = flatten(scene.screens[0]!.root);
  const images = [];
  for (const key of ['cover', 'contain', 'padded', 'none', 'small', 'fill']) {
    const node = source.find((n) => n.source.key === key)!;
    const native = await api.getNodeByIdAsync(
      result.mapping[scene.screens[0]!.id + ':' + node.id]!,
    );
    if (!native || native.type !== 'FRAME' || !native.clipsContent || native.children.length !== 1)
      throw new Error('Missing editable image clip: ' + key);
    const clip = native.children[0];
    if (clip?.type !== 'FRAME' || !clip.clipsContent || clip.children[0]?.type !== 'RECTANGLE')
      throw new Error('Missing original image pixels: ' + key);
    const bitmap = clip.children[0];
    if (!(bitmap.fills as Paint[]).some((p) => p.type === 'IMAGE'))
      throw new Error('Missing bitmap fill: ' + key);
    const bytes = await native.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 },
    });
    images.push({
      key,
      id: native.id,
      width: native.width,
      height: native.height,
      png: api.base64Encode(bytes),
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
      bitmap: { x: bitmap.x, y: bitmap.y, width: bitmap.width, height: bitmap.height },
    });
  }
  const details = source.find((n) => n.source.key === 'details')!;
  const text = await api.getNodeByIdAsync(result.mapping[scene.screens[0]!.id + ':' + details.id]!);
  if (!text || text.type !== 'TEXT') throw new Error('Missing editable rich text.');
  const decorations = text.getStyledTextSegments(['textDecoration', 'letterSpacing']);
  if (
    !decorations.some((s) => s.textDecoration === 'UNDERLINE') ||
    !decorations.some((s) => s.textDecoration === 'STRIKETHROUGH')
  )
    throw new Error('Lost text decorations.');
  return { result, images, decorations };
}
