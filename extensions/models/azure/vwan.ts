import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const VwanSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    type: z.string().optional(),
    disableVpnEncryption: z.boolean().optional(),
    allowBranchToBranchTraffic: z.boolean().optional(),
    allowVnetToVnetTraffic: z.boolean().optional(),
    virtualHubs: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    vpnSites: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const VirtualHubSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    addressPrefix: z.string().optional(),
    virtualWan: z.object({ id: z.string() }).passthrough().optional(),
    azureFirewall: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    vpnGateway: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    expressRouteGateway: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    p2SVpnGateway: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    virtualHubRouteTableV2s: z.array(z.record(z.string(), z.unknown()))
      .optional(),
    sku: z.string().optional(),
    routingState: z.string().optional(),
    virtualRouterAsn: z.number().optional(),
    virtualRouterAutoScaleConfiguration: z
      .record(z.string(), z.unknown())
      .optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const HubConnectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    remoteVirtualNetwork: z
      .object({ id: z.string() })
      .passthrough()
      .optional(),
    allowHubToRemoteVnetTransit: z.boolean().optional(),
    allowRemoteVnetToUseHubVnetGateways: z.boolean().optional(),
    enableInternetSecurity: z.boolean().optional(),
    routingConfiguration: z.record(z.string(), z.unknown()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const VpnSiteSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    virtualWan: z.object({ id: z.string() }).passthrough().optional(),
    addressSpace: z
      .object({ addressPrefixes: z.array(z.string()) })
      .optional(),
    deviceProperties: z
      .object({
        deviceVendor: z.string().optional(),
        deviceModel: z.string().optional(),
        linkSpeedInMbps: z.number().optional(),
      })
      .passthrough()
      .optional(),
    ipAddress: z.string().optional(),
    vpnSiteLinks: z.array(z.record(z.string(), z.unknown())).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const VpnGatewaySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    virtualHub: z.object({ id: z.string() }).passthrough().optional(),
    bgpSettings: z.record(z.string(), z.unknown()).optional(),
    connections: z.array(z.record(z.string(), z.unknown())).optional(),
    vpnGatewayScaleUnit: z.number().optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-vwan",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    vwan: {
      description: "Azure Virtual WAN",
      schema: VwanSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    virtualHub: {
      description: "Virtual hub within a vWAN",
      schema: VirtualHubSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    hubConnection: {
      description: "VNet connection to a virtual hub",
      schema: HubConnectionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    vpnSite: {
      description: "VPN site (branch office) configuration",
      schema: VpnSiteSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    vpnGateway: {
      description: "Site-to-site VPN gateway in a virtual hub",
      schema: VpnGatewaySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    // --- vWAN operations ---

    list: {
      description:
        "List all Virtual WANs in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "vwan", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const vwans = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Virtual WANs", {
          count: vwans.length,
        });

        const handles = [];
        for (const vwan of vwans) {
          const handle = await context.writeResource(
            "vwan",
            sanitizeInstanceName(vwan.name as string),
            vwan,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Virtual WAN.",
      arguments: z.object({
        name: z.string().describe("vWAN name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const vwan = await az(
          [
            "network",
            "vwan",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vwan",
          sanitizeInstanceName(args.name),
          vwan,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a Virtual WAN.",
      arguments: z.object({
        name: z.string().describe("vWAN name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        type: z
          .enum(["Basic", "Standard"])
          .default("Standard")
          .describe(
            "vWAN type (Standard required for hub-to-hub, firewall, VPN)",
          ),
        branchToBranch: z
          .boolean()
          .optional()
          .describe("Allow branch-to-branch traffic via vWAN"),
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
          "vwan",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--type",
          args.type,
        ];

        if (args.branchToBranch !== undefined) {
          cmdArgs.push(
            "--branch-to-branch-traffic",
            args.branchToBranch.toString(),
          );
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created vWAN {name} ({type}) in {location}", {
          name: args.name,
          type: args.type,
          location: args.location,
        });

        const vwan = await az(
          [
            "network",
            "vwan",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vwan",
          sanitizeInstanceName(args.name),
          vwan,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a Virtual WAN.",
      arguments: z.object({
        name: z.string().describe("vWAN name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "vwan",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted vWAN {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    // --- Virtual Hub operations ---

    listHubs: {
      description:
        "List all virtual hubs in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "vhub", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const hubs = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} virtual hubs", {
          count: hubs.length,
        });

        const handles = [];
        for (const hub of hubs) {
          const handle = await context.writeResource(
            "virtualHub",
            sanitizeInstanceName(hub.name as string),
            hub,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getHub: {
      description: "Get a single virtual hub.",
      arguments: z.object({
        name: z.string().describe("Virtual hub name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const hub = await az(
          [
            "network",
            "vhub",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "virtualHub",
          sanitizeInstanceName(args.name),
          hub,
        );
        return { dataHandles: [handle] };
      },
    },

    createHub: {
      description: "Create a virtual hub within a vWAN.",
      arguments: z.object({
        name: z.string().describe("Virtual hub name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        vwanName: z.string().describe("Parent vWAN name"),
        addressPrefix: z
          .string()
          .describe("Hub address prefix, e.g. '10.0.0.0/24'"),
        sku: z
          .enum(["Basic", "Standard"])
          .optional()
          .describe("Hub SKU"),
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
          "vhub",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--vwan",
          args.vwanName,
          "--address-prefix",
          args.addressPrefix,
        ];

        if (args.sku) {
          cmdArgs.push("--sku", args.sku);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created virtual hub {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const hub = await az(
          [
            "network",
            "vhub",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "virtualHub",
          sanitizeInstanceName(args.name),
          hub,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteHub: {
      description: "Delete a virtual hub.",
      arguments: z.object({
        name: z.string().describe("Virtual hub name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "vhub",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted virtual hub {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    // --- Hub VNet connection operations ---

    listHubConnections: {
      description: "List all VNet connections to a virtual hub.",
      arguments: z.object({
        hubName: z.string().describe("Virtual hub name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const connections = (await az(
          [
            "network",
            "vhub",
            "connection",
            "list",
            "--vhub-name",
            args.hubName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} connections to hub {hub}", {
          count: connections.length,
          hub: args.hubName,
        });

        const handles = [];
        for (const conn of connections) {
          const instanceName = `${args.hubName}--${conn.name as string}`;
          const handle = await context.writeResource(
            "hubConnection",
            sanitizeInstanceName(instanceName),
            conn,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    createHubConnection: {
      description: "Connect a VNet to a virtual hub.",
      arguments: z.object({
        name: z.string().describe("Connection name"),
        hubName: z.string().describe("Virtual hub name"),
        remoteVnetId: z
          .string()
          .describe("Full resource ID of the VNet to connect"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        internetSecurity: z
          .boolean()
          .optional()
          .describe(
            "Enable internet security (route internet traffic through hub firewall)",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "vhub",
          "connection",
          "create",
          "--name",
          args.name,
          "--vhub-name",
          args.hubName,
          "--remote-vnet",
          args.remoteVnetId,
          "--resource-group",
          rg,
        ];

        if (args.internetSecurity !== undefined) {
          cmdArgs.push(
            "--internet-security",
            args.internetSecurity.toString(),
          );
        }

        const conn = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Connected VNet to hub {hub} as {name}", {
          hub: args.hubName,
          name: args.name,
        });

        const instanceName = `${args.hubName}--${args.name}`;
        const handle = await context.writeResource(
          "hubConnection",
          sanitizeInstanceName(instanceName),
          conn,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteHubConnection: {
      description: "Remove a VNet connection from a virtual hub.",
      arguments: z.object({
        name: z.string().describe("Connection name"),
        hubName: z.string().describe("Virtual hub name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "vhub",
            "connection",
            "delete",
            "--name",
            args.name,
            "--vhub-name",
            args.hubName,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Removed connection {name} from hub {hub}", {
          name: args.name,
          hub: args.hubName,
        });

        return { dataHandles: [] };
      },
    },

    // --- VPN Site operations ---

    listVpnSites: {
      description: "List all VPN sites in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "vpn-site", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const sites = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} VPN sites", {
          count: sites.length,
        });

        const handles = [];
        for (const site of sites) {
          const handle = await context.writeResource(
            "vpnSite",
            sanitizeInstanceName(site.name as string),
            site,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getVpnSite: {
      description: "Get a single VPN site.",
      arguments: z.object({
        name: z.string().describe("VPN site name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const site = await az(
          [
            "network",
            "vpn-site",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vpnSite",
          sanitizeInstanceName(args.name),
          site,
        );
        return { dataHandles: [handle] };
      },
    },

    createVpnSite: {
      description: "Create a VPN site (branch office) configuration.",
      arguments: z.object({
        name: z.string().describe("VPN site name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        vwanName: z.string().describe("Associated vWAN name"),
        ipAddress: z
          .string()
          .describe("Public IP address of the branch VPN device"),
        addressPrefixes: z
          .array(z.string())
          .optional()
          .describe("On-premises address prefixes behind the VPN site"),
        deviceVendor: z
          .string()
          .optional()
          .describe("VPN device vendor (e.g. Cisco, Fortinet, Palo Alto)"),
        deviceModel: z.string().optional().describe("VPN device model"),
        linkSpeedInMbps: z
          .number()
          .optional()
          .describe("Link speed in Mbps"),
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
          "vpn-site",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--virtual-wan",
          args.vwanName,
          "--ip-address",
          args.ipAddress,
        ];

        if (args.addressPrefixes) {
          cmdArgs.push("--address-prefixes", ...args.addressPrefixes);
        }
        if (args.deviceVendor) {
          cmdArgs.push("--device-vendor", args.deviceVendor);
        }
        if (args.deviceModel) {
          cmdArgs.push("--device-model", args.deviceModel);
        }
        if (args.linkSpeedInMbps) {
          cmdArgs.push("--link-speed", args.linkSpeedInMbps.toString());
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        const site = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created VPN site {name} ({ip}) in {location}", {
          name: args.name,
          ip: args.ipAddress,
          location: args.location,
        });

        const handle = await context.writeResource(
          "vpnSite",
          sanitizeInstanceName(args.name),
          site,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteVpnSite: {
      description: "Delete a VPN site.",
      arguments: z.object({
        name: z.string().describe("VPN site name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "vpn-site",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted VPN site {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    // --- VPN Gateway operations ---

    listVpnGateways: {
      description:
        "List all site-to-site VPN gateways in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "vpn-gateway", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const gateways = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} VPN gateways", {
          count: gateways.length,
        });

        const handles = [];
        for (const gw of gateways) {
          const handle = await context.writeResource(
            "vpnGateway",
            sanitizeInstanceName(gw.name as string),
            gw,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getVpnGateway: {
      description: "Get a single VPN gateway.",
      arguments: z.object({
        name: z.string().describe("VPN gateway name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const gw = await az(
          [
            "network",
            "vpn-gateway",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vpnGateway",
          sanitizeInstanceName(args.name),
          gw,
        );
        return { dataHandles: [handle] };
      },
    },

    // --- Full inventory ---

    inventory: {
      description:
        "Inventory the complete vWAN topology — vWAN, hubs, hub connections, VPN sites, and VPN gateways in a resource group.",
      arguments: z.object({
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);

        const [vwans, hubs, vpnSites, vpnGateways] = await Promise.all([
          az(
            ["network", "vwan", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "vhub", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "vpn-site", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "vpn-gateway", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
        ]);

        const handles = [];

        for (const vwan of vwans) {
          handles.push(
            await context.writeResource(
              "vwan",
              sanitizeInstanceName(vwan.name as string),
              vwan,
            ),
          );
        }

        for (const hub of hubs) {
          handles.push(
            await context.writeResource(
              "virtualHub",
              sanitizeInstanceName(hub.name as string),
              hub,
            ),
          );

          // Fetch connections for each hub
          const connections = (await az(
            [
              "network",
              "vhub",
              "connection",
              "list",
              "--vhub-name",
              hub.name as string,
              "--resource-group",
              rg,
            ],
            g.subscriptionId,
          )) as Array<Record<string, unknown>>;

          for (const conn of connections) {
            const instanceName = `${hub.name}--${conn.name as string}`;
            handles.push(
              await context.writeResource(
                "hubConnection",
                sanitizeInstanceName(instanceName),
                conn,
              ),
            );
          }
        }

        for (const site of vpnSites) {
          handles.push(
            await context.writeResource(
              "vpnSite",
              sanitizeInstanceName(site.name as string),
              site,
            ),
          );
        }

        for (const gw of vpnGateways) {
          handles.push(
            await context.writeResource(
              "vpnGateway",
              sanitizeInstanceName(gw.name as string),
              gw,
            ),
          );
        }

        context.logger.info(
          "vWAN inventory for {rg}: {vwans} vWANs, {hubs} hubs, {sites} VPN sites, {gateways} VPN gateways",
          {
            rg,
            vwans: vwans.length,
            hubs: hubs.length,
            sites: vpnSites.length,
            gateways: vpnGateways.length,
          },
        );

        return { dataHandles: handles };
      },
    },
  },
};
