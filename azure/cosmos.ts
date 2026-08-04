import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const CosmosAccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    kind: z.string().optional(),
    documentEndpoint: z.string().optional(),
    enableFreeTier: z.boolean().nullish(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const CosmosDatabaseSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    resourceGroup: z.string().optional(),
  })
  .passthrough();

const CosmosContainerSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    resourceGroup: z.string().optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-cosmos` model — read-only inventory of Azure
 * Cosmos DB accounts and their SQL (Core) API databases and
 * containers, wrapping the `az cosmosdb` CLI. list enumerates database
 * accounts across a subscription or resource group; get and sync
 * return or refresh one account; listDatabases and listContainers walk
 * the SQL API hierarchy beneath an account. This model covers the SQL
 * (Core) API surface only — Mongo, Cassandra, Gremlin, and Table
 * enumeration, along with account lifecycle (create/delete are
 * long-running ARM operations), are out of scope for now. Keys and
 * connection strings are deliberately excluded: secrets belong in
 * swamp vaults and never flow through model data.
 */
export const model = {
  type: "@dougschaefer/azure-cosmos",
  version: "2026.08.04.2",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    account: {
      description: "Azure Cosmos DB database account",
      schema: CosmosAccountSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    database: {
      description: "Azure Cosmos DB SQL API database",
      schema: CosmosDatabaseSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    container: {
      description: "Azure Cosmos DB SQL API container",
      schema: CosmosContainerSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List Cosmos DB database accounts in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["cosmosdb", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const accounts = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Cosmos DB accounts", {
          count: accounts.length,
        });

        const handles = [];
        for (const account of accounts) {
          const handle = await context.writeResource(
            "account",
            sanitizeInstanceName(account.name as string),
            account,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Cosmos DB database account.",
      arguments: z.object({
        name: z.string().describe("Cosmos DB account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const account = await az(
          [
            "cosmosdb",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "account",
          sanitizeInstanceName(args.name),
          account,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Cosmos DB account without making changes.",
      arguments: z.object({
        name: z.string().describe("Cosmos DB account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const account = await az(
          [
            "cosmosdb",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "account",
          sanitizeInstanceName(args.name),
          account,
        );
        context.logger.info("Synced Cosmos DB account {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    listDatabases: {
      description: "List the SQL API databases under a Cosmos DB account.",
      arguments: z.object({
        accountName: z.string().describe("Cosmos DB account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const databases = (await az(
          [
            "cosmosdb",
            "sql",
            "database",
            "list",
            "--account-name",
            args.accountName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} SQL databases on {account}", {
          count: databases.length,
          account: args.accountName,
        });

        const handles = [];
        for (const db of databases) {
          // The CLI returns the database name in the `id` field.
          const dbName = (db.name ?? db.id) as string;
          const handle = await context.writeResource(
            "database",
            sanitizeInstanceName(`${args.accountName}-${dbName}`),
            db,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listContainers: {
      description:
        "List the SQL API containers under a Cosmos DB SQL database.",
      arguments: z.object({
        accountName: z.string().describe("Cosmos DB account name"),
        databaseName: z.string().describe("SQL API database name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const containers = (await az(
          [
            "cosmosdb",
            "sql",
            "container",
            "list",
            "--account-name",
            args.accountName,
            "--database-name",
            args.databaseName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info(
          "Found {count} SQL containers in {account}/{database}",
          {
            count: containers.length,
            account: args.accountName,
            database: args.databaseName,
          },
        );

        const handles = [];
        for (const container of containers) {
          const containerName = (container.name ?? container.id) as string;
          const handle = await context.writeResource(
            "container",
            sanitizeInstanceName(
              `${args.accountName}-${args.databaseName}-${containerName}`,
            ),
            container,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
