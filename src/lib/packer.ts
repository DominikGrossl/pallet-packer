export interface TruckSpec {
  id: string;
  name: string;
  innerWidth: number;
  innerLength: number;
  innerHeight: number;
  maxWeight?: number;
}

export interface CargoItem {
  id: string;
  /** Queue-batch id this copy came from; falls back to `id` when omitted. */
  sourceId?: string;
  /** 1-based index within the queue batch (first EUR 1 copy is 1, not the "1" in the name). */
  unitNumber?: number;
  name: string;
  palletWidth: number;
  palletLength: number;
  cargoWidth: number;
  cargoLength: number;
  height: number;
  weight?: number;
  stackable: boolean;
}

export interface PlacedItem {
  id: string;
  /** Queue-batch id, so the dashboard can count how many of a line were placed. */
  sourceId: string;
  /** 1-based index within the queue batch. */
  unitNumber: number;
  name: string;
  x: number;
  y: number;
  z: number;
  /** Occupied footprint in the placed orientation: the larger of pallet and cargo per axis. */
  width: number;
  length: number;
  height: number;
  /** Pallet footprint in the placed orientation; never larger than width/length. */
  palletWidth: number;
  palletLength: number;
  isOverhanging: boolean;
  rotation: 0 | 90;
}

export interface PackingResult {
  placed: PlacedItem[];
  unplaced: CargoItem[];
  totalWeight: number;
  floorUtilizationPercent: number;
}

interface NormalizedItem {
  source: CargoItem;
  effectiveWidth: number;
  effectiveLength: number;
  height: number;
  isOverhanging: boolean;
  weight: number;
}

interface FreeRect {
  x: number;
  z: number;
  width: number;
  length: number;
}

interface StackSlot {
  x: number;
  y: number;
  z: number;
  width: number;
  length: number;
}

interface Orientation {
  width: number;
  length: number;
  rotation: 0 | 90;
}

const BOTH_ROTATIONS: ReadonlySet<0 | 90> = new Set([0, 90]);

/** Wooden pallet deck thickness, also used as stacking occupancy with cargo height. */
export const PALLET_BASE_HEIGHT_MM = 150;

function occupyHeight(cargoHeight: number): number {
  return PALLET_BASE_HEIGHT_MM + Math.max(0, cargoHeight);
}

function orientationsOf(width: number, length: number): Orientation[] {
  const list: Orientation[] = [{ width, length, rotation: 0 }];
  if (width !== length) {
    list.push({ width: length, length: width, rotation: 90 });
  }
  return list;
}

function fitsTruckFloor(item: NormalizedItem, truck: TruckSpec): boolean {
  return orientationsOf(item.effectiveWidth, item.effectiveLength).some(
    (o) => o.width <= truck.innerWidth && o.length <= truck.innerLength,
  );
}

function rectsOverlap(
  a: FreeRect,
  b: { x: number; z: number; width: number; length: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.z < b.z + b.length &&
    a.z + a.length > b.z
  );
}

function containsRect(outer: FreeRect, inner: FreeRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.z <= inner.z &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.z + outer.length >= inner.z + inner.length
  );
}

/** Keep the full leftover strips, including long unused corridors. */
function splitMaxRects(rect: FreeRect, placed: FreeRect): FreeRect[] {
  if (!rectsOverlap(rect, placed)) return [rect];

  const next: FreeRect[] = [];
  const placedRight = placed.x + placed.width;
  const placedBack = placed.z + placed.length;
  const rectRight = rect.x + rect.width;
  const rectBack = rect.z + rect.length;

  if (placed.x > rect.x) {
    next.push({ x: rect.x, z: rect.z, width: placed.x - rect.x, length: rect.length });
  }
  if (placedRight < rectRight) {
    next.push({
      x: placedRight,
      z: rect.z,
      width: rectRight - placedRight,
      length: rect.length,
    });
  }
  if (placed.z > rect.z) {
    next.push({ x: rect.x, z: rect.z, width: rect.width, length: placed.z - rect.z });
  }
  if (placedBack < rectBack) {
    next.push({
      x: rect.x,
      z: placedBack,
      width: rect.width,
      length: rectBack - placedBack,
    });
  }

  return next.filter((r) => r.width > 0 && r.length > 0);
}

