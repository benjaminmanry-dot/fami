import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import {
  AppRouter,
  NavigationProvider,
} from "@stripe/ui-extension-sdk/navigation";

import { routes } from "../routes";

export default function FullPage(context: ExtensionContextValue) {
  return (
    <NavigationProvider routes={routes}>
      <AppRouter context={context} redirectOnNotFound={{ key: "closeout" }} />
    </NavigationProvider>
  );
}
