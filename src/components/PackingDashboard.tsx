import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Calculator,
  Camera,
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
} from "lucide-react";
import TruckCanvas, { type TruckCanvasHandle } from "./TruckCanvas";
import {
  packTruck,
  tryNudgePlacedItem,
  tryRotatePlacedItem,
  tryTogglePlacedElevation,
  updatePlacedItems,
  type CargoItem,
  type PackingResult,
  type TruckSpec,
} from "../lib/packer";
import {
  DEFAULT_PALLETS,
  DEFAULT_TRUCKS,
  isPalletList,
  isTruckList,
  loadPresets,
  newPresetId,
  PALLETS_KEY,
  TRUCKS_KEY,
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
  stackable: boolean;
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
  "rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

const panelClass =
  "rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50";

const addToLoadButtonClass =
  "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-transparent bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700";

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

/** Disabled colours are picked here rather than stacked as variants, to keep the cascade unambiguous. */
function fieldClass(disabled = false): string {
  return clsx(
    fieldBaseClass,
    disabled
      ? "bg-slate-50 text-slate-500 dark:bg-slate-900/60 dark:text-slate-500"
      : "bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100",
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
    <label className="block">
      <span className={labelClass}>{label}</span>
      <div className="relative">
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
          className={clsx(fieldClass(disabled), suffix && "pr-10")}
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

  const [selectedTruckId, setSelectedTruckId] = useState(() => trucks[0]?.id ?? "");
  const [customTruck, setCustomTruck] = useState(trucks.length === 0);
  const [truckWidth, setTruckWidth] = useState(trucks[0]?.innerWidth ?? 2440);
  const [truckLength, setTruckLength] = useState(trucks[0]?.innerLength ?? 13600);
  const [truckHeight, setTruckHeight] = useState(trucks[0]?.innerHeight ?? 2700);

  const [selectedPalletId, setSelectedPalletId] = useState(pallets[0]?.id ?? "custom");
  const [palletWidth, setPalletWidth] = useState(pallets[0]?.width ?? 800);
  const [palletLength, setPalletLength] = useState(pallets[0]?.length ?? 1200);
  const [cargoWidth, setCargoWidth] = useState(pallets[0]?.width ?? 800);
  const [cargoLength, setCargoLength] = useState(pallets[0]?.length ?? 1200);
  const [cargoHeight, setCargoHeight] = useState(1400);
  const [stackable, setStackable] = useState(true);
  const [quantity, setQuantity] = useState(1);

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [result, setResult] = useState<PackingResult | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
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
  }, []);

  const onTruckSelect = (id: string) => {
    const truck = trucks.find((item) => item.id === id);
    setSelectedTruckId(id);
    setResult(null);
    if (truck && !customTruck) applyTruckPreset(truck);
  };

  const onPalletSelect = (id: string) => {
    if (id === "custom") {
      setSelectedPalletId("custom");
      return;
    }
    const pallet = pallets.find((item) => item.id === id);
    if (pallet) applyPalletPreset(pallet);
  };

  const addToLoad = () => {
    const qty = Math.max(1, Math.floor(quantity) || 1);
    const pallet = pallets.find((item) => item.id === selectedPalletId);
    const name = pallet && selectedPalletId !== "custom" ? pallet.name : "Vlastní paleta";
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
        stackable,
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
        stackable: entry.stackable,
      })),
    );
    setResult(packTruck(activeTruck, items));
    setSelectedUnitId(null);
  };

  const nudgeSelected = (id: string, delta: { dx?: number; dy?: number; dz?: number }): boolean => {
    const current = resultRef.current;
    if (!current) return false;
    const next = tryNudgePlacedItem(activeTruck, current.placed, id, delta);
    if (!next) return false;
    const updated = updatePlacedItems(activeTruck, current, next);
    resultRef.current = updated;
    setResult(updated);
    return true;
  };

  const rotateSelected = (id: string) => {
    setResult((current) => {
      if (!current) return current;
      const next = tryRotatePlacedItem(activeTruck, current.placed, id);
      return next ? updatePlacedItems(activeTruck, current, next) : current;
    });
  };

  const toggleSelectedElevation = (id: string) => {
    setResult((current) => {
      if (!current) return current;
      const next = tryTogglePlacedElevation(activeTruck, current.placed, id);
      return next ? updatePlacedItems(activeTruck, current, next) : current;
    });
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
    const payload: PresetBundle = { trucks, pallets };
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
            <div className="space-y-4">
              <label className="block">
                <span className={labelClass}>Předvolba</span>
                <select
                  value={selectedTruckId}
                  onChange={(event) => onTruckSelect(event.target.value)}
                  disabled={customTruck || trucks.length === 0}
                  className={fieldClass(customTruck || trucks.length === 0)}
                >
                  {trucks.length === 0 ? <option value="">Žádné předvolby</option> : null}
                  {trucks.map((truck) => (
                    <option key={truck.id} value={truck.id}>
                      {truck.name}
                    </option>
                  ))}
                </select>
              </label>
              <Toggle
                label="Vlastní rozměry"
                checked={customTruck}
                onChange={(next) => {
                  setCustomTruck(next);
                  setResult(null);
                  if (!next && selectedTruck) applyTruckPreset(selectedTruck);
                }}
              />
              <div className="grid grid-cols-3 gap-2">
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
                  label="Délka"
                  value={truckLength}
                  onChange={(value) => {
                    setTruckLength(value);
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
              {!customTruck ? (
                <p className={clsx("text-xs", mutedClass)}>
                  Používají se vnitřní rozměry předvolby {selectedTruck?.name ?? "—"}.
                </p>
              ) : null}
            </div>
          </section>

          <section className={clsx(cardClass, "flex h-full flex-col lg:col-span-8")}>
            <div className="mb-4 flex items-center gap-2">
              <Package className={headingIconClass} />
              <h2 className="text-sm font-semibold">Náklad</h2>
            </div>
            <div className="flex h-full min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <label className="md:col-span-2">
                    <span className={labelClass}>Předvolba palety</span>
                    <select
                      value={selectedPalletId}
                      onChange={(event) => onPalletSelect(event.target.value)}
                      className={fieldClass()}
                    >
                      {pallets.map((pallet) => (
                        <option key={pallet.id} value={pallet.id}>
                          {pallet.name} ({pallet.width} × {pallet.length})
                        </option>
                      ))}
                      <option value="custom">Vlastní paleta</option>
                    </select>
                  </label>
                  <NumberField
                    label="Šířka palety"
                    value={palletWidth}
                    onChange={(value) => {
                      setPalletWidth(value);
                      setSelectedPalletId("custom");
                    }}
                  />
                  <NumberField
                    label="Délka palety"
                    value={palletLength}
                    onChange={(value) => {
                      setPalletLength(value);
                      setSelectedPalletId("custom");
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <NumberField label="Šířka nákladu" value={cargoWidth} onChange={setCargoWidth} />
                  <NumberField label="Délka nákladu" value={cargoLength} onChange={setCargoLength} />
                  <NumberField label="Výška nákladu" value={cargoHeight} onChange={setCargoHeight} />
                </div>
              </div>
              <div className="mt-auto flex w-full items-end gap-3 pt-4">
                <div className="w-32 shrink-0">
                  <NumberField
                    label="Počet"
                    value={quantity}
                    onChange={setQuantity}
                    min={1}
                    step={1}
                    suffix=""
                  />
                </div>
                <div className="shrink-0">
                  <span className={labelClass}>Stohování</span>
                  <Toggle label="Stohovatelné" checked={stackable} onChange={setStackable} />
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
                    <div>
                      <p className="text-sm font-medium">{entry.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Paleta {entry.palletWidth}×{entry.palletLength} · Náklad{" "}
                        {entry.cargoWidth}×{entry.cargoLength}×{entry.height} mm
                      </p>
                      <p className={clsx("mt-1 text-xs", mutedClass)}>
                        Počet {entry.quantity}
                        {entry.stackable ? " · Stohovatelné" : " · Nestohovatelné"}
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
                selectedUnitId={
                  selectedUnitId && result?.placed.some((item) => item.id === selectedUnitId)
                    ? selectedUnitId
                    : null
                }
                onSelectedUnitIdChange={setSelectedUnitId}
                onNudge={nudgeSelected}
                onRotate={rotateSelected}
                onToggleElevation={toggleSelectedElevation}
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
  theme,
  onThemeChange,
  onClose,
  onTrucksChange,
  onPalletsChange,
  onExport,
  onImportClick,
}: {
  trucks: TruckSpec[];
  pallets: PalletPreset[];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
  onTrucksChange: (trucks: TruckSpec[]) => void;
  onPalletsChange: (pallets: PalletPreset[]) => void;
  onExport: () => void;
  onImportClick: () => void;
}) {
  const [tab, setTab] = useState<"trucks" | "pallets">("trucks");
  const [editingTruck, setEditingTruck] = useState<TruckSpec | null>(null);
  const [editingPallet, setEditingPallet] = useState<PalletPreset | null>(null);
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
              Správa předvoleb vozidel a palet
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

        <div className="flex gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <TabButton active={tab === "trucks"} onClick={() => setTab("trucks")}>
            Vozidla
          </TabButton>
          <TabButton active={tab === "pallets"} onClick={() => setTab("pallets")}>
            Palety
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
                      label="Šířka"
                      value={draft.innerWidth}
                      onChange={(innerWidth) => setDraft({ ...draft, innerWidth })}
                    />
                    <NumberField
                      label="Délka"
                      value={draft.innerLength}
                      onChange={(innerLength) => setDraft({ ...draft, innerLength })}
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
                `${item.innerWidth} × ${item.innerLength} × ${item.innerHeight} mm`
              }
            />
          ) : (
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
                      label="Šířka"
                      value={draft.width}
                      onChange={(width) => setDraft({ ...draft, width })}
                    />
                    <NumberField
                      label="Délka"
                      value={draft.length}
                      onChange={(length) => setDraft({ ...draft, length })}
                    />
                  </div>
                </>
              )}
              summary={(item) => `${item.width} × ${item.length} mm`}
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
}: {
  items: T[];
  onChange: (items: T[]) => void;
  editing: T | null;
  setEditing: (item: T | null) => void;
  blank: () => T;
  renderFields: (draft: T, setDraft: (item: T) => void) => ReactNode;
  summary: (item: T) => string;
}) {
  const isNew = editing ? !items.some((item) => item.id === editing.id) : false;

  const save = () => {
    if (!editing || !editing.name.trim()) return;
    const next = isNew
      ? [...items, editing]
      : items.map((item) => (item.id === editing.id ? editing : item));
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
