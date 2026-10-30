import { createRouter } from "../app";
import { registerGatewayWebhooks } from "../services/gateway";
import { registerPlatformWebhooks } from "./billing";

/** Server-to-server callbacks. Each one authenticates with its own shared token, never cookies. */
export const webhookRoutes = createRouter();
registerPlatformWebhooks(webhookRoutes);
registerGatewayWebhooks(webhookRoutes);
