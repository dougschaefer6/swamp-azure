import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  isAzAlreadyExists,
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

const BackupPolicySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    properties: z.record(z.string(), z.unknown()).optional().nullable(),
  })
  .passthrough();

const ProtectionResultSchema = z
  .object({
    vaultName: z.string(),
    resourceGroup: z.string(),
    policyName: z.string(),
    requested: z.number(),
    enrolled: z.array(z.string()),
    alreadyProtected: z.array(z.string()),
    failed: z.array(
      z.object({ vm: z.string(), error: z.string() }),
    ),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-recovery-services-vault` model — Azure Recovery
 * Services (backup) vaults, wrapping the `az backup` CLI. The read side
 * enumerates vaults across a resource group or the whole subscription,
 * returns or refreshes one vault enriched with its backup storage
 * redundancy configuration so `storageModelType` / `storageType` (LRS,
 * GeoRedundant, ZoneRedundant, …) surface alongside the core attributes,
 * and lists the backup policies and protected items registered with a
 * vault. The write side creates a vault idempotently, sets the
 * vault-level backup properties that have to be configured before the
 * first item is protected (storage redundancy, cross-region restore,
 * soft-delete state and retention), and enrolls virtual machines into
 * protection. Enrollment is a fan-out: one call takes every VM, resolves
 * each to a full resource id so vaults and VMs in different resource
 * groups work, and reports enrolled, already-protected and failed
 * separately rather than aborting the batch on the first failure.
 * Restore, disable-protection and item deletion are deliberately out of
 * scope — recovery is a decision a human makes with a change record, not
 * something a workflow should be able to trigger.
 */
export const model = {
  type: "@dougschaefer/azure-recovery-services-vault",
  version: "2026.07.28.1",
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
    backupPolicy: {
      description: "A backup policy (schedule + retention) defined in a vault",
      schema: BackupPolicySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    protectionResult: {
      description:
        "Outcome of one fan-out protection enrollment — enrolled, already protected, and failed VMs",
      schema: ProtectionResultSchema,
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

    listPolicies: {
      description:
        "List the backup policies (schedule + retention) defined in a vault (read-only).",
      arguments: z.object({
        vaultName: z.string().describe("Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const policies = (await az(
          [
            "backup",
            "policy",
            "list",
            "--vault-name",
            args.vaultName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} backup policies in {vault}", {
          count: policies.length,
          vault: args.vaultName,
        });

        const handles = [];
        for (const policy of policies) {
          const instanceName = `${args.vaultName}--${policy.name as string}`;
          const handle = await context.writeResource(
            "backupPolicy",
            sanitizeInstanceName(instanceName),
            policy,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    create: {
      description:
        "Create a Recovery Services vault (idempotent — converges on an existing vault of the same name).",
      arguments: z.object({
        name: z.string().describe("Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. centralus"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
        immutabilityState: z
          .enum(["Disabled", "Unlocked", "Locked"])
          .optional()
          .describe(
            "Immutability. Unlocked is reversible; Locked is PERMANENT and cannot be undone.",
          ),
        publicNetworkAccess: z
          .enum(["Enable", "Disable"])
          .optional()
          .describe(
            "Public network access. Disable only when a private endpoint is in place.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "backup",
          "vault",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
        ];

        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }
        if (args.immutabilityState) {
          cmdArgs.push("--immutability-state", args.immutabilityState);
        }
        if (args.publicNetworkAccess) {
          cmdArgs.push("--public-network-access", args.publicNetworkAccess);
        }

        try {
          await az(cmdArgs, g.subscriptionId);
          context.logger.info(
            "Created Recovery Services vault {name} in {loc}",
            {
              name: args.name,
              loc: args.location,
            },
          );
        } catch (err) {
          if (!isAzAlreadyExists(err)) throw err;
          context.logger.info(
            "Recovery Services vault {name} already exists — converging",
            { name: args.name },
          );
        }

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

    setBackupProperties: {
      description:
        "Set vault-level backup properties — storage redundancy, cross-region restore, and soft delete. Storage redundancy can only be changed while the vault has NO protected items, so run this before enableProtection.",
      arguments: z.object({
        name: z.string().describe("Vault name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        backupStorageRedundancy: z
          .enum(["LocallyRedundant", "GeoRedundant", "ZoneRedundant"])
          .optional()
          .describe(
            "Storage redundancy. Immutable once the first item is protected.",
          ),
        crossRegionRestore: z
          .boolean()
          .optional()
          .describe("Cross-region restore. Requires GeoRedundant storage."),
        softDeleteState: z
          .enum(["AlwaysOn", "Enable", "Disable"])
          .optional()
          .describe("Soft delete. AlwaysOn is PERMANENT and cannot be undone."),
        softDeleteRetentionDays: z
          .number()
          .int()
          .optional()
          .describe("Soft-delete retention in days (14-180)."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);

        if (
          !args.backupStorageRedundancy &&
          args.crossRegionRestore === undefined &&
          !args.softDeleteState &&
          args.softDeleteRetentionDays === undefined
        ) {
          throw new Error(
            "setBackupProperties needs at least one property to set — pass backupStorageRedundancy, crossRegionRestore, softDeleteState or softDeleteRetentionDays",
          );
        }

        const cmdArgs = [
          "backup",
          "vault",
          "backup-properties",
          "set",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];

        if (args.backupStorageRedundancy) {
          cmdArgs.push(
            "--backup-storage-redundancy",
            args.backupStorageRedundancy,
          );
        }
        if (args.crossRegionRestore !== undefined) {
          cmdArgs.push(
            "--cross-region-restore-flag",
            args.crossRegionRestore ? "True" : "False",
          );
        }
        if (args.softDeleteState) {
          cmdArgs.push("--soft-delete-feature-state", args.softDeleteState);
        }
        if (args.softDeleteRetentionDays !== undefined) {
          cmdArgs.push(
            "--soft-delete-duration",
            String(args.softDeleteRetentionDays),
          );
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Set backup properties on vault {name}", {
          name: args.name,
        });

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

    enableProtection: {
      description:
        "Enroll one or more virtual machines into vault protection under a backup policy. Fan-out: every VM is handled in a single execution, already-protected VMs are treated as success, and a failure on one VM does not abandon the rest.",
      arguments: z.object({
        vaultName: z.string().describe("Vault name"),
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group of the VAULT"),
        vms: z
          .array(z.string())
          .min(1)
          .describe(
            "VM names or full resource ids. Names are resolved against vmResourceGroup.",
          ),
        vmResourceGroup: z
          .string()
          .optional()
          .describe(
            "Resource group holding the VMs when they are given by name. Defaults to the vault's.",
          ),
        policyName: z
          .string()
          .default("DefaultPolicy")
          .describe("Backup policy to protect under"),
        excludeAllDataDisks: z
          .boolean()
          .optional()
          .describe("Back up the OS disk only"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const vmRg = args.vmResourceGroup || rg;

        const enrolled: string[] = [];
        const alreadyProtected: string[] = [];
        const failed: Array<{ vm: string; error: string }> = [];

        for (const vm of args.vms) {
          try {
            const vmId = await resolveVmId(vm, vmRg, g, context);
            const cmdArgs = [
              "backup",
              "protection",
              "enable-for-vm",
              "--vault-name",
              args.vaultName,
              "--resource-group",
              rg,
              "--policy-name",
              args.policyName,
              "--vm",
              vmId,
            ];
            if (args.excludeAllDataDisks) {
              cmdArgs.push("--exclude-all-data-disks", "true");
            }
            await az(cmdArgs, g.subscriptionId);
            enrolled.push(vm);
            context.logger.info("Enrolled {vm} into {vault}/{policy}", {
              vm,
              vault: args.vaultName,
              policy: args.policyName,
            });
          } catch (err) {
            if (isAlreadyProtected(err)) {
              alreadyProtected.push(vm);
              context.logger.info("{vm} is already protected — leaving as is", {
                vm,
              });
            } else {
              failed.push({ vm, error: String(err) });
              context.logger.info("Could not enroll {vm}: {err}", {
                vm,
                err: String(err),
              });
            }
          }
        }

        const result = {
          vaultName: args.vaultName,
          resourceGroup: rg,
          policyName: args.policyName,
          requested: args.vms.length,
          enrolled,
          alreadyProtected,
          failed,
        };
        const handle = await context.writeResource(
          "protectionResult",
          sanitizeInstanceName(`${args.vaultName}--enrollment`),
          result,
        );

        context.logger.info(
          "Enrollment complete: {enrolled} enrolled, {already} already protected, {failed} failed",
          {
            enrolled: enrolled.length,
            already: alreadyProtected.length,
            failed: failed.length,
          },
        );

        // The receipt is written before this throws, so a partial batch is
        // still inspectable in the data model rather than lost with the error.
        if (failed.length > 0) {
          throw new Error(
            `Protection enrollment failed for ${failed.length} of ${args.vms.length} VMs: ${
              failed.map((f) => f.vm).join(", ")
            }`,
          );
        }

        return { dataHandles: [handle] };
      },
    },
  },
};

/**
 * Resolve a VM name to its full ARM resource id, passing through anything
 * that already is one. `az backup protection enable-for-vm` accepts a bare
 * name only when the VM shares the vault's resource group, so resolving up
 * front is what lets a central vault protect VMs anywhere in the
 * subscription.
 */
async function resolveVmId(vm, vmResourceGroup, g, context) {
  if (vm.startsWith("/subscriptions/")) return vm;
  const shown = (await az(
    ["vm", "show", "--name", vm, "--resource-group", vmResourceGroup],
    g.subscriptionId,
  )) as Record<string, unknown> | null;
  const id = shown?.id as string | undefined;
  if (!id) {
    throw new Error(
      `Could not resolve VM ${vm} in resource group ${vmResourceGroup}`,
    );
  }
  context.logger.info("Resolved {vm} to {id}", { vm, id });
  return id;
}

/**
 * Classify an `enable-for-vm` failure as "this VM is already protected".
 * Azure phrases this several ways and none of them match the generic
 * already-exists heuristic, so enrollment would otherwise report a
 * correctly-protected VM as a failure and fail an idempotent re-run.
 */
function isAlreadyProtected(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("already protected") ||
    msg.includes("already backed up") ||
    msg.includes("already has a backup") ||
    msg.includes("alreadyprotected") ||
    (msg.includes("already") && msg.includes("protect"))
  );
}

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
