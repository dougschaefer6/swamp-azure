import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const SqlServerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    fullyQualifiedDomainName: z.string().optional(),
    administratorLogin: z.string().optional(),
    version: z.string().optional(),
    state: z.string().optional(),
    publicNetworkAccess: z.string().optional(),
    minimalTlsVersion: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const SqlDatabaseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z
      .object({ name: z.string(), tier: z.string(), capacity: z.number() })
      .passthrough()
      .optional(),
    status: z.string().optional(),
    maxSizeBytes: z.number().optional(),
    collation: z.string().optional(),
    zoneRedundant: z.boolean().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-sql",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    server: {
      description: "Azure SQL logical server",
      schema: SqlServerSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    database: {
      description: "Azure SQL database",
      schema: SqlDatabaseSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listServers: {
      description:
        "List all SQL servers in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["sql", "server", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const servers = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} SQL servers", {
          count: servers.length,
        });

        const handles = [];
        for (const server of servers) {
          const handle = await context.writeResource(
            "server",
            sanitizeInstanceName(server.name as string),
            server,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getServer: {
      description: "Get a single SQL server.",
      arguments: z.object({
        name: z.string().describe("SQL server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const server = await az(
          [
            "sql",
            "server",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "server",
          sanitizeInstanceName(args.name),
          server,
        );
        return { dataHandles: [handle] };
      },
    },

    createServer: {
      description: "Create an Azure SQL logical server.",
      arguments: z.object({
        name: z
          .string()
          .describe(
            "SQL server name (globally unique, becomes <name>.database.windows.net)",
          ),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        adminUser: z.string().describe("Server admin username"),
        adminPassword: z
          .string()
          .describe(
            "Server admin password. Use: ${{ vault.get('azure', 'SQL_ADMIN_PASSWORD') }}",
          ),
        minimalTlsVersion: z
          .enum(["1.0", "1.1", "1.2"])
          .optional()
          .describe("Minimum TLS version"),
        publicNetworkAccess: z
          .enum(["Enabled", "Disabled"])
          .optional()
          .describe("Enable or disable public network access"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "sql",
          "server",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--admin-user",
          args.adminUser,
          "--admin-password",
          args.adminPassword,
        ];

        if (args.minimalTlsVersion) {
          cmdArgs.push("--minimal-tls-version", args.minimalTlsVersion);
        }
        if (args.publicNetworkAccess) {
          cmdArgs.push(
            "--public-network-access",
            args.publicNetworkAccess,
          );
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        const server = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created SQL server {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const handle = await context.writeResource(
          "server",
          sanitizeInstanceName(args.name),
          server,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteServer: {
      description: "Delete an Azure SQL logical server and all its databases.",
      arguments: z.object({
        name: z.string().describe("SQL server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "sql",
            "server",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted SQL server {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    // --- Database operations ---

    listDatabases: {
      description: "List all databases on a SQL server.",
      arguments: z.object({
        serverName: z.string().describe("SQL server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const dbs = (await az(
          [
            "sql",
            "db",
            "list",
            "--server",
            args.serverName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} databases on {server}", {
          count: dbs.length,
          server: args.serverName,
        });

        const handles = [];
        for (const db of dbs) {
          const instanceName = `${args.serverName}--${db.name as string}`;
          const handle = await context.writeResource(
            "database",
            sanitizeInstanceName(instanceName),
            db,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    createDatabase: {
      description: "Create a database on a SQL server.",
      arguments: z.object({
        name: z.string().describe("Database name"),
        serverName: z.string().describe("SQL server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        edition: z
          .enum([
            "Basic",
            "Standard",
            "Premium",
            "GeneralPurpose",
            "BusinessCritical",
            "Hyperscale",
          ])
          .optional()
          .describe("Database edition/tier"),
        computeModel: z
          .enum(["Provisioned", "Serverless"])
          .optional()
          .describe("Compute model (GeneralPurpose only)"),
        maxSizeGb: z
          .number()
          .optional()
          .describe("Maximum database size in GB"),
        zoneRedundant: z
          .boolean()
          .optional()
          .describe("Enable zone redundancy"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "sql",
          "db",
          "create",
          "--name",
          args.name,
          "--server",
          args.serverName,
          "--resource-group",
          rg,
        ];

        if (args.edition) {
          cmdArgs.push("--edition", args.edition);
        }
        if (args.computeModel) {
          cmdArgs.push("--compute-model", args.computeModel);
        }
        if (args.maxSizeGb) {
          cmdArgs.push("--max-size", `${args.maxSizeGb}GB`);
        }
        if (args.zoneRedundant !== undefined) {
          cmdArgs.push(
            "--zone-redundant",
            args.zoneRedundant.toString(),
          );
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        const db = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created database {name} on {server}", {
          name: args.name,
          server: args.serverName,
        });

        const instanceName = `${args.serverName}--${args.name}`;
        const handle = await context.writeResource(
          "database",
          sanitizeInstanceName(instanceName),
          db,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteDatabase: {
      description: "Delete a database from a SQL server.",
      arguments: z.object({
        name: z.string().describe("Database name"),
        serverName: z.string().describe("SQL server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "sql",
            "db",
            "delete",
            "--name",
            args.name,
            "--server",
            args.serverName,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted database {name} from {server}", {
          name: args.name,
          server: args.serverName,
        });

        return { dataHandles: [] };
      },
    },
  },
};
