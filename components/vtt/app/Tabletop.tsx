"use client";

import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CharacterSheetWindow } from "@/app/CharacterSheetWindow";
import { LightingLayer, type BarrierPreview } from "@/app/LightingLayer";
import { MeasurementLayer } from "@/app/MeasurementLayer";
import { createCharacterSheet } from "@/lib/character-sheet";
import { detectSquareGrid, type DetectedGrid } from "@/lib/grid-detection";
import {
  buildViewerLighting,
  inferArtworkLightDraft,
  inferArtworkWallDraft,
  pointInPolygon,
} from "@/lib/lighting";
import { gridPosition, mapGridGeometry, normalizeMapPoint, reanchorSegment } from "@/lib/map-geometry";
import type { MeasurementKind, MeasurementTemplate } from "@/lib/measurement";
import { normalizedRoomCode, publicRoomCodeLength } from "@/lib/public-access";
import {
  type BattleMap,
  type MapLight,
  type MapLighting,
  type RoomOperation,
  type RoomAsset,
  type RoomState,
  type SightBarrier,
  type TableToken,
  type TokenStatus,
  type TurnOrder,
} from "@/lib/room-state";
import { parseUvtt } from "@/lib/uvtt";
import { shouldBeginCameraPan } from "@/lib/tabletop-gestures";

type Snapshot = {
  roomId: string;
  revision: number;
  state: RoomState;
  canUndo: boolean;
  canRedo: boolean;
  isDm: boolean;
};

type Session = {
  roomId: string;
  clientId: string;
  dmKey: string;
};

type Point = { x: number; y: number };
type Drag = {
  tokenIds: string[];
  primaryId: string;
  start: Point;
  origins: Record<string, Point>;
  measuring: boolean;
  joints: Point[];
};
type Camera = { x: number; y: number; zoom: number };
type CameraDrag = {
  pointerId: number;
  captureTarget: HTMLDivElement;
  startX: number;
  startY: number;
  cameraX: number;
  cameraY: number;
};
type Tool = "move" | "pan" | "ping" | "measure" | "wall" | "door" | "light";
type ToolPanel = "measure" | "dice" | "turns" | null;
type ActiveLayer = "token" | "map" | "dm" | "lighting";
type UtilityPanel = "chat" | "journal" | "assets" | "settings";
type SelectedBarrier =
  | { source: "accepted"; id: string }
  | { source: "draft"; index: number };

const tokenColorOptions = [
  { value: "#d6a84b", label: "Burnished gold" },
  { value: "#5bb6d6", label: "Sky blue" },
  { value: "#cb6f65", label: "Brick red" },
  { value: "#7dc890", label: "Sage green" },
  { value: "#a88cdb", label: "Amethyst" },
] as const;
const tokenColors: string[] = tokenColorOptions.map(({ value }) => value);
const tokenConditions = [
  "Blinded", "Charmed", "Concentrating", "Deafened", "Frightened", "Grappled",
  "Incapacitated", "Invisible", "Paralyzed", "Poisoned", "Prone", "Restrained",
  "Stunned", "Unconscious",
];
const layerDetails: Record<ActiveLayer, { label: string; mark: string; hint: string }> = {
  token: {
    label: "Play",
    mark: "♟",
    hint: "Select and move tokens · hold Alt for free movement",
  },
  map: {
    label: "Maps",
    mark: "▧",
    hint: "Choose scenes, upload maps, and align grids",
  },
  dm: {
    label: "Player view",
    mark: "◐",
    hint: "Preview exactly what the party can currently see",
  },
  lighting: {
    label: "Lighting",
    mark: "✦",
    hint: "Set up dynamic lighting, walls, doors, and lights",
  },
};

