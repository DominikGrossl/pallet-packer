import type { TruckSpec } from "./packer";

export interface PalletPreset {
  id: string;
  name: string;
  width: number;
  length: number;
}

export interface CargoPreset {
  id: string;
  name: string;
  palletLength: number;
  palletWidth: number;
  cargoLength: number;
  cargoWidth: number;
  cargoHeight: number;
  defaultCanBeOnTop: boolean;
  defaultCanSupportTop: boolean;
}

export interface PresetBundle {
  trucks: TruckSpec[];
  pallets: PalletPreset[];
  cargo?: CargoPreset[];
}

export const TRUCKS_KEY = "pallet-packer:trucks";
export const PALLETS_KEY = "pallet-packer:pallets";
export const CARGO_KEY = "paketo_cargo_presets";

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

export const DEFAULT_CARGO_PRESETS: CargoPreset[] = [
  {
    id: "cargo-eur-carton-1400",
    name: "Karton EUR 1400 mm",
    palletLength: 1200,
    palletWidth: 800,
    cargoLength: 1200,
    cargoWidth: 800,
    cargoHeight: 1400,
    defaultCanBeOnTop: true,
    defaultCanSupportTop: true,
  },
  {
    id: "cargo-eur-carton-1000",
    name: "Karton EUR 1000 mm",
    palletLength: 1200,
    palletWidth: 800,
    cargoLength: 1200,
    cargoWidth: 800,
    cargoHeight: 1000,
    defaultCanBeOnTop: true,
    defaultCanSupportTop: true,
  },
  {
    id: "cargo-a4-eur",
    name: "Karton A4 na EUR",
    palletLength: 1200,
    palletWidth: 800,
    cargoLength: 430,
    cargoWidth: 310,
    cargoHeight: 250,
    defaultCanBeOnTop: true,
    defaultCanSupportTop: true,
  },
  {
    id: "cargo-eur-heavy",
    name: "Nestohovatelný EUR",
    palletLength: 1200,
    palletWidth: 800,
    cargoLength: 1200,
    cargoWidth: 800,
    cargoHeight: 1800,
    defaultCanBeOnTop: false,
    defaultCanSupportTop: false,
  },
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

export function isCargoList(value: unknown): value is CargoPreset[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.palletLength === "number" &&
        typeof item.palletWidth === "number" &&
        typeof item.cargoLength === "number" &&
        typeof item.cargoWidth === "number" &&
        typeof item.cargoHeight === "number" &&
        typeof item.defaultCanBeOnTop === "boolean" &&
        typeof item.defaultCanSupportTop === "boolean",
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
