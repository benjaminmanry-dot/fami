import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { Tabletop } from "./Tabletop";
import { isSiteOwner } from "@/lib/public-access";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const bindings = env as unknown as {
    VTT_OWNER_USER_ID?: string;
    VTT_LOCAL_DEVELOPMENT?: string;
  };
  const localDevelopment = bindings.VTT_LOCAL_DEVELOPMENT === "true";
  const ownerSetupUserId = !localDevelopment && !bindings.VTT_OWNER_USER_ID?.trim()
    ? requestHeaders.get("oai-authenticated-user-id")
    : null;
  return (
    <Tabletop
      canManageRooms={isSiteOwner(
        requestHeaders,
        bindings.VTT_OWNER_USER_ID,
        localDevelopment,
      )}
      ownerSetupUserId={ownerSetupUserId}
    />
  );
}
