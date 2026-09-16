import {
  type CharacterSheet,
  createCharacterSheet,
  normalizeCharacterSheet,
} from "./character-sheet.ts";
import { buildViewerLighting, cellsInsidePolygons } from "./lighting.ts";
import { isMediaKey } from "./public-access.ts";

export type BattleMap = {
  id: string;
  name: string;
  imageKey: string | null;
  columns: number;
  rows: number;
  grid?: GridCalibration;
  lighting?: MapLighting;
  folder?: string;
  archived?: boolean;
  gridVisible?: boolean;
  landing?: GridPoint;
};

export type GridCalibration = {
  offsetX: number;
  offsetY: number;
  cellWidth: number;
  cellHeight: number;
  imageAspect: number;
};

export type GridPoint = { x: number; y: number };

export type SightBarrier = {
  id: string;
  start: GridPoint;
  end: GridPoint;
  kind: "wall" | "door";
  open: boolean;
};

export type MapLight = {
  id: string;
  x: number;
  y: number;
  range: number;
  intensity: number;
  color: string;
};

export type MapLighting = {
  enabled: boolean;
  darkness: number;
  barriers: SightBarrier[];
  lights: MapLight[];
  explored: Record<string, number[]>;
};

export type TableToken = {
  id: string;
  mapId: string;
  ownerId: string;
  name: string;
  imageKey: string | null;
  color: string;
  x: number;
  y: number;
  sharedSight?: boolean;
  visionRange?: number;
  playerControlled?: boolean;
  width?: number;
  height?: number;
  rotation?: number;
  hp?: number;
  maxHp?: number;
  tempHp?: number;
  statuses?: TokenStatus[];
  auraRange?: number;
  auraColor?: string;
  showName?: boolean;
  locked?: boolean;
};

export type RoomAsset = {
  id: string;
  ownerId: string;
  kind: "map" | "token";
  name: string;
  imageKey: string;
  columns?: number;
  rows?: number;
  grid?: GridCalibration;
};

export type TokenStatus = {
  id: string;
  label: string;
  count: number;
};

export type RoomPlayer = {
  id: string;
  name: string;
  isDm: boolean;
};

export type TablePing = {
  id: string;
  mapId: string;
  actorId: string;
  label: string;
  color: string;
  x: number;
  y: number;
  focus: boolean;
  createdAt: number;
};

export type DiceRoll = {
  id: string;
  actorId: string;
  label: string;
  formula: string;
  rolls: number[];
  modifier: number;
  total: number;
  createdAt: number;
};

export type TurnEntry = {
  id: string;
  name: string;
  score: number;
  tokenId: string | null;
};

export type TurnOrder = {
  mapId: string;
  entries: TurnEntry[];
  activeId: string | null;
  round: number;
};

export type RoomState = {
  name: string;
  activeMapId: string;
  maps: BattleMap[];
  tokens: TableToken[];
  assets?: RoomAsset[];
  players?: RoomPlayer[];
  characterSheets?: CharacterSheet[];
  diceLog?: DiceRoll[];
  turnOrder?: TurnOrder;
  ping?: TablePing;
};

export type RoomOperation =
  | { type: "set-player-name"; name: string }
  | {
      type: "add-token";
      token: Omit<TableToken, "ownerId" | "mapId">;
    }
  | { type: "move-token"; tokenId: string; x: number; y: number }
  | { type: "move-tokens"; tokens: Array<{ tokenId: string; x: number; y: number }> }
  | { type: "set-token"; tokenId: string; token: Partial<TableToken> }
  | { type: "set-token-owner"; tokenId: string; ownerId: string }
  | { type: "duplicate-tokens"; tokenIds: string[]; newIds: string[] }
  | { type: "delete-tokens"; tokenIds: string[] }
  | { type: "delete-token"; tokenId: string }
  | { type: "set-character-sheet"; sheet: CharacterSheet }
  | { type: "add-asset"; asset: Omit<RoomAsset, "ownerId"> }
  | { type: "add-map"; map: BattleMap }
  | {
      type: "set-map-image";
      mapId: string;
      name: string;
      imageKey: string;
      columns: number;
      rows: number;
      grid?: GridCalibration;
      lighting?: MapLighting;
    }
  | {
      type: "set-map-details";
      mapId: string;
      name: string;
      folder: string;
      gridVisible: boolean;
      landing: GridPoint;
    }
  | { type: "duplicate-map"; mapId: string; newId: string }
  | { type: "reorder-map"; mapId: string; index: number }
  | { type: "archive-map"; mapId: string; archived: boolean }
  | { type: "delete-map"; mapId: string }
  | {
      type: "align-map-grid";
      mapId: string;
      columns: number;
      rows: number;
      grid: GridCalibration;
    }
  | { type: "set-map-lighting"; mapId: string; lighting: MapLighting }
  | { type: "set-token-vision"; tokenId: string; sharedSight: boolean; visionRange: number }
  | { type: "reveal-map"; mapId: string; scope: string; cells: number[] }
  | { type: "roll-dice"; formula: string; label: string }
  | { type: "set-turn-order"; turnOrder: TurnOrder }
  | { type: "set-active-map"; mapId: string }
  | { type: "ping-map"; mapId: string; x: number; y: number; label: string; color: string; focus: boolean }
  | { type: "restore-room"; state: RoomState }
  | { type: "undo-room" }
  | { type: "redo-room" };

export type RoomActor = {
  roomId: string;
  clientId: string;
  isDm: boolean;
};

export class RoomStateError extends Error {
  public readonly status: number;

  constructor(
    message: string,
    status = 400,
  ) {
    super(message);
    this.status = status;
  }
}

const idPattern = /^[A-Za-z0-9_-]{8,80}$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;

export function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

export function createInitialRoomState(name: string): RoomState {
  return {
    name: cleanName(name, 60, "Game room"),
    activeMapId: "training-hall",
    maps: [
      {
        id: "training-hall",
        name: "The Training Hall",
        imageKey: null,
        columns: 20,
        rows: 12,
        gridVisible: true,
        landing: { x: 1, y: 1 },
      },
    ],
    tokens: [],
    assets: [],
    players: [],
    characterSheets: [],
  };
}

