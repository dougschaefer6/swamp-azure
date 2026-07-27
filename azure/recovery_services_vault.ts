import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const RecoveryServicesVaultSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z
      .object({ name: z.string().optional(), tier: z.string().optional() })
      .passthrough()
      .optional(),
    properties: z
      .object({
        provisioningState: z.string().optional(),
      })
      .passthrough()
      .optional(),
    storageModelType: z.string().optional(),
    storageType: z.string().optional(),
    storageTypeState: z.string().optional(),
    crossRegionRestoreFlag: z.boolean().optional(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

const BackupItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    properties: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-recovery-services-vault` model — read-only view
 * of Azure Recovery Services (backup) vaults, wrapping the `az backup
 * vault` CLI. list enumerates vaults across a resource group (or the
 * whole subscription) with location, SKU, and provisioning state. get
 * and sync return or refresh one vault, enriching it with the vault's
 * backup storage redundancy configuration (`az backup vault
 * backup-properties show`) so `storageModelType` / `storageType`
 * (LRS, GeoRedundant, ZoneRedundant, …) surface alongside the core
 * attributes. listBackupItems is a read-only sub-lister over the
 * protected items registered with a vault (`az backup item list`).
 * This model is deliberately read-only — vault creation, backup-policy
 * changes, and protection enable/disable are out of scope; use the
 * `az backup` CLI directly for those.
 */
export const model = {
  type: "@dougschaefer/azure-recovery-services-vault",
  version: "2026.07.24.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    vault: {
      description: "Azure Recovery Services (backup) vault",
      schema: RecoveryServicesVaultSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    backupItem: {
      description: "A protected (backup) item registered with a vault",
      schema: BackupItemSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all Recovery Services vaults in a resource group (or all in the subscription if no resource group specified).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["backup", "vault", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const vaults = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Recovery Services vaults", {
          count: vaults.length,
        });

        const handles = [];
        for (const vault of vaults) {
          const handle = await context.writeResource(
            "vault",
            sanitizeInstanceName(vault.name as string),
            vault,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description:
        "Get a single Recovery Services vault, enriched with its backup storage redundancy configuration.",
      arguments: z.object({
        name: z.string().describe("Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const vault = (await az(
          [
            "backup",
            "vault",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Record<string, unknown>;

        const enriched = await enrichWithStorage(
          vault,
          args.name,
          rg,
          g,
          context,
        );
        const handle = await context.writeResource(
          "vault",
          sanitizeInstanceName(args.name),
          enriched,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Recovery Services vault, including its backup storage redundancy configuration, without making changes.",
      arguments: z.object({
        name: z.string().describe("Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const vault = (await az(
          [
            "backup",
            "vault",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Record<string, unknown>;

        const enriched = await enrichWithStorage(
          vault,
          args.name,
          rg,
          g,
          context,
        );
        context.logger.info("Synced Recovery Services vault {name}", {
          name: args.name,
        });
        const handle = await context.writeResource(
          "vault",
          sanitizeInstanceName(args.name),
          enriched,
        );
        return { dataHandles: [handle] };
      },
    },

    listBackupItems: {
      description:
        "List all protected (backup) items registered with a vault (read-only).",
      arguments: z.object({
        vaultName: z.string().describe("Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const items = (await az(
          [
            "backup",
            "item",
            "list",
            "--vault-name",
            args.vaultName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} backup items in {vault}", {
          count: items.length,
          vault: args.vaultName,
        });

        const handles = [];
        for (const item of items) {
          const instanceName = `${args.vaultName}--${item.name as string}`;
          const handle = await context.writeResource(
            "backupItem",
            sanitizeInstanceName(instanceName),
            item,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};

/**
 * Merge the vault's backup storage redundancy configuration (from
 * `az backup vault backup-properties show`) into the vault object as
 * top-level `storageModelType` / `storageType` / … attributes. Storage
 * properties are informational; if the lookup fails the vault is
 * returned unmodified rather than failing the read.
 */
async function enrichWithStorage(vault, name, rg, g, context) {
  try {
    const props = (await az(
      [
        "backup",
        "vault",
        "backup-properties",
        "show",
        "--name",
        name,
        "--resource-group",
        rg,
      ],
      g.subscriptionId,
    )) as Array<Record<string, unknown>> | Record<string, unknown> | null;

    const first = Array.isArray(props) ? props[0] : props;
    const p = (first?.properties as Record<string, unknown>) || first;
    if (p) {
      return {
        ...vault,
        storageModelType: p.storageModelType,
        storageType: p.storageType,
        storageTypeState: p.storageTypeState,
        crossRegionRestoreFlag: p.crossRegionRestoreFlag,
      };
    }
  } catch (err) {
    context.logger.info(
      "Could not read backup storage properties for {name}: {err}",
      { name, err: String(err) },
    );
  }
  return vault;
}
