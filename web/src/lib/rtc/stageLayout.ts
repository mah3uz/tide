// Where every participant sits on the stage, as plain numbers. Every tile
// lives in one keyed list and is placed by these rects, so a change of view
// or of speaker moves a tile rather than re-creating its <video>.

export type Shape = 'lens' | 'portal' | 'cell' | 'hidden';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tile with no rect sits in the phone's scrolling strip, in document flow. */
export interface Slot {
  shape: Shape;
  rect?: Rect;
}

export interface StageLayout {
  slots: Record<string, Slot>;
  /** The frame behind the lens: it stays put while the lens content changes hands. */
  lens?: Rect;
  share?: Rect;
  /** The last portal when more people are in the call than fit: "+N". */
  overflow?: { count: number; rect?: Rect };
  /** The faint orbit drawn around the lens and its portals. */
  orbit?: Rect;
  portalSize: number;
  /** Whether the portals scroll in a strip under the lens (phone). */
  strip: boolean;
}

export interface LayoutInput {
  mode: 'orbit' | 'grid' | 'share';
  width: number;
  height: number;
  phone: boolean;
  /** Display order: remote participants as the room lists them, then you. */
  order: string[];
  self?: string;
  /** Who fills the lens in orbit view. */
  lensIdentity?: string;
}

const maxOrbitPortals = 6;
/** Phone strip: a 58px portal, its name, and breathing room. */
export const stripHeight = 96;
export const phonePortal = 58;
const lensAspect = 1.55;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps you on screen when the portals overflow: the first few others, you, then "+N". */
function visiblePortals(ids: string[], self: string | undefined, room: number) {
  if (ids.length <= room) return { shown: ids, hidden: [] as string[] };
  const others = ids.filter((id) => id !== self);
  const keep = room - 1 - (self && ids.includes(self) ? 1 : 0);
  const shown = [...others.slice(0, keep), ...(self && ids.includes(self) ? [self] : [])];
  return { shown, hidden: ids.filter((id) => !shown.includes(id)) };
}