export function parseRoomState(value: string): RoomState {
  const parsed = JSON.parse(value) as Partial<RoomState>;
  if (
    typeof parsed.name !== "string" ||
    typeof parsed.activeMapId !== "string" ||
    !Array.isArray(parsed.maps) ||
    !Array.isArray(parsed.tokens)
  ) {
    throw new Error("Room state is malformed.");
  }
  const state = parsed as RoomState;
  state.assets = validatedAssets(state.assets);
  state.players = Array.isArray(state.players)
    ? state.players.flatMap((player) => {
        if (!player || !isValidClientId(player.id)) return [];
        return [{
          id: player.id,
          name: cleanName(player.name, 30, player.isDm ? "Dungeon Master" : "Player"),
          isDm: player.isDm === true,
        }];
      }).slice(0, 50)
    : [];
  state.maps = state.maps.map((map) => ({
    ...map,
    folder: cleanOptionalText(map.folder, 40),
    archived: map.archived === true,
    gridVisible: map.gridVisible !== false,
    landing: normalizedLanding(map.landing, map),
  }));
  const sheetTokenIds = new Set(
    Array.isArray(state.characterSheets)
      ? state.characterSheets.flatMap((sheet) =>
          sheet && typeof sheet.tokenId === "string" ? [sheet.tokenId] : [],
        )
      : [],
  );
  state.tokens = state.tokens.map((token) => ({
    ...token,
    playerControlled: token.playerControlled ?? (
      token.sharedSight !== false || sheetTokenIds.has(token.id)
    ),
    width: numberInRange(token.width, 0.5, 8, 1),
    height: numberInRange(token.height, 0.5, 8, 1),
    rotation: normalizedRotation(token.rotation),
    hp: integerInRange(token.hp, 0, 100_000, 0),
    maxHp: integerInRange(token.maxHp, 0, 100_000, 0),
    tempHp: integerInRange(token.tempHp, 0, 100_000, 0),
    statuses: validatedStatuses(token.statuses),
    auraRange: numberInRange(token.auraRange, 0, 60, 0),
    auraColor: typeof token.auraColor === "string" && colorPattern.test(token.auraColor)
      ? token.auraColor
      : token.color,
    showName: token.showName !== false,
    locked: token.locked === true,
  }));
  if (!state.maps.some((map) => map.id === state.activeMapId && !map.archived)) {
    state.activeMapId = state.maps.find((map) => !map.archived)?.id ?? state.maps[0]?.id ?? "";
  }
  state.characterSheets = (state.characterSheets ?? []).map((sheet) => {
    const raw = sheet as unknown as Record<string, unknown>;
    if (typeof raw.id !== "string" || typeof raw.tokenId !== "string") {
      throw new Error("Room character sheet is malformed.");
    }
    const token = state.tokens.find((candidate) => candidate.id === raw.tokenId);
    if (!token) throw new Error("Room character sheet token is missing.");
    return normalizeCharacterSheet(raw, createCharacterSheet(raw.tokenId, token.name, raw.id));
  });
  if (state.ping && (
    !idPattern.test(state.ping.id) ||
    !state.maps.some((map) => map.id === state.ping?.mapId)
  )) {
    delete state.ping;
  }
  return state;
}