function pruneFreeRects(rects: FreeRect[]): FreeRect[] {
  const unique: FreeRect[] = [];
  for (const rect of rects) {
    const duplicate = unique.some(
      (other) =>
        other.x === rect.x &&
        other.z === rect.z &&
        other.width === rect.width &&
        other.length === rect.length,
    );
    if (!duplicate) unique.push(rect);
  }
  return unique.filter(
    (rect, index) =>
      !unique.some((other, otherIndex) => otherIndex !== index && containsRect(other, rect)),
  );
}

function occupyFreeRects(freeRects: FreeRect[], placed: FreeRect): FreeRect[] {
  const split: FreeRect[] = [];
  for (const rect of freeRects) {
    split.push(...splitMaxRects(rect, placed));
  }
  return pruneFreeRects(split);
}

interface PlacementCandidate {
  kind: "floor" | "stack";
  rectIndex: number;
  slotIndex: number;
  orientation: Orientation;
  x: number;
  y: number;
  z: number;
  leftoverArea: number;
}

function orientationsFor(
  item: NormalizedItem,
  allowedRotations: ReadonlySet<0 | 90>,
): Orientation[] {
  const all = orientationsOf(item.effectiveWidth, item.effectiveLength);
  const filtered = all.filter((orientation) => allowedRotations.has(orientation.rotation));
  return filtered.length > 0 ? filtered : all;
}

/** Cabin first (`z`), then the current bay (`x` then `y`), then the tighter leftover. */
function isBetterCandidate(candidate: PlacementCandidate, best: PlacementCandidate): boolean {
  if (candidate.z !== best.z) return candidate.z < best.z;
  if (candidate.x !== best.x) return candidate.x < best.x;
  if (candidate.y !== best.y) return candidate.y < best.y;
  if (candidate.leftoverArea !== best.leftoverArea) return candidate.leftoverArea < best.leftoverArea;
  return candidate.orientation.rotation < best.orientation.rotation;
}

function findBestPlacement(
  truck: TruckSpec,
  placed: PlacedItem[],
  freeRects: FreeRect[],
  stackSlots: StackSlot[],
  item: NormalizedItem,
  allowedRotations: ReadonlySet<0 | 90>,
): PlacementCandidate | null {
  const orientations = orientationsFor(item, allowedRotations);
  let best: PlacementCandidate | null = null;

  const consider = (candidate: PlacementCandidate) => {
    if (
      !canOccupy(
        truck,
        placed,
        candidate.x,
        candidate.y,
        candidate.z,
        candidate.orientation.width,
        candidate.orientation.length,
        item.height,
      )
    ) {
      return;
    }
    if (!best || isBetterCandidate(candidate, best)) best = candidate;
  };

  for (let rectIndex = 0; rectIndex < freeRects.length; rectIndex++) {
    const rect = freeRects[rectIndex];
    for (const orientation of orientations) {
      if (orientation.width > rect.width || orientation.length > rect.length) continue;
      consider({
        kind: "floor",
        rectIndex,
        slotIndex: -1,
        orientation,
        x: rect.x,
        y: 0,
        z: rect.z,
        leftoverArea: rect.width * rect.length - orientation.width * orientation.length,
      });
    }
  }

  if (item.source.stackable) {
    for (let slotIndex = 0; slotIndex < stackSlots.length; slotIndex++) {
      const slot = stackSlots[slotIndex];
      if (slot.y + occupyHeight(item.height) > truck.innerHeight) continue;
      for (const orientation of orientations) {
        if (orientation.width > slot.width || orientation.length > slot.length) continue;
        consider({
          kind: "stack",
          rectIndex: -1,
          slotIndex,
          orientation,
          x: slot.x,
          y: slot.y,
          z: slot.z,
          leftoverArea: slot.width * slot.length - orientation.width * orientation.length,
        });
      }
    }
  }

  return best;
}

function wouldExceedWeight(
  truck: TruckSpec,
  currentWeight: number,
  itemWeight: number,
): boolean {
  return truck.maxWeight !== undefined && currentWeight + itemWeight > truck.maxWeight;
}

function withinTruck(
  truck: TruckSpec,
  x: number,
  y: number,
  z: number,
  width: number,
  length: number,
  height: number,
): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    z >= 0 &&
    x + width <= truck.innerWidth &&
    z + length <= truck.innerLength &&
    y + height <= truck.innerHeight
  );
}

function hasExactCoordinate(
  placed: PlacedItem[],
  x: number,
  y: number,
  z: number,
): boolean {
  return placed.some((item) => item.x === x && item.y === y && item.z === z);
}

