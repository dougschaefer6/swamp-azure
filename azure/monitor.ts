import { z } from "npm:zod@4.3.6";
import { az, AzureGlobalArgsSchema, sanitizeInstanceName } from "./_helpers.ts";

const MetricAlertSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    description: z.string().optional(),
    severity: z.number().optional(),
    enabled: z.boolean().optional(),
    scopes: z.array(z.string()).optional(),
    criteria: z.record(z.string(), z.unknown()).optional(),
    actions: z.array(z.record(z.string(), z.unknown())).optional(),
    evaluationFrequency: z.string().optional(),
    windowSize: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const ActivityLogAlertSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    scopes: z.array(z.string()).optional(),
    condition: z.record(z.string(), z.unknown()).optional(),
    actions: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const DiagnosticSettingSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    logs: z.array(z.record(z.string(), z.unknown())).optional(),
    metrics: z.array(z.record(z.string(), z.unknown())).optional(),
    workspaceId: z.string().optional().nullable(),
    storageAccountId: z.string().optional().nullable(),
    eventHubAuthorizationRuleId: z.string().optional().nullable(),
    eventHubName: z.string().optional().nullable(),
  })
  .passthrough();

const ActionGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    groupShortName: z.string().optional(),
    enabled: z.boolean().optional(),
    emailReceivers: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    smsReceivers: z.array(z.record(z.string(), z.unknown())).optional(),
    webhookReceivers: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-monitor` model — read-side surface over Azure
 * Monitor alerts, diagnostics, and action groups, wrapping the `az
 * monitor` CLI. listMetricAlerts and listActivityLogAlerts enumerate
 * the two alert object kinds with scopes, criteria, evaluation
 * frequency, and attached action groups. Diagnostic-setting and
 * action-group schemas are wired as resource shapes for use by
 * downstream methods or external consumers reading the data store.
 * Creation and deletion of alerts and action groups is intentionally
 * not yet exposed — for that, use `az monitor` directly or extend
 * the model. Useful as the inventory backbone for compliance and
 * alert-coverage reports against subscriptions with sprawl.
 */
export const model = {
  type: "@dougschaefer/azure-monitor",
  version: "2026.07.24.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    metricAlert: {
      description: "Azure Monitor metric alert rule",
      schema: MetricAlertSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    activityLogAlert: {
      description: "Azure Monitor activity log alert",
      schema: ActivityLogAlertSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    diagnosticSetting: {
      description: "Diagnostic setting on an Azure resource",
      schema: DiagnosticSettingSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    actionGroup: {
      description: "Azure Monitor action group",
      schema: ActionGroupSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listMetricAlerts: {
      description:
        "List all metric alert rules in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["monitor", "metrics", "alert", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const alerts = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} metric alerts", {
          count: alerts.length,
        });

        const handles = [];
        for (const alert of alerts) {
          const handle = await context.writeResource(
            "metricAlert",
            sanitizeInstanceName(alert.name as string),
            alert,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listActivityLogAlerts: {
      description: "List all activity log alerts in the subscription.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const alerts = (await az(
          ["monitor", "activity-log", "alert", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} activity log alerts", {
          count: alerts.length,
        });

        const handles = [];
        for (const alert of alerts) {
          const handle = await context.writeResource(
            "activityLogAlert",
            sanitizeInstanceName(alert.name as string),
            alert,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listActionGroups: {
      description:
        "List all action groups in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["monitor", "action-group", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const groups = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} action groups", {
          count: groups.length,
        });

        const handles = [];
        for (const group of groups) {
          const handle = await context.writeResource(
            "actionGroup",
            sanitizeInstanceName(group.name as string),
            group,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getDiagnosticSettings: {
      description: "List diagnostic settings for a specific Azure resource.",
      arguments: z.object({
        resourceId: z
          .string()
          .describe("Full Azure resource ID to query diagnostic settings for"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const settings = (await az(
          [
            "monitor",
            "diagnostic-settings",
            "list",
            "--resource",
            args.resourceId,
          ],
          g.subscriptionId,
        )) as
          | { value?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>;

        const settingsList = Array.isArray(settings)
          ? settings
          : settings.value || [];

        context.logger.info(
          "Found {count} diagnostic settings on {resource}",
          { count: settingsList.length, resource: args.resourceId },
        );

        const handles = [];
        for (const setting of settingsList) {
          const handle = await context.writeResource(
            "diagnosticSetting",
            sanitizeInstanceName(setting.name as string),
            setting,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
