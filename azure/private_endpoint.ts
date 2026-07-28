import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const PrivateEndpointSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    privateLinkServiceConnections: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    manualPrivateLinkServiceConnections: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    subnet: z.object({ id: z.string() }).passthrough().optional().nullable(),
    customDnsConfigs: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    networkInterfaces: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const PrivateDnsZoneSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    resourceGroup: z.string(),
    numberOfRecordSets: z.number().optional(),
    numberOfVirtualNetworkLinks: z.number().optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-private-endpoint` model — private-endpoint and
 * private-DNS-zone management, wrapping the `az network
 * private-endpoint` and `az network private-dns` CLIs. list, get,
 * sync, create, delete cover private endpoints with their
 * privateLinkServiceConnections (auto and manual approval),
 * containing subnet, custom DNS configurations, and the implicit NIC
 * Azure provisions. listPrivateDnsZones enumerates the privateDnsZone
 * resources commonly paired with private endpoints to make the
 * subresource FQDN resolve to the private IP. Private endpoints are
 * the right way to expose Storage, SQL, Key Vault, and PaaS services
 * inside the hub-and-spoke without exposing public endpoints — use
 * this model to inventory the existing wiring and to provision new
 * endpoints during workload onboarding.
 */
export const model = {
  type: "@dougschaefer/azure-private-endpoint",
  version: "2026.07.28.2",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    privateEndpoint: {
      description: "Azure Private Endpoint for Private Link connections",
      schema: PrivateEndpointSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    privateDnsZone: {
      description: "Private DNS zone for private endpoint resolution",
      schema: PrivateDnsZoneSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all private endpoints in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "private-endpoint", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const endpoints = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} private endpoints", {
          count: endpoints.length,
        });

        const handles = [];
        for (const ep of endpoints) {
          const handle = await context.writeResource(
            "privateEndpoint",
            sanitizeInstanceName(ep.name as string),
            ep,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single private endpoint.",
      arguments: z.object({
        name: z.string().describe("Private endpoint name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const ep = await az(
          [
            "network",
            "private-endpoint",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "privateEndpoint",
          sanitizeInstanceName(args.name),
          ep,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a private endpoint without making changes.",
      arguments: z.object({
        name: z.string().describe("Private endpoint name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const ep = await az(
          [
            "network",
            "private-endpoint",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "privateEndpoint",
          sanitizeInstanceName(args.name),
          ep,
        );
        context.logger.info("Synced private endpoint {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description:
        "Create a private endpoint for a Private Link-enabled service.",
      arguments: z.object({
        name: z.string().describe("Private endpoint name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        vnetName: z.string().describe("VNet containing the subnet"),
        subnetName: z.string().describe("Subnet for the private endpoint NIC"),
        privateLinkResourceId: z
          .string()
          .describe(
            "Resource ID of the target service (SQL server, storage account, Key Vault, etc.)",
          ),
        groupIds: z
          .array(z.string())
          .describe(
            "Sub-resource group IDs, e.g. ['sqlServer'], ['blob'], ['vault']",
          ),
        connectionName: z
          .string()
          .optional()
          .describe("Private link service connection name"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const connName = args.connectionName || `${args.name}-conn`;

        const cmdArgs = [
          "network",
          "private-endpoint",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--vnet-name",
          args.vnetName,
          "--subnet",
          args.subnetName,
          "--private-connection-resource-id",
          args.privateLinkResourceId,
          "--group-ids",
          ...args.groupIds,
          "--connection-name",
          connName,
        ];

        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created private endpoint {name} for {resource}",
          { name: args.name, resource: args.privateLinkResourceId },
        );

        const ep = await az(
          [
            "network",
            "private-endpoint",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "privateEndpoint",
          sanitizeInstanceName(args.name),
          ep,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a private endpoint.",
      arguments: z.object({
        name: z.string().describe("Private endpoint name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "private-endpoint",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted private endpoint {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    listPrivateDnsZones: {
      description: "List all private DNS zones in a resource group.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "private-dns", "zone", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const zones = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} private DNS zones", {
          count: zones.length,
        });

        const handles = [];
        for (const zone of zones) {
          const handle = await context.writeResource(
            "privateDnsZone",
            sanitizeInstanceName(zone.name as string),
            zone,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
