import type { TruckSpec } from "./packer";

export interface PalletPreset {
  id: string;
  name: string;
  width: number;
  length: number;
}

export interface PresetBundle {
  trucks: TruckSpec[];
  pallets: PalletPreset[];
}

export const TRUCKS_KEY = "pallet-packer:trucks";
export const PALLETS_KEY = "pallet-packer:pallets";

export const DEFAULT_TRUCKS: TruckSpec[] = [
  {
    id: "box-van-3-5t",
    name: "Dodávka 3,5 t",
    innerWidth: 2000,
    innerLength: 4200,
    innerHeight: 2100,
  },
  {
    id: "rigid-7-5t",
    name: "Nákladní vůz 7,5 t",
    innerWidth: 2400,
    innerLength: 6200,
    innerHeight: 2400,
  },
  {
    id: "semi-13-6m",
    name: "Návěs 13,6 m",
    innerWidth: 2440,
    innerLength: 13600,
    innerHeight: 2700,
  },
];

export const DEFAULT_PALLETS: PalletPreset[] = [
  { id: "eur-1", name: "EUR 1", width: 800, length: 1200 },
  { id: "eur-2", name: "EUR 2", width: 1200, length: 1000 },
  { id: "eur-3", name: "EUR 3", width: 1000, length: 1200 },
];

export function isTruckList(value: unknown): value is TruckSpec[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.innerWidth === "number" &&
        typeof item.innerLength === "number" &&
        typeof item.innerHeight === "number",
    )
  );
}

export function isPalletList(value: unknown): value is PalletPreset[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.width === "number" &&
        typeof item.length === "number",
    )
  );
}

export function loadPresets<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function newPresetId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
