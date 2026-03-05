import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const NatGatewaySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z.object({ name: z.string() }).optional(),
    idleTimeoutInMinutes: z.number().optional(),
    publicIpAddresses: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    publicIpPrefixes: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    subnets: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    zones: z.array(z.string()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-nat-gateway",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    natGateway: {
      description: "Azure NAT gateway",
      schema: NatGatewaySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all NAT gateways in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "nat", "gateway", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const gateways = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} NAT gateways", {
          count: gateways.length,
        });

        const handles = [];
        for (const gw of gateways) {
          const handle = await context.writeResource(
            "natGateway",
            sanitizeInstanceName(gw.name as string),
            gw,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single NAT gateway.",
      arguments: z.object({
        name: z.string().describe("NAT gateway name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const gw = await az(
          [
            "network",
            "nat",
            "gateway",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "natGateway",
          sanitizeInstanceName(args.name),
          gw,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a NAT gateway.",
      arguments: z.object({
        name: z.string().describe("NAT gateway name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        publicIpAddresses: z
          .array(z.string())
          .optional()
          .describe("Public IP resource names or IDs to associate"),
        idleTimeout: z
          .number()
          .optional()
          .describe("Idle timeout in minutes (default 4, max 120)"),
        zone: z
          .array(z.string())
          .optional()
          .describe("Availability zones, e.g. ['1', '2', '3']"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "nat",
          "gateway",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
        ];

        if (args.publicIpAddresses) {
          cmdArgs.push("--public-ip-addresses", ...args.publicIpAddresses);
        }
        if (args.idleTimeout) {
          cmdArgs.push("--idle-timeout", args.idleTimeout.toString());
        }
        if (args.zone) {
          cmdArgs.push("--zone", ...args.zone);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created NAT gateway {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const gw = await az(
          [
            "network",
            "nat",
            "gateway",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "natGateway",
          sanitizeInstanceName(args.name),
          gw,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a NAT gateway.",
      arguments: z.object({
        name: z.string().describe("NAT gateway name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "nat",
            "gateway",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted NAT gateway {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
