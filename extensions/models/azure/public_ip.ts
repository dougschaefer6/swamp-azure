import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const PublicIpSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    publicIPAllocationMethod: z.string(),
    publicIPAddressVersion: z.string().optional(),
    ipAddress: z.string().optional().nullable(),
    sku: z.object({ name: z.string(), tier: z.string().optional() }).optional(),
    zones: z.array(z.string()).optional(),
    dnsSettings: z
      .object({
        domainNameLabel: z.string().optional(),
        fqdn: z.string().optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
    ipConfiguration: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-public-ip",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    publicIp: {
      description: "Azure public IP address",
      schema: PublicIpSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all public IP addresses in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "public-ip", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const ips = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} public IPs", { count: ips.length });

        const handles = [];
        for (const ip of ips) {
          const handle = await context.writeResource(
            "publicIp",
            sanitizeInstanceName(ip.name as string),
            ip,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single public IP address.",
      arguments: z.object({
        name: z.string().describe("Public IP name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const ip = await az(
          [
            "network",
            "public-ip",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "publicIp",
          sanitizeInstanceName(args.name),
          ip,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a public IP address.",
      arguments: z.object({
        name: z.string().describe("Public IP name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        sku: z
          .enum(["Basic", "Standard"])
          .default("Standard")
          .describe(
            "SKU: Basic or Standard (Standard required for zones and LB Standard)",
          ),
        allocation: z
          .enum(["Static", "Dynamic"])
          .default("Static")
          .describe("Allocation method (Standard SKU requires Static)"),
        version: z
          .enum(["IPv4", "IPv6"])
          .optional()
          .describe("IP version"),
        zone: z
          .array(z.string())
          .optional()
          .describe("Availability zones, e.g. ['1', '2', '3']"),
        dnsName: z
          .string()
          .optional()
          .describe(
            "DNS domain name label (creates <label>.<region>.cloudapp.azure.com)",
          ),
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
          "public-ip",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--sku",
          args.sku,
          "--allocation-method",
          args.allocation,
        ];

        if (args.version) {
          cmdArgs.push("--version", args.version);
        }
        if (args.zone) {
          cmdArgs.push("--zone", ...args.zone);
        }
        if (args.dnsName) {
          cmdArgs.push("--dns-name", args.dnsName);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created public IP {name} ({sku}, {allocation}) in {location}",
          {
            name: args.name,
            sku: args.sku,
            allocation: args.allocation,
            location: args.location,
          },
        );

        const ip = await az(
          [
            "network",
            "public-ip",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "publicIp",
          sanitizeInstanceName(args.name),
          ip,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a public IP address.",
      arguments: z.object({
        name: z.string().describe("Public IP name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "public-ip",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted public IP {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },
  },
};