export function applyRoomOperation(
  current: RoomState,
  operation: unknown,
  actor: RoomActor,
): RoomState {
  if (!operation || typeof operation !== "object") {
    throw new RoomStateError("A tabletop operation is required.");
  }

  const input = operation as Record<string, unknown>;
  const next = structuredClone(current);

  switch (input.type) {
    case "set-player-name": {
      const players = next.players ?? [];
      const player: RoomPlayer = {
        id: actor.clientId,
        name: cleanName(input.name, 30, actor.isDm ? "Dungeon Master" : "Player"),
        isDm: actor.isDm,
      };
      next.players = players.some((candidate) => candidate.id === actor.clientId)
        ? players.map((candidate) => candidate.id === actor.clientId ? player : candidate)
        : [...players, player].slice(-50);
      if (!actor.isDm) {
        next.tokens.forEach((token) => {
          if (token.ownerId === actor.clientId) token.playerControlled = true;
        });
      }
      return next;
    }

    case "add-token": {
      if (next.tokens.length >= 200) {
        throw new RoomStateError("This room already has its maximum of 200 tokens.");
      }
      const raw = input.token;
      if (!raw || typeof raw !== "object") {
        throw new RoomStateError("Token details are required.");
      }
      const token = raw as Record<string, unknown>;
      const id = requireId(token.id, "token id");
      if (next.tokens.some((candidate) => candidate.id === id)) {
        throw new RoomStateError("That token already exists.");
      }
      const activeMap = requireActiveMap(next);
      const imageKey = optionalAssetKey(
        token.imageKey,
        `${actor.roomId}/token/`,
      );
      const name = cleanName(token.name, 40, "Adventurer");
      next.tokens.push({
        id,
        mapId: activeMap.id,
        ownerId: actor.clientId,
        name,
        imageKey,
        color:
          typeof token.color === "string" && colorPattern.test(token.color)
            ? token.color
            : "#d6a84b",
        x: clampNumber(token.x, 0, activeMap.columns - 1, 1),
        y: clampNumber(token.y, 0, activeMap.rows - 1, 1),
        sharedSight: !actor.isDm,
        visionRange: 12,
        playerControlled: !actor.isDm,
        width: 1,
        height: 1,
        rotation: 0,
        hp: 0,
        maxHp: 0,
        tempHp: 0,
        statuses: [],
        auraRange: 0,
        auraColor: typeof token.color === "string" && colorPattern.test(token.color)
          ? token.color
          : "#d6a84b",
        showName: true,
        locked: false,
      });
      if (imageKey) rememberAsset(next, {
        id: `asset-${id}`,
        ownerId: actor.clientId,
        kind: "token",
        name,
        imageKey,
      });
      return next;
    }

    case "move-token": {
      const tokenId = requireId(input.tokenId, "token id");
      const token = next.tokens.find((candidate) => candidate.id === tokenId);
      if (!token) throw new RoomStateError("Token not found.", 404);
      moveToken(token, input.x, input.y, next, actor);
      return next;
    }

    case "move-tokens": {
      if (!Array.isArray(input.tokens) || input.tokens.length < 1 || input.tokens.length > 200) {
        throw new RoomStateError("Move between 1 and 200 tokens at a time.");
      }
      const moves = input.tokens.map((value) => {
        if (!value || typeof value !== "object") throw new RoomStateError("Invalid token move.");
        const move = value as Record<string, unknown>;
        const tokenId = requireId(move.tokenId, "token id");
        const token = next.tokens.find((candidate) => candidate.id === tokenId);
        if (!token) throw new RoomStateError("Token not found.", 404);
        assertCanMove(token, actor);
        return { token, x: move.x, y: move.y };
      });
      if (new Set(moves.map(({ token }) => token.id)).size !== moves.length) {
        throw new RoomStateError("Each token can only move once per update.");
      }
      for (const move of moves) moveToken(move.token, move.x, move.y, next, actor);
      return next;
    }

    case "set-token": {
      const tokenId = requireId(input.tokenId, "token id");
      const token = next.tokens.find((candidate) => candidate.id === tokenId);
      if (!token) throw new RoomStateError("Token not found.", 404);
      assertCanControl(token, actor);
      if (!input.token || typeof input.token !== "object") {
        throw new RoomStateError("Token settings are required.");
      }
      const patch = input.token as Record<string, unknown>;
      const map = next.maps.find((candidate) => candidate.id === token.mapId);
      if (!map) throw new RoomStateError("Token map not found.", 409);
      if (patch.name !== undefined) token.name = cleanName(patch.name, 40, token.name);
      if (patch.imageKey !== undefined) {
        token.imageKey = optionalAssetKey(patch.imageKey, `${actor.roomId}/token/`);
        if (token.imageKey) rememberAsset(next, {
          id: `asset-${token.id}-${next.assets?.length ?? 0}`,
          ownerId: actor.clientId,
          kind: "token",
          name: token.name,
          imageKey: token.imageKey,
        });
      }
      if (patch.color !== undefined) {
        token.color = typeof patch.color === "string" && colorPattern.test(patch.color)
          ? patch.color
          : token.color;
      }
      token.width = numberInRange(patch.width, 0.5, 8, token.width ?? 1);
      token.height = numberInRange(patch.height, 0.5, 8, token.height ?? 1);
      token.rotation = normalizedRotation(patch.rotation ?? token.rotation);
      token.hp = integerInRange(patch.hp, 0, 100_000, token.hp ?? 0);
      token.maxHp = integerInRange(patch.maxHp, 0, 100_000, token.maxHp ?? 0);
      token.tempHp = integerInRange(patch.tempHp, 0, 100_000, token.tempHp ?? 0);
      if (patch.statuses !== undefined) token.statuses = validatedStatuses(patch.statuses);
      token.auraRange = numberInRange(patch.auraRange, 0, 60, token.auraRange ?? 0);
      if (patch.auraColor !== undefined) {
        token.auraColor = typeof patch.auraColor === "string" && colorPattern.test(patch.auraColor)
          ? patch.auraColor
          : token.auraColor ?? token.color;
      }
      if (patch.showName !== undefined) token.showName = patch.showName !== false;
      if (actor.isDm && patch.locked !== undefined) token.locked = patch.locked === true;
      token.x = clampNumber(token.x, 0, Math.max(0, map.columns - (token.width ?? 1)), 0);
      token.y = clampNumber(token.y, 0, Math.max(0, map.rows - (token.height ?? 1)), 0);
      return next;
    }

    case "set-token-owner": {
      requireDm(actor);
      const tokenId = requireId(input.tokenId, "token id");
      const token = next.tokens.find((candidate) => candidate.id === tokenId);
      if (!token) throw new RoomStateError("Token not found.", 404);
      const ownerId = requireId(input.ownerId, "token owner id");
      const player = next.players?.find((candidate) => candidate.id === ownerId);
      if (ownerId !== actor.clientId && (!player || player.isDm)) {
        throw new RoomStateError("Choose a player who has joined this room.");
      }
      token.ownerId = ownerId;
      token.playerControlled = ownerId !== actor.clientId;
      return next;
    }

    case "duplicate-tokens": {
      if (
        !Array.isArray(input.tokenIds) || !Array.isArray(input.newIds) ||
        input.tokenIds.length < 1 || input.tokenIds.length > 20 ||
        input.tokenIds.length !== input.newIds.length ||
        next.tokens.length + input.tokenIds.length > 200
      ) {
        throw new RoomStateError("Duplicate between 1 and 20 tokens at a time.");
      }
      const targetMap = requireActiveMap(next);
      const newIds = input.newIds.map((value) => requireId(value, "new token id"));
      if (new Set(newIds).size !== newIds.length || newIds.some((id) => next.tokens.some((token) => token.id === id))) {
        throw new RoomStateError("Duplicate token ids must be unique.");
      }
      const copies = input.tokenIds.map((value, index) => {
        const tokenId = requireId(value, "token id");
        const token = next.tokens.find((candidate) => candidate.id === tokenId);
        if (!token) throw new RoomStateError("Token not found.", 404);
        assertCanControl(token, actor);
        const copy = structuredClone(token);
        copy.id = newIds[index];
        copy.mapId = targetMap.id;
        copy.name = cleanName(`${token.name} copy`, 40, "Token copy");
        copy.x = clampNumber(token.x + 0.5 + index * 0.25, 0, Math.max(0, targetMap.columns - (copy.width ?? 1)), 1);
        copy.y = clampNumber(token.y + 0.5 + index * 0.25, 0, Math.max(0, targetMap.rows - (copy.height ?? 1)), 1);
        copy.locked = false;
        return copy;
      });
      next.tokens.push(...copies);
      return next;
    }

    case "delete-token": {
      const tokenId = requireId(input.tokenId, "token id");
      const token = next.tokens.find((candidate) => candidate.id === tokenId);
      if (!token) throw new RoomStateError("Token not found.", 404);
      if (!actor.isDm && token.ownerId !== actor.clientId) {
        throw new RoomStateError("You can only remove your own token.", 403);
      }
      next.tokens = next.tokens.filter((candidate) => candidate.id !== tokenId);
      next.characterSheets = (next.characterSheets ?? []).filter((sheet) => sheet.tokenId !== tokenId);
      if (next.turnOrder) {
        next.turnOrder.entries = next.turnOrder.entries.filter((entry) => entry.tokenId !== tokenId);
        if (!next.turnOrder.entries.some((entry) => entry.id === next.turnOrder?.activeId)) {
          next.turnOrder.activeId = next.turnOrder.entries[0]?.id ?? null;
        }
      }
      return next;
    }

    case "delete-tokens": {
      if (!Array.isArray(input.tokenIds) || input.tokenIds.length < 1 || input.tokenIds.length > 20) {
        throw new RoomStateError("Remove between 1 and 20 tokens at a time.");
      }
      const tokenIds = input.tokenIds.map((value) => requireId(value, "token id"));
      if (new Set(tokenIds).size !== tokenIds.length) throw new RoomStateError("Token ids must be unique.");
      for (const tokenId of tokenIds) {
        const token = next.tokens.find((candidate) => candidate.id === tokenId);
        if (!token) throw new RoomStateError("Token not found.", 404);
        assertCanControl(token, actor);
      }
      const removed = new Set(tokenIds);
      next.tokens = next.tokens.filter((token) => !removed.has(token.id));
      next.characterSheets = (next.characterSheets ?? []).filter((sheet) => !removed.has(sheet.tokenId));
      if (next.turnOrder) {
        next.turnOrder.entries = next.turnOrder.entries.filter((entry) => !entry.tokenId || !removed.has(entry.tokenId));
        if (!next.turnOrder.entries.some((entry) => entry.id === next.turnOrder?.activeId)) {
          next.turnOrder.activeId = next.turnOrder.entries[0]?.id ?? null;
        }
      }
      return next;
    }

    case "set-character-sheet": {
      if (!input.sheet || typeof input.sheet !== "object") {
        throw new RoomStateError("Character sheet details are required.");
      }
      if (JSON.stringify(input.sheet).length > 500_000) {
        throw new RoomStateError("Character sheet is too large.");
      }
      const rawSheet = input.sheet as Record<string, unknown>;
      const id = requireId(rawSheet.id, "character sheet id");
      const tokenId = requireId(rawSheet.tokenId, "character sheet token id");
      const token = next.tokens.find((candidate) => candidate.id === tokenId);
      if (!token) throw new RoomStateError("Character token not found.", 404);
      if (!actor.isDm && token.ownerId !== actor.clientId) {
        throw new RoomStateError("You can only edit your own character sheet.", 403);
      }

      const sheets = next.characterSheets ?? [];
      const existing = sheets.find((sheet) => sheet.id === id);
      const tokenSheet = sheets.find((sheet) => sheet.tokenId === tokenId);
      if (existing && existing.tokenId !== tokenId) {
        throw new RoomStateError("Character sheet belongs to another token.", 409);
      }
      if (tokenSheet && tokenSheet.id !== id) {
        throw new RoomStateError("That token already has a character sheet.", 409);
      }
      if (!existing && sheets.length >= 200) {
        throw new RoomStateError("This room already has its maximum of 200 character sheets.");
      }

      const fallback = existing ?? createCharacterSheet(tokenId, token.name, id);
      const sheet = normalizeCharacterSheet({ ...rawSheet, id, tokenId }, fallback);
      next.characterSheets = existing
        ? sheets.map((candidate) => candidate.id === id ? sheet : candidate)
        : [...sheets, sheet];
      return next;
    }

    case "add-asset": {
      if (!input.asset || typeof input.asset !== "object") {
        throw new RoomStateError("Asset details are required.");
      }
      const raw = input.asset as Record<string, unknown>;
      const kind = raw.kind === "map" ? "map" : raw.kind === "token" ? "token" : null;
      if (!kind) throw new RoomStateError("Asset type must be map or token.");
      if (kind === "map") requireDm(actor);
      const imageKey = requiredAssetKey(raw.imageKey, `${actor.roomId}/${kind}/`);
      rememberAsset(next, {
        id: requireId(raw.id, "asset id"),
        ownerId: actor.clientId,
        kind,
        name: cleanName(raw.name, 80, kind === "map" ? "Untitled map" : "Token"),
        imageKey,
        columns: kind === "map" ? integerInRange(raw.columns, 4, 100, 20) : undefined,
        rows: kind === "map" ? integerInRange(raw.rows, 4, 100, 12) : undefined,
        grid: kind === "map" ? optionalGridCalibration(raw.grid) : undefined,
      });
      return next;
    }

    case "add-map": {
      requireDm(actor);
      if (next.maps.length >= 100) {
        throw new RoomStateError("This room already has its maximum of 100 maps.");
      }
      const raw = input.map;
      if (!raw || typeof raw !== "object") {
        throw new RoomStateError("Map details are required.");
      }
      const map = raw as Record<string, unknown>;
      const id = requireId(map.id, "map id");
      if (next.maps.some((candidate) => candidate.id === id)) {
        throw new RoomStateError("That map already exists.");
      }
      const addedMap: BattleMap = {
        id,
        name: cleanName(map.name, 80, "Untitled map"),
        imageKey: optionalAssetKey(map.imageKey, `${actor.roomId}/map/`),
        columns: integerInRange(map.columns, 4, 100, 20),
        rows: integerInRange(map.rows, 4, 100, 12),
        grid: optionalGridCalibration(map.grid),
        folder: cleanOptionalText(map.folder, 40),
        archived: false,
        gridVisible: map.gridVisible !== false,
        landing: { x: 1, y: 1 },
      };
      if (map.lighting !== undefined) {
        addedMap.lighting = validatedLighting(map.lighting, addedMap);
      }
      next.maps.push(addedMap);
      if (addedMap.imageKey) rememberAsset(next, {
        id: `asset-${id}`,
        ownerId: actor.clientId,
        kind: "map",
        name: addedMap.name,
        imageKey: addedMap.imageKey,
        columns: addedMap.columns,
        rows: addedMap.rows,
        grid: addedMap.grid,
      });
      next.activeMapId = id;
      placePartyTokens(next, addedMap);
      return next;
    }

    case "set-map-image": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map) throw new RoomStateError("Map not found.", 404);
      map.name = cleanName(input.name, 80, map.name);
      map.imageKey = requiredAssetKey(input.imageKey, `${actor.roomId}/map/`);
      map.columns = integerInRange(input.columns, 4, 100, map.columns);
      map.rows = integerInRange(input.rows, 4, 100, map.rows);
      map.grid = optionalGridCalibration(input.grid);
      map.lighting = input.lighting === undefined
        ? undefined
        : validatedLighting(input.lighting, map);
      map.landing = normalizedLanding(map.landing, map);
      for (const token of next.tokens.filter((candidate) => candidate.mapId === map.id)) {
        token.x = clampNumber(token.x, 0, Math.max(0, map.columns - (token.width ?? 1)), 0);
        token.y = clampNumber(token.y, 0, Math.max(0, map.rows - (token.height ?? 1)), 0);
      }
      rememberAsset(next, {
        id: `asset-${map.id}-${next.assets?.length ?? 0}`,
        ownerId: actor.clientId,
        kind: "map",
        name: map.name,
        imageKey: map.imageKey,
        columns: map.columns,
        rows: map.rows,
        grid: map.grid,
      });
      return next;
    }

    case "set-map-details": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map) throw new RoomStateError("Map not found.", 404);
      map.name = cleanName(input.name, 80, map.name);
      map.folder = cleanOptionalText(input.folder, 40);
      map.gridVisible = input.gridVisible !== false;
      map.landing = validatedPoint(input.landing, map);
      return next;
    }

    case "duplicate-map": {
      requireDm(actor);
      if (next.maps.length >= 100) {
        throw new RoomStateError("This room already has its maximum of 100 maps.");
      }
      const mapId = requireId(input.mapId, "map id");
      const sourceIndex = next.maps.findIndex((candidate) => candidate.id === mapId);
      if (sourceIndex < 0) throw new RoomStateError("Map not found.", 404);
      const newId = requireId(input.newId, "new map id");
      if (next.maps.some((candidate) => candidate.id === newId)) {
        throw new RoomStateError("That map already exists.");
      }
      const copy = structuredClone(next.maps[sourceIndex]);
      copy.id = newId;
      copy.name = cleanName(`${copy.name} copy`, 80, "Map copy");
      copy.archived = false;
      if (copy.lighting) copy.lighting.explored = {};
      next.maps.splice(sourceIndex + 1, 0, copy);
      return next;
    }

    case "reorder-map": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      const currentIndex = next.maps.findIndex((candidate) => candidate.id === mapId);
      if (currentIndex < 0) throw new RoomStateError("Map not found.", 404);
      const index = integerInRange(input.index, 0, next.maps.length - 1, currentIndex);
      const [map] = next.maps.splice(currentIndex, 1);
      next.maps.splice(index, 0, map);
      return next;
    }

    case "archive-map": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map) throw new RoomStateError("Map not found.", 404);
      const archived = input.archived === true;
      if (archived && map.id === next.activeMapId) {
        throw new RoomStateError("Switch scenes before archiving the active map.");
      }
      map.archived = archived;
      return next;
    }

    case "delete-map": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      if (next.maps.length <= 1) throw new RoomStateError("A room must keep at least one map.");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map) throw new RoomStateError("Map not found.", 404);
      const fallback = next.maps.find((candidate) => candidate.id !== mapId && !candidate.archived)
        ?? next.maps.find((candidate) => candidate.id !== mapId);
      if (!fallback) throw new RoomStateError("No replacement map is available.", 409);
      const removedNpcIds = new Set(
        next.tokens
          .filter((token) => token.mapId === mapId && token.playerControlled !== true)
          .map((token) => token.id),
      );
      next.maps = next.maps.filter((candidate) => candidate.id !== mapId);
      next.tokens = next.tokens.filter((token) => !removedNpcIds.has(token.id));
      next.characterSheets = (next.characterSheets ?? []).filter((sheet) => !removedNpcIds.has(sheet.tokenId));
      if (next.activeMapId === mapId) next.activeMapId = fallback.id;
      placePartyTokens(next, next.maps.find((candidate) => candidate.id === next.activeMapId) ?? fallback);
      if (next.turnOrder?.mapId === mapId) delete next.turnOrder;
      return next;
    }

    case "align-map-grid": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map?.imageKey) throw new RoomStateError("Map image not found.", 404);
      const grid = optionalGridCalibration(input.grid);
      if (!grid) throw new RoomStateError("Grid calibration is required.");
      map.columns = integerInRange(input.columns, 4, 100, map.columns);
      map.rows = integerInRange(input.rows, 4, 100, map.rows);
      map.grid = grid;
      const asset = next.assets?.find((candidate) => candidate.imageKey === map.imageKey);
      if (asset?.kind === "map") {
        asset.columns = map.columns;
        asset.rows = map.rows;
        asset.grid = map.grid;
      }
      return next;
    }

    case "set-map-lighting": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map) throw new RoomStateError("Map not found.", 404);
      const configured = validatedLighting(input.lighting, map);
      if (map.lighting) {
        configured.explored = mergedExploration(
          map.lighting.explored,
          configured.explored,
          map.columns * map.rows,
        );
      }
      map.lighting = configured;
      return next;
    }

    case "set-token-vision": {
      requireDm(actor);
      const tokenId = requireId(input.tokenId, "token id");
      const token = next.tokens.find((candidate) => candidate.id === tokenId);
      if (!token) throw new RoomStateError("Token not found.", 404);
      token.sharedSight = input.sharedSight !== false;
      token.visionRange = numberInRange(input.visionRange, 1, 60, 12);
      return next;
    }

    case "reveal-map": {
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map?.lighting?.enabled) throw new RoomStateError("Map lighting is unavailable.", 409);
      const scope = input.scope === "shared" ? "shared" : input.scope === actor.clientId ? actor.clientId : "";
      if (!scope) throw new RoomStateError("Invalid fog scope.", 403);
      if (!Array.isArray(input.cells) || input.cells.length > 10000) {
        throw new RoomStateError("Invalid explored area update.");
      }
      const maximumCell = map.columns * map.rows - 1;
      if (!actor.isDm) {
        const visibility = buildViewerLighting(
          map,
          next.tokens.filter((token) => token.mapId === map.id),
          actor.clientId,
        );
        const visibleCells = new Set(cellsInsidePolygons(
          scope === "shared" ? visibility.sharedPolygons : visibility.privatePolygons,
          map.columns,
          map.rows,
        ));
        if (input.cells.some((cell) => !visibleCells.has(Number(cell)))) {
          throw new RoomStateError("Players can only reveal cells in their current sight.", 403);
        }
      }
      const revealed = new Set(map.lighting.explored[scope] ?? []);
      for (const cell of input.cells) {
        if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell > maximumCell) {
          throw new RoomStateError("Invalid explored map cell.");
        }
        revealed.add(cell);
      }
      map.lighting.explored[scope] = [...revealed].sort((left, right) => left - right);
      return next;
    }

    case "roll-dice": {
      const dice = parseDiceFormula(input.formula);
      const rolls = Array.from({ length: dice.count }, () => randomDie(dice.sides));
      const total = rolls.reduce((sum, roll) => sum + roll, dice.modifier);
      const entry: DiceRoll = {
        id: crypto.randomUUID(),
        actorId: actor.clientId,
        label: cleanName(input.label, 40, actor.isDm ? "Dungeon Master" : "Player"),
        formula: dice.formula,
        rolls,
        modifier: dice.modifier,
        total,
        createdAt: Date.now(),
      };
      next.diceLog = [entry, ...(next.diceLog ?? [])].slice(0, 20);
      return next;
    }

    case "set-turn-order": {
      requireDm(actor);
      next.turnOrder = validatedTurnOrder(input.turnOrder, next);
      return next;
    }

    case "set-active-map": {
      requireDm(actor);
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map) {
        throw new RoomStateError("Map not found.", 404);
      }
      if (map.archived) throw new RoomStateError("Restore that map before making it active.");
      next.activeMapId = mapId;
      placePartyTokens(next, map);
      return next;
    }

    case "ping-map": {
      const mapId = requireId(input.mapId, "map id");
      const map = next.maps.find((candidate) => candidate.id === mapId);
      if (!map || map.id !== next.activeMapId) throw new RoomStateError("Ping the active map.");
      next.ping = {
        id: crypto.randomUUID(),
        mapId,
        actorId: actor.clientId,
        label: cleanName(input.label, 30, actor.isDm ? "Dungeon Master" : "Player"),
        color: typeof input.color === "string" && colorPattern.test(input.color) ? input.color : "#f0c96f",
        x: numberInRange(input.x, 0, map.columns, 0),
        y: numberInRange(input.y, 0, map.rows, 0),
        focus: actor.isDm && input.focus === true,
        createdAt: Date.now(),
      };
      return next;
    }

    case "restore-room": {
      requireDm(actor);
      return validatedBackupState(input.state, actor.roomId);
    }

    case "undo-room":
    case "redo-room": {
      throw new RoomStateError("Undo and redo must be handled by room history.");
    }

    default:
      throw new RoomStateError("Unsupported tabletop operation.");
  }
}