export function Tabletop({
  canManageRooms,
  ownerSetupUserId,
}: {
  canManageRooms: boolean;
  ownerSetupUserId: string | null;
}) {
  const [ready, setReady] = useState(false);
  const [clientId, setClientId] = useState("");
  const [lastRoomId, setLastRoomId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "reconnecting">("connecting");
  const [error, setError] = useState("");
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>("token");
  const [tool, setTool] = useState<Tool>("move");
  const [measureKind, setMeasureKind] = useState<MeasurementKind>("distance");
  const [beamWidth, setBeamWidth] = useState(1);
  const [measure, setMeasure] = useState<MeasurementTemplate | null>(null);
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const [drawingBarriers, setDrawingBarriers] = useState<BarrierPreview[]>([]);
  const drawingBarriersRef = useRef<BarrierPreview[]>([]);
  const [draftBarriers, setDraftBarriers] = useState<BarrierPreview[]>([]);
  const [draftLights, setDraftLights] = useState<MapLight[]>([]);
  const [manualLightRange, setManualLightRange] = useState(30);
  const [manualLightColor, setManualLightColor] = useState("#ffd27a");
  const [selectedBarrier, setSelectedBarrier] = useState<SelectedBarrier | null>(null);
  const [lightingMessage, setLightingMessage] = useState("Lighting is off for this map.");
  const [previewPlayers, setPreviewPlayers] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const cameraDragRef = useRef<CameraDrag | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const focusedPingRef = useRef("");
  const registrationRef = useRef("");
  const pollRef = useRef(false);
  const [playerName, setPlayerName] = useState("Player");
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  const [copiedTokenIds, setCopiedTokenIds] = useState<string[]>([]);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [showScenes, setShowScenes] = useState(false);
  const [showUtility, setShowUtility] = useState(true);
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>("chat");
  const [mapSearch, setMapSearch] = useState("");
  const [showArchivedMaps, setShowArchivedMaps] = useState(false);
  const [busy, setBusy] = useState("");
  const [gridMessage, setGridMessage] = useState("Grid size will be detected when possible.");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let storedClientId = localStorage.getItem("vtt:client-id");
      if (!storedClientId) {
        storedClientId = crypto.randomUUID();
        localStorage.setItem("vtt:client-id", storedClientId);
      }
      const storedName = localStorage.getItem("vtt:player-name");
      if (storedName) setPlayerName(storedName);
      const storedRoomId = normalizedRoomCode(
        localStorage.getItem("vtt:last-room"),
        canManageRooms,
      );
      if (storedRoomId) setLastRoomId(storedRoomId);
      setClientId(storedClientId);

      const roomId = new URLSearchParams(window.location.search)
        .get("room")
        ?.trim()
        .toUpperCase();
      if (roomId && normalizedRoomCode(roomId, canManageRooms)) {
        localStorage.setItem("vtt:last-room", roomId);
        setLastRoomId(roomId);
        setSession({
          roomId,
          clientId: storedClientId,
          dmKey: localStorage.getItem(`vtt:dm:${roomId}`) ?? "",
        });
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [canManageRooms]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function poll() {
      if (pollRef.current || dragRef.current) return;
      pollRef.current = true;
      try {
        const revision = snapshotRef.current?.revision;
        const query = new URLSearchParams({ id: session!.roomId });
        if (revision !== undefined) query.set("since", String(revision));
        const response = await fetch(`/api/room?${query}`, {
          cache: "no-store",
          headers: {
            "X-VTT-Client": session!.clientId,
            "X-VTT-DM-Key": session!.dmKey,
          },
        });
        if (response.status === 204) {
          setConnection("online");
          return;
        }
        const data = (await response.json()) as Snapshot & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not open the room.");
        if (!cancelled) {
          const name = data.isDm
            ? "Dungeon Master"
            : localStorage.getItem("vtt:player-name")?.slice(0, 30) || "Player";
          const registered = data.state.players?.find((player) => player.id === session!.clientId);
          const registrationKey = `${session!.roomId}:${session!.clientId}:${name}`;
          if (
            (!registered || registered.name !== name || registered.isDm !== data.isDm) &&
            registrationRef.current !== registrationKey
          ) {
            registrationRef.current = registrationKey;
            void registerRoomPlayer(session!, name).catch(() => {
              if (registrationRef.current === registrationKey) registrationRef.current = "";
            });
          }
          snapshotRef.current = data;
          setSnapshot(data);
          setConnection("online");
          setError("");
        }
      } catch (pollError) {
        if (!cancelled) {
          setConnection("reconnecting");
          if (!snapshotRef.current) setError(messageFrom(pollError));
        }
      } finally {
        pollRef.current = false;
      }
    }

    void poll();
    const timer = window.setInterval(poll, 600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session]);

  async function createRoom(name: string) {
    setBusy("Creating room…");
    setError("");
    try {
      const response = await fetch("/api/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name }),
      });
      const data = (await response.json()) as Snapshot & {
        dmKey?: string;
        error?: string;
      };
      if (!response.ok || !data.dmKey) {
        throw new Error(data.error ?? "Could not create the room.");
      }
      localStorage.setItem(`vtt:dm:${data.roomId}`, data.dmKey);
      enterRoom(data.roomId, data.dmKey);
      const createdSnapshot = {
        roomId: data.roomId,
        revision: data.revision,
        state: data.state,
        canUndo: data.canUndo,
        canRedo: data.canRedo,
        isDm: data.isDm,
      };
      snapshotRef.current = createdSnapshot;
      setSnapshot(createdSnapshot);
    } catch (createError) {
      setError(messageFrom(createError));
    } finally {
      setBusy("");
    }
  }

  function enterRoom(roomId: string, dmKey = "") {
    const normalized = normalizedRoomCode(roomId, canManageRooms && Boolean(dmKey));
    if (!normalized) {
      setError(`Enter a valid ${publicRoomCodeLength}-character room code.`);
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", normalized);
    window.history.pushState({}, "", url);
    setConnection("connecting");
    snapshotRef.current = null;
    setSnapshot(null);
    setActiveLayer("token");
    setPreviewPlayers(false);
    setSelectedBarrier(null);
    setSelectedTokenIds([]);
    setCopiedTokenIds([]);
    setCamera({ x: 0, y: 0, zoom: 1 });
    setShowScenes(false);
    setShowUtility(true);
    setUtilityPanel("chat");
    setOpenSheetId(null);
    localStorage.setItem("vtt:last-room", normalized);
    setLastRoomId(normalized);
    const nextSession = { roomId: normalized, clientId, dmKey };
    const name = dmKey ? "Dungeon Master" : playerName || "Player";
    const registrationKey = `${normalized}:${clientId}:${name}`;
    registrationRef.current = registrationKey;
    setSession(nextSession);
    void registerRoomPlayer(nextSession, name).catch(() => {
      if (registrationRef.current === registrationKey) registrationRef.current = "";
    });
    setError("");
  }

  const mutate = useCallback(async (operation: RoomOperation): Promise<boolean> => {
    if (!session) return false;
    try {
      const response = await fetch("/api/room", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-VTT-DM-Key": session.dmKey,
        },
        body: JSON.stringify({
          action: "mutate",
          roomId: session.roomId,
          clientId: session.clientId,
          operation,
        }),
      });
      const data = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The table could not update.");
      snapshotRef.current = data;
      setSnapshot(data);
      setConnection("online");
      setError("");
      return true;
    } catch (mutationError) {
      setError(messageFrom(mutationError));
      setConnection("reconnecting");
      return false;
    }
  }, [session]);

  const isDm = snapshot?.isDm === true;
  const editingLayer: ActiveLayer = isDm ? activeLayer : "token";
  const currentMap = snapshot?.state.maps.find(
    (candidate) => candidate.id === snapshot.state.activeMapId,
  ) ?? snapshot?.state.maps[0] ?? null;
  const currentMapTokens = useMemo(
    () => currentMap
      ? (snapshot?.state.tokens ?? []).filter((token) => token.mapId === currentMap.id)
      : [],
    [currentMap, snapshot?.state.tokens],
  );
  const lightingViewerId = isDm && previewPlayers ? "__player_preview__" : session?.clientId ?? "";
  const viewerLighting = useMemo(
    () => currentMap && session && (!isDm || previewPlayers)
      ? buildViewerLighting(currentMap, currentMapTokens, lightingViewerId)
      : { sharedPolygons: [], privatePolygons: [], polygons: [] },
    [currentMap, currentMapTokens, isDm, lightingViewerId, previewPlayers, session],
  );
  const revealMap = useCallback(async (mapId: string, scope: string, cells: number[]) => {
    const mapExists = snapshotRef.current?.state.maps.some((candidate) => candidate.id === mapId);
    if (mapExists) await mutate({ type: "reveal-map", mapId, scope, cells });
  }, [mutate]);
  const listedMaps = useMemo(() => {
    const search = mapSearch.trim().toLowerCase();
    return (snapshot?.state.maps ?? []).filter((map) =>
      (showArchivedMaps ? map.archived === true : map.archived !== true) &&
      (!search || `${map.name} ${map.folder ?? ""}`.toLowerCase().includes(search)),
    );
  }, [mapSearch, showArchivedMaps, snapshot?.state.maps]);
  const savedAssets = snapshot?.state.assets ?? [];

  useEffect(() => {
    const ping = snapshot?.state.ping;
    const map = currentMap;
    const board = boardRef.current;
    if (!ping?.focus || !map || ping.mapId !== map.id || !board || focusedPingRef.current === ping.id) return;
    focusedPingRef.current = ping.id;
    const point = normalizeMapPoint(ping, map);
    setCamera((current) => ({
      ...current,
      x: (0.5 - point.x) * board.clientWidth * current.zoom,
      y: (0.5 - point.y) * board.clientHeight * current.zoom,
    }));
  }, [currentMap, snapshot?.state.ping]);

  async function upload(file: File, kind: "map" | "token") {
    if (!session) throw new Error("Room session unavailable.");
    if (kind === "token" && file.size > 5 * 1024 * 1024) {
      throw new Error("Token images must be 5 MB or smaller.");
    }
    const response = await fetch("/api/media", {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-VTT-Room": session.roomId,
        "X-VTT-Client": session.clientId,
        "X-VTT-DM-Key": session.dmKey,
        "X-VTT-Kind": kind,
      },
      body: file,
    });
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const data = isJson
      ? ((await response.json()) as { key?: string; error?: string })
      : {};
    if (!response.ok || !data.key) {
      throw new Error(
        data.error ??
          (response.status === 413
            ? "This image exceeds the current host's upload ceiling."
            : "Upload failed."),
      );
    }
    return data.key;
  }

  async function mapSetup(file: File): Promise<{
    columns: number;
    rows: number;
    grid?: BattleMap["grid"];
    detected: boolean;
  }> {
    const detected = await detectImageGrid(file);
    if (detected) {
      return {
        columns: detected.columns,
        rows: detected.rows,
        grid: detected.calibration,
        detected: true,
      };
    }
    const bitmap = await createImageBitmap(file);
    try {
      const columns = 20;
      return {
        columns,
        rows: clamp(Math.round(columns / (bitmap.width / bitmap.height)), 4, 100),
        detected: false,
      };
    } finally {
      bitmap.close();
    }
  }

  async function setSceneMapImage(
    map: BattleMap,
    file: File,
    setup?: Awaited<ReturnType<typeof mapSetup>>,
  ) {
    if (!isDm) return;
    if (
      map.imageKey &&
      !window.confirm("Replace this scene's map image? Its grid and lighting setup will reset.")
    ) return;
    setBusy("Uploading map…");
    setError("");
    try {
      const resolved = setup ?? await mapSetup(file);
      const imageKey = await upload(file, "map");
      const changed = await mutate({
        type: "set-map-image",
        mapId: map.id,
        name: map.imageKey ? map.name : fileBaseName(file.name),
        imageKey,
        columns: resolved.columns,
        rows: resolved.rows,
        grid: resolved.grid,
      });
      if (changed) {
        setCamera({ x: 0, y: 0, zoom: 1 });
        setSelectedTokenIds([]);
        setSelectedBarrier(null);
        setDraftBarriers([]);
        setDraftLights([]);
        setGridMessage(resolved.detected
          ? `Detected and aligned ${resolved.columns} × ${resolved.rows}.`
          : `Set a proportional ${resolved.columns} × ${resolved.rows} footprint. Adjust if needed.`);
      }
    } catch (uploadError) {
      setError(messageFrom(uploadError));
    } finally {
      setBusy("");
    }
  }

  async function chooseSceneMap(event: ChangeEvent<HTMLInputElement>, map: BattleMap) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    await setSceneMapImage(map, file);
    input.value = "";
  }

  async function createBlankScene() {
    const number = (snapshotRef.current?.state.maps.length ?? 0) + 1;
    if (await mutate({
      type: "add-map",
      map: {
        id: crypto.randomUUID(),
        name: `Scene ${number}`,
        imageKey: null,
        columns: 20,
        rows: 12,
      },
    })) {
      setCamera({ x: 0, y: 0, zoom: 1 });
      setSelectedTokenIds([]);
      setShowScenes(true);
      setActiveLayer("map");
    }
  }

  async function placeTokenImage(
    imageKey: string | null,
    name: string,
    point: Point = { x: 1, y: 1 },
    color = tokenColors[0],
  ) {
    return mutate({
      type: "add-token",
      token: {
        id: crypto.randomUUID(),
        name,
        imageKey,
        color,
        x: point.x,
        y: point.y,
      },
    });
  }

  async function saveAssetFile(event: ChangeEvent<HTMLInputElement>, kind: "map" | "token") {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(`Saving ${kind}…`);
    setError("");
    try {
      const setup = kind === "map" ? await mapSetup(file) : null;
      const imageKey = await upload(file, kind);
      await mutate({
        type: "add-asset",
        asset: {
          id: crypto.randomUUID(),
          kind,
          name: fileBaseName(file.name),
          imageKey,
          columns: setup?.columns,
          rows: setup?.rows,
          grid: setup?.grid,
        },
      });
    } catch (uploadError) {
      setError(messageFrom(uploadError));
    } finally {
      input.value = "";
      setBusy("");
    }
  }

  async function placeSavedAsset(asset: RoomAsset, point: Point = { x: 1, y: 1 }) {
    const map = activeMap();
    if (!map) return;
    if (asset.kind === "map") {
      if (!isDm) return;
      if (
        map.imageKey &&
        !window.confirm("Replace this scene's map image? Its grid and lighting setup will reset.")
      ) return;
      await mutate({
        type: "set-map-image",
        mapId: map.id,
        name: map.imageKey ? map.name : asset.name,
        imageKey: asset.imageKey,
        columns: asset.columns ?? 20,
        rows: asset.rows ?? 12,
        grid: asset.grid,
      });
      setCamera({ x: 0, y: 0, zoom: 1 });
      return;
    }
    await placeTokenImage(asset.imageKey, asset.name, point);
  }

  function beginAssetDrag(event: ReactDragEvent<HTMLElement>, asset: RoomAsset) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-20fates-asset", asset.id);
  }

  function allowBoardDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (
      event.dataTransfer.types.includes("Files") ||
      event.dataTransfer.types.includes("application/x-20fates-asset")
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  async function dropOnBoard(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const map = activeMap();
    const point = pointFromClient(event.clientX, event.clientY, map);
    if (!map || !point) return;
    const assetId = event.dataTransfer.getData("application/x-20fates-asset");
    const asset = savedAssets.find((candidate) => candidate.id === assetId);
    if (asset) {
      if (
        (asset.kind === "map" && editingLayer !== "map") ||
        (asset.kind === "token" && editingLayer !== "token")
      ) {
        setError(`Switch to the ${asset.kind === "map" ? "Map" : "Token"} layer before dropping this asset.`);
        return;
      }
      await placeSavedAsset(asset, point);
      return;
    }
    const file = [...event.dataTransfer.files].find((candidate) =>
      ["image/png", "image/jpeg", "image/webp"].includes(candidate.type),
    );
    if (!file) {
      setError("Drop a PNG, JPEG, or WebP image.");
      return;
    }
    if (editingLayer === "map" && isDm) {
      await setSceneMapImage(map, file);
      return;
    }
    if (editingLayer === "token") {
      setBusy("Adding token…");
      try {
        const imageKey = await upload(file, "token");
        await placeTokenImage(imageKey, fileBaseName(file.name), point);
      } catch (uploadError) {
        setError(messageFrom(uploadError));
      } finally {
        setBusy("");
      }
      return;
    }
    setError("Drop maps on the Map layer or tokens on the Token layer.");
  }

  async function addToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("tokenFile");
    setBusy("Adding token…");
    setError("");
    try {
      const imageKey = file instanceof File && file.size > 0 ? await upload(file, "token") : null;
      const added = await placeTokenImage(
        imageKey,
        String(data.get("tokenName") ?? playerName),
        { x: 1, y: 1 },
        String(data.get("tokenColor") ?? tokenColors[0]),
      );
      if (added) form.reset();
    } catch (uploadError) {
      setError(messageFrom(uploadError));
    } finally {
      setBusy("");
    }
  }

  async function alignMapGrid(map: BattleMap) {
    if (!map.imageKey) return;
    setBusy("Aligning map grid…");
    setError("");
    try {
      const response = await fetch(`/api/media?key=${encodeURIComponent(map.imageKey)}`);
      if (!response.ok) throw new Error("Could not read the map image.");
      const result = await detectImageGrid(await response.blob());
      if (!result) throw new Error("No clear square grid was found. Use the manual size fields instead.");
      const aligned = await mutate({
        type: "align-map-grid",
        mapId: map.id,
        columns: result.columns,
        rows: result.rows,
        grid: result.calibration,
      });
      if (aligned) setGridMessage(`Aligned ${map.name} to ${result.columns} × ${result.rows}.`);
    } catch (alignmentError) {
      setError(messageFrom(alignmentError));
    } finally {
      setBusy("");
    }
  }

  async function importUvttMap(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy("Importing Universal VTT map…");
    setError("");
    try {
      const imported = parseUvtt(await file.text());
      const imageKey = await upload(
        base64ImageFile(imported.imageBase64, imported.imageType, file.name),
        "map",
      );
      const added = await mutate({
        type: "add-map",
        map: {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.(?:uvtt|dd2vtt|df2vtt)$/i, ""),
          imageKey,
          columns: imported.columns,
          rows: imported.rows,
          grid: imported.grid,
          lighting: imported.lighting,
        },
      });
      if (added) {
        input.value = "";
        setCamera({ x: 0, y: 0, zoom: 1 });
        setSelectedTokenIds([]);
        setSelectedBarrier(null);
        setDraftBarriers([]);
        setDraftLights([]);
        setLightingMessage(
          `Imported ${imported.lighting.barriers.length} walls and doors, plus ${imported.lighting.lights.length} lights.`,
        );
      }
    } catch (importError) {
      setError(messageFrom(importError));
    } finally {
      setBusy("");
    }
  }

  async function toggleLighting(map: BattleMap) {
    const lighting = lightingFor(map);
    const enabled = !lighting.enabled;
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: { ...lighting, enabled },
    })) {
      setLightingMessage(enabled ? "Dynamic lighting is on." : "Dynamic lighting is off.");
    }
  }

  async function draftAutomaticLighting(map: BattleMap) {
    if (!map.imageKey) return;
    setBusy("Tracing walls and lights from the artwork…");
    setError("");
    try {
      const response = await fetch(`/api/media?key=${encodeURIComponent(map.imageKey)}`);
      if (!response.ok) throw new Error("Could not read the map image.");
      const image = await readImageData(await response.blob());
      const lighting = lightingFor(map);
      const grid = mapGridGeometry(map);
      const walls = lighting.barriers.length ? [] : inferArtworkWallDraft(
        image.data, image.width, image.height, map, grid,
      );
      const lights = lighting.lights.length ? [] : inferArtworkLightDraft(
        image.data, image.width, image.height, map, grid,
      );
      setSelectedBarrier(null);
      setDraftBarriers(walls.map((barrier) => ({ ...barrier, kind: "wall" })));
      setDraftLights(lights.map((light, index) => ({ ...light, id: `draft-light-${index}` })));
      setLightingMessage(
        walls.length || lights.length
          ? `Found ${walls.length} wall paths and ${lights.length} likely light sources. Review the orange draft, then accept or discard it.`
          : "No new wall or light candidates were found. Draw them manually or import a Universal VTT file.",
      );
    } catch (draftError) {
      setError(messageFrom(draftError));
    } finally {
      setBusy("");
    }
  }

  async function acceptLightingDraft(map: BattleMap) {
    if (!draftBarriers.length && !draftLights.length) return;
    const lighting = lightingFor(map);
    const barriers: SightBarrier[] = draftBarriers.map((barrier) => ({
      ...barrier,
      id: crypto.randomUUID(),
      open: false,
    }));
    const lights = draftLights.map((light) => ({ ...light, id: crypto.randomUUID() }));
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        enabled: true,
        barriers: [...lighting.barriers, ...barriers],
        lights: [...lighting.lights, ...lights],
      },
    })) {
      setSelectedBarrier(null);
      setDraftBarriers([]);
      setDraftLights([]);
      setLightingMessage(`Added ${barriers.length} wall paths and ${lights.length} lights. Dynamic lighting is on.`);
    }
  }

  async function clearBarriers(map: BattleMap) {
    const lighting = lightingFor(map);
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: { ...lighting, barriers: [] },
    })) {
      setSelectedBarrier(null);
      setDraftBarriers([]);
      setLightingMessage("Removed all walls and doors from this map.");
    }
  }

  async function saveBarriers(map: BattleMap, barriers: BarrierPreview[]) {
    if (!barriers.length) return;
    const lighting = lightingFor(map);
    await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        enabled: true,
        barriers: [
          ...lighting.barriers,
          ...barriers.map((barrier) => ({
            ...barrier,
            id: crypto.randomUUID(),
            open: false,
          })),
        ],
      },
    });
  }

  async function placeLight(map: BattleMap, point: Point) {
    const lighting = lightingFor(map);
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        enabled: true,
        lights: [
          ...lighting.lights,
          {
            id: crypto.randomUUID(),
            x: point.x,
            y: point.y,
            range: manualLightRange / 5,
            intensity: 1,
            color: manualLightColor,
          },
        ],
      },
    })) {
      setLightingMessage(`Placed a ${manualLightRange}-foot light. Click its blue marker to remove it.`);
    }
  }

  async function scaleMapFootprint(map: BattleMap, factor: number) {
    if (!map.imageKey) return;
    const columns = clamp(Math.round(map.columns * factor), 4, 100);
    const actualFactor = columns / map.columns;
    const rows = clamp(Math.round(map.rows * actualFactor), 4, 100);
    if (columns === map.columns && rows === map.rows) return;
    const grid = mapGridGeometry(map);
    const scaled = {
      ...grid,
      offsetX: clamp(0.5 + (grid.offsetX - 0.5) / actualFactor, -0.25, 0.25),
      offsetY: clamp(0.5 + (grid.offsetY - 0.5) / actualFactor, -0.25, 0.25),
      cellWidth: clamp(grid.cellWidth / actualFactor, 0.005, 0.25),
      cellHeight: clamp(grid.cellHeight / actualFactor, 0.005, 0.25),
    };
    if (await mutate({
      type: "align-map-grid",
      mapId: map.id,
      columns,
      rows,
      grid: scaled,
    })) {
      setGridMessage(`Map footprint is now ${columns} × ${rows}; proportions stayed linked.`);
    }
  }

  async function removeLight(map: BattleMap, lightId: string) {
    const lighting = lightingFor(map);
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        lights: lighting.lights.filter((light) => light.id !== lightId),
      },
    })) {
      setLightingMessage("Removed the light.");
    }
  }

  async function toggleDoor(map: BattleMap, barrierId: string) {
    const lighting = lightingFor(map);
    await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        barriers: lighting.barriers.map((barrier) =>
          barrier.id === barrierId && barrier.kind === "door"
            ? { ...barrier, open: !barrier.open }
            : barrier,
        ),
      },
    });
  }

  async function removeBarrier(map: BattleMap, barrierId: string) {
    const lighting = lightingFor(map);
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        barriers: lighting.barriers.filter((barrier) => barrier.id !== barrierId),
      },
    })) {
      setSelectedBarrier(null);
      setLightingMessage("Removed the selected wall segment.");
    }
  }

  async function reanchorSelectedBarrier(map: BattleMap, target: Point) {
    if (!selectedBarrier) return;
    if (selectedBarrier.source === "draft") {
      const barrier = draftBarriers[selectedBarrier.index];
      if (!barrier) {
        setSelectedBarrier(null);
        return;
      }
      const moved = reanchorSegment(barrier.start, barrier.end, target, map.columns, map.rows);
      setDraftBarriers((barriers) => barriers.map((candidate, index) =>
        index === selectedBarrier.index ? { ...candidate, ...moved } : candidate,
      ));
      setSelectedBarrier(null);
      setLightingMessage("Moved the draft wall without changing its length or angle.");
      return;
    }

    const lighting = lightingFor(map);
    const barrier = lighting.barriers.find((candidate) =>
      candidate.id === selectedBarrier.id && candidate.kind === "wall",
    );
    if (!barrier) {
      setSelectedBarrier(null);
      return;
    }
    const moved = reanchorSegment(barrier.start, barrier.end, target, map.columns, map.rows);
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        barriers: lighting.barriers.map((candidate) =>
          candidate.id === barrier.id ? { ...candidate, ...moved } : candidate,
        ),
      },
    })) {
      setSelectedBarrier(null);
      setLightingMessage("Moved the wall without changing its length or angle.");
    }
  }

  function deleteSelectedBarrier(map: BattleMap) {
    if (!selectedBarrier) return;
    if (selectedBarrier.source === "accepted") {
      if (window.confirm("Remove this wall segment?")) void removeBarrier(map, selectedBarrier.id);
      return;
    }
    setDraftBarriers((barriers) => barriers.filter((_, index) => index !== selectedBarrier.index));
    setSelectedBarrier(null);
    setLightingMessage("Removed the selected draft wall segment.");
  }

  async function clearLights(map: BattleMap) {
    const lighting = lightingFor(map);
    if (await mutate({
      type: "set-map-lighting",
      mapId: map.id,
      lighting: {
        ...lighting,
        lights: [],
      },
    })) {
      setDraftLights([]);
      setLightingMessage("Removed every light from this map.");
    }
  }

  function setTokenVision(token: TableToken, sharedSight: boolean, rangeFeet: number) {
    void mutate({
      type: "set-token-vision",
      tokenId: token.id,
      sharedSight,
      visionRange: Math.round(rangeFeet / 5),
    });
  }

  function updateToken(token: TableToken, patch: Partial<TableToken>) {
    void mutate({ type: "set-token", tokenId: token.id, token: patch });
  }

  async function replaceTokenImage(token: TableToken, file: File) {
    setBusy("Saving token…");
    setError("");
    try {
      const imageKey = await upload(file, "token");
      if (!await mutate({ type: "set-token", tokenId: token.id, token: { imageKey } })) {
        throw new Error("The token image could not be saved.");
      }
    } catch (uploadError) {
      setError(messageFrom(uploadError));
      throw uploadError;
    } finally {
      setBusy("");
    }
  }

  function saveTokenDetails(event: FormEvent<HTMLFormElement>, token: TableToken) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateToken(token, {
      name: String(data.get("name") ?? token.name),
      color: String(data.get("color") ?? token.color),
      width: Number(data.get("width") ?? 1),
      height: Number(data.get("height") ?? 1),
      rotation: Number(data.get("rotation") ?? 0),
      hp: Number(data.get("hp") ?? 0),
      maxHp: Number(data.get("maxHp") ?? 0),
      tempHp: Number(data.get("tempHp") ?? 0),
      auraRange: Number(data.get("auraRange") ?? 0) / 5,
      auraColor: String(data.get("auraColor") ?? token.color),
      showName: data.get("showName") === "on",
      locked: data.get("locked") === "on",
    });
  }

  function addTokenStatus(event: FormEvent<HTMLFormElement>, token: TableToken) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const label = String(data.get("status") ?? "Condition");
    const statuses: TokenStatus[] = [
      ...(token.statuses ?? []),
      { id: crypto.randomUUID(), label, count: Number(data.get("count") ?? 1) },
    ];
    updateToken(token, { statuses });
    form.reset();
  }

  function removeTokenStatus(token: TableToken, statusId: string) {
    updateToken(token, { statuses: (token.statuses ?? []).filter((status) => status.id !== statusId) });
  }

  function duplicateTokens(tokenIds: string[]) {
    if (!tokenIds.length) return;
    void mutate({
      type: "duplicate-tokens",
      tokenIds,
      newIds: tokenIds.map(() => crypto.randomUUID()),
    });
  }

  function copySelectedTokens() {
    const ids = selectedTokenIds.filter((id) =>
      snapshotRef.current?.state.tokens.some((token) => token.id === id && canControl(token)),
    );
    if (ids.length) setCopiedTokenIds(ids);
  }

  function deleteSelectedTokens() {
    const ids = selectedTokenIds.filter((id) =>
      snapshotRef.current?.state.tokens.some((token) => token.id === id && canControl(token)),
    );
    if (!ids.length || !window.confirm(`Remove ${ids.length === 1 ? "this token" : `these ${ids.length} tokens`}?`)) return;
    void mutate({ type: "delete-tokens", tokenIds: ids });
    setSelectedTokenIds([]);
  }

  function saveMapDetails(event: FormEvent<HTMLFormElement>, map: BattleMap) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate({
      type: "set-map-details",
      mapId: map.id,
      name: String(data.get("name") ?? map.name),
      folder: String(data.get("folder") ?? ""),
      gridVisible: data.get("gridVisible") === "on",
      landing: {
        x: Number(data.get("landingX") ?? 1),
        y: Number(data.get("landingY") ?? 1),
      },
    });
  }

  function duplicateMap(map: BattleMap) {
    void mutate({ type: "duplicate-map", mapId: map.id, newId: crypto.randomUUID() });
  }

  function reorderMap(map: BattleMap, offset: number) {
    const maps = snapshotRef.current?.state.maps ?? [];
    const index = maps.findIndex((candidate) => candidate.id === map.id);
    if (index >= 0) void mutate({ type: "reorder-map", mapId: map.id, index: index + offset });
  }

  function deleteMap(map: BattleMap) {
    if (window.confirm(`Delete ${map.name}? Undo can restore it during this session.`)) {
      setCamera({ x: 0, y: 0, zoom: 1 });
      setSelectedTokenIds([]);
      void mutate({ type: "delete-map", mapId: map.id });
    }
  }

  function downloadRoomBackup() {
    const current = snapshotRef.current;
    if (!current) return;
    const file = new Blob([JSON.stringify({
      format: "20fates-room-backup",
      version: 1,
      roomId: current.roomId,
      createdAt: new Date().toISOString(),
      state: current.state,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${stateFileName(current.state.name)}-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadOwnerRecovery() {
    if (!isDm || !session?.dmKey) return;
    const file = new Blob([JSON.stringify({
      format: "20fates-room-owner",
      version: 1,
      roomId: session.roomId,
      dmKey: session.dmKey,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${stateFileName(snapshotRef.current?.state.name ?? "room")}-owner-key.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function restoreRoomBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text()) as { format?: string; state?: RoomState };
      if (backup.format !== "20fates-room-backup" || !backup.state) {
        throw new Error("Choose a 20Fates room backup file.");
      }
      if (window.confirm("Restore this backup over the current room? You can undo the restore.")) {
        if (await mutate({ type: "restore-room", state: backup.state })) {
          setCamera({ x: 0, y: 0, zoom: 1 });
          setSelectedTokenIds([]);
        }
      }
    } catch (restoreError) {
      setError(messageFrom(restoreError));
    } finally {
      input.value = "";
    }
  }

  function rollDiceFormula(formula: string) {
    void mutate({
      type: "roll-dice",
      formula,
      label: isDm ? "Dungeon Master" : playerName,
    });
  }

  function submitDice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    rollDiceFormula(String(data.get("formula") ?? "1d20"));
  }

  function turnOrderFor(map: BattleMap): TurnOrder {
    const current = snapshotRef.current?.state.turnOrder;
    return current?.mapId === map.id
      ? current
      : { mapId: map.id, entries: [], activeId: null, round: 1 };
  }

  function changeTurnOrder(map: BattleMap, change: (order: TurnOrder) => TurnOrder) {
    void mutate({ type: "set-turn-order", turnOrder: change(structuredClone(turnOrderFor(map))) });
  }

  function addMapTokensToTurns(map: BattleMap) {
    changeTurnOrder(map, (order) => {
      const tokenIds = new Set(order.entries.flatMap((entry) => entry.tokenId ? [entry.tokenId] : []));
      const additions = (snapshotRef.current?.state.tokens ?? [])
        .filter((token) => token.mapId === map.id && !tokenIds.has(token.id))
        .map((token) => ({
          id: crypto.randomUUID(),
          name: token.name,
          score: 0,
          tokenId: token.id,
        }));
      order.entries.push(...additions);
      return order;
    });
  }

  function addCustomTurn(event: FormEvent<HTMLFormElement>, map: BattleMap) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    changeTurnOrder(map, (order) => {
      order.entries.push({
        id: crypto.randomUUID(),
        name: String(data.get("name") ?? "Combatant"),
        score: Number(data.get("score") ?? 0),
        tokenId: null,
      });
      return order;
    });
    form.reset();
  }

  function setTurnScore(map: BattleMap, entryId: string, score: number) {
    if (!Number.isFinite(score)) return;
    changeTurnOrder(map, (order) => ({
      ...order,
      entries: order.entries.map((entry) => entry.id === entryId ? { ...entry, score } : entry),
    }));
  }

  function sortTurns(map: BattleMap) {
    changeTurnOrder(map, (order) => ({
      ...order,
      entries: [...order.entries].sort((left, right) => right.score - left.score),
    }));
  }

  function nextTurn(map: BattleMap) {
    changeTurnOrder(map, (order) => {
      if (!order.entries.length) return order;
      const current = order.entries.findIndex((entry) => entry.id === order.activeId);
      const next = current < 0 ? 0 : (current + 1) % order.entries.length;
      return {
        ...order,
        activeId: order.entries[next].id,
        round: current === order.entries.length - 1 ? order.round + 1 : order.round,
      };
    });
  }

  function removeTurn(map: BattleMap, entryId: string) {
    changeTurnOrder(map, (order) => {
      const entries = order.entries.filter((entry) => entry.id !== entryId);
      return {
        ...order,
        entries,
        activeId: order.activeId === entryId ? entries[0]?.id ?? null : order.activeId,
      };
    });
  }

  function setZoom(zoom: number) {
    setCamera((current) => ({ ...current, zoom: clamp(zoom, 0.25, 4) }));
  }

  function beginCameraPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!shouldBeginCameraPan({
      button: event.button,
      panToolActive: tool === "pan",
      region: cameraGestureRegion(event.target),
    })) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cameraDragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
    };
  }

  function moveCamera(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cameraDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCamera((current) => ({
      ...current,
      x: drag.cameraX + event.clientX - drag.startX,
      y: drag.cameraY + event.clientY - drag.startY,
    }));
  }

  function finishCameraPan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = cameraDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cameraDragRef.current = null;
    if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    }
  }

  function cancelCameraPan() {
    const drag = cameraDragRef.current;
    if (!drag) return;
    cameraDragRef.current = null;
    if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    }
  }

  function cameraGestureRegion(target: EventTarget | null) {
    if (target instanceof Element && target.closest("[data-camera-interface]")) return "interface";
    if (target instanceof Node && boardRef.current?.contains(target)) return "map";
    return "table-margin";
  }

  function zoomWithWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (cameraGestureRegion(event.target) === "interface") return;
    event.preventDefault();
    setZoom(camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  }

  function beginTokenDrag(event: ReactPointerEvent<HTMLButtonElement>, token: TableToken) {
    if (event.button !== 0) return;
    const selected = selectedTokenIds.includes(token.id);
    const tokenIds = event.shiftKey
      ? selected
        ? selectedTokenIds.filter((id) => id !== token.id)
        : [...selectedTokenIds, token.id]
      : selected
        ? selectedTokenIds
        : [token.id];
    setSelectedTokenIds(tokenIds);
    if (tool !== "move" || !canMoveToken(token) || token.locked || !tokenIds.includes(token.id)) return;
    const map = activeMap();
    const point = pointFromClient(event.clientX, event.clientY, map);
    if (!point) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origins = Object.fromEntries(
      (snapshotRef.current?.state.tokens ?? [])
        .filter((candidate) => tokenIds.includes(candidate.id) && canMoveToken(candidate) && !candidate.locked)
        .map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }]),
    );
    dragRef.current = {
      tokenIds: Object.keys(origins),
      primaryId: token.id,
      start: point,
      origins,
      measuring: false,
      joints: [],
    };
  }

  function addRightClickJoint(event: ReactMouseEvent<HTMLElement>): boolean {
    if (event.button !== 2) return false;
    const map = activeMap();
    const point = pointFromClient(event.clientX, event.clientY, map);
    if (!map || !point) return false;

    const drag = dragRef.current;
    if (drag && snapshotRef.current) {
      const token = snapshotRef.current.state.tokens.find((candidate) => candidate.id === drag.primaryId);
      const origin = drag.origins[drag.primaryId];
      if (!token || !origin) return false;
      const current = {
        x: token.x + (token.width ?? 1) / 2,
        y: token.y + (token.height ?? 1) / 2,
      };
      if (drag.measuring) drag.joints.push(current);
      else drag.measuring = true;
      setMeasure({
        kind: "distance",
        start: {
          x: origin.x + (token.width ?? 1) / 2,
          y: origin.y + (token.height ?? 1) / 2,
        },
        end: current,
        joints: drag.joints,
        beamWidth: 1,
      });
    } else if (drawingBarriersRef.current.length) {
      const snapped = snapBarrierPoint(point, map);
      const segments = [...drawingBarriersRef.current];
      const current = { ...segments.at(-1)!, end: snapped };
      if (Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y) < 0.1) {
        return false;
      }
      segments[segments.length - 1] = current;
      segments.push({ start: snapped, end: snapped, kind: current.kind });
      drawingBarriersRef.current = segments;
      setDrawingBarriers(segments);
    } else if (tool === "measure" && measure?.kind === "distance") {
      const bounded = {
        x: clamp(point.x, 0, map.columns),
        y: clamp(point.y, 0, map.rows),
      };
      setMeasure({
        ...measure,
        end: bounded,
        joints: [...(measure.joints ?? []), bounded],
      });
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handleBoardContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!addRightClickJoint(event)) event.preventDefault();
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const map = activeMap();
    if (!map) return;
    const point = pointFromClient(event.clientX, event.clientY, map);
    if (!point) return;

    if (drawingBarriersRef.current.length) {
      const segments = [...drawingBarriersRef.current];
      const drawing = {
        ...segments.at(-1)!,
        end: snapBarrierPoint(point, map),
      };
      segments[segments.length - 1] = drawing;
      drawingBarriersRef.current = segments;
      setDrawingBarriers(segments);
    } else if (dragRef.current && snapshotRef.current) {
      const drag = dragRef.current;
      const deltaX = point.x - drag.start.x;
      const deltaY = point.y - drag.start.y;
      const draggedSnapshot = {
        ...snapshotRef.current,
        state: {
          ...snapshotRef.current.state,
          tokens: snapshotRef.current.state.tokens.map((token) => {
            const origin = drag.origins[token.id];
            if (!origin) return token;
            const proposedX = origin.x + deltaX;
            const proposedY = origin.y + deltaY;
            return {
              ...token,
              x: clamp(event.altKey ? proposedX : Math.round(proposedX), 0, Math.max(0, map.columns - (token.width ?? 1))),
              y: clamp(event.altKey ? proposedY : Math.round(proposedY), 0, Math.max(0, map.rows - (token.height ?? 1))),
            };
          }),
        },
      };
      snapshotRef.current = draggedSnapshot;
      setSnapshot(draggedSnapshot);
      if (drag.measuring) {
        const token = draggedSnapshot.state.tokens.find((candidate) => candidate.id === drag.primaryId);
        const origin = drag.origins[drag.primaryId];
        if (token && origin) {
          setMeasure({
            kind: "distance",
            start: {
              x: origin.x + (token.width ?? 1) / 2,
              y: origin.y + (token.height ?? 1) / 2,
            },
            end: {
              x: token.x + (token.width ?? 1) / 2,
              y: token.y + (token.height ?? 1) / 2,
            },
            joints: drag.joints,
            beamWidth: 1,
          });
        }
      }
    } else if (tool === "measure" && measure) {
      setMeasure({ ...measure, end: point });
    }
  }

  function finishPointer(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event?.type === "pointerup" && event.button !== 0) return;
    if (drawingBarriersRef.current.length) {
      const barriers = drawingBarriersRef.current.filter((barrier) => Math.hypot(
        barrier.end.x - barrier.start.x,
        barrier.end.y - barrier.start.y,
      ) >= 0.1);
      drawingBarriersRef.current = [];
      setDrawingBarriers([]);
      const map = activeMap();
      if (map && barriers.length) void saveBarriers(map, barriers);
      return;
    }
    if (dragRef.current && snapshotRef.current) {
      const tokenIds = dragRef.current.tokenIds;
      const tokens = snapshotRef.current.state.tokens.filter((candidate) => tokenIds.includes(candidate.id));
      dragRef.current = null;
      if (tokens.length) {
        void mutate({
          type: "move-tokens",
          tokens: tokens.map((token) => ({ tokenId: token.id, x: token.x, y: token.y })),
        });
      }
    }
  }

  function beginBoardAction(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as Element).closest("[data-token], [data-lighting-control]")) return;
    const map = activeMap();
    const point = pointFromClient(event.clientX, event.clientY, map);
    if (!point || !map) return;
    if (tool === "ping") {
      void mutate({
        type: "ping-map",
        mapId: map.id,
        x: point.x,
        y: point.y,
        label: isDm ? "Dungeon Master" : playerName,
        color: tokenColors[isDm ? 0 : 1],
        focus: isDm && event.shiftKey,
      });
    } else if (editingLayer === "lighting" && selectedBarrier && isDm) {
      void reanchorSelectedBarrier(map, point);
    } else if (editingLayer === "lighting" && tool === "light" && isDm) {
      void placeLight(map, {
        x: clamp(point.x, 0, map.columns),
        y: clamp(point.y, 0, map.rows),
      });
    } else if (editingLayer === "lighting" && (tool === "wall" || tool === "door") && isDm) {
      const snapped = snapBarrierPoint(point, map);
      const drawing = { start: snapped, end: snapped, kind: tool } satisfies BarrierPreview;
      drawingBarriersRef.current = [drawing];
      setDrawingBarriers([drawing]);
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (tool === "measure") {
      const bounded = {
        x: clamp(point.x, 0, map.columns),
        y: clamp(point.y, 0, map.rows),
      };
      setMeasure({ kind: measureKind, start: bounded, end: bounded, joints: [], beamWidth });
    }
  }

  function moveTokenWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, token: TableToken) {
    if (!canMoveToken(token)) return;
    const directions: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.altKey ? 0.25 : 1;
    const ids = selectedTokenIds.includes(token.id) ? selectedTokenIds : [token.id];
    const tokens = (snapshotRef.current?.state.tokens ?? []).filter((candidate) =>
      ids.includes(candidate.id) && canMoveToken(candidate) && !candidate.locked,
    );
    if (!tokens.length) return;
    void mutate({
      type: "move-tokens",
      tokens: tokens.map((candidate) => ({
        tokenId: candidate.id,
        x: candidate.x + direction.x * step,
        y: candidate.y + direction.y * step,
      })),
    });
  }

  function handleTabletopKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copySelectedTokens();
    } else if (command && event.key.toLowerCase() === "v" && copiedTokenIds.length) {
      event.preventDefault();
      duplicateTokens(copiedTokenIds);
    } else if (command && event.key.toLowerCase() === "z" && isDm) {
      event.preventDefault();
      void mutate({ type: event.shiftKey ? "redo-room" : "undo-room" });
    } else if (event.key === "Delete" && selectedTokenIds.length) {
      event.preventDefault();
      deleteSelectedTokens();
    } else if (event.key === "Home") {
      event.preventDefault();
      setCamera({ x: 0, y: 0, zoom: 1 });
    } else if (event.key === "+" || event.key === "=") {
      setZoom(camera.zoom * 1.1);
    } else if (event.key === "-") {
      setZoom(camera.zoom * 0.9);
    } else if (event.key === "Escape") {
      cancelCameraPan();
      setSelectedTokenIds([]);
      setSelectedBarrier(null);
      setDrawingBarriers([]);
      drawingBarriersRef.current = [];
      setMeasure(null);
      setToolPanel(null);
      setTool("move");
    }
  }

  function activeMap(): BattleMap | null {
    const state = snapshotRef.current?.state;
    return state?.maps.find((map) => map.id === state.activeMapId) ?? null;
  }

  function pointFromClient(clientX: number, clientY: number, map: BattleMap | null) {
    const board = boardRef.current;
    if (!board || !map) return null;
    const rect = board.getBoundingClientRect();
    const grid = mapGridGeometry(map);
    return {
      x: ((clientX - rect.left) / rect.width - grid.offsetX) / grid.cellWidth,
      y: ((clientY - rect.top) / rect.height - grid.offsetY) / grid.cellHeight,
    };
  }

  function canControl(token: TableToken) {
    return isDm || token.ownerId === session?.clientId;
  }

  function canMoveToken(token: TableToken) {
    return editingLayer === "token" && canControl(token);
  }

  async function openCharacterSheet(token: TableToken) {
    const existing = snapshotRef.current?.state.characterSheets?.find((sheet) => sheet.tokenId === token.id);
    if (existing) {
      setOpenSheetId(existing.id);
      return;
    }
    const sheet = createCharacterSheet(token.id, token.name);
    setOpenSheetId(sheet.id);
    if (!await mutate({ type: "set-character-sheet", sheet })) setOpenSheetId(null);
  }

  function selectLayer(layer: ActiveLayer) {
    if (layer === editingLayer) {
      if (layer === "map" || layer === "lighting") setShowScenes(true);
      if (layer === "token") {
        setShowUtility(true);
        setUtilityPanel("journal");
      }
      if (layer === "dm") setPreviewPlayers(true);
      return;
    }
    if (layer === "lighting") {
      setLightingMessage(activeMap()?.lighting?.enabled
        ? "Dynamic lighting is on."
        : "Lighting is off for this map.");
    }
    setActiveLayer(layer);
    dragRef.current = null;
    setPreviewPlayers(layer === "dm");
    setTool("move");
    setToolPanel(null);
    setMeasure(null);
    setSelectedBarrier(null);
    drawingBarriersRef.current = [];
    setDrawingBarriers([]);
    if (layer === "map" || layer === "lighting") setShowScenes(true);
    if (layer === "token") {
      setShowUtility(true);
      setUtilityPanel("journal");
    }
  }

  function updatePlayerName(value: string) {
    const clean = value.slice(0, 30);
    setPlayerName(clean);
    localStorage.setItem("vtt:player-name", clean);
  }

  function savePlayerName() {
    if (session && playerName.trim()) void mutate({ type: "set-player-name", name: playerName });
  }

  async function recoverOwnedRoom(file: File) {
    setError("");
    try {
      const recovery = JSON.parse(await file.text()) as {
        format?: string;
        roomId?: string;
        dmKey?: string;
      };
      const roomId = normalizedRoomCode(recovery.roomId, true);
      if (
        !canManageRooms ||
        recovery.format !== "20fates-room-owner" ||
        !roomId ||
        !/^[a-f0-9]{64}$/i.test(recovery.dmKey ?? "")
      ) {
        throw new Error("Choose a valid 20Fates owner recovery file.");
      }
      localStorage.setItem(`vtt:dm:${roomId}`, recovery.dmKey!);
      enterRoom(roomId, recovery.dmKey);
    } catch (recoveryError) {
      setError(messageFrom(recoveryError));
    }
  }

  function leaveRoom() {
    const url = new URL(window.location.href);
    url.search = "";
    window.history.pushState({}, "", url);
    setSession(null);
    setOpenSheetId(null);
    setSelectedBarrier(null);
    setSelectedTokenIds([]);
    setCopiedTokenIds([]);
    setShowScenes(false);
    setShowUtility(true);
    setUtilityPanel("chat");
    snapshotRef.current = null;
    setSnapshot(null);
    setError("");
  }

  if (!ready) return <Loading label="Opening the tabletop…" />;
  if (!session) {
    return (
      <Lobby
        busy={busy}
        error={error}
        canManageRooms={canManageRooms}
        ownerSetupUserId={ownerSetupUserId}
        lastRoomId={lastRoomId}
        onCreate={createRoom}
        onJoin={(roomId) => enterRoom(roomId)}
        onReturn={() => enterRoom(
          lastRoomId,
          canManageRooms ? localStorage.getItem(`vtt:dm:${lastRoomId}`) ?? "" : "",
        )}
        onRecover={recoverOwnedRoom}
      />
    );
  }
  if (!snapshot) {
    return (
      <Loading
        label={error || `Joining room ${session.roomId}…`}
        action={<button onClick={leaveRoom}>Back to lobby</button>}
      />
    );
  }

  const state = snapshot.state;
  const map = currentMap ?? state.maps[0];
  const fogRestrictsView = Boolean(map.lighting?.enabled && (!isDm || previewPlayers));
  const visibleTokens = currentMapTokens.filter((token) =>
    !fogRestrictsView || viewerLighting.polygons.some((polygon) =>
      pointInPolygon({
        x: token.x + (token.width ?? 1) / 2,
        y: token.y + (token.height ?? 1) / 2,
      }, polygon),
    ),
  );
  const turnOrder = state.turnOrder?.mapId === map.id
    ? state.turnOrder
    : { mapId: map.id, entries: [], activeId: null, round: 1 } satisfies TurnOrder;
  const activeTurnTokenId = turnOrder.entries.find((entry) => entry.id === turnOrder.activeId)?.tokenId;
  const diceLog = state.diceLog ?? [];
  const openSheet = state.characterSheets?.find((sheet) => sheet.id === openSheetId);
  const sheetToken = openSheet
    ? state.tokens.find((token) => token.id === openSheet.tokenId)
    : null;
  const selectedToken = visibleTokens.find((token) => selectedTokenIds.includes(token.id)) ?? null;
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${session.roomId}`;
  const grid = mapGridGeometry(map);
  const modeDetail = layerDetails[editingLayer];
  const modeHint = editingLayer === "dm" && !map.lighting?.enabled
    ? "Dynamic lighting is off, so players can currently see the full scene"
    : modeDetail.hint;
  const activePing = state.ping?.mapId === map.id ? state.ping : null;
  const pingPoint = activePing ? normalizeMapPoint(activePing, map) : null;
  const boardStyle = {
    "--map-aspect": grid.imageAspect,
    "--cell-width": `${grid.cellWidth * 100}%`,
    "--cell-height": `${grid.cellHeight * 100}%`,
    "--map-image": map.imageKey
      ? `url("/api/media?key=${encodeURIComponent(map.imageKey)}")`
      : "none",
    aspectRatio: grid.imageAspect,
    transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
    transformOrigin: "center",
  } as CSSProperties;

  return (
    <main className="vtt-shell" onKeyDown={handleTabletopKeyDown}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">20</span>
          <div>
            <strong>20Fates Tabletop</strong>
            <span>{state.name}</span>
          </div>
        </div>
        <div className="tabletop-nav">
          {isDm ? (
            <button
              className={showScenes ? "scene-menu-button active" : "scene-menu-button"}
              aria-expanded={showScenes}
              onClick={() => setShowScenes((open) => !open)}
            >
              <span>Current scene</span><strong>{map.name}</strong><small>{state.maps.length}</small>
            </button>
          ) : (
            <div className="scene-menu-button scene-indicator" aria-label={`Current scene: ${map.name}`}>
              <span>Current scene</span><strong>{map.name}</strong>
            </div>
          )}
          <div className="room-chip" title="Find the full player link in the Game panel">
            Invite code <strong>{session.roomId}</strong>
          </div>
        </div>
        <div className="topbar-actions">
          {isDm && (
            <div className="history-buttons" aria-label="Undo history">
              <button disabled={!snapshot.canUndo} title="Undo (Ctrl+Z)" onClick={() => void mutate({ type: "undo-room" })}>↶ <span>Undo</span></button>
              <button disabled={!snapshot.canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => void mutate({ type: "redo-room" })}>↷ <span>Redo</span></button>
            </div>
          )}
          <span className="role-status">
            <strong>
              <span className="role-long">{isDm ? "Dungeon Master" : "Player"}</span>
              <span className="role-short">{isDm ? "DM" : "Player"}</span>
            </strong>
            <small className={`connection ${connection}`}><i />{connection === "online" ? "Connected" : connection}</small>
          </span>
          <button
            className={showUtility ? "panel-toggle active" : "panel-toggle"}
            aria-expanded={showUtility}
            aria-label={`${showUtility ? "Hide" : "Show"} game panel`}
            title={`${showUtility ? "Hide" : "Show"} game panel`}
            onClick={() => setShowUtility((open) => !open)}
          >Game panel</button>
          <button className="quiet-button" onClick={leaveRoom}>Leave game</button>
        </div>
      </header>

      <div className="status-stack">
        {error && <div className="error-banner" role="alert">{error}</div>}
        {busy && <div className="busy-banner" role="status">{busy}</div>}
      </div>

      <div className={showUtility ? "workspace" : "workspace utility-closed"}>
        {isDm && showScenes && (
        <aside className={`scene-drawer ${editingLayer === "map" || editingLayer === "lighting" ? "with-inspector" : ""}`} aria-label="Scene menu">
          <div className="sidebar-heading">
            <div><span>Scenes</span><strong>Choose a scene or edit its setup</strong></div>
            <div className="scene-drawer-actions">
              <button onClick={() => void createBlankScene()}>＋ New scene</button>
              <button onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy invite</button>
              <button aria-label="Close scene menu" onClick={() => setShowScenes(false)}>Close</button>
            </div>
          </div>
          <div className="map-library-tools">
            <input value={mapSearch} onChange={(event) => setMapSearch(event.target.value)} placeholder="Find a scene" aria-label="Find a scene" />
            <label><input type="checkbox" checked={showArchivedMaps} onChange={(event) => setShowArchivedMaps(event.target.checked)} /> Archived</label>
          </div>
          <div className="map-list">
            {!listedMaps.length && <p className="empty-library">No matching scenes.</p>}
            {listedMaps.map((candidate) => (
              <div className="map-row" key={candidate.id}>
                <button
                  className={candidate.id === map.id ? "map-card active" : "map-card"}
                  disabled={!isDm || candidate.archived}
                  onClick={() => {
                    if (candidate.id === map.id) return;
                    setCamera({ x: 0, y: 0, zoom: 1 });
                    setSelectedTokenIds([]);
                    dragRef.current = null;
                    cancelCameraPan();
                    setSelectedBarrier(null);
                    setDraftBarriers([]);
                    setDraftLights([]);
                    setLightingMessage(
                      candidate.lighting?.enabled
                        ? "Dynamic lighting is on."
                        : "Lighting is off for this map.",
                    );
                    setShowScenes(false);
                    void mutate({ type: "set-active-map", mapId: candidate.id });
                  }}
                >
                  <span className="map-thumb" style={candidate.imageKey ? { backgroundImage: `url("/api/media?key=${encodeURIComponent(candidate.imageKey)}")` } : undefined} />
                  <span><strong>{candidate.name}</strong><small>{candidate.folder ? `${candidate.folder} · ` : ""}{candidate.columns} × {candidate.rows}</small></span>
                </button>
                {isDm && candidate.archived && <button className="map-row-action" onClick={() => void mutate({ type: "archive-map", mapId: candidate.id, archived: false })}>Restore</button>}
                {isDm && !candidate.archived && candidate.id !== map.id && <button className="map-row-action" onClick={() => void mutate({ type: "archive-map", mapId: candidate.id, archived: true })}>Archive</button>}
              </div>
            ))}
          </div>
          <div className="scene-inspector">
          {editingLayer === "lighting" && (
              <div className="lighting-card">
                <div className="lighting-heading">
                  <span>Lighting setup</span>
                  <strong>{map.lighting?.enabled ? `On · ${map.lighting.lights.length} lights` : "Off"}</strong>
                </div>
                <div className="manual-light-controls">
                  <label>Range
                    <select value={manualLightRange} onChange={(event) => setManualLightRange(Number(event.target.value))}>
                      {[15, 20, 30, 40, 60, 90, 120].map((feet) => <option key={feet} value={feet}>{feet} ft</option>)}
                    </select>
                  </label>
                  <label>Color<input type="color" value={manualLightColor} onChange={(event) => setManualLightColor(event.target.value)} /></label>
                  <button className={tool === "light" ? "active" : ""} onClick={() => { setSelectedBarrier(null); setTool("light"); setMeasure(null); }}>Place light</button>
                </div>
                {selectedBarrier && (
                  <div className="selected-barrier-actions">
                    <strong>Wall selected</strong>
                    <span>Click the map where this segment&apos;s midpoint should move.</span>
                    <div>
                      <button className="delete-segment" onClick={() => deleteSelectedBarrier(map)}>Delete segment</button>
                      <button onClick={() => {
                        setSelectedBarrier(null);
                        setLightingMessage("Wall move canceled.");
                      }}>Cancel</button>
                    </div>
                  </div>
                )}
                {(draftBarriers.length > 0 || draftLights.length > 0) && (
                  <div className="draft-actions">
                    <button className="accept" onClick={() => void acceptLightingDraft(map)}>Accept draft</button>
                    <button onClick={() => {
                      setSelectedBarrier(null);
                      setDraftBarriers([]);
                      setDraftLights([]);
                      setLightingMessage("Automatic lighting draft discarded.");
                    }}>Discard</button>
                  </div>
                )}
                {Boolean(map.lighting?.barriers.length) && (
                  <button
                    className="clear-lighting"
                    onClick={() => {
                      if (window.confirm("Remove every wall and door from this map?")) void clearBarriers(map);
                    }}
                  >
                    Clear walls and doors
                  </button>
                )}
                {Boolean(map.lighting?.lights.length) && (
                  <button
                    className="clear-lighting"
                    onClick={() => {
                      if (window.confirm("Remove every light from this map?")) void clearLights(map);
                    }}
                  >
                    Clear lights
                  </button>
                )}
                <small aria-live="polite">{lightingMessage}</small>
                <small>Trace creates a reviewable draft from the artwork. Click a wall to move it, or an orange light to remove it. Accepted lights reveal only visible, wall-bounded areas.</small>
              </div>
          )}
          {editingLayer === "map" && (
            <>
              <form className="compact-form map-settings" key={`settings-${map.id}-${snapshot.revision}`} onSubmit={(event) => saveMapDetails(event, map)}>
                <h2>Scene details</h2>
                <label>Scene name<input name="name" defaultValue={map.name} maxLength={80} required /></label>
                <label>Folder<input name="folder" defaultValue={map.folder ?? ""} maxLength={40} placeholder="Chapter or location" /></label>
                <label className="check-field"><input name="gridVisible" type="checkbox" defaultChecked={map.gridVisible !== false} /> Show grid to everyone</label>
                <div className="form-row">
                  <label>Party start X<input name="landingX" type="number" min="0" max={map.columns} step="0.5" defaultValue={map.landing?.x ?? 1} /></label>
                  <label>Party start Y<input name="landingY" type="number" min="0" max={map.rows} step="0.5" defaultValue={map.landing?.y ?? 1} /></label>
                </div>
                <button className="primary-button">Save scene details</button>
                <div className="map-action-grid">
                  <button type="button" onClick={() => duplicateMap(map)}>Duplicate</button>
                  <button type="button" onClick={() => reorderMap(map, -1)}>Move earlier</button>
                  <button type="button" onClick={() => reorderMap(map, 1)}>Move later</button>
                  <button type="button" className="danger-button" disabled={state.maps.length <= 1} onClick={() => deleteMap(map)}>Delete</button>
                </div>
              </form>
              <section className="compact-form map-image-controls">
                <h2>Map &amp; grid</h2>
                <label className="file-picker primary-upload">
                  {map.imageKey ? "Replace map image" : "Upload map"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseSceneMap(event, map)} />
                </label>
                <div className="map-scale-controls">
                  <span><strong>{map.columns} × {map.rows}</strong><small>Linked map footprint</small></span>
                  <button type="button" aria-label="Scale map down proportionally" onClick={() => void scaleMapFootprint(map, 0.9)}>−</button>
                  <button type="button" aria-label="Scale map up proportionally" onClick={() => void scaleMapFootprint(map, 1.1)}>+</button>
                </div>
                <small className="grid-status" aria-live="polite">{gridMessage}</small>
                <label className="file-picker uvtt-picker">
                  Import Universal VTT map
                  <input type="file" accept=".uvtt,.dd2vtt,.df2vtt,application/json" onChange={importUvttMap} />
                </label>
              </section>
            </>
          )}
          </div>
        </aside>
        )}

        <section className="table-stage" aria-label={`${map.name} battlemap`}>
          <div
            ref={boardWrapRef}
            className="board-wrap"
            onPointerDown={beginCameraPan}
            onPointerMove={moveCamera}
            onPointerUp={finishCameraPan}
            onPointerCancel={finishCameraPan}
            onLostPointerCapture={finishCameraPan}
            onWheel={zoomWithWheel}
            onContextMenu={handleBoardContextMenu}
          >
            <nav className="table-hotbar" aria-label="Tabletop tools" data-camera-interface>
              <button
                className={showUtility && utilityPanel === "settings" ? "active" : ""}
                aria-label="Open game panel"
                title="Open game panel"
                onClick={() => { setToolPanel(null); setShowUtility(true); setUtilityPanel("settings"); }}
              ><span>☰</span><small>Game</small></button>
              <span className="tool-divider" aria-hidden="true" />
              {editingLayer === "token" && (
                <button
                  className={tool === "move" ? "active" : ""}
                  aria-label="Select and move tokens"
                  title="Select and move tokens"
                  onClick={() => { setTool("move"); setToolPanel(null); setMeasure(null); }}
                ><span>↖</span><small>Select</small></button>
              )}
              <button
                className={tool === "pan" ? "active" : ""}
                aria-label="Pan around map"
                title="Pan · right-drag works from any tool"
                onClick={() => { setTool("pan"); setToolPanel(null); setMeasure(null); }}
              ><span>✥</span><small>Pan</small></button>
              <button
                className={tool === "ping" ? "active" : ""}
                aria-label="Ping map"
                title={isDm ? "Ping map · hold Shift to focus everyone" : "Ping map"}
                onClick={() => { setTool("ping"); setToolPanel(null); setMeasure(null); }}
              ><span>◎</span><small>Ping</small></button>
              <span className="tool-divider" aria-hidden="true" />
              {isDm && editingLayer === "map" && (
                <button
                  disabled={Boolean(busy) || !map.imageKey}
                  aria-label="Automatically align map grid"
                  title={map.imageKey ? "Automatically align map grid" : "Upload a map image first"}
                  onClick={() => void alignMapGrid(map)}
                ><span>#</span><small>Auto-grid</small></button>
              )}
              {isDm && editingLayer === "lighting" && (
                <>
                  <button
                    className={map.lighting?.enabled ? "active" : ""}
                    aria-label={`Turn dynamic lighting ${map.lighting?.enabled ? "off" : "on"}`}
                    aria-pressed={Boolean(map.lighting?.enabled)}
                    onClick={() => { setSelectedBarrier(null); setTool("move"); setToolPanel(null); setMeasure(null); void toggleLighting(map); }}
                  ><span>☀</span><small>{map.lighting?.enabled ? "Lighting on" : "Lighting off"}</small></button>
                  <button
                    disabled={Boolean(busy) || !map.imageKey || Boolean(map.lighting?.barriers.length && map.lighting?.lights.length)}
                    aria-label="Trace lighting from artwork"
                    title={map.lighting?.barriers.length && map.lighting?.lights.length ? "This map already has walls and lights" : "Trace lighting from artwork"}
                    onClick={() => { setSelectedBarrier(null); setTool("move"); setToolPanel(null); setMeasure(null); void draftAutomaticLighting(map); }}
                  ><span>◇</span><small>Trace</small></button>
                  <button className={tool === "wall" ? "active" : ""} aria-label="Draw wall" title="Draw wall" onClick={() => { setSelectedBarrier(null); setTool("wall"); setToolPanel(null); setMeasure(null); }}>
                    <span>╱</span><small>Wall</small>
                  </button>
                  <button className={tool === "door" ? "active" : ""} aria-label="Draw door" title="Draw door" onClick={() => { setSelectedBarrier(null); setTool("door"); setToolPanel(null); setMeasure(null); }}>
                    <span>▯</span><small>Door</small>
                  </button>
                  <button className={tool === "light" ? "active" : ""} aria-label="Place light" title="Place light" onClick={() => { setSelectedBarrier(null); setTool("light"); setToolPanel(null); setMeasure(null); }}>
                    <span>✦</span><small>Light</small>
                  </button>
                </>
              )}
              <span className="tool-divider" aria-hidden="true" />
              <button
                className={tool === "measure" ? "active" : ""}
                aria-label="Measurement templates"
                title="Measurement templates"
                onClick={() => { setSelectedBarrier(null); setTool("measure"); setToolPanel(toolPanel === "measure" ? null : "measure"); }}
              ><span>⌁</span><small>Measure</small></button>
              <button
                className={toolPanel === "dice" ? "active" : ""}
                aria-label="Dice roller"
                title="Dice roller"
                onClick={() => { setSelectedBarrier(null); setTool("move"); setMeasure(null); setToolPanel(toolPanel === "dice" ? null : "dice"); }}
              ><span>⚄</span><small>Dice</small></button>
              <button
                className={toolPanel === "turns" ? "active" : ""}
                aria-label="Initiative tracker"
                title="Initiative tracker"
                onClick={() => { setSelectedBarrier(null); setTool("move"); setMeasure(null); setToolPanel(toolPanel === "turns" ? null : "turns"); }}
              ><span>☷</span><small>Initiative</small></button>
              {isDm && (
                <>
                  <span className="tool-divider" aria-hidden="true" />
                  <span className="tool-section-label">Workspace</span>
                  {(["token", "map", "dm", "lighting"] as ActiveLayer[]).map((layer) => {
                    const detail = layerDetails[layer];
                    return (
                      <button
                        key={layer}
                        className={editingLayer === layer ? "active layer-tool" : "layer-tool"}
                        aria-label={`${detail.label} mode`}
                        aria-pressed={editingLayer === layer}
                        title={detail.hint}
                        onClick={() => selectLayer(layer)}
                      ><span>{detail.mark}</span><small>{detail.label}</small></button>
                    );
                  })}
                </>
              )}
            </nav>

            <div className="zoom-controls" aria-label="Map zoom" data-camera-interface>
              <button aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(camera.zoom * 0.8)}>−</button>
              <button aria-label="Reset map view" title="Reset view (Home)" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>{Math.round(camera.zoom * 100)}%</button>
              <button aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(camera.zoom * 1.25)}>+</button>
            </div>

            {toolPanel === "measure" && (
              <section className="tool-popover measure-popover" aria-label="Measurement type" data-camera-interface>
                <header><strong>Measure</strong><button aria-label="Close measurement menu" onClick={() => setToolPanel(null)}>×</button></header>
                <div className="template-options">
                  {([
                    ["distance", "Distance"],
                    ["cone", "Cone"],
                    ["square", "Square"],
                    ["beam", "Beam"],
                    ["emanation", "Emanation"],
                  ] as Array<[MeasurementKind, string]>).map(([kind, label]) => (
                    <button
                      key={kind}
                      className={measureKind === kind ? "active" : ""}
                      onClick={() => { setMeasureKind(kind); setMeasure(null); setTool("measure"); }}
                    >{label}</button>
                  ))}
                </div>
                {measureKind === "beam" && (
                  <label>Beam width
                    <select value={beamWidth} onChange={(event) => { setBeamWidth(Number(event.target.value)); setMeasure(null); }}>
                      {[1, 2, 3, 4].map((width) => <option key={width} value={width}>{width * 5} ft</option>)}
                    </select>
                  </label>
                )}
                <p>Drag on the map. Every square—including diagonals—counts as 5 feet.</p>
              </section>
            )}

            {toolPanel === "dice" && (
              <section className="tool-popover dice-popover" aria-label="Dice roller" data-camera-interface>
                <header><strong>Dice roller</strong><button aria-label="Close dice roller" onClick={() => setToolPanel(null)}>×</button></header>
                <div className="quick-dice">
                  {[4, 6, 8, 10, 12, 20, 100].map((sides) => (
                    <button key={sides} onClick={() => rollDiceFormula(`1d${sides}`)}>d{sides}</button>
                  ))}
                </div>
                <form className="dice-form" onSubmit={submitDice}>
                  <input name="formula" defaultValue="1d20" aria-label="Dice formula" placeholder="2d6 + 3" />
                  <button>Roll</button>
                </form>
                <div className="dice-log" aria-live="polite">
                  {!diceLog.length && <p>No rolls yet.</p>}
                  {diceLog.slice(0, 10).map((roll) => (
                    <button className="dice-result" key={roll.id} title={`Roll ${roll.formula} again`} onClick={() => rollDiceFormula(roll.formula)}>
                      <span><strong>{roll.label}</strong><small>{roll.formula} · [{roll.rolls.join(", ")}]</small></span>
                      <b>{roll.total}</b>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {toolPanel === "turns" && (
              <section className="tool-popover turns-popover" aria-label="Turn order" data-camera-interface>
                <header><strong>Turn order · Round {turnOrder.round}</strong><button aria-label="Close turn order" onClick={() => setToolPanel(null)}>×</button></header>
                {isDm && (
                  <div className="turn-controls">
                    <button onClick={() => addMapTokensToTurns(map)}>Add map tokens</button>
                    <button onClick={() => sortTurns(map)}>Sort</button>
                    <button onClick={() => nextTurn(map)}>Next turn</button>
                    <button onClick={() => {
                      if (window.confirm("Clear the turn order?")) {
                        changeTurnOrder(map, (order) => ({ ...order, entries: [], activeId: null, round: 1 }));
                      }
                    }}>Clear</button>
                  </div>
                )}
                <div className="turn-list" aria-live="polite">
                  {!turnOrder.entries.length && <p>No combatants yet.</p>}
                  {turnOrder.entries.map((entry) => (
                    <div key={entry.id} className={entry.id === turnOrder.activeId ? "active" : ""}>
                      <span>{entry.name}</span>
                      {isDm ? (
                        <input
                          key={`${entry.id}:${entry.score}`}
                          type="number"
                          defaultValue={entry.score}
                          aria-label={`${entry.name} initiative`}
                          onBlur={(event) => setTurnScore(map, entry.id, Number(event.target.value))}
                        />
                      ) : <strong>{entry.score}</strong>}
                      {isDm && <button aria-label={`Remove ${entry.name}`} onClick={() => removeTurn(map, entry.id)}>×</button>}
                    </div>
                  ))}
                </div>
                {isDm && (
                  <form className="custom-turn-form" onSubmit={(event) => addCustomTurn(event, map)}>
                    <input name="name" placeholder="Custom combatant" maxLength={40} required />
                    <input name="score" type="number" defaultValue="0" aria-label="Initiative score" required />
                    <button>Add</button>
                  </form>
                )}
              </section>
            )}

            <div
              ref={boardRef}
              tabIndex={0}
              className={`battle-board ${map.imageKey ? "has-map" : "training-map"} ${map.grid ? "detected-grid" : ""} ${map.gridVisible === false ? "grid-hidden" : ""} layer-${editingLayer} tool-${tool} ${selectedBarrier ? "reanchoring" : ""}`}
              style={boardStyle}
              onPointerDown={beginBoardAction}
              onPointerMove={movePointer}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              onContextMenu={handleBoardContextMenu}
              onDragOver={allowBoardDrop}
              onDrop={(event) => void dropOnBoard(event)}
            >
              {activePing && pingPoint && (
                <div
                  key={activePing.id}
                  className="table-ping"
                  style={{
                    left: `${pingPoint.x * 100}%`,
                    top: `${pingPoint.y * 100}%`,
                    "--ping-color": activePing.color,
                  } as CSSProperties}
                ><span>{activePing.label}</span></div>
              )}
              <LightingLayer
                map={map}
                viewerId={lightingViewerId}
                isDm={isDm}
                previewPlayers={previewPlayers}
                showControls={isDm && editingLayer === "lighting" && !previewPlayers}
                visibility={viewerLighting}
                draftBarriers={draftBarriers}
                draftLights={draftLights}
                drawing={drawingBarriers}
                selectedBarrierId={selectedBarrier?.source === "accepted" ? selectedBarrier.id : null}
                selectedDraftBarrierIndex={selectedBarrier?.source === "draft" ? selectedBarrier.index : null}
                onDoorToggle={(barrierId) => void toggleDoor(map, barrierId)}
                onBarrierSelect={(barrierId) => {
                  setSelectedBarrier({ source: "accepted", id: barrierId });
                  setTool("move");
                  setToolPanel(null);
                  setMeasure(null);
                  setLightingMessage("Wall selected. Click the map to move its midpoint there.");
                }}
                onDraftSelect={(index) => {
                  setSelectedBarrier({ source: "draft", index });
                  setTool("move");
                  setToolPanel(null);
                  setMeasure(null);
                  setLightingMessage("Draft wall selected. Click the map to move its midpoint there.");
                }}
                onLightRemove={(lightId) => void removeLight(map, lightId)}
                onDraftLightRemove={(index) => setDraftLights((lights) =>
                  lights.filter((_, lightIndex) => lightIndex !== index),
                )}
                onReveal={revealMap}
              />
              {visibleTokens.map((token) => {
                const width = token.width ?? 1;
                const height = token.height ?? 1;
                const aura = token.auraRange ?? 0;
                const hpPercent = token.maxHp
                  ? clamp((token.hp ?? 0) / token.maxHp * 100, 0, 100)
                  : 0;
                return (
                  <div
                    key={token.id}
                    data-token
                    className={`token-object ${selectedTokenIds.includes(token.id) ? "selected" : ""} ${token.id === activeTurnTokenId ? "active-turn" : ""}`}
                    style={{
                      left: gridPosition(token.x, grid.offsetX, grid.cellWidth),
                      top: gridPosition(token.y, grid.offsetY, grid.cellHeight),
                      width: `${grid.cellWidth * width * 100}%`,
                      height: `${grid.cellHeight * height * 100}%`,
                    }}
                  >
                    {aura > 0 && (
                      <div
                        className="token-aura"
                        style={{
                          left: `${50 - aura / width * 100}%`,
                          top: `${50 - aura / height * 100}%`,
                          width: `${aura / width * 200}%`,
                          height: `${aura / height * 200}%`,
                          borderColor: token.auraColor ?? token.color,
                          backgroundColor: `${token.auraColor ?? token.color}22`,
                        }}
                      />
                    )}
                    <button
                      className={`table-token ${canMoveToken(token) && !token.locked ? "controllable" : ""} ${token.locked ? "locked" : ""}`}
                      aria-label={`${token.name} token${canMoveToken(token) && !token.locked ? ", draggable" : ""}`}
                      aria-pressed={selectedTokenIds.includes(token.id)}
                      title={token.locked ? `${token.name} · locked` : canMoveToken(token) ? `${token.name} · drag or use arrow keys` : token.name}
                      onPointerDown={(event) => beginTokenDrag(event, token)}
                      onKeyDown={(event) => moveTokenWithKeyboard(event, token)}
                    >
                      <span
                        className="token-face"
                        style={{
                          "--token-rotation": `${token.rotation ?? 0}deg`,
                          backgroundColor: token.color,
                          borderColor: token.color,
                          backgroundImage: token.imageKey ? `url("/api/media?key=${encodeURIComponent(token.imageKey)}")` : undefined,
                        } as CSSProperties}
                      >{!token.imageKey && initials(token.name)}</span>
                      {token.showName !== false && <span className="token-name">{token.name}</span>}
                      {Boolean(token.maxHp) && (
                        <span className="token-health" aria-label={`${token.hp ?? 0} of ${token.maxHp} hit points`}>
                          <i style={{ width: `${hpPercent}%` }} />
                          {Boolean(token.tempHp) && <b>{token.tempHp}</b>}
                        </span>
                      )}
                      {Boolean(token.statuses?.length) && (
                        <span className="token-statuses">
                          {token.statuses?.map((status) => <i key={status.id} title={`${status.label} ${status.count}`}>{status.label[0]}{status.count > 1 ? status.count : ""}</i>)}
                        </span>
                      )}
                      {token.locked && <span className="token-lock" aria-hidden="true">🔒</span>}
                    </button>
                  </div>
                );
              })}
              {measure && <MeasurementLayer map={map} template={measure} />}
            </div>
          </div>
          <footer className="stage-footer">
            <span className="stage-mode"><strong>{modeDetail.label} mode</strong><span>{modeHint}</span></span>
            <span>Esc cancels the current tool · Revision {snapshot.revision}</span>
          </footer>
        </section>

        {showUtility && (
        <aside className="sidebar token-sidebar" aria-label="Tabletop utility panel">
          <nav className="utility-tabs" aria-label="Utility panels">
            {([
              ["chat", "Rolls"],
              ["journal", "Characters"],
              ["assets", "Library"],
              ["settings", "Game"],
            ] as Array<[UtilityPanel, string]>).map(([panel, label]) => (
              <button
                key={panel}
                className={utilityPanel === panel ? "active" : ""}
                aria-pressed={utilityPanel === panel}
                onClick={() => setUtilityPanel(panel)}
              >{label}</button>
            ))}
          </nav>
          {utilityPanel === "journal" && (
          <div className="utility-scroll">
          <div className="sidebar-heading">
            <div><span>Characters</span><strong>Tokens and character sheets</strong></div>
          </div>
          {(!isDm || editingLayer === "token") && (
            <form className="compact-form token-form" onSubmit={addToken}>
              <h2>{isDm ? "Add a character or token" : "Add your character token"}</h2>
              <p className="panel-help">Place it on the current scene, then select it here to manage ownership and its sheet.</p>
              <label>Token name<input name="tokenName" placeholder={isDm ? "Goblin guard" : playerName} maxLength={40} /></label>
              <label className="file-picker">Choose portrait (optional)<input name="tokenFile" type="file" accept="image/png,image/jpeg,image/webp" /></label>
              <label>Ring color<select name="tokenColor" defaultValue={tokenColors[0]}>{tokenColorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <button className="primary-button" disabled={Boolean(busy)}>Add to current scene</button>
            </form>
          )}
          <div className="token-roster">
            <h2>On the current scene</h2>
            {visibleTokens.length === 0 && <p>No tokens yet.</p>}
            {visibleTokens.map((token) => (
              <div className={`roster-row ${selectedTokenIds.includes(token.id) ? "selected" : ""}`} key={token.id}>
                <i style={{ background: token.color }} />
                <button className="roster-select" onClick={(event) => setSelectedTokenIds(
                  event.shiftKey
                    ? selectedTokenIds.includes(token.id)
                      ? selectedTokenIds.filter((id) => id !== token.id)
                      : [...selectedTokenIds, token.id]
                    : [token.id],
                )}>
                  <span>{token.name}<small>{token.ownerId === session.clientId ? "Yours" : token.playerControlled ? state.players?.find((player) => player.id === token.ownerId)?.name ?? "Player token" : "DM token"}</small></span>
                </button>
                {canControl(token) && <button className="sheet-open-button" title={`Open ${token.name}'s character sheet`} onClick={() => void openCharacterSheet(token)}>Character</button>}
                {editingLayer === "token" && canControl(token) && <button title={`Remove ${token.name}`} onClick={() => { setSelectedTokenIds([token.id]); void mutate({ type: "delete-token", tokenId: token.id }); }}>×</button>}
              </div>
            ))}
          </div>
          {selectedToken && editingLayer === "token" && canControl(selectedToken) && (
            <section className="token-editor" key={`${selectedToken.id}:${snapshot.revision}`}>
              <header><strong>{selectedToken.name}</strong><span>{selectedTokenIds.length > 1 ? `${selectedTokenIds.length} selected` : "Selected token"}</span></header>
              <form onSubmit={(event) => saveTokenDetails(event, selectedToken)}>
                <label>Name<input name="name" defaultValue={selectedToken.name} maxLength={40} /></label>
                <div className="token-field-grid three">
                  <label>Width (squares)<input name="width" type="number" min="0.5" max="8" step="0.5" defaultValue={selectedToken.width ?? 1} /></label>
                  <label>Height (squares)<input name="height" type="number" min="0.5" max="8" step="0.5" defaultValue={selectedToken.height ?? 1} /></label>
                  <label>Facing (degrees)<input name="rotation" type="number" min="0" max="359" defaultValue={selectedToken.rotation ?? 0} /></label>
                </div>
                <div className="token-field-grid three">
                  <label>Hit points<input name="hp" type="number" min="0" defaultValue={selectedToken.hp ?? 0} /></label>
                  <label>Maximum HP<input name="maxHp" type="number" min="0" defaultValue={selectedToken.maxHp ?? 0} /></label>
                  <label>Temporary HP<input name="tempHp" type="number" min="0" defaultValue={selectedToken.tempHp ?? 0} /></label>
                </div>
                <div className="token-field-grid">
                  <label>Aura (feet)<input name="auraRange" type="number" min="0" max="300" step="5" defaultValue={(selectedToken.auraRange ?? 0) * 5} /></label>
                  <label>Aura color<input name="auraColor" type="color" defaultValue={selectedToken.auraColor ?? selectedToken.color} /></label>
                </div>
                <TokenColorPicker name="color" defaultValue={selectedToken.color} />
                <div className="token-checks">
                  <label><input name="showName" type="checkbox" defaultChecked={selectedToken.showName !== false} /> Nameplate</label>
                  {isDm && <label><input name="locked" type="checkbox" defaultChecked={selectedToken.locked === true} /> Lock movement</label>}
                </div>
                <button className="primary-button">Save token changes</button>
              </form>
              {isDm && (
                <div className="vision-editor" aria-label={`${selectedToken.name} ownership and vision settings`}>
                  <label>Controlled by
                    <select value={selectedToken.playerControlled ? selectedToken.ownerId : session.clientId} onChange={(event) => void mutate({ type: "set-token-owner", tokenId: selectedToken.id, ownerId: event.target.value })}>
                      <option value={session.clientId}>DM only</option>
                      {(state.players ?? []).filter((player) => !player.isDm).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                    </select>
                  </label>
                  <label>Shares sight
                    <select value={selectedToken.sharedSight === false ? "owner" : "party"} onChange={(event) => setTokenVision(selectedToken, event.target.value === "party", (selectedToken.visionRange ?? 12) * 5)}>
                      <option value="party">Party</option>
                      <option value="owner">Owner only</option>
                    </select>
                  </label>
                  <label>Vision (feet)
                    <input type="number" min="5" max="300" step="5" defaultValue={(selectedToken.visionRange ?? 12) * 5} onBlur={(event) => setTokenVision(selectedToken, selectedToken.sharedSight !== false, Number(event.target.value))} />
                  </label>
                </div>
              )}
              <div className="status-list">
                {(selectedToken.statuses ?? []).map((status) => <button key={status.id} title="Remove condition" onClick={() => removeTokenStatus(selectedToken, status.id)}>{status.label}{status.count > 1 ? ` ${status.count}` : ""} ×</button>)}
              </div>
              <form className="status-form" onSubmit={(event) => addTokenStatus(event, selectedToken)}>
                <select name="status" defaultValue={tokenConditions[0]}>{tokenConditions.map((condition) => <option key={condition}>{condition}</option>)}</select>
                <input name="count" type="number" min="1" max="99" defaultValue="1" aria-label="Condition count" />
                <button>Add</button>
              </form>
              <div className="token-editor-actions">
                <button onClick={() => void openCharacterSheet(selectedToken)}>Character sheet</button>
                <button onClick={copySelectedTokens}>Copy</button>
                <button disabled={!copiedTokenIds.length} onClick={() => duplicateTokens(copiedTokenIds)}>Paste</button>
                <button onClick={() => duplicateTokens(selectedTokenIds)}>Duplicate</button>
                <button className="danger-button" onClick={deleteSelectedTokens}>Delete</button>
              </div>
            </section>
          )}
          </div>
          )}
          {utilityPanel === "assets" && (
            <section className="utility-panel asset-panel" aria-label="Saved asset library">
              <header className="utility-heading"><span>Library</span><strong>Images saved to this game</strong></header>
              <div className="asset-upload-actions">
                <label className="file-picker">Save token image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void saveAssetFile(event, "token")} /></label>
                {isDm && <label className="file-picker">Save map image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void saveAssetFile(event, "map")} /></label>}
              </div>
              {!savedAssets.length && <p className="empty-library">Uploaded maps and tokens will remain here for reuse.</p>}
              {(["token", "map"] as const).map((kind) => {
                const assets = savedAssets.filter((asset) => asset.kind === kind);
                if (!assets.length || (kind === "map" && !isDm)) return null;
                return (
                  <div className="asset-group" key={kind}>
                    <h2>{kind === "map" ? "Maps" : "Tokens"}</h2>
                    <div className="asset-grid">
                      {assets.map((asset) => (
                        <article
                          className="asset-card"
                          key={asset.id}
                          draggable
                          onDragStart={(event) => beginAssetDrag(event, asset)}
                        >
                          <span className="asset-thumb" style={{ backgroundImage: `url("/api/media?key=${encodeURIComponent(asset.imageKey)}")` }} />
                          <strong>{asset.name}</strong>
                          <small>{asset.kind === "map" ? `${asset.columns ?? 20} × ${asset.rows ?? 12}` : "Drag onto the Token layer"}</small>
                          <button onClick={() => {
                            if (asset.kind === "map") setActiveLayer("map");
                            else setActiveLayer("token");
                            void placeSavedAsset(asset);
                          }}>{asset.kind === "map" ? "Use on scene" : "Place"}</button>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
              <small className="asset-library-note">These files persist with this game room. Drag them onto the matching layer or use the button.</small>
            </section>
          )}
          {utilityPanel === "chat" && (
            <section className="utility-panel chat-panel" aria-label="Shared roll log">
              <header className="utility-heading"><span>Rolls</span><strong>Shared results</strong></header>
              <form className="dice-form" onSubmit={submitDice}>
                <input name="formula" defaultValue="1d20" aria-label="Roll in chat" placeholder="2d6 + 3" />
                <button>Roll</button>
              </form>
              <div className="dice-log" aria-live="polite">
                {!diceLog.length && <p>No rolls yet.</p>}
                {diceLog.slice(0, 12).map((roll) => (
                  <div key={roll.id}>
                    <span><strong>{roll.label}</strong><small>{roll.formula} · [{roll.rolls.join(", ")}]</small></span>
                    <b>{roll.total}</b>
                  </div>
                ))}
              </div>
            </section>
          )}
          {utilityPanel === "settings" && (
            <section className="utility-panel room-panel">
              <div className="sidebar-heading">
                <div><span>Game</span><strong>{isDm ? "You are the Dungeon Master" : `Playing as ${playerName}`}</strong></div>
              </div>
              {!isDm && (
                <label className="name-field">Display name<input value={playerName} onChange={(event) => updatePlayerName(event.target.value)} onBlur={savePlayerName} maxLength={30} /></label>
              )}
              {isDm && (
            <div className="share-card">
              <span>Invite players</span>
              <strong>{session.roomId}</strong>
              <button onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy join link</button>
              <small>Share only the link or code. It grants player access, never DM control.</small>
            </div>
              )}
              {isDm && (
                <section className="recovery-card" aria-label="Backups and owner recovery">
                  <header><span>Recovery</span><strong>Backups &amp; owner access</strong></header>
                  <p>Save both files before an important game. The owner file is private and restores DM access on another browser.</p>
                  <button onClick={downloadRoomBackup}>Download game backup</button>
                  <label className="file-picker">Restore game backup<input type="file" accept="application/json,.json" onChange={restoreRoomBackup} /></label>
                  <button onClick={downloadOwnerRecovery}>Download owner recovery file</button>
                </section>
              )}
              <div className="room-details">
                <span>Scene<strong>{map.name}</strong></span>
                <span>Role<strong>{isDm ? "Dungeon Master" : "Player"}</strong></span>
                <span>Connection<strong className={connection}>{connection}</strong></span>
                <span>Revision<strong>{snapshot.revision}</strong></span>
              </div>
            </section>
          )}
        </aside>
        )}
      </div>
      {openSheet && sheetToken && (
        <CharacterSheetWindow
          key={openSheet.id}
          sheet={openSheet}
          tokenImageUrl={sheetToken.imageKey ? `/api/media?key=${encodeURIComponent(sheetToken.imageKey)}` : null}
          onChange={(sheet) => mutate({ type: "set-character-sheet", sheet })}
          onTokenImage={(file) => replaceTokenImage(sheetToken, file)}
          onRoll={rollDiceFormula}
          onClose={() => setOpenSheetId(null)}
        />
      )}
    </main>
  );
}

function Lobby({
  busy,
  error,
  canManageRooms,
  ownerSetupUserId,
  lastRoomId,
  onCreate,
  onJoin,
  onReturn,
  onRecover,
}: {
  busy: string;
  error: string;
  canManageRooms: boolean;
  ownerSetupUserId: string | null;
  lastRoomId: string;
  onCreate(name: string): Promise<void>;
  onJoin(roomId: string): void;
  onReturn(): void;
  onRecover(file: File): Promise<void>;
}) {
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void onCreate(String(data.get("roomName") ?? "Game room"));
  }
  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onJoin(String(data.get("roomCode") ?? ""));
  }

  return (
    <main className="lobby-shell">
      <div className="lobby-glow" aria-hidden="true" />
      <section className="lobby-card">
        <header className="lobby-brand"><span>20</span><strong>20Fates Tabletop</strong></header>
        <div className="lobby-intro">
          <p className="eyebrow">Shared tabletop</p>
          <h1>{canManageRooms ? "Start, join, or return to a game." : "Join your 20Fates game."}</h1>
          <p className="lobby-copy">
            {canManageRooms
              ? "Run a new table, continue on this browser, or enter a player invitation."
              : "Enter the invitation code from your Dungeon Master. No account is required."}
          </p>
        </div>
        {ownerSetupUserId && (
          <div className="lobby-error" role="status">
            Owner setup is fail-closed. While this Site is still owner-only, set
            <strong> VTT_OWNER_USER_ID </strong>to <code>{ownerSetupUserId}</code> in the Sites environment, then reload.
          </div>
        )}
        {error && <div className="lobby-error" role="alert">{error}</div>}
        {lastRoomId && (
          <section className="return-card" aria-label="Continue your last game">
            <div>
              <span>Continue on this browser</span>
              <strong>Return to your last game</strong>
              <small>Your saved access stays on this device.</small>
            </div>
            <button className="primary-button" disabled={Boolean(busy)} onClick={onReturn}>Return to game</button>
          </section>
        )}
        <div className="lobby-actions">
          {canManageRooms && (
            <section className="lobby-action-card">
              <header><span>Dungeon Master</span><h2>Start a new game</h2></header>
              <p>Create a fresh room and keep control on this browser.</p>
              <form onSubmit={create}>
                <label>Game name<input name="roomName" placeholder="Thursday Night D&D" maxLength={60} /></label>
                <button className="primary-button" disabled={Boolean(busy)}>{busy || "Create game as DM"}</button>
              </form>
            </section>
          )}
          <section className="lobby-action-card">
            <header><span>Player</span><h2>Join a game</h2></header>
            <p>Use the ten-character invitation from your Dungeon Master.</p>
            <form onSubmit={join}>
              <label>Invitation code<input name="roomCode" placeholder="ABCDE23456" minLength={publicRoomCodeLength} maxLength={publicRoomCodeLength} autoCapitalize="characters" required /></label>
              <button className="secondary-button">Join game as player</button>
            </form>
          </section>
        </div>
        {canManageRooms && (
          <section className="lobby-recovery">
            <div><strong>Changed browser or computer?</strong><span>Use your private owner recovery file to restore DM access.</span></div>
            <label className="recovery-picker">Recover a game as DM<input type="file" accept="application/json,.json" onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void onRecover(file);
            }} /></label>
          </section>
        )}
        <footer>Keep invitation codes private. Players do not need an account.</footer>
      </section>
    </main>
  );
}

