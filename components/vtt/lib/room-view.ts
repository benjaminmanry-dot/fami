import { buildViewerLighting, pointInPolygon } from "./lighting.ts";
import type { RoomActor, RoomState } from "./room-state.ts";

export function roomStateForActor(state: RoomState, actor: RoomActor): RoomState {
  if (actor.isDm) return structuredClone(state);

  const activeMap = state.maps.find((map) => map.id === state.activeMapId);
  if (!activeMap) throw new Error("The active map is unavailable.");
  const map = structuredClone(activeMap);
  if (map.lighting) {
    map.lighting.explored = Object.fromEntries(
      Object.entries(map.lighting.explored).filter(([scope]) =>
        scope === "shared" || scope === actor.clientId,
      ),
    );
  }

  const mapTokens = state.tokens.filter((token) => token.mapId === activeMap.id);
  const visibility = buildViewerLighting(activeMap, mapTokens, actor.clientId);
  const fogEnabled = activeMap.lighting?.enabled === true;
  const tokens = mapTokens
    .filter((token) =>
      token.ownerId === actor.clientId ||
      !fogEnabled ||
      visibility.polygons.some((polygon) => pointInPolygon({
        x: token.x + (token.width ?? 1) / 2,
        y: token.y + (token.height ?? 1) / 2,
      }, polygon)),
    )
    .map((token) => ({
      ...structuredClone(token),
      ownerId: token.ownerId === actor.clientId ? token.ownerId : "redacted-owner",
    }));
  const tokenIds = new Set(tokens.map((token) => token.id));
  const turnOrder = state.turnOrder?.mapId === activeMap.id
    ? {
        ...structuredClone(state.turnOrder),
        entries: state.turnOrder.entries.map((entry) =>
          entry.tokenId && !tokenIds.has(entry.tokenId)
            ? { ...entry, name: "Hidden combatant", tokenId: null }
            : { ...entry },
        ),
      }
    : undefined;

  return {
    name: state.name,
    activeMapId: activeMap.id,
    maps: [map],
    tokens,
    assets: structuredClone(
      (state.assets ?? []).filter((asset) =>
        asset.kind === "token" && asset.ownerId === actor.clientId,
      ),
    ),
    players: structuredClone((state.players ?? []).filter((player) => player.id === actor.clientId)),
    characterSheets: structuredClone(
      (state.characterSheets ?? []).filter((sheet) =>
        tokens.some((token) => token.id === sheet.tokenId && token.ownerId === actor.clientId),
      ),
    ),
    diceLog: structuredClone(state.diceLog ?? []).map((roll) => ({
      ...roll,
      actorId: roll.actorId === actor.clientId ? roll.actorId : "redacted-owner",
    })),
    turnOrder,
    ping: state.ping?.mapId === activeMap.id
      ? {
          ...structuredClone(state.ping),
          actorId: state.ping.actorId === actor.clientId ? state.ping.actorId : "redacted-owner",
        }
      : undefined,
  };
}
