import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Calculator,
  Camera,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  Moon,
  Package,
  Plus,
  ScanBox,
  Settings,
  Sun,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import TruckCanvas, { type TruckCanvasHandle } from "./TruckCanvas";
import {
  packTruck,
  findFloorPlacementTargets,
  findStackPlacementTargets,
  tryMovePlacedItemTo,
  tryNudgePlacedItems,
  tryRotatePlacedItems,
  updatePlacedItems,
  type CargoItem,
  type PackingResult,
  type PlacementTarget,
  type TruckSpec,
} from "../lib/packer";
import {
  CARGO_KEY,
  DEFAULT_CARGO_PRESETS,
  DEFAULT_PALLETS,
  DEFAULT_TRUCKS,
  isCargoList,
  isPalletList,
  isTruckList,
  loadPresets,
  newPresetId,
  PALLETS_KEY,
  TRUCKS_KEY,
  type CargoPreset,
  type PalletPreset,
  type PresetBundle,
} from "../lib/presets";
import { applyTheme, loadTheme, saveTheme, type Theme } from "../lib/theme";

interface QueueEntry {
  id: string;
  name: string;
  palletWidth: number;
  palletLength: number;
  cargoWidth: number;
  cargoLength: number;
  height: number;
  canBeOnTop: boolean;
  canSupportTop: boolean;
  quantity: number;
}

const percentFormat = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const fieldBaseClass =
  "h-10 w-full rounded-lg border border-slate-200 px-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700";

const labelClass =
  "mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400";

const cardClass =
  "max-w-full overflow-x-clip rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

const panelClass =
  "rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50";

const addToLoadButtonClass =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-transparent bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 md:ml-auto md:w-auto md:flex-1 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700";

const calculateButtonClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#9ed843] px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-sm transition-all hover:bg-[#8ec738] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:hover:bg-slate-100 disabled:active:scale-100 dark:disabled:bg-slate-800/50 dark:disabled:text-slate-500 dark:disabled:hover:bg-slate-800/50";

const outlineButtonClass =
  "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800";

const smallButtonClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800";

const headingIconClass = "h-4 w-4 text-slate-500 dark:text-slate-400";

const mutedClass = "text-slate-400 dark:text-slate-500";