function hasVolumeOverlap(
  placed: PlacedItem[],
  x: number,
  y: number,
  z: number,
  width: number,
  length: number,
  height: number,
): boolean {
  return placed.some((item) => {
    const itemTop = item.y + occupyHeight(item.height);
    return (
      item.x < x + width &&
      item.x + item.width > x &&
      item.y < y + height &&
      itemTop > y &&
      item.z < z + length &&
      item.z + item.length > z
    );
  });
}

function canOccupy(
  truck: TruckSpec,
  placed: PlacedItem[],
  x: number,
  y: number,
  z: number,
  width: number,
  length: number,
  cargoHeight: number,
): boolean {
  const height = occupyHeight(cargoHeight);
  return (
    withinTruck(truck, x, y, z, width, length, height) &&
    !hasExactCoordinate(placed, x, y, z) &&
    !hasVolumeOverlap(placed, x, y, z, width, length, height)
  );
}

function toPlaced(
  item: NormalizedItem,
  x: number,
  y: number,
  z: number,
  orientation: Orientation,
): PlacedItem {
  const turned = orientation.rotation === 90;

  return {
    id: `${item.source.id ?? "item"}-${item.source.unitNumber ?? Math.random().toString(36).slice(2, 7)}`,
    sourceId: item.source.sourceId ?? item.source.id,
    unitNumber: item.source.unitNumber ?? 1,
    name: item.source.name,
    x,
    y,
    z,
    width: orientation.width,
    length: orientation.length,
    height: item.height,
    palletWidth: turned ? item.source.palletLength : item.source.palletWidth,
    palletLength: turned ? item.source.palletWidth : item.source.palletLength,
    isOverhanging: item.isOverhanging,
    rotation: orientation.rotation,
  };
}

function normalizeItems(items: CargoItem[]): NormalizedItem[] {
  return items.map((source) => ({
    source,
    effectiveWidth: Math.max(source.palletWidth, source.cargoWidth),
    effectiveLength: Math.max(source.palletLength, source.cargoLength),
    height: source.height,
    isOverhanging:
      source.cargoWidth > source.palletWidth || source.cargoLength > source.palletLength,
    weight: source.weight ?? 0,
  }));
}

function finalizeResult(
  truck: TruckSpec,
  placed: PlacedItem[],
  unplaced: CargoItem[],
  totalWeight: number,
): PackingResult {
  const floorArea = truck.innerWidth * truck.innerLength;
  const usedFloorArea = placed
    .filter((p) => p.y === 0)
    .reduce((sum, p) => sum + p.width * p.length, 0);
  const floorUtilizationPercent = floorArea > 0 ? (usedFloorArea / floorArea) * 100 : 0;
  return { placed, unplaced, totalWeight, floorUtilizationPercent };
}

function packAttempt(
  truck: TruckSpec,
  items: CargoItem[],
  preferredRotation: 0 | 90,
): PackingResult {
  const placed: PlacedItem[] = [];
  const unplaced: CargoItem[] = [];
  let totalWeight = 0;
  let freeRects: FreeRect[] = [
    { x: 0, z: 0, width: truck.innerWidth, length: truck.innerLength },
  ];
  const stackSlots: StackSlot[] = [];
  const preferred: ReadonlySet<0 | 90> = new Set([preferredRotation]);

  const placeItem = (
    item: NormalizedItem,
    allowedRotations: ReadonlySet<0 | 90>,
  ): boolean => {
    if (wouldExceedWeight(truck, totalWeight, item.weight)) return false;
    const fit = findBestPlacement(
      truck,
      placed,
      freeRects,
      stackSlots,
      item,
      allowedRotations,
    );
    if (!fit) return false;

    const { orientation, x, y, z } = fit;
    placed.push(toPlaced(item, x, y, z, orientation));
    totalWeight += item.weight;

    if (fit.kind === "floor") {
      if (item.source.stackable) {
        stackSlots.push({
          x,
          y: occupyHeight(item.height),
          z,
          width: orientation.width,
          length: orientation.length,
        });
      }
      freeRects = occupyFreeRects(freeRects, {
        x,
        z,
        width: orientation.width,
        length: orientation.length,
      });
      return true;
    }

    const slot = stackSlots[fit.slotIndex];
    stackSlots[fit.slotIndex] = {
      x,
      y: slot.y + occupyHeight(item.height),
      z,
      width: orientation.width,
      length: orientation.length,
    };
    return true;
  };

  const leftover: NormalizedItem[] = [];

  for (const item of normalizeItems(items)) {
    if (occupyHeight(item.height) > truck.innerHeight || !fitsTruckFloor(item, truck)) {
      unplaced.push(item.source);
      continue;
    }
    if (wouldExceedWeight(truck, totalWeight, item.weight)) {
      unplaced.push(item.source);
      continue;
    }
    if (!placeItem(item, preferred)) leftover.push(item);
  }

  for (const item of leftover) {
    if (!placeItem(item, BOTH_ROTATIONS)) unplaced.push(item.source);
  }

  return finalizeResult(truck, placed, unplaced, totalWeight);
}

