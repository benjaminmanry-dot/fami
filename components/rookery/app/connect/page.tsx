import ExchangeUI from "@/components/exchange";
import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { Exchange, type Runtime } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function Connect() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  // Only loopback previews may override the public connection destination.
  const origin = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)
    ? `http://${host}`
    : "https://the-rookery.benjamin-manry.chatgpt.site";
  let initialStatus = null;
  try {
    const snapshot = await new Exchange(env as unknown as Runtime, new Request(origin + "/connect")).status();
    initialStatus = {
      ...snapshot,
      exchange: {
        total: Number(snapshot.exchange?.total ?? 0),
        needs: Number(snapshot.exchange?.needs ?? 0),
        confirmed: Number(snapshot.exchange?.confirmed ?? 0),
      },
    };
  } catch {
    // The connection guide remains usable if status storage is unavailable.
  }
  return <ExchangeUI view="connect" initialOrigin={origin} initialStatus={initialStatus}/>;
}