function Loading({ label, action }: { label: string; action?: React.ReactNode }) {
  return <main className="loading-shell"><div className="loading-mark">20</div><p>{label}</p>{action}</main>;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function TokenColorPicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [color, setColor] = useState(defaultValue);
  const label = tokenColorOptions.find((option) => option.value === color.toLowerCase())?.label ?? "Custom color";
  return (
    <label>
      <span className="ring-color-heading">Ring color <small>{label}</small></span>
      <input
        name={name}
        type="color"
        defaultValue={defaultValue}
        onInput={(event) => setColor(event.currentTarget.value)}
      />
    </label>
  );
}

async function registerRoomPlayer(session: Session, name: string) {
  const response = await fetch("/api/room", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VTT-DM-Key": session.dmKey,
    },
    body: JSON.stringify({
      action: "mutate",
      roomId: session.roomId,
      clientId: session.clientId,
      operation: { type: "set-player-name", name },
    }),
  });
  if (!response.ok) throw new Error("Could not register this player.");
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function snapBarrierPoint(point: Point, map: BattleMap): Point {
  return {
    x: clamp(Math.round(point.x * 4) / 4, 0, map.columns),
    y: clamp(Math.round(point.y * 4) / 4, 0, map.rows),
  };
}

function lightingFor(map: BattleMap): MapLighting {
  return map.lighting ?? {
    enabled: false,
    darkness: 0.92,
    barriers: [],
    lights: [],
    explored: {},
  };
}

function base64ImageFile(base64: string, type: string, sourceName: string): File {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const extension = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  const name = sourceName.replace(/\.(?:uvtt|dd2vtt|df2vtt)$/i, "") || "map";
  return new File([bytes], `${name}.${extension}`, { type });
}

async function readImageData(image: Blob): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not inspect this map image.");
    context.drawImage(bitmap, 0, 0, width, height);
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bitmap.close();
  }
}

async function detectImageGrid(image: Blob): Promise<DetectedGrid | null> {
  const pixels = await readImageData(image);
  return detectSquareGrid(pixels.data, pixels.width, pixels.height);
}

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || "Untitled asset";
}

function stateFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
}