export function packTruck(truck: TruckSpec, items: CargoItem[]): PackingResult {
  const unrotated = packAttempt(truck, items, 0);
  const rotated = packAttempt(truck, items, 90);
  if (unrotated.placed.length !== rotated.placed.length) {
    return unrotated.placed.length > rotated.placed.length ? unrotated : rotated;
  }
  if (unrotated.unplaced.length !== rotated.unplaced.length) {
    return unrotated.unplaced.length < rotated.unplaced.length ? unrotated : rotated;
  }
  return unrotated.floorUtilizationPercent >= rotated.floorUtilizationPercent
    ? unrotated
    : rotated;
}

/** Manual inspector nudge along the truck bed, in millimetres. */
export const NUDGE_STEP_MM = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function othersOf(placed: PlacedItem[], id: string): PlacedItem[] {
  return placed.filter((item) => item.id !== id);
}

function candidateFits(
  truck: TruckSpec,
  others: PlacedItem[],
  x: number,
  y: number,
  z: number,
  width: number,
  length: number,
  cargoHeight: number,
): boolean {
  const height = occupyHeight(cargoHeight);
  if (width > truck.innerWidth || length > truck.innerLength) return false;
  return (
    withinTruck(truck, x, y, z, width, length, height) &&
    !hasVolumeOverlap(others, x, y, z, width, length, height)
  );
}

function replaceItem(placed: PlacedItem[], id: string, next: PlacedItem): PlacedItem[] {
  return placed.map((item) => (item.id === id ? next : item));
}

function clampToTruck(
  truck: TruckSpec,
  x: number,
  y: number,
  z: number,
  width: number,
  length: number,
  cargoHeight: number,
): { x: number; y: number; z: number } | null {
  const height = occupyHeight(cargoHeight);
  if (width > truck.innerWidth || length > truck.innerLength) return null;
  if (height > truck.innerHeight) return null;
  return {
    x: clamp(x, 0, truck.innerWidth - width),
    y: clamp(y, 0, truck.innerHeight - height),
    z: clamp(z, 0, truck.innerLength - length),
  };
}

/** Rebuild stats after a manual move so the dashboard does not run a full repack. */
export function updatePlacedItems(
  truck: TruckSpec,
  result: PackingResult,
  placed: PlacedItem[],
): PackingResult {
  return finalizeResult(truck, placed, result.unplaced, result.totalWeight);
}

/**
 * Translate one unit. Out-of-bed positions are clamped to the walls; overlaps are rejected.
 * `x` is truck width (left/right), `z` is truck length (cab → rear doors).
 */
export function tryNudgePlacedItem(
  truck: TruckSpec,
  placed: PlacedItem[],
  id: string,
  delta: { dx?: number; dy?: number; dz?: number },
): PlacedItem[] | null {
  const item = placed.find((entry) => entry.id === id);
  if (!item) return null;

  const clamped = clampToTruck(
    truck,
    item.x + (delta.dx ?? 0),
    item.y + (delta.dy ?? 0),
    item.z + (delta.dz ?? 0),
    item.width,
    item.length,
    item.height,
  );
  if (!clamped) return null;
  if (clamped.x === item.x && clamped.y === item.y && clamped.z === item.z) return null;

  const others = othersOf(placed, id);
  if (
    !candidateFits(
      truck,
      others,
      clamped.x,
      clamped.y,
      clamped.z,
      item.width,
      item.length,
      item.height,
    )
  ) {
    return null;
  }

  return replaceItem(placed, id, { ...item, ...clamped });
}