export function isUndoableRoomOperation(operation: unknown): boolean {
  if (!operation || typeof operation !== "object") return false;
  return new Set([
    "add-token",
    "move-token",
    "move-tokens",
    "set-token",
    "set-token-owner",
    "duplicate-tokens",
    "delete-tokens",
    "delete-token",
    "add-asset",
    "add-map",
    "set-map-image",
    "set-map-details",
    "duplicate-map",
    "reorder-map",
    "archive-map",
    "delete-map",
    "align-map-grid",
    "set-map-lighting",
    "set-token-vision",
    "set-active-map",
    "restore-room",
  ]).has(String((operation as Record<string, unknown>).type));
}

export function validatedBackupState(value: unknown, roomId: string): RoomState {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 12_000_000) {
    throw new RoomStateError("That room backup is too large.");
  }
  let state: RoomState;
  try {
    state = parseRoomState(serialized);
  } catch {
    throw new RoomStateError("That file is not a valid 20Fates room backup.");
  }
  if (
    state.maps.length < 1 ||
    state.maps.length > 100 ||
    state.tokens.length > 200 ||
    (state.assets?.length ?? 0) > 500
  ) {
    throw new RoomStateError("That room backup exceeds the supported map, token, or asset limits.");
  }
  if (new Set(state.maps.map((map) => map.id)).size !== state.maps.length) {
    throw new RoomStateError("Backup map ids must be unique.");
  }
  if (new Set(state.tokens.map((token) => token.id)).size !== state.tokens.length) {
    throw new RoomStateError("Backup token ids must be unique.");
  }
  if (new Set((state.assets ?? []).map((asset) => asset.id)).size !== (state.assets?.length ?? 0)) {
    throw new RoomStateError("Backup asset ids must be unique.");
  }
  for (const map of state.maps) {
    requireId(map.id, "map id");
    map.name = cleanName(map.name, 80, "Untitled map");
    map.columns = integerInRange(map.columns, 4, 100, 20);
    map.rows = integerInRange(map.rows, 4, 100, 12);
    map.grid = optionalGridCalibration(map.grid);
    map.landing = normalizedLanding(map.landing, map);
    if (map.imageKey !== null) requiredAssetKey(map.imageKey, `${roomId}/map/`);
    if (map.lighting) map.lighting = validatedLighting(map.lighting, map);
  }
  for (const token of state.tokens) {
    requireId(token.id, "token id");
    if (!state.maps.some((map) => map.id === token.mapId)) {
      throw new RoomStateError("A backup token references a missing map.");
    }
    if (!isValidClientId(token.ownerId)) throw new RoomStateError("A backup token has an invalid owner.");
    if (token.imageKey !== null) requiredAssetKey(token.imageKey, `${roomId}/token/`);
  }
  for (const asset of state.assets ?? []) {
    requireId(asset.id, "asset id");
    if (!isValidClientId(asset.ownerId)) throw new RoomStateError("A backup asset has an invalid owner.");
    requiredAssetKey(asset.imageKey, `${roomId}/${asset.kind}/`);
  }
  if (!state.maps.some((map) => map.id === state.activeMapId && !map.archived)) {
    throw new RoomStateError("The backup has no usable active map.");
  }
  delete state.ping;
  return state;
}

