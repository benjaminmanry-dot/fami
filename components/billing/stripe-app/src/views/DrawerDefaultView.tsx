import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";

import { Closeout } from "./Closeout";

export default function DrawerDefaultView(context: ExtensionContextValue) {
  return <Closeout context={context} drawer />;
}
