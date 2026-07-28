import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const DiskSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z.object({ name: z.string(), tier: z.string().optional() })
      .passthrough()
      .optional(),
    diskSizeGb: z.number().optional(),
    diskState: z.string().optional(),
    osType: z.string().optional().nullable(),
    managedBy: z.string().optional().nullable(),
    timeCreated: z.string().optional(),
    provisioningState: z.string().optional(),
    zones: z.array(z.string()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-disk` model — Azure managed-disk lifecycle,
 * wrapping the `az disk` CLI. list enumerates managed disks across a
 * subscription or resource group with SKU, size, state, OS type, and
 * the resource currently attached via managedBy. get and sync return
 * or refresh a single disk. listOrphaned filters for disks with no
 * managedBy attachment — the primary cost-cleanup target after VM
 * teardowns. create provisions a new managed disk (empty, from
 * snapshot, or from another disk) with chosen SKU, zones, and size.
 * delete removes a disk. Useful for the post-VM-delete cleanup
 * pattern where NIC, OS disk, and public IP are intentionally left
 * behind by `az vm delete`.
 */
export const model = {
  type: "@dougschaefer/azure-disk",
  version: "2026.07.28.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    disk: {
      description: "Azure managed disk",
      schema: DiskSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all managed disks in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["disk", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const disks = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} managed disks", {
          count: disks.length,
        });

        const handles = [];
        for (const disk of disks) {
          const handle = await context.writeResource(
            "disk",
            sanitizeInstanceName(disk.name as string),
            disk,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single managed disk.",
      arguments: z.object({
        name: z.string().describe("Disk name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const disk = await az(
          ["disk", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "disk",
          sanitizeInstanceName(args.name),
          disk,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a managed disk without making changes.",
      arguments: z.object({
        name: z.string().describe("Disk name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const disk = await az(
          ["disk", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "disk",
          sanitizeInstanceName(args.name),
          disk,
        );
        context.logger.info("Synced managed disk {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    listOrphaned: {
      description:
        "List managed disks that are not attached to any VM (diskState is Unattached).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to scan across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["disk", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const disks = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        const orphaned = disks.filter(
          (d) => d.diskState === "Unattached" || !d.managedBy,
        );

        context.logger.info(
          "Found {orphaned} orphaned disks out of {total} total",
          { orphaned: orphaned.length, total: disks.length },
        );

        const handles = [];
        for (const disk of orphaned) {
          const handle = await context.writeResource(
            "disk",
            sanitizeInstanceName(disk.name as string),
            disk,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    create: {
      description: "Create a managed disk.",
      arguments: z.object({
        name: z.string().describe("Disk name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        sizeGb: z.number().describe("Disk size in GB"),
        sku: z
          .enum([
            "Premium_LRS",
            "StandardSSD_LRS",
            "Standard_LRS",
            "UltraSSD_LRS",
            "Premium_ZRS",
            "StandardSSD_ZRS",
          ])
          .default("StandardSSD_LRS")
          .describe("Disk SKU"),
        zone: z.string().optional().describe("Availability zone (1, 2, or 3)"),
        osType: z
          .enum(["Linux", "Windows"])
          .optional()
          .describe("OS type (for OS disks)"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "disk",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--size-gb",
          args.sizeGb.toString(),
          "--sku",
          args.sku,
        ];

        if (args.zone) cmdArgs.push("--zone", args.zone);
        if (args.osType) cmdArgs.push("--os-type", args.osType);
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created disk {name} ({size}GB {sku})", {
          name: args.name,
          size: args.sizeGb,
          sku: args.sku,
        });

        const disk = await az(
          ["disk", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "disk",
          sanitizeInstanceName(args.name),
          disk,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a managed disk. Disk must be unattached.",
      arguments: z.object({
        name: z.string().describe("Disk name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "disk",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted disk {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },
  },
};
