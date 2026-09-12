import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type CSSProperties,
} from "react";
import clsx from "clsx";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Grid, Html, OrbitControls } from "@react-three/drei";
import { BackSide, DoubleSide } from "three";
import type { PackingResult, PlacedItem, TruckSpec } from "../lib/packer";
import type { Theme } from "../lib/theme";

type Vec3 = [number, number, number];

interface ScenePalette {
  background: string;
  bed: string;
  cab: string;
  edge: string;
  edgeHovered: string;
  rearFrame: string;
  gridCell: string;
  gridSection: string;
}

interface TruckDimensions {
  width: number;
  length: number;
  height: number;
}

interface PalletGeometry {
  centerX: number;
  centerZ: number;
  base: Vec3;
  baseCenterY: number;
  cargo: Vec3;
  cargoCenterY: number;
  /** Full placed footprint, used as the single hover target. */
  bounds: Vec3;
  centerY: number;
  color: string;
}

interface PalletUnit {
  item: PlacedItem;
  geometry: PalletGeometry;
}

export interface TruckCanvasProps {
  truck: TruckSpec;
  result: PackingResult | null;
  theme: Theme;
}

const MM_TO_M = 0.001;
const PALLET_BASE_MM = 150;
const MIN_TRUCK_MM = 100;

/** Cargo hues read on either background, so only the neutrals switch with the theme. */
const COLOR_CARGO = "#38bdf8";
const COLOR_CARGO_OVERHANGING = "#fb923c";
const COLOR_CARGO_STACKED = "#4ade80";
const COLOR_PALLET = "#d4a373";
const COLOR_PALLET_EDGE = "#b08968";

const PALETTES: Record<Theme, ScenePalette> = {
  light: {
    background: "#f8fafc",
    bed: "#e2e8f0",
    cab: "#cbd5e1",
    edge: "#94a3b8",
    edgeHovered: "#0f172a",
    rearFrame: "#64748b",
    gridCell: "#e2e8f0",
    gridSection: "#cbd5e1",
  },
  dark: {
    background: "#0f172a",
    bed: "#1e293b",
    cab: "#334155",
    edge: "#94a3b8",
    edgeHovered: "#f8fafc",
    rearFrame: "#cbd5e1",
    gridCell: "#1e293b",
    gridSection: "#334155",
  },
};

const CAMERA_FOV = 35;
/** Soft-isometric framing from behind and to the left of the bed. */
const VIEW_DIRECTION: Vec3 = [-0.52, 0.55, 0.65];
const VIEW_DISTANCE_FACTOR = 1.9;

/**
 * Opaque and nowrap, because a translucent or wrapped pill lets the wireframe read as a line
 * through the text. `-translate-y-full` lifts the pill clear of its anchor in screen pixels, so
 * the roof edge stays outside it at any zoom level.
 */
const badgeClass =
  "pointer-events-none inline-block -translate-y-full rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] leading-none font-semibold tracking-wide whitespace-nowrap text-slate-600 shadow-sm select-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";

/** drei only forwards `style` to the label element, so these have to be set here. */
const labelStyle: CSSProperties = {
  pointerEvents: "none",
  userSelect: "none",
  whiteSpace: "nowrap",
};

function toMeters(mm: number): number {
  return mm * MM_TO_M;
}

function usableMm(mm: number): number {
  return Number.isFinite(mm) && mm > MIN_TRUCK_MM ? mm : MIN_TRUCK_MM;
}

function cargoColor(item: PlacedItem): string {
  if (item.isOverhanging) return COLOR_CARGO_OVERHANGING;
  if (item.y > 0) return COLOR_CARGO_STACKED;
  return COLOR_CARGO;
}

function buildPalletGeometry(item: PlacedItem, truck: TruckDimensions): PalletGeometry {
  const footprintWidth = toMeters(item.width);
  const footprintLength = toMeters(item.length);
  const totalHeight = toMeters(item.height);

  const baseHeight = Math.min(toMeters(PALLET_BASE_MM), totalHeight);
  const cargoHeight = Math.max(totalHeight - baseHeight, 0);
  const floorY = toMeters(item.y);

  return {
    // The packer anchors items by their occupied footprint, so pallet and cargo share its centre.
    centerX: toMeters(item.x) + footprintWidth / 2 - truck.width / 2,
    centerZ: toMeters(item.z) + footprintLength / 2 - truck.length / 2,
    base: [toMeters(item.palletWidth), baseHeight, toMeters(item.palletLength)],
    baseCenterY: floorY + baseHeight / 2,
    cargo: [footprintWidth, cargoHeight, footprintLength],
    cargoCenterY: floorY + baseHeight + cargoHeight / 2,
    bounds: [footprintWidth, totalHeight, footprintLength],
    centerY: floorY + totalHeight / 2,
    color: cargoColor(item),
  };
}

