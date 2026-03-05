import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const SubnetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    addressPrefix: z.string().optional(),
    addressPrefixes: z.array(z.string()).optional(),
    networkSecurityGroup: z
      .object({ id: z.string() })
      .optional()
      .nullable(),
    routeTable: z.object({ id: z.string() }).optional().nullable(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const VnetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    addressSpace: z.object({
      addressPrefixes: z.array(z.string()),
    }),
    subnets: z.array(SubnetSchema).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const PeeringSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    peeringState: z.string(),
    remoteVirtualNetwork: z.object({ id: z.string() }),
    allowVirtualNetworkAccess: z.boolean().optional(),
    allowForwardedTraffic: z.boolean().optional(),
    allowGatewayTransit: z.boolean().optional(),
    useRemoteGateways: z.boolean().optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-vnet",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    vnet: {
      description: "Azure virtual network",
      schema: VnetSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    subnet: {
      description: "Azure subnet within a virtual network",
      schema: SubnetSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    peering: {
      description: "Virtual network peering connection",
      schema: PeeringSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all VNets in a resource group (or all in the subscription if no resource group specified).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "vnet", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const vnets = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} VNets", { count: vnets.length });

        const handles = [];
        for (const vnet of vnets) {
          const handle = await context.writeResource(
            "vnet",
            sanitizeInstanceName(vnet.name as string),
            vnet,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single VNet by name.",
      arguments: z.object({
        name: z.string().describe("VNet name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const vnet = await az(
          [
            "network",
            "vnet",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vnet",
          sanitizeInstanceName(args.name),
          vnet,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a virtual network.",
      arguments: z.object({
        name: z.string().describe("VNet name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        addressPrefixes: z
          .array(z.string())
          .describe("Address space CIDR blocks, e.g. ['10.0.0.0/16']"),
        subnetName: z
          .string()
          .optional()
          .describe("Default subnet name to create with the VNet"),
        subnetPrefix: z
          .string()
          .optional()
          .describe("Default subnet CIDR, e.g. '10.0.0.0/24'"),
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
          "vnet",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--address-prefixes",
          ...args.addressPrefixes,
        ];

        if (args.subnetName) {
          cmdArgs.push("--subnet-name", args.subnetName);
        }
        if (args.subnetPrefix) {
          cmdArgs.push("--subnet-prefix", args.subnetPrefix);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        const result = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created VNet {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const vnet = (result as Record<string, unknown>).newVNet || result;
        const handle = await context.writeResource(
          "vnet",
          sanitizeInstanceName(args.name),
          vnet,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a virtual network.",
      arguments: z.object({
        name: z.string().describe("VNet name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "vnet",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted VNet {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    // --- Subnet operations ---

    listSubnets: {
      description: "List all subnets in a VNet.",
      arguments: z.object({
        vnetName: z.string().describe("VNet name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const subnets = (await az(
          [
            "network",
            "vnet",
            "subnet",
            "list",
            "--vnet-name",
            args.vnetName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} subnets in {vnet}", {
          count: subnets.length,
          vnet: args.vnetName,
        });

        const handles = [];
        for (const subnet of subnets) {
          const instanceName = `${args.vnetName}--${subnet.name as string}`;
          const handle = await context.writeResource(
            "subnet",
            sanitizeInstanceName(instanceName),
            subnet,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getSubnet: {
      description: "Get a single subnet.",
      arguments: z.object({
        vnetName: z.string().describe("VNet name"),
        subnetName: z.string().describe("Subnet name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const subnet = await az(
          [
            "network",
            "vnet",
            "subnet",
            "show",
            "--vnet-name",
            args.vnetName,
            "--name",
            args.subnetName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.vnetName}--${args.subnetName}`;
        const handle = await context.writeResource(
          "subnet",
          sanitizeInstanceName(instanceName),
          subnet,
        );
        return { dataHandles: [handle] };
      },
    },

    createSubnet: {
      description: "Create a subnet in a VNet.",
      arguments: z.object({
        vnetName: z.string().describe("VNet name"),
        subnetName: z.string().describe("Subnet name"),
        addressPrefix: z
          .string()
          .describe("Subnet CIDR, e.g. '10.0.1.0/24'"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        nsgName: z
          .string()
          .optional()
          .describe("Network security group to associate"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "vnet",
          "subnet",
          "create",
          "--vnet-name",
          args.vnetName,
          "--name",
          args.subnetName,
          "--address-prefixes",
          args.addressPrefix,
          "--resource-group",
          rg,
        ];

        if (args.nsgName) {
          cmdArgs.push("--network-security-group", args.nsgName);
        }

        const subnet = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created subnet {subnet} in {vnet}", {
          subnet: args.subnetName,
          vnet: args.vnetName,
        });

        const instanceName = `${args.vnetName}--${args.subnetName}`;
        const handle = await context.writeResource(
          "subnet",
          sanitizeInstanceName(instanceName),
          subnet,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteSubnet: {
      description: "Delete a subnet from a VNet.",
      arguments: z.object({
        vnetName: z.string().describe("VNet name"),
        subnetName: z.string().describe("Subnet name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "vnet",
            "subnet",
            "delete",
            "--vnet-name",
            args.vnetName,
            "--name",
            args.subnetName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted subnet {subnet} from {vnet}", {
          subnet: args.subnetName,
          vnet: args.vnetName,
        });

        return { dataHandles: [] };
      },
    },

    // --- Peering operations ---

    listPeerings: {
      description: "List all peering connections for a VNet.",
      arguments: z.object({
        vnetName: z.string().describe("VNet name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const peerings = (await az(
          [
            "network",
            "vnet",
            "peering",
            "list",
            "--vnet-name",
            args.vnetName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} peerings for {vnet}", {
          count: peerings.length,
          vnet: args.vnetName,
        });

        const handles = [];
        for (const peering of peerings) {
          const instanceName = `${args.vnetName}--${peering.name as string}`;
          const handle = await context.writeResource(
            "peering",
            sanitizeInstanceName(instanceName),
            peering,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    createPeering: {
      description:
        "Create a VNet peering connection. Creates one direction only — you need to create the reverse peering on the remote VNet separately.",
      arguments: z.object({
        vnetName: z.string().describe("Local VNet name"),
        peeringName: z.string().describe("Peering connection name"),
        remoteVnetId: z
          .string()
          .describe("Full resource ID of the remote VNet"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        allowVnetAccess: z
          .boolean()
          .optional()
          .describe("Allow access to the remote VNet (default: true)"),
        allowForwardedTraffic: z
          .boolean()
          .optional()
          .describe("Allow forwarded traffic from the remote VNet"),
        allowGatewayTransit: z
          .boolean()
          .optional()
          .describe("Allow gateway transit"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "vnet",
          "peering",
          "create",
          "--vnet-name",
          args.vnetName,
          "--name",
          args.peeringName,
          "--remote-vnet",
          args.remoteVnetId,
          "--resource-group",
          rg,
        ];

        if (args.allowVnetAccess !== undefined) {
          cmdArgs.push(
            "--allow-vnet-access",
            args.allowVnetAccess.toString(),
          );
        }
        if (args.allowForwardedTraffic !== undefined) {
          cmdArgs.push(
            "--allow-forwarded-traffic",
            args.allowForwardedTraffic.toString(),
          );
        }
        if (args.allowGatewayTransit !== undefined) {
          cmdArgs.push(
            "--allow-gateway-transit",
            args.allowGatewayTransit.toString(),
          );
        }

        const peering = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created peering {name} on {vnet}", {
          name: args.peeringName,
          vnet: args.vnetName,
        });

        const instanceName = `${args.vnetName}--${args.peeringName}`;
        const handle = await context.writeResource(
          "peering",
          sanitizeInstanceName(instanceName),
          peering,
        );
        return { dataHandles: [handle] };
      },
    },

    deletePeering: {
      description: "Delete a VNet peering connection.",
      arguments: z.object({
        vnetName: z.string().describe("VNet name"),
        peeringName: z.string().describe("Peering connection name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "vnet",
            "peering",
            "delete",
            "--vnet-name",
            args.vnetName,
            "--name",
            args.peeringName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted peering {name} from {vnet}", {
          name: args.peeringName,
          vnet: args.vnetName,
        });

        return { dataHandles: [] };
      },
    },
  },
};
