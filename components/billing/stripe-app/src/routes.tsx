import { createRoutes, route } from "@stripe/ui-extension-sdk/navigation";

import { Closeout } from "./views/Closeout";

export const routes = createRoutes({
  closeout: route("/", (_params, context) => <Closeout context={context} />),
});

declare module "@stripe/ui-extension-sdk/navigation" {
  interface RouteRegister {
    routes: typeof routes;
  }
}
