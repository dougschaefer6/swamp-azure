import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const PostgresFlexibleServerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    version: z.string().optional(),
    minorVersion: z.string().optional(),
    administratorLogin: z.string().optional(),
    fullyQualifiedDomainName: z.string().optional(),
    state: z.string().optional(),
    availabilityZone: z.string().optional(),
    sku: z
      .object({ name: z.string(), tier: z.string() })
      .passthrough()
      .optional(),
    storage: z
      .object({
        storageSizeGb: z.number().optional(),
        tier: z.string().optional(),
        type: z.string().optional(),
        iops: z.number().optional(),
        autoGrow: z.string().optional(),
      })
      .passthrough()
      .optional(),
    backup: z
      .object({
        backupRetentionDays: z.number().optional(),
        geoRedundantBackup: z.string().optional(),
        earliestRestoreDate: z.string().optional(),
      })
      .passthrough()
      .optional(),
    highAvailability: z
      .object({
        mode: z.string().optional(),
        state: z.string().optional(),
        standbyAvailabilityZone: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    network: z
      .object({
        publicNetworkAccess: z.string().optional(),
        delegatedSubnetResourceId: z.string().nullable().optional(),
        privateDnsZoneArmResourceId: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    authConfig: z.record(z.string(), z.unknown()).optional(),
    dataEncryption: z.record(z.string(), z.unknown()).optional(),
    maintenanceWindow: z.record(z.string(), z.unknown()).optional(),
    replicationRole: z.string().nullable().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const PostgresDatabaseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    resourceGroup: z.string().optional(),
    charset: z.string().optional(),
    collation: z.string().optional(),
  })
  .passthrough();

const PostgresFirewallRuleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    resourceGroup: z.string().optional(),
    startIpAddress: z.string().optional(),
    endIpAddress: z.string().optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-postgres-flexible-server` model — Azure Database
 * for PostgreSQL Flexible Server inventory, wrapping the `az postgres
 * flexible-server` CLI. list enumerates flexible servers across a
 * resource group or the whole subscription with engine version, SKU /
 * compute tier (Burstable, GeneralPurpose, MemoryOptimized), storage
 * size and tier, provisioning state, fully-qualified domain name,
 * backup retention and geo-redundancy, high-availability mode, and
 * network exposure (public access vs. delegated-subnet / private DNS).
 * get and sync return or refresh a single server. listDatabases and
 * listFirewallRules are read-only sub-listers over a given server's
 * databases and firewall (public-access) rules. This is intentionally
 * a read-only inventory surface — server/database/firewall creation,
 * deletion, and restart are out of scope; use the `az postgres
 * flexible-server` CLI directly for those. Note this targets the
 * FLEXIBLE server offering, not the retired single-server one.
 */
export const model = {
  type: "@dougschaefer/azure-postgres-flexible-server",
  version: "2026.07.28.5",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    server: {
      description: "Azure Database for PostgreSQL Flexible Server",
      schema: PostgresFlexibleServerSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    database: {
      description: "Database hosted on a PostgreSQL flexible server",
      schema: PostgresDatabaseSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    firewallRule: {
      description:
        "Firewall (public-access) rule on a PostgreSQL flexible server",
      schema: PostgresFirewallRuleSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all PostgreSQL flexible servers in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["postgres", "flexible-server", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const servers = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} PostgreSQL flexible servers", {
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

    get: {
      description: "Get a single PostgreSQL flexible server.",
      arguments: z.object({
        name: z.string().describe("Flexible server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const server = await az(
          [
            "postgres",
            "flexible-server",
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

    sync: {
      description:
        "Refresh the stored state of a PostgreSQL flexible server without making changes.",
      arguments: z.object({
        name: z.string().describe("Flexible server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const server = await az(
          [
            "postgres",
            "flexible-server",
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
        context.logger.info("Synced PostgreSQL flexible server {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    listDatabases: {
      description: "List all databases on a PostgreSQL flexible server.",
      arguments: z.object({
        serverName: z.string().describe("Flexible server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const dbs = (await az(
          [
            "postgres",
            "flexible-server",
            "db",
            "list",
            "--server-name",
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

    listFirewallRules: {
      description:
        "List all firewall (public-access) rules on a PostgreSQL flexible server.",
      arguments: z.object({
        serverName: z.string().describe("Flexible server name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const rules = (await az(
          [
            "postgres",
            "flexible-server",
            "firewall-rule",
            "list",
            "--name",
            args.serverName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} firewall rules on {server}", {
          count: rules.length,
          server: args.serverName,
        });

        const handles = [];
        for (const rule of rules) {
          const instanceName = `${args.serverName}--${rule.name as string}`;
          const handle = await context.writeResource(
            "firewallRule",
            sanitizeInstanceName(instanceName),
            rule,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