function TruckShell({
  dimensions,
  palette,
}: {
  dimensions: TruckDimensions;
  palette: ScenePalette;
}) {
  const { width, length, height } = dimensions;
  const cabLength = Math.max(Math.min(length * 0.14, 1.8), 0.2);
  const cabHeight = height * 0.62;
  const frontZ = -length / 2;
  const rearZ = length / 2;
  // Scaled off the framing size, so the badges clear the roof edge by a constant amount on screen.
  const labelLift = Math.max(width, length, height) * 0.06;

  return (
    <group>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, length]} />
        <meshBasicMaterial
          color={palette.bed}
          transparent
          opacity={0.12}
          side={BackSide}
          depthWrite={false}
        />
        <Edges color={palette.edge} lineWidth={1.4} />
      </mesh>

      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color={palette.bed} roughness={1} metalness={0} side={DoubleSide} />
      </mesh>

      <mesh position={[0, height / 2, frontZ + 0.004]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color={palette.edge}
          roughness={1}
          metalness={0}
          transparent
          opacity={0.22}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[0, cabHeight / 2, frontZ - cabLength / 2 - 0.02]}>
        <boxGeometry args={[width * 0.94, cabHeight, cabLength]} />
        <meshStandardMaterial
          color={palette.cab}
          roughness={0.95}
          metalness={0}
          transparent
          opacity={0.4}
        />
        <Edges color={palette.edge} lineWidth={1} />
      </mesh>

      <mesh position={[0, height / 2, rearZ + 0.008]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
        <Edges color={palette.rearFrame} lineWidth={2.4} />
      </mesh>

      {/* Centred above the front roof edge, clear of every wireframe line. */}
      <Html
        position={[0, height + labelLift, frontZ]}
        center
        pointerEvents="none"
        zIndexRange={[30, 0]}
        className="pointer-events-none select-none whitespace-nowrap"
        style={labelStyle}
      >
        <span className={badgeClass}>Předek (kabina)</span>
      </Html>

      {/* Centred above the rear opening, at the same lift as the front badge. */}
      <Html
        position={[0, height + labelLift, rearZ]}
        center
        pointerEvents="none"
        zIndexRange={[30, 0]}
        className="pointer-events-none select-none whitespace-nowrap"
        style={labelStyle}
      >
        <span className={badgeClass}>Zadní dveře</span>
      </Html>
    </group>
  );
}

function PalletMesh({
  unit,
  palette,
  hovered,
  onHover,
}: {
  unit: PalletUnit;
  palette: ScenePalette;
  hovered: boolean;
  onHover: (hovered: boolean) => void;
}) {
  const { geometry } = unit;
  const edgeWidth = hovered ? 2.4 : 1;

  const enter = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(true);
  };

  const leave = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(false);
  };

  return (
    <group position={[geometry.centerX, 0, geometry.centerZ]}>
      <mesh position={[0, geometry.baseCenterY, 0]}>
        <boxGeometry args={geometry.base} />
        <meshStandardMaterial color={COLOR_PALLET} roughness={0.9} metalness={0} />
        <Edges
          color={hovered ? palette.edgeHovered : COLOR_PALLET_EDGE}
          lineWidth={edgeWidth}
        />
      </mesh>

      {geometry.cargo[1] > 0 ? (
        <mesh position={[0, geometry.cargoCenterY, 0]}>
          <boxGeometry args={geometry.cargo} />
          <meshStandardMaterial
            color={geometry.color}
            roughness={0.45}
            metalness={0}
            transparent
            opacity={0.85}
          />
          <Edges
            color={hovered ? palette.edgeHovered : palette.edge}
            lineWidth={edgeWidth}
          />
        </mesh>
      ) : null}

      {/* Invisible hit box: one hover target for the pallet and its cargo. */}
      <mesh position={[0, geometry.centerY, 0]} onPointerOver={enter} onPointerOut={leave}>
        <boxGeometry args={geometry.bounds} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-[10px] tracking-wide text-slate-400 uppercase dark:text-slate-500">
        {label}
      </dt>
      <dd className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{value}</dd>
    </div>
  );
}

/** Parked in the corner rather than following the cursor, so it never sits under the pointer. */
function PalletHud({ unit, visible }: { unit: PalletUnit; visible: boolean }) {
  const { item, geometry } = unit;

  return (
    <div
      aria-hidden={!visible}
      className={clsx(
        "pointer-events-none absolute bottom-4 left-4 z-10 transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="w-max min-w-[200px] rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur-sm select-none dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-slate-200 dark:ring-slate-700"
            style={{ backgroundColor: geometry.color }}
          />
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.name}</p>
        </div>
        <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{item.id}</p>

        <dl className="mt-2 space-y-1">
          <HudRow
            label="Rozměry"
            value={`${item.width} × ${item.length} × ${item.height} mm`}
          />
          <HudRow label="Paleta" value={`${item.palletWidth} × ${item.palletLength} mm`} />
          <HudRow label="Rotace" value={`${item.rotation}°`} />
          <HudRow
            label="Poloha"
            value={item.y > 0 ? `ve stohu, ${item.y} mm` : "na podlaze"}
          />
        </dl>

        <p
          className={clsx(
            "mt-2 text-[11px] font-medium",
            item.isOverhanging
              ? "text-orange-600 dark:text-orange-400"
              : "text-slate-500 dark:text-slate-400",
          )}
        >
          {item.isOverhanging ? "Náklad přesahuje paletu" : "V rozměru palety"}
        </p>
      </div>
    </div>
  );
}

function ViewControls({
  position,
  target,
  minDistance,
  maxDistance,
}: {
  position: Vec3;
  target: Vec3;
  minDistance: number;
  maxDistance: number;
}) {
  const camera = useThree((state) => state.camera);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);

  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
    } else {
      camera.lookAt(target[0], target[1], target[2]);
    }
  }, [camera, position, target]);

  return (
    <OrbitControls
      ref={controlsRef}
      target={target}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      panSpeed={0.6}
      minDistance={minDistance}
      maxDistance={maxDistance}
      maxPolarAngle={Math.PI / 2 - 0.04}
    />
  );
}