export function measureDistanceFeet(
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const cells = Math.ceil(
    Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)),
  );
  return cells * 5;
}

export function parseDiceFormula(value: unknown): {
  count: number;
  sides: number;
  modifier: number;
  formula: string;
} {
  if (typeof value !== "string") throw new RoomStateError("Enter dice like 2d6 + 3.");
  const match = value.match(/^\s*(\d{0,3})d(\d{1,4})(?:\s*([+-])\s*(\d{1,5}))?\s*$/i);
  if (!match) throw new RoomStateError("Enter dice like 2d6 + 3.");
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = match[4] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  if (count < 1 || count > 50 || sides < 2 || sides > 1000 || Math.abs(modifier) > 10000) {
    throw new RoomStateError("Use 1-50 dice, 2-1,000 sides, and a modifier up to 10,000.");
  }
  return {
    count,
    sides,
    modifier,
    formula: `${count}d${sides}${modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : ""}`,
  };
}

function assertCanControl(token: TableToken, actor: RoomActor): void {
  if (!actor.isDm && token.ownerId !== actor.clientId) {
    throw new RoomStateError("You can only change your own token.", 403);
  }
}

function assertCanMove(token: TableToken, actor: RoomActor): void {
  assertCanControl(token, actor);
  if (token.locked) throw new RoomStateError("Unlock that token before moving it.", 409);
}

