import type { SceneNode } from './scene.js';

/**
 * Browser text rectangles of inline content cover the font's content area
 * (ascent + descent), which can be taller or shorter than the line box. Figma
 * text layers are always whole line boxes with glyphs centred in them, so text
 * bounds are converted to line boxes around the same centre.
 */
export function textLineBoxes(root: SceneNode): void {
  const visit = (node: SceneNode) => {
    const text = node.text;
    if (node.kind === 'text' && text && text.lineHeight > 0 && !text.maxLines) {
      const height = node.bounds.height;
      const ratio = height / text.lineHeight;
      // Block text already measures whole line boxes.
      const lines =
        Math.round(ratio) >= 1 && Math.abs(ratio - Math.round(ratio)) < 0.06
          ? Math.round(ratio)
          : Math.max(1, Math.round((height - text.fontSize * 1.9) / text.lineHeight) + 1);
      const lineBox = lines * text.lineHeight;
      if (Math.abs(lineBox - height) > 0.5) {
        node.bounds = {
          ...node.bounds,
          y: node.bounds.y + (height - lineBox) / 2,
          height: lineBox,
        };
      }
    }
    node.children.forEach(visit);
  };
  visit(root);
}