/** Swap the 0°/90° footprint around the unit's floor centre, then clamp and reject overlaps. */
export function tryRotatePlacedItem(
  truck: TruckSpec,
  placed: PlacedItem[],
  id: string,
): PlacedItem[] | null {
  const item = placed.find((entry) => entry.id === id);
  if (!item) return null;

  const width = item.length;
  const length = item.width;
  const palletWidth = item.palletLength;
  const palletLength = item.palletWidth;
  const rotation: 0 | 90 = item.rotation === 0 ? 90 : 0;
  const centerX = item.x + item.width / 2;
  const centerZ = item.z + item.length / 2;
  const clamped = clampToTruck(
    truck,
    Math.round(centerX - width / 2),
    item.y,
    Math.round(centerZ - length / 2),
    width,
    length,
    item.height,
  );
  if (!clamped) return null;

  const others = othersOf(placed, id);
  if (!candidateFits(truck, others, clamped.x, clamped.y, clamped.z, width, length, item.height)) {
    return null;
  }

  return replaceItem(placed, id, {
    ...item,
    ...clamped,
    width,
    length,
    palletWidth,
    palletLength,
    rotation,
  });
}

function findStackSupport(
  truck: TruckSpec,
  item: PlacedItem,
  others: PlacedItem[],
): { x: number; y: number; z: number } | null {
  const itemCenterX = item.x + item.width / 2;
  const itemCenterZ = item.z + item.length / 2;
  let best: { x: number; y: number; z: number; score: number } | null = null;

  for (const other of others) {
    if (item.width > other.width || item.length > other.length) continue;
    const y = other.y + occupyHeight(other.height);
    const contained =
      item.x >= other.x &&
      item.z >= other.z &&
      item.x + item.width <= other.x + other.width &&
      item.z + item.length <= other.z + other.length;
    const x = contained ? item.x : Math.round(other.x + (other.width - item.width) / 2);
    const z = contained ? item.z : Math.round(other.z + (other.length - item.length) / 2);
    if (!candidateFits(truck, others, x, y, z, item.width, item.length, item.height)) continue;

    const otherCenterX = other.x + other.width / 2;
    const otherCenterZ = other.z + other.length / 2;
    const dist =
      (itemCenterX - otherCenterX) ** 2 + (itemCenterZ - otherCenterZ) ** 2;
    const score = (contained ? 0 : 1_000_000_000) + dist;
    if (!best || score < best.score) best = { x, y, z, score };
  }

  return best;
}

/** Drop a stacked unit to the floor, or lift a floor unit onto the nearest valid support. */
export function tryTogglePlacedElevation(
  truck: TruckSpec,
  placed: PlacedItem[],
  id: string,
): PlacedItem[] | null {
  const item = placed.find((entry) => entry.id === id);
  if (!item) return null;

  const others = othersOf(placed, id);

  if (item.y > 0) {
    const clamped = clampToTruck(truck, item.x, 0, item.z, item.width, item.length, item.height);
    if (!clamped) return null;
    if (!candidateFits(truck, others, clamped.x, 0, clamped.z, item.width, item.length, item.height)) {
      return null;
    }
    return replaceItem(placed, id, { ...item, ...clamped, y: 0 });
  }

  const support = findStackSupport(truck, item, others);
  if (!support) return null;
  return replaceItem(placed, id, { ...item, ...support });
}

export function testPacker(): void {
  const truck: TruckSpec = {
    id: "trailer-standard",
    name: "Standard trailer",
    innerWidth: 2440,
    innerLength: 13600,
    innerHeight: 2700,
  };

  const items: CargoItem[] = Array.from({ length: 40 }, (_, index) => ({
    id: `euro-${index + 1}`,
    name: `Euro pallet ${index + 1}`,
    palletWidth: 800,
    palletLength: 1200,
    cargoWidth: 800,
    cargoLength: 1200,
    height: 1400,
    weight: 500,
    stackable: true,
  }));

  const result = packTruck(truck, items);

  console.log("Truck:", truck.name, truck.innerWidth, "x", truck.innerLength, "x", truck.innerHeight, "mm");
  console.log("Items:", items.length, "Euro pallets (1200x800x1400 mm)");
  console.log("Placed:", result.placed.length);
  console.log("Unplaced:", result.unplaced.length, result.unplaced.map((i) => i.id).join(", ") || "(none)");
  console.log("Total weight:", result.totalWeight, "kg");
  console.log("Floor utilization:", result.floorUtilizationPercent.toFixed(2), "%");
  console.log(
    "Placements:",
    result.placed.map(
      (p) =>
        `${p.id} @ (${p.x},${p.y},${p.z}) ${p.width}x${p.length}x${p.height} rot=${p.rotation} overhang=${p.isOverhanging}`,
    ),
  );
}