function moveToken(
  token: TableToken,
  x: unknown,
  y: unknown,
  state: RoomState,
  actor: RoomActor,
): void {
  assertCanMove(token, actor);
  const map = state.maps.find((candidate) => candidate.id === token.mapId);
  if (!map) throw new RoomStateError("Token map not found.", 409);
  token.x = clampNumber(x, 0, Math.max(0, map.columns - (token.width ?? 1)), token.x);
  token.y = clampNumber(y, 0, Math.max(0, map.rows - (token.height ?? 1)), token.y);
}

function placePartyTokens(state: RoomState, map: BattleMap): void {
  const landing = normalizedLanding(map.landing, map);
  const party = state.tokens.filter((token) => token.playerControlled === true);
  party.forEach((token, index) => {
    token.mapId = map.id;
    token.x = clampNumber(
      landing.x + index % 4,
      0,
      Math.max(0, map.columns - (token.width ?? 1)),
      0,
    );
    token.y = clampNumber(
      landing.y + Math.floor(index / 4),
      0,
      Math.max(0, map.rows - (token.height ?? 1)),
      0,
    );
  });
}

function requireActiveMap(state: RoomState): BattleMap {
  const map = state.maps.find((candidate) => candidate.id === state.activeMapId);
  if (!map) throw new RoomStateError("The active map is unavailable.", 409);
  return map;
}

