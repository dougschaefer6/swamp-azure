import { z } from "npm:zod@4.3.6";
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

const ContainerListSchema = z
  .object({
    account: z.string(),
    count: z.number(),
    containers: z.array(
      z
        .object({
          name: z.string(),
          publicAccess: z.string().nullable().optional(),
          lastModified: z.string().optional(),
        })
        .passthrough(),
    ),
    capturedAt: z.string(),
  })
  .passthrough();

const BlobListSchema = z
  .object({
    account: z.string(),
    container: z.string(),
    count: z.number(),
    blobs: z.array(
      z
        .object({
          name: z.string(),
          blobType: z.string().optional(),
          contentLength: z.number().optional(),
          contentType: z.string().nullable().optional(),
          lastModified: z.string().optional(),
        })
        .passthrough(),
    ),
    capturedAt: z.string(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-storage-account` model — Azure Storage account
 * lifecycle, wrapping the `az storage account` CLI. list enumerates
 * storage accounts across a subscription or resource group with
 * kind, SKU (LRS, ZRS, GRS, RA-GRS), endpoints, primary location,
 * replication health, blob public-access flag, minimum TLS version,
 * network ACLs, and encryption configuration. get and sync return
 * or refresh one account. create provisions a new storage account
 * with the chosen kind/SKU, location, network rules, and TLS floor.
 * delete removes it. listContainers and listBlobs cover the blob
 * data plane read path and uploadBlob the write path — installer ISOs
 * and machine images — all authenticating as the signed-in principal
 * so no account key is ever handled, which means reads need Storage
 * Blob Data Reader and uploads need Contributor. File-share and queue
 * management remain out of scope.
 */
export const model = {
  type: "@dougschaefer/azure-storage-account",
  version: "2026.08.04.2",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    storageAccount: {
      description: "Azure storage account",
      schema: StorageAccountSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    containerList: {
      description: "Blob containers in one storage account",
      schema: ContainerListSchema,
      lifetime: "7d",
      garbageCollection: 5,
    },
    blobList: {
      description: "Blobs in one container",
      schema: BlobListSchema,
      lifetime: "7d",
      garbageCollection: 5,
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

    sync: {
      description:
        "Refresh the stored state of a storage account without making changes.",
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
        context.logger.info("Synced storage account {name}", {
          name: args.name,
        });
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

    listContainers: {
      description:
        "List blob containers in a storage account. Authenticates as the signed-in principal (--auth-mode login), so it needs Storage Blob Data Reader on the account and never touches an account key.",
      arguments: z.object({
        name: z.string().describe("Storage account name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const containers = (await az(
          [
            "storage",
            "container",
            "list",
            "--account-name",
            args.name,
            "--auth-mode",
            "login",
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info(
          "Found {count} containers in {account}",
          { count: containers.length, account: args.name },
        );

        const handle = await context.writeResource(
          "containerList",
          sanitizeInstanceName(`containers-${args.name}`),
          {
            account: args.name,
            count: containers.length,
            containers: containers.map((c) => ({
              name: c.name as string,
              publicAccess:
                (c.properties as Record<string, unknown>)?.publicAccess ?? null,
              lastModified: (c.properties as Record<string, unknown>)
                ?.lastModified as string | undefined,
            })),
            capturedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      },
    },

    listBlobs: {
      description:
        "List blobs in one container, with size and content type — enough to identify machine images and their formats. Authenticates as the signed-in principal (--auth-mode login); no account key is handled.",
      arguments: z.object({
        name: z.string().describe("Storage account name"),
        container: z.string().describe("Container name"),
        prefix: z
          .string()
          .optional()
          .describe("Only list blobs whose names start with this prefix"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = [
          "storage",
          "blob",
          "list",
          "--account-name",
          args.name,
          "--container-name",
          args.container,
          "--auth-mode",
          "login",
        ];
        if (args.prefix) {
          cmdArgs.push("--prefix", args.prefix);
        }

        const blobs = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info(
          "Found {count} blobs in {account}/{container}",
          {
            count: blobs.length,
            account: args.name,
            container: args.container,
          },
        );

        const handle = await context.writeResource(
          "blobList",
          sanitizeInstanceName(`blobs-${args.name}-${args.container}`),
          {
            account: args.name,
            container: args.container,
            count: blobs.length,
            blobs: blobs.map((b) => {
              const p = (b.properties ?? {}) as Record<string, unknown>;
              return {
                name: b.name as string,
                blobType: p.blobType as string | undefined,
                contentLength: p.contentLength as number | undefined,
                contentType: ((p.contentSettings as Record<string, unknown>)
                  ?.contentType as string | undefined) ?? null,
                lastModified: p.lastModified as string | undefined,
              };
            }),
            capturedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      },
    },

    uploadBlob: {
      description:
        "Upload a local file into a container — installer ISOs and machine images. Authenticates as the signed-in principal (--auth-mode login), which needs Storage Blob Data Contributor; Reader is not enough to write. Large files are chunked by the CLI, so allow a generous method timeout.",
      arguments: z.object({
        name: z.string().describe("Storage account name"),
        container: z.string().describe("Destination container"),
        file: z.string().describe("Absolute path to the local file"),
        blobName: z
          .string()
          .optional()
          .describe("Destination blob name; defaults to the file's basename"),
        overwrite: z
          .boolean()
          .default(false)
          .describe("Replace an existing blob of the same name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const blobName = args.blobName ||
          args.file.split("/").filter(Boolean).pop() as string;

        const cmdArgs = [
          "storage",
          "blob",
          "upload",
          "--account-name",
          args.name,
          "--container-name",
          args.container,
          "--file",
          args.file,
          "--name",
          blobName,
          "--auth-mode",
          "login",
        ];
        if (args.overwrite) {
          cmdArgs.push("--overwrite", "true");
        }

        context.logger.info(
          "Uploading {file} to {account}/{container}/{blob}",
          {
            file: args.file,
            account: args.name,
            container: args.container,
            blob: blobName,
          },
        );

        await az(cmdArgs, g.subscriptionId);

        // Re-list so the stored blob inventory reflects the new artifact.
        const blobs = (await az(
          [
            "storage",
            "blob",
            "list",
            "--account-name",
            args.name,
            "--container-name",
            args.container,
            "--auth-mode",
            "login",
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        const handle = await context.writeResource(
          "blobList",
          sanitizeInstanceName(`blobs-${args.name}-${args.container}`),
          {
            account: args.name,
            container: args.container,
            count: blobs.length,
            blobs: blobs.map((b) => {
              const p = (b.properties ?? {}) as Record<string, unknown>;
              return {
                name: b.name as string,
                blobType: p.blobType as string | undefined,
                contentLength: p.contentLength as number | undefined,
                contentType: ((p.contentSettings as Record<string, unknown>)
                  ?.contentType as string | undefined) ?? null,
                lastModified: p.lastModified as string | undefined,
              };
            }),
            capturedAt: new Date().toISOString(),
          },
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
