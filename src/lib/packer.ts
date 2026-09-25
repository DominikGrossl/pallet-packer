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
  /** Other pallets may sit on this unit. Defaults to true when omitted. */
  canSupportTop?: boolean;
  /** This unit may sit at y > 0. Defaults to true when omitted. */
  canBeOnTop?: boolean;
  /** Batch color shared by every unit from the same queue line. */
  color: string;
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
  /** Pallet footprint in the placed orientation. */
  palletWidth: number;
  palletLength: number;
  /** Cargo box in the placed orientation; independent of the pallet base. */
  cargoWidth: number;
  cargoLength: number;
  isOverhanging: boolean;
  rotation: 0 | 90;
  canSupportTop: boolean;
  canBeOnTop: boolean;
  color: string;
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

interface VolumeBox {
  x: number;
  y: number;
  z: number;
  width: number;
  length: number;
  height: number;
}

function boxesOverlap(a: VolumeBox, b: VolumeBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y &&
    a.z < b.z + b.length &&
    a.z + a.length > b.z
  );
}

function volumesOf(item: PlacedItem): VolumeBox[] {
  const palletX = item.x + (item.width - item.palletWidth) / 2;
  const palletZ = item.z + (item.length - item.palletLength) / 2;
  const volumes: VolumeBox[] = [
    {
      x: palletX,
      y: item.y,
      z: palletZ,
      width: item.palletWidth,
      length: item.palletLength,
      height: PALLET_BASE_HEIGHT_MM,
    },
  ];
  if (item.height > 0) {
    volumes.push({
      x: item.x + (item.width - item.cargoWidth) / 2,
      y: item.y + PALLET_BASE_HEIGHT_MM,
      z: item.z + (item.length - item.cargoLength) / 2,
      width: item.cargoWidth,
      length: item.cargoLength,
      height: item.height,
    });
  }
  return volumes;
}

function palletBaseRect(item: PlacedItem): { x: number; z: number; width: number; length: number } {
  return {
    x: item.x + (item.width - item.palletWidth) / 2,
    z: item.z + (item.length - item.palletLength) / 2,
    width: item.palletWidth,
    length: item.palletLength,
  };
}

function itemOverlapsItem(a: PlacedItem, b: PlacedItem): boolean {
  const aVolumes = volumesOf(a);
  const bVolumes = volumesOf(b);
  return aVolumes.some((left) => bVolumes.some((right) => boxesOverlap(left, right)));
}

function volumesFitTruck(truck: TruckSpec, item: PlacedItem): boolean {
  return volumesOf(item).every((box) =>
    withinTruck(truck, box.x, box.y, box.z, box.width, box.length, box.height),
  );
}

function allowsBeOnTop(item: { canBeOnTop?: boolean }): boolean {
  return item.canBeOnTop !== false;
}

function allowsSupportTop(item: { canSupportTop?: boolean }): boolean {
  return item.canSupportTop !== false;
}