function requireDm(actor: RoomActor): void {
  if (!actor.isDm) {
    throw new RoomStateError("Only the DM can do that.", 403);
  }
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new RoomStateError(`Invalid ${label}.`);
  }
  return value;
}

function cleanName(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || fallback;
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return clean || undefined;
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const number = typeof value === "number" ? Math.round(value) : Number.NaN;
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

function numberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

function normalizedRotation(value: unknown): number {
  const rotation = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return ((Math.round(rotation) % 360) + 360) % 360;
}

function validatedAssets(value: unknown): RoomAsset[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) {
    throw new RoomStateError("A room can have at most 500 saved assets.");
  }
  const assets = value.map((item) => {
    if (!item || typeof item !== "object") throw new RoomStateError("Invalid saved asset.");
    const raw = item as Record<string, unknown>;
    const kind = raw.kind === "map" ? "map" : raw.kind === "token" ? "token" : null;
    if (!kind || !isValidClientId(raw.ownerId)) throw new RoomStateError("Invalid saved asset.");
    const imageKey = typeof raw.imageKey === "string" ? raw.imageKey : "";
    if (!isMediaKey(imageKey) || imageKey.split("/")[1] !== kind || imageKey.length > 180) {
      throw new RoomStateError("Invalid saved asset image.");
    }
    return {
      id: requireId(raw.id, "asset id"),
      ownerId: raw.ownerId,
      kind,
      name: cleanName(raw.name, 80, kind === "map" ? "Untitled map" : "Token"),
      imageKey,
      columns: kind === "map" ? integerInRange(raw.columns, 4, 100, 20) : undefined,
      rows: kind === "map" ? integerInRange(raw.rows, 4, 100, 12) : undefined,
      grid: kind === "map" ? optionalGridCalibration(raw.grid) : undefined,
    } satisfies RoomAsset;
  });
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw new RoomStateError("Saved asset ids must be unique.");
  }
  return assets;
}

function rememberAsset(state: RoomState, asset: RoomAsset): void {
  const assets = state.assets ?? [];
  const existing = assets.find((candidate) => candidate.imageKey === asset.imageKey);
  if (existing) {
    existing.name = asset.name;
    if (asset.kind === "map") {
      existing.columns = asset.columns;
      existing.rows = asset.rows;
      existing.grid = asset.grid;
    }
    state.assets = assets;
    return;
  }
  if (assets.length >= 500) throw new RoomStateError("This room already has 500 saved assets.");
  state.assets = [...assets, asset];
}

function validatedStatuses(value: unknown): TokenStatus[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw new RoomStateError("A token can have at most 12 conditions.");
  }
  const statuses = value.map((item) => {
    if (!item || typeof item !== "object") throw new RoomStateError("Invalid token condition.");
    const status = item as Record<string, unknown>;
    return {
      id: requireId(status.id, "condition id"),
      label: cleanName(status.label, 24, "Condition"),
      count: integerInRange(status.count, 1, 99, 1),
    } satisfies TokenStatus;
  });
  if (new Set(statuses.map((status) => status.id)).size !== statuses.length) {
    throw new RoomStateError("Token conditions must be unique.");
  }
  return statuses;
}

function normalizedLanding(value: unknown, map: Pick<BattleMap, "columns" | "rows">): GridPoint {
  if (!value || typeof value !== "object") return { x: 1, y: 1 };
  const point = value as Record<string, unknown>;
  return {
    x: numberInRange(point.x, 0, Math.max(0, map.columns - 1), 1),
    y: numberInRange(point.y, 0, Math.max(0, map.rows - 1), 1),
  };
}

function optionalGridCalibration(value: unknown): GridCalibration | undefined {
  if (value === null || value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new RoomStateError("Invalid grid calibration.");
  }
  const grid = value as Record<string, unknown>;
  const calibration = {
    offsetX: gridNumber(grid.offsetX, -0.25, 0.25),
    offsetY: gridNumber(grid.offsetY, -0.25, 0.25),
    cellWidth: gridNumber(grid.cellWidth, 0.005, 0.25),
    cellHeight: gridNumber(grid.cellHeight, 0.005, 0.25),
    imageAspect: gridNumber(grid.imageAspect, 0.1, 10),
  };
  if (Object.values(calibration).some((number) => number === null)) {
    throw new RoomStateError("Invalid grid calibration.");
  }
  return calibration as GridCalibration;
}

function gridNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function validatedLighting(value: unknown, map: BattleMap): MapLighting {
  if (!value || typeof value !== "object") throw new RoomStateError("Invalid lighting setup.");
  const lighting = value as Record<string, unknown>;
  if (!Array.isArray(lighting.barriers) || lighting.barriers.length > 2000) {
    throw new RoomStateError("A map can have at most 2,000 walls and doors.");
  }
  if (!Array.isArray(lighting.lights) || lighting.lights.length > 200) {
    throw new RoomStateError("A map can have at most 200 lights.");
  }

  const barriers = lighting.barriers.map((value) => {
    if (!value || typeof value !== "object") throw new RoomStateError("Invalid wall.");
    const barrier = value as Record<string, unknown>;
    const kind = barrier.kind === "door" ? "door" : barrier.kind === "wall" ? "wall" : null;
    if (!kind) throw new RoomStateError("Invalid wall type.");
    return {
      id: requireId(barrier.id, "wall id"),
      start: validatedPoint(barrier.start, map),
      end: validatedPoint(barrier.end, map),
      kind,
      open: kind === "door" && barrier.open === true,
    } satisfies SightBarrier;
  });

  const lights = lighting.lights.map((value) => {
    if (!value || typeof value !== "object") throw new RoomStateError("Invalid light.");
    const light = value as Record<string, unknown>;
    return {
      id: requireId(light.id, "light id"),
      x: numberInRange(light.x, 0, map.columns, 0),
      y: numberInRange(light.y, 0, map.rows, 0),
      range: numberInRange(light.range, 0.5, 100, 6),
      intensity: numberInRange(light.intensity, 0, 1, 0.7),
      color: typeof light.color === "string" && colorPattern.test(light.color) ? light.color : "#ffd58a",
    } satisfies MapLight;
  });

  const explored: Record<string, number[]> = {};
  if (lighting.explored && typeof lighting.explored === "object") {
    for (const [scope, cells] of Object.entries(lighting.explored as Record<string, unknown>)) {
      if ((scope !== "shared" && !isValidClientId(scope)) || !Array.isArray(cells)) continue;
      explored[scope] = cells
        .filter((cell): cell is number =>
          typeof cell === "number" && Number.isInteger(cell) && cell >= 0 && cell < map.columns * map.rows,
        )
        .slice(0, map.columns * map.rows);
    }
  }

  return {
    enabled: lighting.enabled === true,
    darkness: numberInRange(lighting.darkness, 0, 1, 0.92),
    barriers,
    lights,
    explored,
  };
}

function mergedExploration(
  current: Record<string, number[]>,
  incoming: Record<string, number[]>,
  maximumCells: number,
): Record<string, number[]> {
  const merged: Record<string, number[]> = {};
  for (const scope of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    merged[scope] = [...new Set([...(current[scope] ?? []), ...(incoming[scope] ?? [])])]
      .sort((left, right) => left - right)
      .slice(0, maximumCells);
  }
  return merged;
}

function validatedTurnOrder(value: unknown, state: RoomState): TurnOrder {
  if (!value || typeof value !== "object") throw new RoomStateError("Invalid turn order.");
  const raw = value as Record<string, unknown>;
  const mapId = requireId(raw.mapId, "turn-order map id");
  if (!state.maps.some((map) => map.id === mapId)) throw new RoomStateError("Turn-order map not found.");
  if (!Array.isArray(raw.entries) || raw.entries.length > 100) {
    throw new RoomStateError("Turn order can contain at most 100 combatants.");
  }
  const entries = raw.entries.map((value) => {
    if (!value || typeof value !== "object") throw new RoomStateError("Invalid combatant.");
    const rawEntry = value as Record<string, unknown>;
    const tokenId = rawEntry.tokenId === null || rawEntry.tokenId === undefined
      ? null
      : requireId(rawEntry.tokenId, "combatant token id");
    if (tokenId && !state.tokens.some((token) => token.id === tokenId && token.mapId === mapId)) {
      throw new RoomStateError("Combatant token not found on this map.");
    }
    return {
      id: requireId(rawEntry.id, "combatant id"),
      name: cleanName(rawEntry.name, 40, "Combatant"),
      score: integerInRange(rawEntry.score, -1000, 1000, 0),
      tokenId,
    } satisfies TurnEntry;
  });
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new RoomStateError("Turn-order combatants must be unique.");
  }
  const activeId = raw.activeId === null || raw.activeId === undefined
    ? null
    : requireId(raw.activeId, "active combatant id");
  if (activeId && !entries.some((entry) => entry.id === activeId)) {
    throw new RoomStateError("Active combatant not found.");
  }
  return {
    mapId,
    entries,
    activeId,
    round: integerInRange(raw.round, 1, 9999, 1),
  };
}

function randomDie(sides: number): number {
  const maximum = 0x100000000;
  const ceiling = Math.floor(maximum / sides) * sides;
  const random = new Uint32Array(1);
  do crypto.getRandomValues(random); while (random[0] >= ceiling);
  return random[0] % sides + 1;
}

function validatedPoint(value: unknown, map: BattleMap): GridPoint {
  if (!value || typeof value !== "object") throw new RoomStateError("Invalid wall point.");
  const point = value as Record<string, unknown>;
  if (
    typeof point.x !== "number" || !Number.isFinite(point.x) || point.x < 0 || point.x > map.columns ||
    typeof point.y !== "number" || !Number.isFinite(point.y) || point.y < 0 || point.y > map.rows
  ) {
    throw new RoomStateError("Wall points must stay on the map.");
  }
  return { x: point.x, y: point.y };
}

function optionalAssetKey(value: unknown, prefix: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredAssetKey(value, prefix);
}

function requiredAssetKey(value: unknown, prefix: string): string {
  if (
    typeof value !== "string" ||
    !isMediaKey(value) ||
    !value.startsWith(prefix) ||
    value.length > 180
  ) {
    throw new RoomStateError("Invalid uploaded image reference.");
  }
  return value;
}