export default function TruckCanvas({ truck, result, theme }: TruckCanvasProps) {
  const [hoveredItem, setHoveredItem] = useState<PlacedItem | null>(null);
  // Sticky copy of the last hovered item, so the HUD keeps its content while fading out.
  const [hudItem, setHudItem] = useState<PlacedItem | null>(null);
  const palette = PALETTES[theme];

  const dimensions = useMemo<TruckDimensions>(
    () => ({
      width: toMeters(usableMm(truck.innerWidth)),
      length: toMeters(usableMm(truck.innerLength)),
      height: toMeters(usableMm(truck.innerHeight)),
    }),
    [truck.innerWidth, truck.innerLength, truck.innerHeight],
  );

  const units = useMemo<PalletUnit[]>(
    () =>
      (result?.placed ?? []).map((item) => ({
        item,
        geometry: buildPalletGeometry(item, dimensions),
      })),
    [result, dimensions],
  );

  // Identity lookup, so a stale hover from a previous calculation resolves to nothing.
  const hoveredUnit = useMemo(
    () => units.find((unit) => unit.item === hoveredItem),
    [units, hoveredItem],
  );

  const hudUnit = useMemo(() => units.find((unit) => unit.item === hudItem), [units, hudItem]);

  const handleHover = (item: PlacedItem, hovered: boolean) => {
    if (hovered) {
      setHoveredItem(item);
      setHudItem(item);
      return;
    }
    // The pointer may already be over a neighbouring pallet, so only clear our own entry.
    setHoveredItem((current) => (current === item ? null : current));
  };

  const radius = Math.max(dimensions.width, dimensions.length, dimensions.height);

  const cameraTarget = useMemo<Vec3>(() => [0, dimensions.height * 0.35, 0], [dimensions.height]);

  const cameraPosition = useMemo<Vec3>(() => {
    const distance = radius * VIEW_DISTANCE_FACTOR;
    return [
      VIEW_DIRECTION[0] * distance,
      VIEW_DIRECTION[1] * distance + cameraTarget[1],
      VIEW_DIRECTION[2] * distance,
    ];
  }, [radius, cameraTarget]);

  const [initialCamera] = useState(() => ({
    fov: CAMERA_FOV,
    near: 0.1,
    far: 600,
    position: cameraPosition,
  }));

  const gridSize = Math.max(dimensions.width, dimensions.length) * 1.8;

  return (
    <div
      className={clsx(
        "relative h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900",
        hoveredUnit && "cursor-pointer",
      )}
    >
      <Canvas dpr={[1, 2]} shadows={false} gl={{ antialias: true }} camera={initialCamera}>
        <color attach="background" args={[palette.background]} />

        <ambientLight intensity={0.7} />
        <directionalLight position={[radius, radius * 1.4, radius * 0.7]} intensity={0.6} />
        <directionalLight position={[-radius, radius * 0.8, -radius]} intensity={0.22} />

        <Grid
          position={[0, -0.004, 0]}
          args={[gridSize, gridSize]}
          cellSize={0.5}
          cellThickness={0.6}
          cellColor={palette.gridCell}
          sectionSize={2.5}
          sectionThickness={1}
          sectionColor={palette.gridSection}
          fadeDistance={gridSize}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={false}
          side={DoubleSide}
        />

        <TruckShell dimensions={dimensions} palette={palette} />

        {units.map((unit, index) => (
          <PalletMesh
            key={`${unit.item.id}-${index}`}
            unit={unit}
            palette={palette}
            hovered={hoveredUnit === unit}
            onHover={(hovered) => handleHover(unit.item, hovered)}
          />
        ))}

        <ViewControls
          position={cameraPosition}
          target={cameraTarget}
          minDistance={radius * 0.3}
          maxDistance={radius * 4.5}
        />
      </Canvas>

      {hudUnit ? <PalletHud unit={hudUnit} visible={Boolean(hoveredUnit)} /> : null}

      {units.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg border border-slate-200 bg-white/90 px-3.5 py-2 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-400">
            Nastavte náklad a klikněte na Vypočítat náklad
          </p>
        </div>
      ) : null}
    </div>
  );
}
