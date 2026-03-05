import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const KeyVaultSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    properties: z
      .object({
        enableSoftDelete: z.boolean().optional(),
        enablePurgeProtection: z.boolean().optional().nullable(),
        enableRbacAuthorization: z.boolean().optional(),
        enabledForDeployment: z.boolean().optional(),
        enabledForDiskEncryption: z.boolean().optional(),
        enabledForTemplateDeployment: z.boolean().optional(),
        softDeleteRetentionInDays: z.number().optional(),
        tenantId: z.string().optional(),
        sku: z
          .object({ family: z.string(), name: z.string() })
          .passthrough()
          .optional(),
        vaultUri: z.string().optional(),
        networkAcls: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-key-vault",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    keyVault: {
      description: "Azure Key Vault",
      schema: KeyVaultSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all Key Vaults in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["keyvault", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const vaults = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Key Vaults", {
          count: vaults.length,
        });

        const handles = [];
        for (const vault of vaults) {
          const handle = await context.writeResource(
            "keyVault",
            sanitizeInstanceName(vault.name as string),
            vault,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Key Vault.",
      arguments: z.object({
        name: z.string().describe("Key Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const vault = await az(
          [
            "keyvault",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "keyVault",
          sanitizeInstanceName(args.name),
          vault,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a Key Vault.",
      arguments: z.object({
        name: z
          .string()
          .describe("Key Vault name (3-24 chars, globally unique)"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        sku: z
          .enum(["standard", "premium"])
          .default("standard")
          .describe("SKU: standard or premium (premium supports HSM keys)"),
        enableRbac: z
          .boolean()
          .optional()
          .describe(
            "Enable RBAC authorization (recommended over access policies)",
          ),
        enableSoftDelete: z
          .boolean()
          .optional()
          .describe("Enable soft delete (default: true, cannot be disabled)"),
        enablePurgeProtection: z
          .boolean()
          .optional()
          .describe("Enable purge protection (irreversible once enabled)"),
        retentionDays: z
          .number()
          .optional()
          .describe("Soft delete retention days (7-90, default 90)"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "keyvault",
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

        if (args.enableRbac !== undefined) {
          cmdArgs.push(
            "--enable-rbac-authorization",
            args.enableRbac.toString(),
          );
        }
        if (args.enablePurgeProtection) {
          cmdArgs.push("--enable-purge-protection", "true");
        }
        if (args.retentionDays) {
          cmdArgs.push("--retention-days", args.retentionDays.toString());
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created Key Vault {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const vault = await az(
          [
            "keyvault",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "keyVault",
          sanitizeInstanceName(args.name),
          vault,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description:
        "Delete a Key Vault. If soft delete is enabled, the vault enters a deleted state and can be recovered.",
      arguments: z.object({
        name: z.string().describe("Key Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "keyvault",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted Key Vault {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },
  },
};
