import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const BastionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z.object({ name: z.string() }).passthrough().optional(),
    dnsName: z.string().optional(),
    ipConfigurations: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    enableTunneling: z.boolean().optional(),
    enableShareableLink: z.boolean().optional(),
    enableIpConnect: z.boolean().optional(),
    enableFileCopy: z.boolean().optional(),
    scaleUnits: z.number().optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-bastion` model — Azure Bastion host lifecycle,
 * wrapping the `az network bastion` CLI. list enumerates Bastion hosts
 * across a subscription or resource group with SKU (Basic, Standard,
 * Premium, Developer), DNS name, IP configuration, and tunneling/
 * shareable-link/IP-connect/file-copy capability flags. get and sync
 * return or refresh a single Bastion. create provisions a Bastion
 * tied to an AzureBastionSubnet with the chosen SKU and scale units.
 * delete tears one down. Bastion is the jump-host plane for VM SSH
 * and RDP in the hub-and-spoke topology, so changes here affect how
 * operators reach every spoke.
 */
export const model = {
  type: "@dougschaefer/azure-bastion",
  version: "2026.07.28.5",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    bastion: {
      description: "Azure Bastion host for secure VM access",
      schema: BastionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description: "List all Bastion hosts in the subscription.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const bastions = (await az(
          ["network", "bastion", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} Bastion hosts", {
          count: bastions.length,
        });

        const handles = [];
        for (const b of bastions) {
          const handle = await context.writeResource(
            "bastion",
            sanitizeInstanceName(b.name as string),
            b,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Bastion host.",
      arguments: z.object({
        name: z.string().describe("Bastion host name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const b = await az(
          [
            "network",
            "bastion",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "bastion",
          sanitizeInstanceName(args.name),
          b,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Bastion host without making changes.",
      arguments: z.object({
        name: z.string().describe("Bastion host name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const b = await az(
          [
            "network",
            "bastion",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "bastion",
          sanitizeInstanceName(args.name),
          b,
        );
        context.logger.info("Synced Bastion host {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description:
        "Create a Bastion host. Requires a VNet with an AzureBastionSubnet.",
      arguments: z.object({
        name: z.string().describe("Bastion host name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        vnetName: z
          .string()
          .describe("VNet name (must have AzureBastionSubnet)"),
        publicIpAddress: z
          .string()
          .describe("Public IP name or ID for the Bastion"),
        sku: z
          .enum(["Basic", "Standard"])
          .default("Basic")
          .describe("Bastion SKU"),
        enableTunneling: z
          .boolean()
          .optional()
          .describe("Enable native client tunneling (Standard SKU only)"),
        scaleUnits: z
          .number()
          .optional()
          .describe("Scale units (2-50, Standard SKU only)"),
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
          "bastion",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--vnet-name",
          args.vnetName,
          "--public-ip-address",
          args.publicIpAddress,
          "--sku",
          args.sku,
        ];

        if (args.enableTunneling) {
          cmdArgs.push("--enable-tunneling", "true");
        }
        if (args.scaleUnits) {
          cmdArgs.push("--scale-units", args.scaleUnits.toString());
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created Bastion host {name} ({sku})", {
          name: args.name,
          sku: args.sku,
        });

        const b = await az(
          [
            "network",
            "bastion",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "bastion",
          sanitizeInstanceName(args.name),
          b,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a Bastion host.",
      arguments: z.object({
        name: z.string().describe("Bastion host name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "bastion",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted Bastion host {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
