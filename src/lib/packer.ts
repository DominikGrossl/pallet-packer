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

function copiesFit(rect: FreeRect, orientation: Orientation): number {
  return (
    Math.floor(rect.width / orientation.width) * Math.floor(rect.length / orientation.length)
  );
}

function findFloorPlacement(
  freeRects: FreeRect[],
  item: NormalizedItem,
  allowedRotations: ReadonlySet<0 | 90>,
): { rectIndex: number; orientation: Orientation } | null {
  const orientations = orientationsOf(item.effectiveWidth, item.effectiveLength).filter((o) =>
    allowedRotations.has(o.rotation),
  );
  const candidates =
    orientations.length > 0
      ? orientations
      : orientationsOf(item.effectiveWidth, item.effectiveLength);

  let best: {
    rectIndex: number;
    orientation: Orientation;
    fitCount: number;
    z: number;
    x: number;
    leftoverArea: number;
    shortLeftover: number;
  } | null = null;

  for (let i = 0; i < freeRects.length; i++) {
    const rect = freeRects[i];
    for (const orientation of candidates) {
      if (orientation.width > rect.width || orientation.length > rect.length) continue;

      const leftoverArea = rect.width * rect.length - orientation.width * orientation.length;
      const shortLeftover = Math.min(
        rect.width - orientation.width,
        rect.length - orientation.length,
      );
      const candidate = {
        rectIndex: i,
        orientation,
        fitCount: copiesFit(rect, orientation),
        z: rect.z,
        x: rect.x,
        leftoverArea,
        shortLeftover,
      };

      if (
        !best ||
        candidate.fitCount > best.fitCount ||
        (candidate.fitCount === best.fitCount && candidate.z < best.z) ||
        (candidate.fitCount === best.fitCount &&
          candidate.z === best.z &&
          candidate.x < best.x) ||
        (candidate.fitCount === best.fitCount &&
          candidate.z === best.z &&
          candidate.x === best.x &&
          candidate.leftoverArea < best.leftoverArea) ||
        (candidate.fitCount === best.fitCount &&
          candidate.z === best.z &&
          candidate.x === best.x &&
          candidate.leftoverArea === best.leftoverArea &&
          candidate.shortLeftover < best.shortLeftover)
      ) {
        best = candidate;
      }
    }
  }

  return best ? { rectIndex: best.rectIndex, orientation: best.orientation } : null;
}

function findStackPlacement(
  slots: StackSlot[],
  item: NormalizedItem,
  truckHeight: number,
): { slotIndex: number; orientation: Orientation } | null {
  let best: {
    slotIndex: number;
    orientation: Orientation;
    leftoverArea: number;
    y: number;
    z: number;
    x: number;
  } | null = null;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.y + occupyHeight(item.height) > truckHeight) continue;

    for (const orientation of orientationsOf(item.effectiveWidth, item.effectiveLength)) {
      if (orientation.width > slot.width || orientation.length > slot.length) continue;

      const leftoverArea = slot.width * slot.length - orientation.width * orientation.length;
      const candidate = {
        slotIndex: i,
        orientation,
        leftoverArea,
        y: slot.y,
        z: slot.z,
        x: slot.x,
      };

      if (
        !best ||
        candidate.leftoverArea < best.leftoverArea ||
        (candidate.leftoverArea === best.leftoverArea && candidate.y < best.y) ||
        (candidate.leftoverArea === best.leftoverArea &&
          candidate.y === best.y &&
          candidate.z < best.z) ||
        (candidate.leftoverArea === best.leftoverArea &&
          candidate.y === best.y &&
          candidate.z === best.z &&
          candidate.x < best.x)
      ) {
        best = candidate;
      }
    }
  }

  return best ? { slotIndex: best.slotIndex, orientation: best.orientation } : null;
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

  const placeOnFloor = (
    item: NormalizedItem,
    allowedRotations: ReadonlySet<0 | 90>,
  ): boolean => {
    if (wouldExceedWeight(truck, totalWeight, item.weight)) return false;
    const floorFit = findFloorPlacement(freeRects, item, allowedRotations);
    if (!floorFit) return false;

    const rect = freeRects[floorFit.rectIndex];
    const { orientation } = floorFit;
    if (
      !canOccupy(
        truck,
        placed,
        rect.x,
        0,
        rect.z,
        orientation.width,
        orientation.length,
        item.height,
      )
    ) {
      return false;
    }

    placed.push(toPlaced(item, rect.x, 0, rect.z, orientation));
    totalWeight += item.weight;

    if (item.source.stackable) {
      stackSlots.push({
        x: rect.x,
        y: occupyHeight(item.height),
        z: rect.z,
        width: orientation.width,
        length: orientation.length,
      });
    }

    freeRects = occupyFreeRects(freeRects, {
      x: rect.x,
      z: rect.z,
      width: orientation.width,
      length: orientation.length,
    });
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
    if (!placeOnFloor(item, preferred)) leftover.push(item);
  }

  const stillOpen: NormalizedItem[] = [];
  for (const item of leftover) {
    if (!placeOnFloor(item, BOTH_ROTATIONS)) stillOpen.push(item);
  }

  for (const item of stillOpen) {
    if (!item.source.stackable) {
      unplaced.push(item.source);
      continue;
    }
    if (wouldExceedWeight(truck, totalWeight, item.weight)) {
      unplaced.push(item.source);
      continue;
    }

    const stackFit = findStackPlacement(stackSlots, item, truck.innerHeight);
    if (!stackFit) {
      unplaced.push(item.source);
      continue;
    }

    const slot = stackSlots[stackFit.slotIndex];
    const { orientation } = stackFit;
    if (
      !canOccupy(
        truck,
        placed,
        slot.x,
        slot.y,
        slot.z,
        orientation.width,
        orientation.length,
        item.height,
      )
    ) {
      unplaced.push(item.source);
      continue;
    }

    placed.push(toPlaced(item, slot.x, slot.y, slot.z, orientation));
    totalWeight += item.weight;

    stackSlots[stackFit.slotIndex] = {
      x: slot.x,
      y: slot.y + occupyHeight(item.height),
      z: slot.z,
      width: orientation.width,
      length: orientation.length,
    };
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