export function stageLayout(input: LayoutInput): StageLayout {
  const { width: W, height: H, phone } = input;
  if (input.mode === 'grid') return gridLayout(input);

  const lensId = input.mode === 'orbit' ? input.lensIdentity : undefined;
  const portals = input.order.filter((id) => id !== lensId);
  const slots: Record<string, Slot> = {};

  if (phone) {
    const mainH = portals.length > 0 ? Math.max(0, H - stripHeight - 12) : H;
    const main = { x: 0, y: 0, w: W, h: mainH };
    if (lensId) slots[lensId] = { shape: 'lens', rect: main };
    for (const id of portals) slots[id] = { shape: 'portal' };
    return {
      slots,
      lens: lensId ? main : undefined,
      share: input.mode === 'share' ? main : undefined,
      portalSize: phonePortal,
      strip: portals.length > 0
    };
  }

  // Orbit proper: the lens in the middle, portals on an arc either side of it.
  const P = Math.round(clamp(Math.min(H * 0.17, W * 0.085), 64, 124));
  const bulge = Math.round(P * 0.25);
  const sideGap = 40;
  const margin = 24;
  const sideW = margin + P + bulge + sideGap;
  const orbitFits = input.mode === 'orbit' && W - 2 * sideW >= 420 && H >= 360;

  if (input.mode === 'orbit' && (portals.length === 0 || orbitFits)) {
    const roomW = portals.length === 0 ? W - 2 * margin : W - 2 * sideW;
    const lensW = Math.min(roomW, (H - 16) * lensAspect);
    const lensH = Math.min(H - 16, lensW / lensAspect);
    const lens = { x: (W - lensW) / 2, y: (H - lensH) / 2, w: lensW, h: lensH };
    if (lensId) slots[lensId] = { shape: 'lens', rect: lens };

    const { shown, hidden } = visiblePortals(portals, input.self, maxOrbitPortals);
    for (const id of hidden) slots[id] = { shape: 'hidden' };
    const places = [...shown, ...(hidden.length ? ['+overflow'] : [])];
    // Left takes the first half, right the rest; one portal sits on the right.
    const rightCount = places.length === 1 ? 1 : Math.floor(places.length / 2);
    const columns = [places.slice(0, places.length - rightCount), places.slice(-rightCount)];
    const cx = lens.x + lens.w / 2;
    const cy = lens.y + lens.h / 2;
    const label = 26;
    let overflowRect: Rect | undefined;

    columns.forEach((column, side) => {
      const k = column.length;
      const reach = Math.max(0, lens.h / 2 - P / 2 - label / 2);
      const step = k > 1 ? Math.min((2 * reach) / (k - 1), P + label + 56) : 0;
      column.forEach((id, index) => {
        const offset = (index - (k - 1) / 2) * step;
        const t = reach > 0 ? offset / reach : 0;
        const out = lens.w / 2 + sideGap + P / 2 + bulge * (1 - t * t);
        const centreX = side === 0 ? cx - out : cx + out;
        const rect = { x: centreX - P / 2, y: cy + offset - P / 2 - label / 2, w: P, h: P };
        if (id === '+overflow') overflowRect = rect;
        else slots[id] = { shape: 'portal', rect };
      });
    });

    const orbitW = lens.w + 2 * (sideGap + P + bulge);
    return {
      slots,
      lens: lensId ? lens : undefined,
      overflow: hidden.length ? { count: hidden.length, rect: overflowRect } : undefined,
      orbit:
        portals.length > 0
          ? { x: cx - orbitW / 2, y: cy - lens.h / 2 - 28, w: orbitW, h: lens.h + 56 }
          : undefined,
      portalSize: P,
      strip: false
    };
  }

  // Screen share, or orbit on a stage too narrow for side columns: the main
  // frame on top and a centred row of small portals under it.
  const rowP = Math.round(clamp(H * 0.085, 48, 64));
  const gap = 18;
  const rowH = rowP + 22 + 16;
  const m = W < 760 ? 16 : 32;
  const mainW = Math.min(W - 2 * m, input.mode === 'share' ? 1600 : (H - rowH) * lensAspect);
  const main = { x: (W - mainW) / 2, y: 0, w: mainW, h: Math.max(0, H - rowH) };
  if (lensId) slots[lensId] = { shape: 'lens', rect: main };
  const fit = Math.max(1, Math.floor((W - 2 * m + gap) / (rowP + gap)));
  const { shown, hidden } = visiblePortals(portals, input.self, fit);
  for (const id of hidden) slots[id] = { shape: 'hidden' };
  const count = shown.length + (hidden.length ? 1 : 0);
  const x0 = (W - (count * rowP + (count - 1) * gap)) / 2;
  const y = main.h + 16;
  shown.forEach((id, index) => {
    slots[id] = { shape: 'portal', rect: { x: x0 + index * (rowP + gap), y, w: rowP, h: rowP } };
  });
  return {
    slots,
    lens: lensId ? main : undefined,
    share: input.mode === 'share' ? main : undefined,
    overflow: hidden.length
      ? {
          count: hidden.length,
          rect: { x: x0 + shown.length * (rowP + gap), y, w: rowP, h: rowP }
        }
      : undefined,
    portalSize: rowP,
    strip: false
  };
}

function gridLayout({ width: W, height: H, phone, order }: LayoutInput): StageLayout {
  const n = Math.max(1, order.length);
  const margin = phone ? 0 : 24;
  const gap = phone ? 8 : 16;
  const innerW = W - 2 * margin;
  let best = { cols: 1, rows: n, w: 0, h: 0 };
  // A phone grid is two across from three people, so a crowd isn't a stack of slivers.
  const firstCols = phone && n >= 3 ? 2 : 1;
  for (let cols = firstCols; cols <= Math.min(n, phone ? 2 : 4); cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (innerW - (cols - 1) * gap) / cols;
    const cellH = (H - (rows - 1) * gap) / rows;
    // A phone tile may stand taller than wide; a desktop one keeps 16:10.
    const w = phone ? cellW : Math.min(cellW, cellH * 1.6);
    const h = phone ? Math.min(cellH, cellW * 1.4) : w / 1.6;
    if (w * h > best.w * best.h) best = { cols, rows, w, h };
  }
  const { cols, rows, w, h } = best;
  const blockH = rows * h + (rows - 1) * gap;
  const top = Math.max(0, (H - blockH) / 2);
  const slots: Record<string, Slot> = {};
  order.forEach((id, index) => {
    const row = Math.floor(index / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const left = (W - (inRow * w + (inRow - 1) * gap)) / 2;
    const col = index - row * cols;
    slots[id] = {
      shape: 'cell',
      rect: { x: left + col * (w + gap), y: top + row * (h + gap), w, h }
    };
  });
  return { slots, portalSize: 0, strip: false };
}
