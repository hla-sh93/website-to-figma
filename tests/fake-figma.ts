/**
 * Minimal in-memory stand-in for the Figma Plugin API: enough of the surface the
 * renderer uses to exercise it in Node. It records values; it does not lay out.
 */
type Any = Record<string, any>;
let nextId = 1;

class FakeNode {
  id = `1:${nextId++}`;
  name = '';
  type: string;
  parent: FakeNode | null = null;
  children: FakeNode[] = [];
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  removed = false;
  pluginData: Record<string, string> = {};
  bound: Record<string, unknown> = {};
  ranges: Any[] = [];
  [key: string]: any;
  constructor(type: string) {
    this.type = type;
    if (type === 'FRAME' || type === 'RECTANGLE')
      Object.assign(this, {
        strokeTopWeight: 0,
        strokeRightWeight: 0,
        strokeBottomWeight: 0,
        strokeLeftWeight: 0,
        strokes: [],
        fills: [],
        effects: [],
      });
    if (type === 'TEXT') Object.assign(this, { fills: [], effects: [] });
    if (type === 'FRAME') {
      this.layoutMode = 'NONE';
      this.gridColumnSizes = [];
      this.gridRowSizes = [];
    }
  }
  appendChild(child: FakeNode) {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
  }
  insertChild(index: number, child: FakeNode) {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.splice(index, 0, child);
  }
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  remove() {
    this.removed = true;
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setPluginData(key: string, value: string) {
    this.pluginData[key] = value;
  }
  setBoundVariable(field: string, variable: unknown) {
    this.bound[field] = variable;
  }
  async setTextStyleIdAsync(id: string) {
    this.textStyleId = id;
  }
  setGridChildPosition(row: number, column: number) {
    this.gridRowAnchorIndex = row;
    this.gridColumnAnchorIndex = column;
  }
  resizeWithoutConstraints(width: number, height: number) {
    this.resize(width, height);
  }
  set gridColumnCount(value: number) {
    this._columns = value;
    this.gridColumnSizes = Array.from({ length: value }, () => ({ type: 'FLEX', value: 1 }));
  }
  get gridColumnCount() {
    return this._columns ?? 0;
  }
  set gridRowCount(value: number) {
    this._rows = value;
    this.gridRowSizes = Array.from({ length: value }, () => ({ type: 'HUG' }));
  }
  get gridRowCount() {
    return this._rows ?? 0;
  }
}
for (const method of [
  'setRangeFontName',
  'setRangeFontSize',
  'setRangeFills',
  'setRangeTextDecoration',
  'setRangeTextCase',
  'setRangeLineHeight',
  'setRangeLetterSpacing',
])
  (FakeNode.prototype as Any)[method] = function (
    this: FakeNode,
    start: number,
    end: number,
    value: unknown,
  ) {
    this.ranges.push({ method, start, end, value });
  };

export function createFakeFigma(fonts = [{ family: 'Inter', style: 'Regular' }]) {
  const page = new FakeNode('PAGE');
  const variables: Any[] = [];
  const collections: Any[] = [];
  const styles: Any[] = [];
  const images: Any[] = [];
  const all: FakeNode[] = [];
  const make = (type: string) => {
    const node = new FakeNode(type);
    all.push(node);
    return node;
  };
  const api: Any = {
    currentPage: page,
    viewport: { scrollAndZoomIntoView() {} },
    listAvailableFontsAsync: async () => fonts.map((fontName) => ({ fontName })),
    loadFontAsync: async () => {},
    base64Decode: (value: string) => new Uint8Array(Buffer.from(value, 'base64')),
    createFrame() {
      const node = make('FRAME');
      page.appendChild(node);
      return node;
    },
    createSection() {
      const node = make('SECTION');
      page.appendChild(node);
      return node;
    },
    createRectangle() {
      const node = make('RECTANGLE');
      page.appendChild(node);
      return node;
    },
    createText() {
      const node = make('TEXT');
      page.appendChild(node);
      node.characters = '';
      return node;
    },
    createNodeFromSvg(svg: string) {
      const node = make('FRAME');
      node.svg = svg;
      page.appendChild(node);
      return node;
    },
    createImage(bytes: Uint8Array) {
      const image = { hash: `hash-${images.length}`, bytes };
      images.push(image);
      return image;
    },
    getLocalTextStylesAsync: async () => styles.filter((style) => !style.removed),
    createTextStyle() {
      const style: Any = { id: `S:${styles.length + 1}`, removed: false };
      style.remove = () => (style.removed = true);
      styles.push(style);
      return style;
    },
    variables: {
      getLocalVariableCollectionsAsync: async () => collections.filter((c) => !c.removed),
      getLocalVariablesAsync: async () => variables.filter((v) => !v.removed),
      createVariableCollection(name: string) {
        const collection: Any = { id: `C:${collections.length + 1}`, name, defaultModeId: 'm' };
        collection.remove = () => (collection.removed = true);
        collections.push(collection);
        return collection;
      },
      createVariable(name: string, collection: Any, type: string) {
        // As in Figma: names are unique in a collection, numbers are 32-bit floats.
        if (
          variables.some(
            (v) => !v.removed && v.variableCollectionId === collection.id && v.name === name,
          )
        )
          throw new Error('in createVariable: duplicate variable name');
        const variable: Any = {
          id: `V:${variables.length + 1}`,
          name,
          type,
          values: {},
          valuesByMode: {},
          variableCollectionId: collection.id,
        };
        variable.setValueForMode = (mode: string, value: unknown) => {
          variable.value = value;
          const f = (x: number) => Math.fround(x);
          variable.valuesByMode[mode] =
            typeof value === 'number'
              ? f(value)
              : Object.fromEntries(
                  Object.entries(value as Any).map(([k, x]) => [k, f(x as number)]),
                );
        };
        variable.remove = () => (variable.removed = true);
        variables.push(variable);
        return variable;
      },
      setBoundVariableForPaint(paint: Any, _field: string, variable: Any) {
        return { ...paint, boundVariables: { color: { id: variable.id } } };
      },
    },
  };
  return { api: api as PluginAPI, page, variables, styles, images, all };
}
