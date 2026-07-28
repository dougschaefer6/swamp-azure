import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const LoadBalancerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z.object({ name: z.string(), tier: z.string().optional() })
      .passthrough()
      .optional(),
    frontendIpConfigurations: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    backendAddressPools: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    loadBalancingRules: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    probes: z.array(z.record(z.string(), z.unknown())).optional(),
    inboundNatRules: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const BackendPoolSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    backendIpConfigurations: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    loadBalancerBackendAddresses: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const ProbeSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    protocol: z.string().optional(),
    port: z.number().optional(),
    intervalInSeconds: z.number().optional(),
    numberOfProbes: z.number().optional(),
    requestPath: z.string().optional().nullable(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-load-balancer` model — Azure Load Balancer
 * resource management, wrapping the `az network lb` CLI. list, get,
 * sync, create, delete cover the LB resource itself with its SKU
 * (Basic, Standard, Gateway), frontend IP configurations, backend
 * address pools, load-balancing rules, health probes, and inbound
 * NAT rules. listBackendPools and listProbes drill into the most
 * commonly queried child collections. Targets both public and
 * internal load balancers, which matters for the hub-and-spoke
 * topology where ILBs front spoke workloads behind the Azure
 * Firewall. Outbound rules and NAT rules can be set on creation;
 * for fine-grained day-2 edits to those, use `az network lb`
 * subcommands directly until those helpers land here.
 */
export const model = {
  type: "@dougschaefer/azure-load-balancer",
  version: "2026.07.28.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    loadBalancer: {
      description: "Azure Load Balancer (L4)",
      schema: LoadBalancerSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    backendPool: {
      description: "Backend address pool",
      schema: BackendPoolSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    probe: {
      description: "Health probe",
      schema: ProbeSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all load balancers in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "lb", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const lbs = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} load balancers", {
          count: lbs.length,
        });

        const handles = [];
        for (const lb of lbs) {
          const handle = await context.writeResource(
            "loadBalancer",
            sanitizeInstanceName(lb.name as string),
            lb,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single load balancer with full configuration.",
      arguments: z.object({
        name: z.string().describe("Load balancer name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const lb = await az(
          [
            "network",
            "lb",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "loadBalancer",
          sanitizeInstanceName(args.name),
          lb,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a load balancer without making changes.",
      arguments: z.object({
        name: z.string().describe("Load balancer name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const lb = await az(
          [
            "network",
            "lb",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "loadBalancer",
          sanitizeInstanceName(args.name),
          lb,
        );
        context.logger.info("Synced load balancer {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a load balancer.",
      arguments: z.object({
        name: z.string().describe("Load balancer name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        sku: z
          .enum(["Basic", "Standard", "Gateway"])
          .default("Standard")
          .describe("Load balancer SKU"),
        frontendIpName: z
          .string()
          .optional()
          .describe("Frontend IP configuration name"),
        publicIpAddress: z
          .string()
          .optional()
          .describe("Public IP name or ID (for public LB)"),
        vnetName: z
          .string()
          .optional()
          .describe("VNet name (for internal LB)"),
        subnetName: z
          .string()
          .optional()
          .describe("Subnet name (for internal LB)"),
        privateIpAddress: z
          .string()
          .optional()
          .describe("Static private IP (for internal LB)"),
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
          "lb",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--sku",
          args.sku,
        ];

        if (args.frontendIpName) {
          cmdArgs.push("--frontend-ip-name", args.frontendIpName);
        }
        if (args.publicIpAddress) {
          cmdArgs.push("--public-ip-address", args.publicIpAddress);
        }
        if (args.vnetName) cmdArgs.push("--vnet-name", args.vnetName);
        if (args.subnetName) cmdArgs.push("--subnet", args.subnetName);
        if (args.privateIpAddress) {
          cmdArgs.push("--private-ip-address", args.privateIpAddress);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created load balancer {name} ({sku})", {
          name: args.name,
          sku: args.sku,
        });

        const lb = await az(
          [
            "network",
            "lb",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "loadBalancer",
          sanitizeInstanceName(args.name),
          lb,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a load balancer.",
      arguments: z.object({
        name: z.string().describe("Load balancer name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "lb",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted load balancer {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    listBackendPools: {
      description: "List backend address pools on a load balancer.",
      arguments: z.object({
        lbName: z.string().describe("Load balancer name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const pools = (await az(
          [
            "network",
            "lb",
            "address-pool",
            "list",
            "--lb-name",
            args.lbName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} backend pools on {lb}", {
          count: pools.length,
          lb: args.lbName,
        });

        const handles = [];
        for (const pool of pools) {
          const instanceName = `${args.lbName}--${pool.name as string}`;
          const handle = await context.writeResource(
            "backendPool",
            sanitizeInstanceName(instanceName),
            pool,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listProbes: {
      description: "List health probes on a load balancer.",
      arguments: z.object({
        lbName: z.string().describe("Load balancer name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const probes = (await az(
          [
            "network",
            "lb",
            "probe",
            "list",
            "--lb-name",
            args.lbName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} health probes on {lb}", {
          count: probes.length,
          lb: args.lbName,
        });

        const handles = [];
        for (const probe of probes) {
          const instanceName = `${args.lbName}--${probe.name as string}`;
          const handle = await context.writeResource(
            "probe",
            sanitizeInstanceName(instanceName),
            probe,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
