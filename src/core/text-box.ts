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
      const lines = text.lines
        ? text.lines
        : Math.round(ratio) >= 1 && Math.abs(ratio - Math.round(ratio)) < 0.06
          ? Math.round(ratio)
          : Math.max(1, Math.round((height - text.fontSize * 1.9) / text.lineHeight) + 1);
      // Each line is as tall as the tallest line height on it: a small date above a
      // large headline in one paragraph has lines of two heights.
      const starts = [0, ...(text.breaks ?? [])];
      const mixed =
        starts.length === lines && (text.runs ?? []).some((run) => run.lineHeight !== undefined);
      const lineBox = mixed
        ? starts.reduce((sum, start, i) => {
            const end = starts[i + 1] ?? text.characters.length;
            const heights = (text.runs ?? [])
              .filter((run) => run.start < end && run.end > start)
              // White space alone does not set a line's height.
              .filter(
                (run) =>
                  text.characters.slice(Math.max(run.start, start), Math.min(run.end, end)).trim()
                    .length > 0,
              )
              .map((run) => run.lineHeight ?? text.lineHeight);
            return sum + (heights.length ? Math.max(...heights) : text.lineHeight);
          }, 0)
        : lines * text.lineHeight;
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
