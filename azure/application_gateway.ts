import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const AppGatewaySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z
      .object({
        name: z.string(),
        tier: z.string(),
        capacity: z.number().optional(),
      })
      .passthrough()
      .optional(),
    frontendIpConfigurations: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    frontendPorts: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    backendAddressPools: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    backendHttpSettingsCollection: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    httpListeners: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    requestRoutingRules: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    webApplicationFirewallConfiguration: z
      .record(z.string(), z.unknown())
      .optional()
      .nullable(),
    sslCertificates: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    operationalState: z.string().optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-application-gateway` model — inventory and
 * teardown surface for Azure Application Gateway resources, wrapping
 * the `az network application-gateway` CLI. list enumerates app
 * gateways across a subscription or resource group, materializing
 * SKU, frontend/backend pool, listener, routing-rule, and WAF
 * configuration. get returns a single gateway. sync refreshes the
 * stored attributes for drift detection. delete tears one down. Full
 * greenfield provisioning of an Application Gateway with backend
 * pools, listeners, and SSL bindings is still better suited to
 * Bicep or Terraform — this model focuses on inventory, drift
 * detection, and decommission automation.
 */
export const model = {
  type: "@dougschaefer/azure-application-gateway",
  version: "2026.08.04.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    appGateway: {
      description: "Azure Application Gateway (L7 load balancer)",
      schema: AppGatewaySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all application gateways in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "application-gateway", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const gateways = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} application gateways", {
          count: gateways.length,
        });

        const handles = [];
        for (const gw of gateways) {
          const handle = await context.writeResource(
            "appGateway",
            sanitizeInstanceName(gw.name as string),
            gw,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single application gateway.",
      arguments: z.object({
        name: z.string().describe("Application gateway name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const gw = await az(
          [
            "network",
            "application-gateway",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "appGateway",
          sanitizeInstanceName(args.name),
          gw,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of an application gateway without making changes.",
      arguments: z.object({
        name: z.string().describe("Application gateway name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const gw = await az(
          [
            "network",
            "application-gateway",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "appGateway",
          sanitizeInstanceName(args.name),
          gw,
        );
        context.logger.info("Synced application gateway {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete an application gateway.",
      arguments: z.object({
        name: z.string().describe("Application gateway name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "application-gateway",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted application gateway {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