export interface PlacementTarget {
  x: number;
  y: number;
  z: number;
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

function palletForOrientation(
  item: NormalizedItem,
  rotation: 0 | 90,
): { width: number; length: number } {
  return rotation === 90
    ? { width: item.source.palletLength, length: item.source.palletWidth }
    : { width: item.source.palletWidth, length: item.source.palletLength };
}

function footprintOriginOnSlot(
  orientation: Orientation,
  pallet: { width: number; length: number },
  slot: StackSlot,
): { x: number; z: number } {
  const palletX = slot.x + (slot.width - pallet.width) / 2;
  const palletZ = slot.z + (slot.length - pallet.length) / 2;
  return {
    x: palletX - (orientation.width - pallet.width) / 2,
    z: palletZ - (orientation.length - pallet.length) / 2,
  };
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

  if (allowsBeOnTop(item.source)) {
    for (let slotIndex = 0; slotIndex < stackSlots.length; slotIndex++) {
      const slot = stackSlots[slotIndex];
      if (slot.y + occupyHeight(item.height) > truck.innerHeight) continue;
      for (const orientation of orientations) {
        const pallet = palletForOrientation(item, orientation.rotation);
        if (pallet.width > slot.width || pallet.length > slot.length) continue;
        const origin = footprintOriginOnSlot(orientation, pallet, slot);
        consider({
          kind: "stack",
          rectIndex: -1,
          slotIndex,
          orientation,
          x: origin.x,
          y: slot.y,
          z: origin.z,
          leftoverArea: slot.width * slot.length - pallet.width * pallet.length,
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
  const candidate: VolumeBox = { x, y, z, width, length, height };
  return placed.some((item) => volumesOf(item).some((box) => boxesOverlap(candidate, box)));
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
    cargoWidth: turned ? item.source.cargoLength : item.source.cargoWidth,
    cargoLength: turned ? item.source.cargoWidth : item.source.cargoLength,
    isOverhanging: item.isOverhanging,
    rotation: orientation.rotation,
    canSupportTop: allowsSupportTop(item.source),
    canBeOnTop: allowsBeOnTop(item.source),
    color: item.source.color,
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
    const placedItem = toPlaced(item, x, y, z, orientation);
    placed.push(placedItem);
    totalWeight += item.weight;

    if (fit.kind === "floor") {
      if (allowsSupportTop(item.source)) {
        const base = palletBaseRect(placedItem);
        stackSlots.push({
          x: base.x,
          y: occupyHeight(item.height),
          z: base.z,
          width: base.width,
          length: base.length,
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

    if (allowsSupportTop(item.source)) {
      const slot = stackSlots[fit.slotIndex];
      const base = palletBaseRect(placedItem);
      stackSlots[fit.slotIndex] = {
        x: base.x,
        y: slot.y + occupyHeight(item.height),
        z: base.z,
        width: base.width,
        length: base.length,
      };
    } else {
      stackSlots.splice(fit.slotIndex, 1);
    }
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

function othersOf(placed: PlacedItem[], id: string): PlacedItem[] {
  return placed.filter((item) => item.id !== id);
}

function replaceItem(placed: PlacedItem[], id: string, next: PlacedItem): PlacedItem[] {
  return placed.map((item) => (item.id === id ? next : item));
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
 * Translate selected units together. If any unit leaves the bed or hits an unselected
 * pallet, the whole group stays put.
 */
export function tryNudgePlacedItems(
  truck: TruckSpec,
  placed: PlacedItem[],
  ids: string[],
  delta: { dx?: number; dy?: number; dz?: number },
): PlacedItem[] | null {
  const idSet = new Set(ids);
  const selected = placed.filter((item) => idSet.has(item.id));
  if (selected.length === 0) return null;

  const dx = delta.dx ?? 0;
  const dy = delta.dy ?? 0;
  const dz = delta.dz ?? 0;
  if (dx === 0 && dy === 0 && dz === 0) return null;

  const moved = selected.map((item) => ({
    ...item,
    x: item.x + dx,
    y: item.y + dy,
    z: item.z + dz,
  }));

  for (const item of moved) {
    if (item.y > 0 && !allowsBeOnTop(item)) return null;
    if (!volumesFitTruck(truck, item)) return null;
  }

  const unselected = placed.filter((item) => !idSet.has(item.id));
  for (const item of moved) {
    if (unselected.some((other) => itemOverlapsItem(item, other))) return null;
  }

  const byId = new Map(moved.map((item) => [item.id, item]));
  return placed.map((item) => byId.get(item.id) ?? item);
}

export function tryNudgePlacedItem(
  truck: TruckSpec,
  placed: PlacedItem[],
  id: string,
  delta: { dx?: number; dy?: number; dz?: number },
): PlacedItem[] | null {
  return tryNudgePlacedItems(truck, placed, [id], delta);
}

function rotatedItem(item: PlacedItem): PlacedItem | null {
  const width = item.length;
  const length = item.width;
  const palletWidth = item.palletLength;
  const palletLength = item.palletWidth;
  const cargoWidth = item.cargoLength;
  const cargoLength = item.cargoWidth;
  const rotation: 0 | 90 = item.rotation === 0 ? 90 : 0;
  const x = Math.round(item.x + item.width / 2 - width / 2);
  const z = Math.round(item.z + item.length / 2 - length / 2);
  return {
    ...item,
    x,
    z,
    width,
    length,
    palletWidth,
    palletLength,
    cargoWidth,
    cargoLength,
    rotation,
  };
}

function itemsOverlap(a: PlacedItem, b: PlacedItem): boolean {
  return itemOverlapsItem(a, b);
}

/** Rotate every selected unit 90° around its own centre, or reject the whole group. */
export function tryRotatePlacedItems(
  truck: TruckSpec,
  placed: PlacedItem[],
  ids: string[],
): PlacedItem[] | null {
  const idSet = new Set(ids);
  const selected = placed.filter((item) => idSet.has(item.id));
  if (selected.length === 0) return null;

  const moved: PlacedItem[] = [];
  for (const item of selected) {
    const next = rotatedItem(item);
    if (!next) return null;
    if (!volumesFitTruck(truck, next)) {
      return null;
    }
    moved.push(next);
  }

  const unselected = placed.filter((item) => !idSet.has(item.id));
  for (const item of moved) {
    if (unselected.some((other) => itemOverlapsItem(item, other))) {
      return null;
    }
  }

  for (let i = 0; i < moved.length; i++) {
    for (let j = i + 1; j < moved.length; j++) {
      if (itemsOverlap(moved[i], moved[j])) return null;
    }
  }

  const byId = new Map(moved.map((item) => [item.id, item]));
  return placed.map((item) => byId.get(item.id) ?? item);
}

export function tryRotatePlacedItem(
  truck: TruckSpec,
  placed: PlacedItem[],
  id: string,
): PlacedItem[] | null {
  return tryRotatePlacedItems(truck, placed, [id]);
}

function uniqueTargets(targets: PlacementTarget[]): PlacementTarget[] {
  const seen = new Set<string>();
  const unique: PlacementTarget[] = [];
  for (const target of targets) {
    const key = `${target.x}:${target.y}:${target.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

/** Treat 1–2 mm of contact as a touch, not a collision, so flush neighbours stay valid. */
const FLOOR_CLEARANCE_MM = 2;

function overlapsFloorFootprint(
  floorItems: PlacedItem[],
  x: number,
  z: number,
  width: number,
  length: number,
): boolean {
  return floorItems.some(
    (item) =>
      item.x < x + width - FLOOR_CLEARANCE_MM &&
      item.x + item.width > x + FLOOR_CLEARANCE_MM &&
      item.z < z + length - FLOOR_CLEARANCE_MM &&
      item.z + item.length > z + FLOOR_CLEARANCE_MM,
  );
}

/** Tile the bed with the moving pallet's current footprint; skip occupied floor cells. */
export function findFloorPlacementTargets(
  truck: TruckSpec,
  placed: PlacedItem[],
  item: PlacedItem,
): PlacementTarget[] {
  const stepX = Math.max(1, Math.round(item.width));
  const stepZ = Math.max(1, Math.round(item.length));
  const maxX = truck.innerWidth - item.width;
  const maxZ = truck.innerLength - item.length;
  if (maxX < 0 || maxZ < 0) return [];

  const floorOthers = othersOf(placed, item.id).filter((entry) => entry.y === 0);
  const targets: PlacementTarget[] = [];

  for (let z = 0; z <= maxZ; z += stepZ) {
    for (let x = 0; x <= maxX; x += stepX) {
      if (x < 0 || z < 0 || x + item.width > truck.innerWidth || z + item.length > truck.innerLength) {
        continue;
      }
      if (overlapsFloorFootprint(floorOthers, x, z, item.width, item.length)) continue;
      targets.push({ x, y: 0, z });
    }
  }

  return uniqueTargets(targets);
}

/** Stack targets sit on the lower pallet footprint, not the cargo box. */
export function findStackPlacementTargets(
  truck: TruckSpec,
  placed: PlacedItem[],
  item: PlacedItem,
): PlacementTarget[] {
  if (!allowsBeOnTop(item)) return [];

  const others = othersOf(placed, item.id);
  const incomingHeight = occupyHeight(item.height);
  const targets: PlacementTarget[] = [];

  for (const support of others) {
    if (!allowsSupportTop(support)) continue;
    if (item.palletWidth > support.palletWidth || item.palletLength > support.palletLength) continue;

    const base = palletBaseRect(support);
    const y = support.y + occupyHeight(support.height);
    if (y + incomingHeight > truck.innerHeight) continue;

    const x = Math.round(base.x - (item.width - item.palletWidth) / 2);
    const z = Math.round(base.z - (item.length - item.palletLength) / 2);
    const preview = { ...item, x, y, z };
    if (!volumesFitTruck(truck, preview)) continue;
    if (others.some((other) => other.id !== support.id && itemOverlapsItem(preview, other))) {
      continue;
    }
    targets.push({ x, y, z });
  }

  return uniqueTargets(targets);
}

export function tryMovePlacedItemTo(
  truck: TruckSpec,
  placed: PlacedItem[],
  id: string,
  target: PlacementTarget,
): PlacedItem[] | null {
  const item = placed.find((entry) => entry.id === id);
  if (!item) return null;
  if (target.y > 0 && !allowsBeOnTop(item)) return null;

  const others = othersOf(placed, id);
  const next = { ...item, x: target.x, y: target.y, z: target.z };
  if (!volumesFitTruck(truck, next)) return null;

  const support =
    target.y === 0
      ? undefined
      : others.find((other) => other.y + occupyHeight(other.height) === target.y);
  if (others.some((other) => other !== support && itemOverlapsItem(next, other))) return null;

  return replaceItem(placed, id, next);
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
    canSupportTop: true,
    canBeOnTop: true,
    color: "#10b981",
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
