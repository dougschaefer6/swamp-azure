import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const RouteSchema = z
  .object({
    name: z.string(),
    addressPrefix: z.string(),
    nextHopType: z.string(),
    nextHopIpAddress: z.string().optional().nullable(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const RouteTableSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    routes: z.array(RouteSchema).optional(),
    subnets: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    disableBgpRoutePropagation: z.boolean().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-route-table",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    routeTable: {
      description: "Azure route table",
      schema: RouteTableSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    route: {
      description: "Individual route within a route table",
      schema: RouteSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all route tables in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "route-table", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const tables = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} route tables", {
          count: tables.length,
        });

        const handles = [];
        for (const table of tables) {
          const handle = await context.writeResource(
            "routeTable",
            sanitizeInstanceName(table.name as string),
            table,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single route table with all its routes.",
      arguments: z.object({
        name: z.string().describe("Route table name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const table = await az(
          [
            "network",
            "route-table",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "routeTable",
          sanitizeInstanceName(args.name),
          table,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a route table.",
      arguments: z.object({
        name: z.string().describe("Route table name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        disableBgpRoutePropagation: z
          .boolean()
          .optional()
          .describe(
            "Disable BGP route propagation (true for forced tunneling scenarios)",
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
          "route-table",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
        ];

        if (args.disableBgpRoutePropagation) {
          cmdArgs.push("--disable-bgp-route-propagation", "true");
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created route table {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const table = await az(
          [
            "network",
            "route-table",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "routeTable",
          sanitizeInstanceName(args.name),
          table,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a route table.",
      arguments: z.object({
        name: z.string().describe("Route table name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "route-table",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted route table {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    // --- Route operations ---

    listRoutes: {
      description: "List all routes in a route table.",
      arguments: z.object({
        routeTableName: z.string().describe("Route table name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const routes = (await az(
          [
            "network",
            "route-table",
            "route",
            "list",
            "--route-table-name",
            args.routeTableName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} routes in {table}", {
          count: routes.length,
          table: args.routeTableName,
        });

        const handles = [];
        for (const route of routes) {
          const instanceName = `${args.routeTableName}--${route
            .name as string}`;
          const handle = await context.writeResource(
            "route",
            sanitizeInstanceName(instanceName),
            route,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    createRoute: {
      description: "Create a route in a route table.",
      arguments: z.object({
        routeTableName: z.string().describe("Route table name"),
        routeName: z.string().describe("Route name"),
        addressPrefix: z
          .string()
          .describe("Destination CIDR, e.g. '0.0.0.0/0' or '10.1.0.0/16'"),
        nextHopType: z
          .enum([
            "VirtualAppliance",
            "VnetLocal",
            "Internet",
            "VirtualNetworkGateway",
            "None",
          ])
          .describe("Next hop type"),
        nextHopIpAddress: z
          .string()
          .optional()
          .describe(
            "Next hop IP address (required when nextHopType is VirtualAppliance)",
          ),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "route-table",
          "route",
          "create",
          "--route-table-name",
          args.routeTableName,
          "--name",
          args.routeName,
          "--address-prefix",
          args.addressPrefix,
          "--next-hop-type",
          args.nextHopType,
          "--resource-group",
          rg,
        ];

        if (args.nextHopIpAddress) {
          cmdArgs.push("--next-hop-ip-address", args.nextHopIpAddress);
        }

        const route = await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created route {route} in {table} ({prefix} -> {hopType})",
          {
            route: args.routeName,
            table: args.routeTableName,
            prefix: args.addressPrefix,
            hopType: args.nextHopType,
          },
        );

        const instanceName = `${args.routeTableName}--${args.routeName}`;
        const handle = await context.writeResource(
          "route",
          sanitizeInstanceName(instanceName),
          route,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteRoute: {
      description: "Delete a route from a route table.",
      arguments: z.object({
        routeTableName: z.string().describe("Route table name"),
        routeName: z.string().describe("Route name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "route-table",
            "route",
            "delete",
            "--route-table-name",
            args.routeTableName,
            "--name",
            args.routeName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted route {route} from {table}", {
          route: args.routeName,
          table: args.routeTableName,
        });

        return { dataHandles: [] };
      },
    },
  },
};
