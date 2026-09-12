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

function splitGuillotine(rect: FreeRect, placedWidth: number, placedLength: number): FreeRect[] {
  const leftoverW = rect.width - placedWidth;
  const leftoverL = rect.length - placedLength;
  const next: FreeRect[] = [];

  if (leftoverW >= leftoverL) {
    if (leftoverW > 0) {
      next.push({
        x: rect.x + placedWidth,
        z: rect.z,
        width: leftoverW,
        length: rect.length,
      });
    }
    if (leftoverL > 0) {
      next.push({
        x: rect.x,
        z: rect.z + placedLength,
        width: placedWidth,
        length: leftoverL,
      });
    }
  } else {
    if (leftoverW > 0) {
      next.push({
        x: rect.x + placedWidth,
        z: rect.z,
        width: leftoverW,
        length: placedLength,
      });
    }
    if (leftoverL > 0) {
      next.push({
        x: rect.x,
        z: rect.z + placedLength,
        width: rect.width,
        length: leftoverL,
      });
    }
  }

  return next.filter((r) => r.width > 0 && r.length > 0);
}

function findFloorPlacement(
  freeRects: FreeRect[],
  item: NormalizedItem,
): { rectIndex: number; orientation: Orientation } | null {
  let best: {
    rectIndex: number;
    orientation: Orientation;
    z: number;
    x: number;
    leftoverArea: number;
    shortLeftover: number;
  } | null = null;

  for (let i = 0; i < freeRects.length; i++) {
    const rect = freeRects[i];
    for (const orientation of orientationsOf(item.effectiveWidth, item.effectiveLength)) {
      if (orientation.width > rect.width || orientation.length > rect.length) continue;

      const leftoverArea = rect.width * rect.length - orientation.width * orientation.length;
      const shortLeftover = Math.min(
        rect.width - orientation.width,
        rect.length - orientation.length,
      );
      const candidate = {
        rectIndex: i,
        orientation,
        z: rect.z,
        x: rect.x,
        leftoverArea,
        shortLeftover,
      };

      if (
        !best ||
        candidate.z < best.z ||
        (candidate.z === best.z && candidate.x < best.x) ||
        (candidate.z === best.z &&
          candidate.x === best.x &&
          candidate.leftoverArea < best.leftoverArea) ||
        (candidate.z === best.z &&
          candidate.x === best.x &&
          candidate.leftoverArea === best.leftoverArea &&
          candidate.orientation.length < best.orientation.length) ||
        (candidate.z === best.z &&
          candidate.x === best.x &&
          candidate.leftoverArea === best.leftoverArea &&
          candidate.orientation.length === best.orientation.length &&
          candidate.shortLeftover < best.shortLeftover) ||
        (candidate.z === best.z &&
          candidate.x === best.x &&
          candidate.leftoverArea === best.leftoverArea &&
          candidate.orientation.length === best.orientation.length &&
          candidate.shortLeftover === best.shortLeftover &&
          candidate.orientation.rotation < best.orientation.rotation)
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
    if (slot.y + item.height > truckHeight) continue;

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

function toPlaced(
  item: NormalizedItem,
  x: number,
  y: number,
  z: number,
  orientation: Orientation,
): PlacedItem {
  const turned = orientation.rotation === 90;

  return {
    id: item.source.id,
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

export function packTruck(truck: TruckSpec, items: CargoItem[]): PackingResult {
  const placed: PlacedItem[] = [];
  const unplaced: CargoItem[] = [];
  let totalWeight = 0;

  const freeRects: FreeRect[] = [
    { x: 0, z: 0, width: truck.innerWidth, length: truck.innerLength },
  ];
  const stackSlots: StackSlot[] = [];

  const normalized: NormalizedItem[] = items.map((source) => ({
    source,
    effectiveWidth: Math.max(source.palletWidth, source.cargoWidth),
    effectiveLength: Math.max(source.palletLength, source.cargoLength),
    height: source.height,
    isOverhanging:
      source.cargoWidth > source.palletWidth || source.cargoLength > source.palletLength,
    weight: source.weight ?? 0,
  }));

  const leftover: NormalizedItem[] = [];

  for (const item of normalized) {
    if (item.height > truck.innerHeight || !fitsTruckFloor(item, truck)) {
      unplaced.push(item.source);
      continue;
    }
    if (wouldExceedWeight(truck, totalWeight, item.weight)) {
      unplaced.push(item.source);
      continue;
    }

    const floorFit = findFloorPlacement(freeRects, item);
    if (!floorFit) {
      leftover.push(item);
      continue;
    }

    const rect = freeRects[floorFit.rectIndex];
    const { orientation } = floorFit;
    placed.push(toPlaced(item, rect.x, 0, rect.z, orientation));
    totalWeight += item.weight;

    if (item.source.stackable) {
      stackSlots.push({
        x: rect.x,
        y: item.height,
        z: rect.z,
        width: orientation.width,
        length: orientation.length,
      });
    }

    const split = splitGuillotine(rect, orientation.width, orientation.length);
    freeRects.splice(floorFit.rectIndex, 1, ...split);
  }

  for (const item of leftover) {
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
    placed.push(toPlaced(item, slot.x, slot.y, slot.z, orientation));
    totalWeight += item.weight;

    stackSlots[stackFit.slotIndex] = {
      x: slot.x,
      y: slot.y + item.height,
      z: slot.z,
      width: orientation.width,
      length: orientation.length,
    };
  }

  const floorArea = truck.innerWidth * truck.innerLength;
  const usedFloorArea = placed
    .filter((p) => p.y === 0)
    .reduce((sum, p) => sum + p.width * p.length, 0);
  const floorUtilizationPercent = floorArea > 0 ? (usedFloorArea / floorArea) * 100 : 0;

  return { placed, unplaced, totalWeight, floorUtilizationPercent };
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
