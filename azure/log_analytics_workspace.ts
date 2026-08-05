import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const LogAnalyticsWorkspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    customerId: z.string().optional(),
    provisioningState: z.string().optional(),
    retentionInDays: z.number().optional(),
    sku: z
      .object({ name: z.string().optional() })
      .passthrough()
      .optional(),
    workspaceCapping: z
      .object({ dailyQuotaGb: z.number().optional() })
      .passthrough()
      .optional(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-log-analytics-workspace` model — read-only view
 * of Azure Monitor Log Analytics workspaces, wrapping the `az monitor
 * log-analytics workspace` CLI. list enumerates workspaces across a
 * resource group (or the whole subscription) and get/sync return or
 * refresh one workspace. Each workspace carries its Log Analytics
 * customer/workspace id (`customerId`), pricing SKU (`sku.name` — e.g.
 * PerGB2018, CapacityReservation), data retention window
 * (`retentionInDays`), provisioning state, and daily ingestion quota
 * (`workspaceCapping.dailyQuotaGb`, where `-1` means uncapped). This
 * model is deliberately read-only — workspace creation, retention/quota
 * changes, and data-source or table management are out of scope.
 */
export const model = {
  type: "@dougschaefer/azure-log-analytics-workspace",
  version: "2026.08.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    workspace: {
      description: "Azure Monitor Log Analytics workspace",
      schema: LogAnalyticsWorkspaceSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all Log Analytics workspaces in a resource group (or all in the subscription if no resource group specified).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["monitor", "log-analytics", "workspace", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const workspaces = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Log Analytics workspaces", {
          count: workspaces.length,
        });

        const handles = [];
        for (const ws of workspaces) {
          const handle = await context.writeResource(
            "workspace",
            sanitizeInstanceName(ws.name as string),
            ws,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Log Analytics workspace by name.",
      arguments: z.object({
        name: z.string().describe("Workspace name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const ws = await az(
          [
            "monitor",
            "log-analytics",
            "workspace",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "workspace",
          sanitizeInstanceName(args.name),
          ws,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Log Analytics workspace without making changes.",
      arguments: z.object({
        name: z.string().describe("Workspace name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const ws = await az(
          [
            "monitor",
            "log-analytics",
            "workspace",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Synced Log Analytics workspace {name}", {
          name: args.name,
        });
        const handle = await context.writeResource(
          "workspace",
          sanitizeInstanceName(args.name),
          ws,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