/** A field left blank keeps its last usable number, so queued cargo is never zero-sized. */
function usableSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function isPositiveSize(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Disabled colours are picked here rather than stacked as variants, to keep the cascade unambiguous. */
function fieldClass(disabled = false): string {
  return clsx(
    fieldBaseClass,
    disabled
      ? "bg-slate-50 text-slate-500 dark:bg-slate-900/60 dark:text-slate-500"
      : "bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100",
  );
}

function PresetSelect({
  value,
  onChange,
  disabled = false,
  children,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("relative", className)}>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(fieldClass(disabled), "appearance-none bg-none pr-10")}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        aria-hidden
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 10,
  suffix = "mm",
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  // While editing, the field owns its text so it can be emptied. `null` means "mirror the prop".
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (Number.isFinite(value) ? String(value) : "");

  const handleChange = (raw: string) => {
    setDraft(raw);
    const parsed = Number(raw);
    // An empty or half-typed value leaves the last usable number upstream.
    if (raw !== "" && Number.isFinite(parsed)) onChange(parsed);
  };

  const handleBlur = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) onChange(min);
    setDraft(null);
  };

  return (
    <label className="block min-w-0">
      <span className={clsx(labelClass, "leading-tight")}>{label}</span>
      <div className="relative min-w-0">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          step={step}
          disabled={disabled}
          placeholder={String(min)}
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
          className={clsx(fieldClass(disabled), "min-w-0", suffix && "pr-10")}
        />
        {suffix ? (
          <span
            className={clsx(
              "pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs",
              mutedClass,
            )}
          >
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

function StackChip({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "flex min-h-10 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-lg border px-2.5 text-center text-xs leading-tight transition-colors md:h-10 md:gap-1.5 md:px-3 md:whitespace-nowrap",
        checked
          ? "border-[#9ed843]/40 bg-[#9ed843]/15 font-medium text-[#9ed843]"
          : "border-slate-200 bg-slate-100 text-slate-500 hover:border-slate-300 dark:border-slate-700/60 dark:bg-[#1a2433] dark:text-slate-400 dark:hover:border-slate-600",
        className,
      )}
    >
      {checked ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} /> : null}
      <span className="min-w-0 text-balance">{label}</span>
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-sm dark:border-slate-800 dark:bg-slate-900/50"
    >
      <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <span
        className={clsx(
          "relative h-6 w-10 shrink-0 rounded-full transition",
          checked ? "bg-slate-900 dark:bg-slate-200" : "bg-slate-300 dark:bg-slate-700",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition dark:bg-slate-950",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

export default function PackingDashboard() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  const [trucks, setTrucks] = useState<TruckSpec[]>(() =>
    loadPresets(TRUCKS_KEY, DEFAULT_TRUCKS, isTruckList),
  );
  const [pallets, setPallets] = useState<PalletPreset[]>(() =>
    loadPresets(PALLETS_KEY, DEFAULT_PALLETS, isPalletList),
  );
  const [cargoPresets, setCargoPresets] = useState<CargoPreset[]>(() =>
    loadPresets(CARGO_KEY, DEFAULT_CARGO_PRESETS, isCargoList),
  );

  const [selectedTruckId, setSelectedTruckId] = useState(() => trucks[0]?.id ?? "");
  const [customTruck, setCustomTruck] = useState(trucks.length === 0);
  const [truckWidth, setTruckWidth] = useState(trucks[0]?.innerWidth ?? 2440);
  const [truckLength, setTruckLength] = useState(trucks[0]?.innerLength ?? 13600);
  const [truckHeight, setTruckHeight] = useState(trucks[0]?.innerHeight ?? 2700);

  const [selectedPalletId, setSelectedPalletId] = useState(pallets[0]?.id ?? "custom");
  const [selectedCargoId, setSelectedCargoId] = useState("custom");
  const [palletWidth, setPalletWidth] = useState(pallets[0]?.width ?? 800);
  const [palletLength, setPalletLength] = useState(pallets[0]?.length ?? 1200);
  const [cargoWidth, setCargoWidth] = useState(pallets[0]?.width ?? 800);
  const [cargoLength, setCargoLength] = useState(pallets[0]?.length ?? 1200);
  const [cargoHeight, setCargoHeight] = useState(1400);
  const [canBeOnTop, setCanBeOnTop] = useState(true);
  const [canSupportTop, setCanSupportTop] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [cargoSaveOpen, setCargoSaveOpen] = useState(false);
  const [cargoSaveName, setCargoSaveName] = useState("");
  const [cargoSaveError, setCargoSaveError] = useState("");
  const cargoSaveInputRef = useRef<HTMLInputElement>(null);

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [result, setResult] = useState<PackingResult | null>(null);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [placementMode, setPlacementMode] = useState<"floor" | "stack" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<TruckCanvasHandle>(null);
  const resultRef = useRef(result);
  resultRef.current = result;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(TRUCKS_KEY, JSON.stringify(trucks));
  }, [trucks]);

  useEffect(() => {
    localStorage.setItem(PALLETS_KEY, JSON.stringify(pallets));
  }, [pallets]);

  useEffect(() => {
    localStorage.setItem(CARGO_KEY, JSON.stringify(cargoPresets));
  }, [cargoPresets]);

  useEffect(() => {
    if (!cargoSaveOpen) return;
    cargoSaveInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCargoSaveOpen(false);
        setCargoSaveName("");
        setCargoSaveError("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cargoSaveOpen]);

  useEffect(() => {
    if (result) return;
    setSelectedUnitIds((ids) => (ids.length === 0 ? ids : []));
    setPlacementMode((mode) => (mode === null ? mode : null));
  }, [result]);

  const changeTheme = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };

  const selectedTruck = useMemo(
    () => trucks.find((truck) => truck.id === selectedTruckId),
    [trucks, selectedTruckId],
  );

  const applyTruckPreset = useCallback((truck: TruckSpec | undefined) => {
    if (!truck) return;
    setSelectedTruckId(truck.id);
    setTruckWidth(truck.innerWidth);
    setTruckLength(truck.innerLength);
    setTruckHeight(truck.innerHeight);
    setResult(null);
  }, []);

  const applyPalletPreset = useCallback((pallet: PalletPreset) => {
    setSelectedPalletId(pallet.id);
    setPalletWidth(pallet.width);
    setPalletLength(pallet.length);
    setCargoWidth(pallet.width);
    setCargoLength(pallet.length);
    setSelectedCargoId("custom");
  }, []);

  const applyCargoPreset = useCallback(
    (preset: CargoPreset) => {
      setSelectedCargoId(preset.id);
      setPalletLength(preset.palletLength);
      setPalletWidth(preset.palletWidth);
      setCargoLength(preset.cargoLength);
      setCargoWidth(preset.cargoWidth);
      setCargoHeight(preset.cargoHeight);
      setCanBeOnTop(preset.defaultCanBeOnTop);
      setCanSupportTop(preset.defaultCanSupportTop);
      const matchingPallet = pallets.find(
        (pallet) => pallet.length === preset.palletLength && pallet.width === preset.palletWidth,
      );
      setSelectedPalletId(matchingPallet?.id ?? "custom");
    },
    [pallets],
  );

  const markCargoCustom = () => setSelectedCargoId("custom");

  const onTruckSelect = (id: string) => {
    const truck = trucks.find((item) => item.id === id);
    setSelectedTruckId(id);
    setResult(null);
    if (truck && !customTruck) applyTruckPreset(truck);
  };

  const onPalletSelect = (id: string) => {
    if (id === "custom") {
      setSelectedPalletId("custom");
      markCargoCustom();
      return;
    }
    const pallet = pallets.find((item) => item.id === id);
    if (pallet) applyPalletPreset(pallet);
  };

  const onCargoSelect = (id: string) => {
    if (id === "custom") {
      setSelectedCargoId("custom");
      return;
    }
    const preset = cargoPresets.find((item) => item.id === id);
    if (preset) applyCargoPreset(preset);
  };

  const cancelCargoSave = () => {
    setCargoSaveOpen(false);
    setCargoSaveName("");
    setCargoSaveError("");
  };

  const confirmCargoSave = () => {
    const name = cargoSaveName.trim();
    if (!name) {
      setCargoSaveError("Zadejte název předvolby.");
      return;
    }
    if (
      ![palletLength, palletWidth, cargoLength, cargoWidth, cargoHeight].every(isPositiveSize)
    ) {
      setCargoSaveError("Rozměry musí být kladná čísla.");
      return;
    }
    const preset: CargoPreset = {
      id: newPresetId("cargo"),
      name,
      palletLength: usableSize(palletLength),
      palletWidth: usableSize(palletWidth),
      cargoLength: usableSize(cargoLength),
      cargoWidth: usableSize(cargoWidth),
      cargoHeight: usableSize(cargoHeight),
      defaultCanBeOnTop: canBeOnTop,
      defaultCanSupportTop: canSupportTop,
    };
    setCargoPresets((current) => [...current, preset]);
    setSelectedCargoId(preset.id);
    cancelCargoSave();
  };

  const addToLoad = () => {
    const qty = Math.max(1, Math.floor(quantity) || 1);
    const cargo = cargoPresets.find((item) => item.id === selectedCargoId);
    const pallet = pallets.find((item) => item.id === selectedPalletId);
    const name =
      cargo && selectedCargoId !== "custom"
        ? cargo.name
        : pallet && selectedPalletId !== "custom"
          ? pallet.name
          : "Vlastní paleta";
    setQueue((current) => [
      ...current,
      {
        id: `load-${crypto.randomUUID()}`,
        name,
        palletWidth: usableSize(palletWidth),
        palletLength: usableSize(palletLength),
        cargoWidth: usableSize(cargoWidth),
        cargoLength: usableSize(cargoLength),
        height: usableSize(cargoHeight),
        canBeOnTop,
        canSupportTop,
        quantity: qty,
      },
    ]);
    setResult(null);
  };

  const removeFromLoad = (id: string) => {
    setQueue((current) => current.filter((entry) => entry.id !== id));
    setResult(null);
  };

  const activeTruck: TruckSpec = {
    id: customTruck ? "custom-truck" : (selectedTruck?.id ?? "custom-truck"),
    name: customTruck ? "Vlastní vozidlo" : (selectedTruck?.name ?? "Vlastní vozidlo"),
    innerWidth: truckWidth,
    innerLength: truckLength,
    innerHeight: truckHeight,
    maxWeight: customTruck ? undefined : selectedTruck?.maxWeight,
  };

  const calculateLoad = () => {
    const items: CargoItem[] = queue.flatMap((entry) =>
      Array.from({ length: entry.quantity }, (_, index) => ({
        id: `${entry.id}-${index + 1}`,
        sourceId: entry.id,
        unitNumber: index + 1,
        name: entry.name,
        palletWidth: entry.palletWidth,
        palletLength: entry.palletLength,
        cargoWidth: entry.cargoWidth,
        cargoLength: entry.cargoLength,
        height: entry.height,
        canBeOnTop: entry.canBeOnTop,
        canSupportTop: entry.canSupportTop,
      })),
    );
    setResult(packTruck(activeTruck, items));
    setSelectedUnitIds([]);
    setPlacementMode(null);
  };

  const liveSelectedIds = useMemo(
    () => selectedUnitIds.filter((id) => result?.placed.some((item) => item.id === id)),
    [selectedUnitIds, result],
  );

  const placementTargets = useMemo<PlacementTarget[]>(() => {
    if (!result || !placementMode || liveSelectedIds.length !== 1) return [];
    const item = result.placed.find((entry) => entry.id === liveSelectedIds[0]);
    if (!item) return [];
    return placementMode === "floor"
      ? findFloorPlacementTargets(activeTruck, result.placed, item)
      : findStackPlacementTargets(activeTruck, result.placed, item);
  }, [result, placementMode, liveSelectedIds, activeTruck]);

  const cancelPlacement = () => setPlacementMode(null);

  const startPlacement = (mode: "floor" | "stack") => {
    if (liveSelectedIds.length !== 1) return;
    const item = result?.placed.find((entry) => entry.id === liveSelectedIds[0]);
    if (mode === "stack" && item?.canBeOnTop === false) return;
    setPlacementMode((current) => (current === mode ? null : mode));
  };

  const selectPlacementTarget = (target: PlacementTarget) => {
    const current = resultRef.current;
    const id = liveSelectedIds[0];
    if (!current || !id) return;
    const next = tryMovePlacedItemTo(activeTruck, current.placed, id, target);
    if (!next) return;
    const updated = updatePlacedItems(activeTruck, current, next);
    resultRef.current = updated;
    setResult(updated);
    setPlacementMode(null);
  };

  const nudgeSelected = (ids: string[], delta: { dx?: number; dy?: number; dz?: number }): boolean => {
    const current = resultRef.current;
    if (!current) return false;
    const next = tryNudgePlacedItems(activeTruck, current.placed, ids, delta);
    if (!next) return false;
    const updated = updatePlacedItems(activeTruck, current, next);
    resultRef.current = updated;
    setResult(updated);
    return true;
  };

  const rotateSelected = (ids: string[]) => {
    setResult((current) => {
      if (!current) return current;
      const next = tryRotatePlacedItems(activeTruck, current.placed, ids);
      return next ? updatePlacedItems(activeTruck, current, next) : current;
    });
  };

  const changeSelectedUnitIds = (ids: string[]) => {
    setSelectedUnitIds(ids);
    if (ids.length !== 1) setPlacementMode(null);
  };

  const queuedCount = queue.reduce((sum, entry) => sum + entry.quantity, 0);

  const placedBySource = useMemo(() => {
    const counts = new Map<string, number>();
    if (!result) return counts;
    for (const item of result.placed) {
      counts.set(item.sourceId, (counts.get(item.sourceId) ?? 0) + 1);
    }
    return counts;
  }, [result]);

  const exportPresets = () => {
    const payload: PresetBundle = { trucks, pallets, cargo: cargoPresets };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pallet-packer-predvolby.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importPresets = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object") return;
      const data = parsed as Partial<PresetBundle>;
      if (isTruckList(data.trucks)) {
        setTrucks(data.trucks);
        const first = data.trucks[0];
        if (first && !customTruck) applyTruckPreset(first);
      }
      if (isPalletList(data.pallets)) {
        setPallets(data.pallets);
        const first = data.pallets[0];
        if (first) applyPalletPreset(first);
      }
      if (isCargoList(data.cargo)) {
        setCargoPresets(data.cargo);
        setSelectedCargoId("custom");
      }
    } catch {
      /* neplatný JSON ignorujeme */
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h1 className="text-2xl font-bold tracking-tight">
              <span>
                paketo<span className="text-[#9ed843]">.group</span>
              </span>
            </h1>
            <span className="hidden text-slate-300 sm:inline dark:text-slate-700" aria-hidden>
              |
            </span>
            <p className="text-sm text-slate-500 dark:text-slate-400">Plánovač nakládky</p>
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)} className={outlineButtonClass}>
            <Settings className="h-4 w-4" />
            Nastavení
          </button>
        </header>

        <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-stretch">
          <section className={clsx(cardClass, "flex h-full flex-col lg:col-span-4")}>
            <div className="mb-4 flex items-center gap-2">
              <Truck className={headingIconClass} />
              <h2 className="text-sm font-semibold">Vozidlo</h2>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-3.5">
                <label className="block">
                  <span className={labelClass}>Předvolba</span>
                  <PresetSelect
                    value={selectedTruckId}
                    onChange={onTruckSelect}
                    disabled={customTruck || trucks.length === 0}
                  >
                    {trucks.length === 0 ? <option value="">Žádné předvolby</option> : null}
                    {trucks.map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.name}
                      </option>
                    ))}
                  </PresetSelect>
                </label>
                <div>
                  <span className={clsx(labelClass, "invisible")} aria-hidden>
                    Režim
                  </span>
                  <Toggle
                    label="Vlastní rozměry"
                    checked={customTruck}
                    onChange={(next) => {
                      setCustomTruck(next);
                      setResult(null);
                      if (!next && selectedTruck) applyTruckPreset(selectedTruck);
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <NumberField
                    label="Délka"
                    value={truckLength}
                    onChange={(value) => {
                      setTruckLength(value);
                      setResult(null);
                    }}
                    disabled={!customTruck}
                  />
                  <NumberField
                    label="Šířka"
                    value={truckWidth}
                    onChange={(value) => {
                      setTruckWidth(value);
                      setResult(null);
                    }}
                    disabled={!customTruck}
                  />
                  <NumberField
                    label="Výška"
                    value={truckHeight}
                    onChange={(value) => {
                      setTruckHeight(value);
                      setResult(null);
                    }}
                    disabled={!customTruck}
                  />
                </div>
              </div>
              <div className="mt-auto flex items-end pt-4">
                <p
                  className={clsx(
                    "flex h-10 items-center text-xs",
                    mutedClass,
                    !customTruck &&
                      "rounded-lg border border-slate-200/80 bg-slate-50 px-3 dark:border-slate-700/60 dark:bg-slate-800/50",
                  )}
                >
                  {!customTruck
                    ? `Používají se vnitřní rozměry předvolby ${selectedTruck?.name ?? "—"}.`
                    : null}
                </p>
              </div>
            </div>
          </section>

          <section className={clsx(cardClass, "flex h-full flex-col lg:col-span-8")}>
            <div className="mb-4 flex items-center gap-2">
              <Package className={headingIconClass} />
              <h2 className="text-sm font-semibold">Náklad</h2>
            </div>
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex flex-col gap-3.5">
                <div>
                  <span className={labelClass}>Předvolba nákladu</span>
                  <div className="flex items-center gap-2">
                    <PresetSelect
                      value={selectedCargoId}
                      onChange={onCargoSelect}
                      className="min-w-0 flex-1"
                    >
                      <option value="custom">Vlastní náklad / Bez předvolby</option>
                      {cargoPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </PresetSelect>
                    <button
                      type="button"
                      title="Uložit aktuální rozměry jako předvolbu"
                      aria-label="Uložit aktuální rozměry jako předvolbu"
                      aria-expanded={cargoSaveOpen}
                      onClick={() => {
                        if (cargoSaveOpen) {
                          cancelCargoSave();
                          return;
                        }
                        setCargoSaveOpen(true);
                        setCargoSaveError("");
                      }}
                      className={clsx(
                        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-sm transition",
                        cargoSaveOpen
                          ? "border-[#9ed843]/40 bg-[#9ed843]/15 text-[#9ed843]"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800",
                      )}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  {cargoSaveOpen ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        ref={cargoSaveInputRef}
                        value={cargoSaveName}
                        onChange={(event) => {
                          setCargoSaveName(event.target.value);
                          if (cargoSaveError) setCargoSaveError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            confirmCargoSave();
                          }
                        }}
                        placeholder="Karton A4 na EUR"
                        aria-label="Název předvolby nákladu"
                        className={clsx(fieldClass(), "flex-1")}
                      />
                      <button
                        type="button"
                        title="Uložit"
                        aria-label="Uložit předvolbu"
                        onClick={confirmCargoSave}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#9ed843]/40 bg-[#9ed843]/15 text-[#9ed843] transition hover:bg-[#9ed843]/25"
                      >
                        <Check className="h-4 w-4" strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        title="Zrušit"
                        aria-label="Zrušit ukládání"
                        onClick={cancelCargoSave}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                  {cargoSaveError ? (
                    <p className="mt-1.5 text-xs font-medium text-rose-500 dark:text-rose-400">
                      {cargoSaveError}
                    </p>
                  ) : null}
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="md:col-span-2">
                    <span className={labelClass}>Předvolba palety</span>
                    <PresetSelect value={selectedPalletId} onChange={onPalletSelect}>
                      {pallets.map((pallet) => (
                        <option key={pallet.id} value={pallet.id}>
                          {pallet.name} ({pallet.length} × {pallet.width})
                        </option>
                      ))}
                      <option value="custom">Vlastní paleta</option>
                    </PresetSelect>
                  </label>
                  <NumberField
                    label="Délka palety"
                    value={palletLength}
                    onChange={(value) => {
                      setPalletLength(value);
                      setSelectedPalletId("custom");
                      markCargoCustom();
                    }}
                  />
                  <NumberField
                    label="Šířka palety"
                    value={palletWidth}
                    onChange={(value) => {
                      setPalletWidth(value);
                      setSelectedPalletId("custom");
                      markCargoCustom();
                    }}
                  />
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-3 min-[520px]:grid-cols-3">
                  <NumberField
                    label="Délka nákladu"
                    value={cargoLength}
                    onChange={(value) => {
                      setCargoLength(value);
                      markCargoCustom();
                    }}
                  />
                  <NumberField
                    label="Šířka nákladu"
                    value={cargoWidth}
                    onChange={(value) => {
                      setCargoWidth(value);
                      markCargoCustom();
                    }}
                  />
                  <NumberField
                    label="Výška nákladu"
                    value={cargoHeight}
                    onChange={(value) => {
                      setCargoHeight(value);
                      markCargoCustom();
                    }}
                  />
                </div>
              </div>
              <div className="mt-auto flex w-full min-w-0 flex-col gap-2.5 pt-4 md:flex-row md:items-end md:gap-2">
                <div className="flex w-full min-w-0 flex-wrap items-end gap-2 md:w-auto md:flex-nowrap">
                  <div className="w-24 shrink-0">
                    <NumberField
                      label="Počet"
                      value={quantity}
                      onChange={setQuantity}
                      min={1}
                      step={1}
                      suffix=""
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-nowrap items-stretch gap-2 md:flex-none">
                    <StackChip
                      className="flex-1 md:flex-none"
                      label="Může do stohu"
                      checked={canBeOnTop}
                      onChange={(next) => {
                        setCanBeOnTop(next);
                        markCargoCustom();
                      }}
                    />
                    <StackChip
                      className="flex-1 md:flex-none"
                      label="Lze na ni stohovat"
                      checked={canSupportTop}
                      onChange={(next) => {
                        setCanSupportTop(next);
                        markCargoCustom();
                      }}
                    />
                  </div>
                </div>
                <button type="button" onClick={addToLoad} className={addToLoadButtonClass}>
                  <Plus className="h-4 w-4" />
                  Přidat do nákladu
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <section className={clsx(cardClass, "lg:col-span-5")}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className={headingIconClass} />
                <h2 className="text-sm font-semibold">Seznam nákladu</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {queuedCount} ks
              </span>
            </div>

            <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
              {queue.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 p-6 dark:border-slate-800">
                  <ClipboardList className="h-7 w-7 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    V nákladu zatím nic není
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Přidejte palety pomocí formuláře vpravo
                  </p>
                </div>
              ) : (
                queue.map((entry) => {
                  const placedCount = placedBySource.get(entry.id) ?? 0;
                  const unplaced = entry.quantity - placedCount;
                  return (
                  <div
                    key={entry.id}
                    className={clsx(panelClass, "flex items-start justify-between gap-3 px-3 py-2.5")}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{entry.name}</p>
                      <div className="my-1.5 space-y-1">
                        <ManifestDimRow
                          label="Paleta"
                          length={entry.palletLength}
                          width={entry.palletWidth}
                        />
                        <ManifestDimRow
                          label="Náklad"
                          length={entry.cargoLength}
                          width={entry.cargoWidth}
                          height={entry.height}
                        />
                      </div>
                      <p className={clsx("mt-1 text-xs", mutedClass)}>
                        Počet {entry.quantity}
                        {entry.canBeOnTop ? " · Může do stohu" : " · Jen na podlaze"}
                        {entry.canSupportTop ? " · Lze na ni stohovat" : " · Nelze na ni stohovat"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => removeFromLoad(entry.id)}
                        aria-label="Odebrat"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {result && unplaced > 0 ? (
                        <span className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-right text-xs font-semibold text-rose-500 dark:text-rose-400">
                          ✕ Nevejde se: {unplaced} ks
                        </span>
                      ) : null}
                    </div>
                  </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={calculateLoad}
              disabled={queue.length === 0 || truckWidth <= 0 || truckLength <= 0 || truckHeight <= 0}
              className={clsx(calculateButtonClass, "mt-4")}
            >
              <Calculator className="h-4 w-4" />
              Vypočítat náklad
            </button>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <ResultStat label="Naloženo" value={result ? String(result.placed.length) : "—"} />
              <ResultStat
                label="Nenaloženo"
                value={result ? String(result.unplaced.length) : "—"}
                alert={Boolean(result && result.unplaced.length > 0)}
              />
              <ResultStat
                label="Využití podlahy"
                value={result ? `${percentFormat.format(result.floorUtilizationPercent)} %` : "—"}
              />
            </div>
          </section>

          <section className={clsx(cardClass, "flex w-full flex-col lg:col-span-7")}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ScanBox className={headingIconClass} />
                <h2 className="text-sm font-semibold">Náhled nákladu</h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <LegendDot color="#38bdf8" label="Na podlaze" />
                <LegendDot color="#4ade80" label="Ve stohu" />
                <LegendDot color="#fb923c" label="Přesah" />
                <button
                  type="button"
                  onClick={() => canvasRef.current?.downloadSnapshot()}
                  className={smallButtonClass}
                >
                  <Camera className="h-3.5 w-3.5" />
                  Stáhnout snímek
                </button>
              </div>
            </div>
            <div className="h-[min(70vh,560px)] min-h-[360px] w-full">
              <TruckCanvas
                ref={canvasRef}
                truck={activeTruck}
                result={result}
                theme={theme}
                selectedUnitIds={liveSelectedIds}
                onSelectedUnitIdsChange={changeSelectedUnitIds}
                onNudge={nudgeSelected}
                onRotate={rotateSelected}
                placementMode={placementMode}
                placementTargets={placementTargets}
                onStartPlacement={startPlacement}
                onSelectPlacementTarget={selectPlacementTarget}
                onCancelPlacement={cancelPlacement}
              />
            </div>
          </section>
        </div>
        </div>
      </div>

      {settingsOpen ? (
        <SettingsModal
          trucks={trucks}
          pallets={pallets}
          cargoPresets={cargoPresets}
          theme={theme}
          onThemeChange={changeTheme}
          onClose={() => setSettingsOpen(false)}
          onTrucksChange={(next) => {
            setTrucks(next);
            if (next.length === 0) {
              setSelectedTruckId("");
              setCustomTruck(true);
              return;
            }
            const stillSelected = next.find((truck) => truck.id === selectedTruckId) ?? next[0];
            setSelectedTruckId(stillSelected.id);
            if (!customTruck) applyTruckPreset(stillSelected);
          }}
          onPalletsChange={(next) => {
            setPallets(next);
            const stillSelected = next.find((pallet) => pallet.id === selectedPalletId);
            if (stillSelected) applyPalletPreset(stillSelected);
            else if (selectedPalletId !== "custom") setSelectedPalletId("custom");
          }}
          onCargoChange={(next) => {
            setCargoPresets(next);
            const stillSelected = next.find((preset) => preset.id === selectedCargoId);
            if (stillSelected) applyCargoPreset(stillSelected);
            else if (selectedCargoId !== "custom") setSelectedCargoId("custom");
          }}
          onExport={exportPresets}
          onImportClick={() => importRef.current?.click()}
        />
      ) : null}

      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importPresets(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function AxisPrefix({ children }: { children: string }) {
  return <span className="mr-1.5 inline-block font-normal text-slate-500">{children}</span>;
}

function AxisMeasure({
  length,
  width,
  height,
}: {
  length: number;
  width: number;
  height?: number;
}) {
  return (
    <span className="whitespace-nowrap">
      <AxisPrefix>d</AxisPrefix>
      <span className="font-semibold text-slate-800 dark:text-slate-100">{length}</span>
      <span className="mx-1.5 font-normal text-slate-500">×</span>
      <AxisPrefix>š</AxisPrefix>
      <span className="font-semibold text-slate-800 dark:text-slate-100">{width}</span>
      {height !== undefined ? (
        <>
          <span className="mx-1.5 font-normal text-slate-500">×</span>
          <AxisPrefix>v</AxisPrefix>
          <span className="font-semibold text-slate-800 dark:text-slate-100">{height}</span>
        </>
      ) : null}
      <span className="ml-1 text-[11px] font-normal text-slate-400">mm</span>
    </span>
  );
}

function ManifestDimRow({
  label,
  length,
  width,
  height,
}: {
  label: string;
  length: number;
  width: number;
  height?: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-400">
        {label}
      </span>
      <AxisMeasure length={length} width={width} height={height} />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span
        className="h-2.5 w-2.5 rounded-full ring-1 ring-slate-200 dark:ring-slate-700"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function ResultStat({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className={clsx(panelClass, "px-3 py-3")}>
      <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        {label}
      </p>
      <p
        className={clsx(
          "text-xl font-bold",
          alert ? "text-red-500 dark:text-red-400" : "text-slate-800 dark:text-slate-100",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SettingsModal({
  trucks,
  pallets,
  cargoPresets,
  theme,
  onThemeChange,
  onClose,
  onTrucksChange,
  onPalletsChange,
  onCargoChange,
  onExport,
  onImportClick,
}: {
  trucks: TruckSpec[];
  pallets: PalletPreset[];
  cargoPresets: CargoPreset[];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
  onTrucksChange: (trucks: TruckSpec[]) => void;
  onPalletsChange: (pallets: PalletPreset[]) => void;
  onCargoChange: (cargo: CargoPreset[]) => void;
  onExport: () => void;
  onImportClick: () => void;
}) {
  const [tab, setTab] = useState<"trucks" | "pallets" | "cargo">("trucks");
  const [editingTruck, setEditingTruck] = useState<TruckSpec | null>(null);
  const [editingPallet, setEditingPallet] = useState<PalletPreset | null>(null);
  const [editingCargo, setEditingCargo] = useState<CargoPreset | null>(null);
  const isDark = theme === "dark";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm dark:bg-slate-950/70"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold">Nastavení</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Správa předvoleb vozidel, palet a nákladu
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Zavřít
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium">Vzhled</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isDark ? "Aktuálně tmavý režim" : "Aktuálně světlý režim"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onThemeChange(isDark ? "light" : "dark")}
            className={outlineButtonClass}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {isDark ? "Přepnout na světlý" : "Přepnout na tmavý"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <TabButton active={tab === "trucks"} onClick={() => setTab("trucks")}>
            Vozidla
          </TabButton>
          <TabButton active={tab === "pallets"} onClick={() => setTab("pallets")}>
            Palety
          </TabButton>
          <TabButton active={tab === "cargo"} onClick={() => setTab("cargo")}>
            Šablony nákladu
          </TabButton>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onExport} className={smallButtonClass}>
              <Download className="h-3.5 w-3.5" />
              Exportovat předvolby (JSON)
            </button>
            <button type="button" onClick={onImportClick} className={smallButtonClass}>
              <Upload className="h-3.5 w-3.5" />
              Importovat předvolby (JSON)
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {tab === "trucks" ? (
            <PresetEditor
              items={trucks}
              onChange={onTrucksChange}
              editing={editingTruck}
              setEditing={setEditingTruck}
              blank={() => ({
                id: newPresetId("truck"),
                name: "",
                innerWidth: 2400,
                innerLength: 6000,
                innerHeight: 2400,
              })}
              renderFields={(draft, setDraft) => (
                <>
                  <label className="block">
                    <span className={labelClass}>Název</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className={fieldClass()}
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <NumberField
                      label="Délka"
                      value={draft.innerLength}
                      onChange={(innerLength) => setDraft({ ...draft, innerLength })}
                    />
                    <NumberField
                      label="Šířka"
                      value={draft.innerWidth}
                      onChange={(innerWidth) => setDraft({ ...draft, innerWidth })}
                    />
                    <NumberField
                      label="Výška"
                      value={draft.innerHeight}
                      onChange={(innerHeight) => setDraft({ ...draft, innerHeight })}
                    />
                  </div>
                </>
              )}
              summary={(item) =>
                `${item.innerLength} × ${item.innerWidth} × ${item.innerHeight} mm`
              }
            />
          ) : tab === "pallets" ? (
            <PresetEditor
              items={pallets}
              onChange={onPalletsChange}
              editing={editingPallet}
              setEditing={setEditingPallet}
              blank={() => ({
                id: newPresetId("pallet"),
                name: "",
                width: 800,
                length: 1200,
              })}
              renderFields={(draft, setDraft) => (
                <>
                  <label className="block">
                    <span className={labelClass}>Název</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className={fieldClass()}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Délka"
                      value={draft.length}
                      onChange={(length) => setDraft({ ...draft, length })}
                    />
                    <NumberField
                      label="Šířka"
                      value={draft.width}
                      onChange={(width) => setDraft({ ...draft, width })}
                    />
                  </div>
                </>
              )}
              summary={(item) => `${item.length} × ${item.width} mm`}
            />
          ) : (
            <PresetEditor
              items={cargoPresets}
              onChange={onCargoChange}
              editing={editingCargo}
              setEditing={setEditingCargo}
              canSave={(draft) =>
                draft.name.trim().length > 0 &&
                [
                  draft.palletLength,
                  draft.palletWidth,
                  draft.cargoLength,
                  draft.cargoWidth,
                  draft.cargoHeight,
                ].every(isPositiveSize)
              }
              blank={() => ({
                id: newPresetId("cargo"),
                name: "",
                palletLength: 1200,
                palletWidth: 800,
                cargoLength: 1200,
                cargoWidth: 800,
                cargoHeight: 1400,
                defaultCanBeOnTop: true,
                defaultCanSupportTop: true,
              })}
              renderFields={(draft, setDraft) => (
                <>
                  <label className="block">
                    <span className={labelClass}>Název</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className={fieldClass()}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Délka palety"
                      value={draft.palletLength}
                      onChange={(palletLength) => setDraft({ ...draft, palletLength })}
                      min={1}
                    />
                    <NumberField
                      label="Šířka palety"
                      value={draft.palletWidth}
                      onChange={(palletWidth) => setDraft({ ...draft, palletWidth })}
                      min={1}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumberField
                      label="Délka nákladu"
                      value={draft.cargoLength}
                      onChange={(cargoLength) => setDraft({ ...draft, cargoLength })}
                      min={1}
                    />
                    <NumberField
                      label="Šířka nákladu"
                      value={draft.cargoWidth}
                      onChange={(cargoWidth) => setDraft({ ...draft, cargoWidth })}
                      min={1}
                    />
                    <NumberField
                      label="Výška nákladu"
                      value={draft.cargoHeight}
                      onChange={(cargoHeight) => setDraft({ ...draft, cargoHeight })}
                      min={1}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Toggle
                      label="Může do stohu"
                      checked={draft.defaultCanBeOnTop}
                      onChange={(defaultCanBeOnTop) => setDraft({ ...draft, defaultCanBeOnTop })}
                    />
                    <Toggle
                      label="Lze na ni stohovat"
                      checked={draft.defaultCanSupportTop}
                      onChange={(defaultCanSupportTop) =>
                        setDraft({ ...draft, defaultCanSupportTop })
                      }
                    />
                  </div>
                </>
              )}
              summary={(item) => {
                const stackBits = [
                  item.defaultCanBeOnTop ? "Může do stohu" : "Jen na podlaze",
                  item.defaultCanSupportTop ? "Lze na ni stohovat" : "Nelze na ni stohovat",
                ];
                return `d ${item.cargoLength} × š ${item.cargoWidth} × v ${item.cargoHeight} mm · ${stackBits.join(" · ")}`;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3 py-1.5 text-sm font-medium transition",
        active
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
      )}
    >
      {children}
    </button>
  );
}

function PresetEditor<T extends { id: string; name: string }>({
  items,
  onChange,
  editing,
  setEditing,
  blank,
  renderFields,
  summary,
  canSave,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  editing: T | null;
  setEditing: (item: T | null) => void;
  blank: () => T;
  renderFields: (draft: T, setDraft: (item: T) => void) => ReactNode;
  summary: (item: T) => string;
  canSave?: (draft: T) => boolean;
}) {
  const isNew = editing ? !items.some((item) => item.id === editing.id) : false;

  const save = () => {
    if (!editing) return;
    const allowed = canSave ? canSave(editing) : Boolean(editing.name.trim());
    if (!allowed) return;
    const next = isNew
      ? [...items, { ...editing, name: editing.name.trim() }]
      : items.map((item) =>
          item.id === editing.id ? { ...editing, name: editing.name.trim() } : item,
        );
    onChange(next);
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
          >
            <div>
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{summary(item)}</p>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setEditing(item)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Upravit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Opravdu smazat předvolbu „${item.name}“?`)) return;
                  onChange(items.filter((entry) => entry.id !== item.id));
                  if (editing?.id === item.id) setEditing(null);
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                Smazat
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 ? (
          <p className={clsx("text-sm", mutedClass)}>Žádné předvolby. Přidejte novou níže.</p>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-sm font-medium">
            {isNew ? "Přidat předvolbu" : "Upravit předvolbu"}
          </p>
          {renderFields(editing, setEditing)}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              Uložit
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(blank())}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          Přidat předvolbu
        </button>
      )}
    </div>
  );
}
