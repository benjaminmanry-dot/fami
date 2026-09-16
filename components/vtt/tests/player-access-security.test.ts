import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { POST as dormantAssistantPost } from "../app/api/assistant/route.ts";
import {
  isMediaKey,
  isSiteOwner,
  maximumRoomMediaBytes,
  maximumRoomMediaUploads,
  normalizedRoomCode,
  publicRoomCodeLength,
  randomRoomCode,
  readRequestBytes,
  RequestBodyTooLarge,
  roomCodeCharacters,
  verifiedImageExtension,
} from "../lib/public-access.ts";

test("new room codes carry 50 bits while six-character legacy rooms stay owner-only", () => {
  assert.equal(roomCodeCharacters.length, 32);
  assert.equal(publicRoomCodeLength * Math.log2(roomCodeCharacters.length), 50);
  assert.equal(randomRoomCode(new Uint8Array(publicRoomCodeLength)), "AAAAAAAAAA");
  assert.equal(
    randomRoomCode(new Uint8Array(publicRoomCodeLength).fill(31)),
    "9999999999",
  );
  assert.equal(normalizedRoomCode("abcde23456"), "ABCDE23456");
  assert.equal(normalizedRoomCode("ABC234"), null);
  assert.equal(normalizedRoomCode("ABC234", true), "ABC234");
});

test("room management requires the exact configured Sites user identity", () => {
  const ownerHeaders = new Headers({ "oai-authenticated-user-id": "site-owner-123" });
  assert.equal(isSiteOwner(ownerHeaders, "site-owner-123"), true);
  assert.equal(isSiteOwner(ownerHeaders, "somebody-else"), false);
  assert.equal(isSiteOwner(ownerHeaders, ""), false);
  assert.equal(isSiteOwner(new Headers(), "site-owner-123"), false);
  assert.equal(isSiteOwner(new Headers({ host: "localhost:3000" }), "", true), true);
  assert.equal(isSiteOwner(new Headers({ host: "vtt.example" }), "", true), false);
});

test("media keys are high-entropy capabilities and image MIME must match file bytes", () => {
  assert.equal(
    isMediaKey("ABCDE23456/token/0f8fad5b-d9cb-469f-a165-70867728950e.webp"),
    true,
  );
  assert.equal(isMediaKey("ABCDE23456/token/portrait.webp"), false);

  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff]);
  const webp = new TextEncoder().encode("RIFF1234WEBP");
  assert.equal(verifiedImageExtension("image/png", png), "png");
  assert.equal(verifiedImageExtension("image/jpeg", jpeg), "jpg");
  assert.equal(verifiedImageExtension("image/webp", webp), "webp");
  assert.equal(verifiedImageExtension("image/png", jpeg), null);
  assert.equal(maximumRoomMediaUploads, 1_000);
  assert.equal(maximumRoomMediaBytes, 512 * 1024 * 1024);
});

test("chunked request bodies stop at the application limit", async () => {
  const request = new Request("https://table.invalid/api/room", {
    method: "POST",
    body: new Blob([Uint8Array.from([1, 2, 3, 4, 5, 6])]),
  });
  await assert.rejects(() => readRequestBytes(request, 5), RequestBodyTooLarge);
});

test("the dormant Familiar endpoint is structurally fail-closed", async () => {
  const response = await dormantAssistantPost();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found." });

  const route = await readFile("app/api/assistant/route.ts", "utf8");
  assert.doesNotMatch(route, /cloudflare:workers|getDatabase|assistant_corpus|fetch\(/);
  const vite = await readFile("vite.config.ts", "utf8");
  assert.doesNotMatch(vite, /\bai\s*:/);
});

test("room and media routes apply the public ownership and cost boundaries", async () => {
  const roomRoute = await readFile("app/api/room/route.ts", "utf8");
  const mediaRoute = await readFile("app/api/media/route.ts", "utf8");
  const tabletop = await readFile("app/Tabletop.tsx", "utf8");

  assert.match(roomRoute, /Only the Site owner can create rooms/);
  assert.match(roomRoute, /isDm: owner && Boolean\(dmKey\)/);
  assert.match(roomRoute, /sinceValue === null \? Number\.NaN/);
  assert.doesNotMatch(roomRoute, /payload\.dmKey/);
  assert.match(mediaRoute, /INSERT INTO room_media_usage/);
  assert.match(mediaRoute, /Join the room before uploading a token/);
  assert.match(tabletop, /const isDm = snapshot\?\.isDm === true/);
});
