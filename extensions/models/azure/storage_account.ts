import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const StorageAccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    kind: z.string(),
    sku: z.object({ name: z.string(), tier: z.string() }).passthrough(),
    primaryEndpoints: z.record(z.string(), z.string()).optional(),
    primaryLocation: z.string().optional(),
    statusOfPrimary: z.string().optional(),
    allowBlobPublicAccess: z.boolean().optional(),
    minimumTlsVersion: z.string().optional(),
    networkRuleSet: z.record(z.string(), z.unknown()).optional(),
    encryption: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-storage-account",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    storageAccount: {
      description: "Azure storage account",
      schema: StorageAccountSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all storage accounts in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["storage", "account", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const accounts = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} storage accounts", {
          count: accounts.length,
        });

        const handles = [];
        for (const acct of accounts) {
          const handle = await context.writeResource(
            "storageAccount",
            sanitizeInstanceName(acct.name as string),
            acct,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single storage account.",
      arguments: z.object({
        name: z.string().describe("Storage account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const acct = await az(
          [
            "storage",
            "account",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "storageAccount",
          sanitizeInstanceName(args.name),
          acct,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a storage account.",
      arguments: z.object({
        name: z
          .string()
          .describe(
            "Storage account name (3-24 chars, lowercase alphanumeric only, globally unique)",
          ),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        sku: z
          .enum([
            "Standard_LRS",
            "Standard_GRS",
            "Standard_RAGRS",
            "Standard_ZRS",
            "Premium_LRS",
            "Premium_ZRS",
          ])
          .default("Standard_LRS")
          .describe("Storage SKU / replication type"),
        kind: z
          .enum(["StorageV2", "BlobStorage", "BlockBlobStorage", "FileStorage"])
          .default("StorageV2")
          .describe("Storage account kind"),
        accessTier: z
          .enum(["Hot", "Cool"])
          .optional()
          .describe("Default access tier for blob storage"),
        httpsOnly: z
          .boolean()
          .optional()
          .describe("Require HTTPS traffic only (default: true)"),
        minimumTlsVersion: z
          .enum(["TLS1_0", "TLS1_1", "TLS1_2"])
          .optional()
          .describe("Minimum TLS version"),
        allowBlobPublicAccess: z
          .boolean()
          .optional()
          .describe("Allow public access to blobs (default: false)"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "storage",
          "account",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--sku",
          args.sku,
          "--kind",
          args.kind,
        ];

        if (args.accessTier) {
          cmdArgs.push("--access-tier", args.accessTier);
        }
        if (args.httpsOnly !== undefined) {
          cmdArgs.push("--https-only", args.httpsOnly.toString());
        }
        if (args.minimumTlsVersion) {
          cmdArgs.push("--min-tls-version", args.minimumTlsVersion);
        }
        if (args.allowBlobPublicAccess !== undefined) {
          cmdArgs.push(
            "--allow-blob-public-access",
            args.allowBlobPublicAccess.toString(),
          );
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created storage account {name} ({sku}) in {location}",
          { name: args.name, sku: args.sku, location: args.location },
        );

        const acct = await az(
          [
            "storage",
            "account",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "storageAccount",
          sanitizeInstanceName(args.name),
          acct,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a storage account.",
      arguments: z.object({
        name: z.string().describe("Storage account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "storage",
            "account",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted storage account {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
