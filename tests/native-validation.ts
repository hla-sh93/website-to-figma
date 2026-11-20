import { renderScene, type RenderResult } from '../src/plugin/renderer.js';
import { flatten } from '../src/core/analysis.js';
import type { ScenePackage } from '../src/core/scene.js';
export async function runNativeValidation(api: PluginAPI, scene: ScenePackage) {
  const result = await renderScene(api, scene, {
    fontPolicy: 'substitute',
    metadata: false,
    foundations: true,
    components: true,
  });
  return verifyNativeResult(api, scene, result);
}

/** Exercise only the newly imported feature fixture, restoring all temporary edits. */
export async function verifyNativeResult(
  api: PluginAPI,
  scene: ScenePackage,
  result: RenderResult,
) {
  const root = await api.getNodeByIdAsync(result.screenIds[0]!);
  if (!root || root.type !== 'FRAME') throw new Error('Expected a native frame.');
  const grid = root.findOne(
    (n) => n.type === 'FRAME' && n.layoutMode === 'GRID',
  ) as FrameNode | null;
  if (
    !grid ||
    grid.gridColumnCount !== 3 ||
    grid.gridRowCount !== 1 ||
    grid.children.length !== 3 ||
    grid.children.some((n) => n.y !== grid.children[0]!.y)
  )
    throw new Error('Component conversion changed grid placement.');
  if (result.stats.components !== 1 || result.stats.instances !== 3)
    throw new Error('Expected one component family and three instances.');
  const instance = grid.children[0];
  if (instance?.type !== 'INSTANCE') throw new Error('Expected a reusable instance.');
  const property = Object.keys(instance.componentProperties).find(
    (name) => instance.componentProperties[name]!.value === 'See the whole picture.',
  );
  if (!property) throw new Error('Editable heading property missing.');
  const old = instance.componentProperties[property]!.value;
  const originalSize = {
    width: root.width,
    height: root.height,
    vertical: root.layoutSizingVertical,
  };
  let resizeWorks = false,
    contentGrowth = false;
  let growthDiagnostic;
  try {
    root.resize(1000, root.height);
    root.layoutSizingVertical = 'HUG';
    resizeWorks = grid.width <= 1000 && grid.children.every((n) => n.x + n.width <= grid.width + 2);
    if (!resizeWorks) throw new Error('Grid does not fit after resize.');
    const height = instance.height;
    instance.setProperties({ [property]: 'A longer heading that needs room to grow. '.repeat(6) });
    const master = await instance.getMainComponentAsync();
    contentGrowth = instance.height > height;
    growthDiagnostic = {
      before: height,
      after: instance.height,
      instanceSizing: instance.layoutSizingVertical,
      masterSizing: master?.layoutSizingVertical,
      texts: instance.findAllWithCriteria({ types: ['TEXT'] }).map((n) => ({
        name: n.name,
        width: n.width,
        height: n.height,
        resizing: n.textAutoResize,
        sizing: n.layoutSizingHorizontal,
      })),
    };
  } finally {
    instance.setProperties({ [property]: old });
    root.resize(originalSize.width, originalSize.height);
    root.layoutSizingVertical = originalSize.vertical;
  }
  const paint = (instance.fills as readonly Paint[]).find((p) => p.type === 'SOLID') as
    SolidPaint | undefined;
  const variableId = paint?.boundVariables?.color?.id;
  if (!variableId) throw new Error('Card background is not bound to a variable.');
  const variable = await api.variables.getVariableByIdAsync(variableId);
  if (!variable) throw new Error('Bound color variable missing.');
  const collection = await api.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId,
  );
  if (!collection) throw new Error('Variable collection missing.');
  const original = variable.valuesByMode[collection.defaultModeId]!;
  let bindingWorks = false;
  try {
    variable.setValueForMode(collection.defaultModeId, { r: 0.1, g: 0.2, b: 0.3, a: 1 });
    const changed = (instance.fills as readonly Paint[]).find(
      (p) => p.type === 'SOLID',
    ) as SolidPaint;
    bindingWorks = Math.abs(changed.color.r - 0.1) < 0.01;
  } finally {
    variable.setValueForMode(collection.defaultModeId, original);
  }
  if (!bindingWorks) throw new Error('Variable binding does not update the instance paint.');
  if (!contentGrowth) throw new Error('Longer component text did not grow the instance height.');
  const source = scene.screens[0]!;
  const origin = root.absoluteTransform;
  const geometry = [];
  for (const node of flatten(source.root)) {
    const id = result.mapping[`${source.id}:${node.id}`];
    const native = id ? await api.getNodeByIdAsync(id) : null;
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
  return {
    result,
    checks: { gridPlacement: true, resizeWorks, contentGrowth, bindingWorks },
    growthDiagnostic,
    geometry,
  };
}
