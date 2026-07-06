// Ported from https://github.com/rkcoleman/swamp-azure-app-service — MIT © Ryan Coleman

/**
 * `@dougschaefer/azure-function-app` model — Azure Function App
 * (Microsoft.Web/sites with kind=functionapp) lifecycle, wrapping
 * `az functionapp`. Covers CRUD, power state, application settings,
 * and function inventory (list/get/delete individual functions).
 * For general Web Apps see `@dougschaefer/azure-app-service`.
 *
 * @module
 */
import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const FunctionAppSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string().optional(),
    kind: z.string().optional(),
    state: z.string().optional(),
    defaultHostName: z.string().optional(),
    hostNames: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    serverFarmId: z.string().optional(),
    httpsOnly: z.boolean().optional(),
    identity: z.record(z.string(), z.unknown()).optional().nullable(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

const FunctionSchema = z
  .object({
    name: z.string(),
    id: z.string().optional(),
    href: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional().nullable(),
    isDisabled: z.boolean().optional(),
    language: z.string().optional(),
  })
  .passthrough();

const AppSettingsSchema = z
  .object({
    functionapp: z.string(),
    settings: z.array(
      z
        .object({
          name: z.string(),
          value: z.string().optional(),
          slotSetting: z.boolean().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Swamp model for Azure Function App lifecycle. */
export const model = {
  type: "@dougschaefer/azure-function-app",
  version: "2026.07.06.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    functionapp: {
      description: "Azure Function App",
      schema: FunctionAppSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    function: {
      description: "Function within a Function App",
      schema: FunctionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    appSettings: {
      description: "Function App application settings",
      schema: AppSettingsSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
  },
  methods: {
    list: {
      description:
        "List Function Apps in a resource group (or across the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["functionapp", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const apps = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;
        context.logger.info("Found {count} Function Apps", {
          count: apps.length,
        });

        const handles = [];
        for (const app of apps) {
          const handle = await context.writeResource(
            "functionapp",
            sanitizeInstanceName(app.name as string),
            app,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const app = await az(
          ["functionapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "functionapp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description: "Refresh the stored state of a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const app = await az(
          ["functionapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "functionapp",
          sanitizeInstanceName(args.name),
          app,
        );
        context.logger.info("Synced Function App {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description:
        "Create a Function App. Requires a storage account; specify either consumptionPlanLocation (consumption plan) or plan (existing App Service Plan).",
      arguments: z.object({
        name: z.string().describe("Function App name (globally unique)"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        storageAccount: z
          .string()
          .describe("Storage account name for the Function App"),
        consumptionPlanLocation: z
          .string()
          .optional()
          .describe("Azure region for a consumption plan (e.g. 'eastus')"),
        plan: z
          .string()
          .optional()
          .describe("Existing App Service Plan name or ID"),
        runtime: z
          .string()
          .optional()
          .describe(
            "Runtime (e.g. 'node', 'python', 'dotnet', 'java', 'powershell')",
          ),
        runtimeVersion: z.string().optional().describe("Runtime version"),
        functionsVersion: z
          .string()
          .optional()
          .describe("Functions host version (e.g. '4')"),
        osType: z
          .enum(["Linux", "Windows"])
          .optional()
          .describe("OS type"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        if (!args.consumptionPlanLocation && !args.plan) {
          throw new Error(
            "Must specify either consumptionPlanLocation or plan",
          );
        }
        const cmdArgs = [
          "functionapp",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--storage-account",
          args.storageAccount,
        ];
        if (args.consumptionPlanLocation) {
          cmdArgs.push(
            "--consumption-plan-location",
            args.consumptionPlanLocation,
          );
        }
        if (args.plan) cmdArgs.push("--plan", args.plan);
        if (args.runtime) cmdArgs.push("--runtime", args.runtime);
        if (args.runtimeVersion) {
          cmdArgs.push("--runtime-version", args.runtimeVersion);
        }
        if (args.functionsVersion) {
          cmdArgs.push("--functions-version", args.functionsVersion);
        }
        if (args.osType) cmdArgs.push("--os-type", args.osType);
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Created Function App {name}", { name: args.name });

        const app = await az(
          ["functionapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "functionapp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    update: {
      description: "Update top-level properties on a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        httpsOnly: z.boolean().optional().describe("Require HTTPS only"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "functionapp",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.httpsOnly !== undefined) {
          cmdArgs.push(
            "--set",
            `httpsOnly=${args.httpsOnly.toString()}`,
          );
        }
        if (args.tags) {
          for (const [k, v] of Object.entries(args.tags)) {
            cmdArgs.push("--set", `tags.${k}=${v}`);
          }
        }
        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Updated Function App {name}", { name: args.name });

        const app = await az(
          ["functionapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "functionapp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "functionapp",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted Function App {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    start: {
      description: "Start a stopped Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["functionapp", "start", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const app = await az(
          ["functionapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "functionapp",
          sanitizeInstanceName(args.name),
          app,
        );
        context.logger.info("Started Function App {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    stop: {
      description: "Stop a running Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["functionapp", "stop", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const app = await az(
          ["functionapp", "show", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "functionapp",
          sanitizeInstanceName(args.name),
          app,
        );
        context.logger.info("Stopped Function App {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    restart: {
      description: "Restart a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "functionapp",
            "restart",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Restarted Function App {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    listAppSettings: {
      description: "List application settings for a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const settings = (await az(
          [
            "functionapp",
            "config",
            "appsettings",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Found {count} app settings on {name}", {
          count: settings.length,
          name: args.name,
        });
        const handle = await context.writeResource(
          "appSettings",
          sanitizeInstanceName(args.name),
          { functionapp: args.name, settings },
        );
        return { dataHandles: [handle] };
      },
    },

    setAppSettings: {
      description: "Set application settings on a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        settings: z
          .record(z.string(), z.string())
          .describe("Settings as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const pairs = Object.entries(args.settings).map(
          ([k, v]) => `${k}=${v}`,
        );
        const settings = (await az(
          [
            "functionapp",
            "config",
            "appsettings",
            "set",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--settings",
            ...pairs,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Set {count} app settings on {name}", {
          count: pairs.length,
          name: args.name,
        });
        const handle = await context.writeResource(
          "appSettings",
          sanitizeInstanceName(args.name),
          { functionapp: args.name, settings },
        );
        return { dataHandles: [handle] };
      },
    },

    listFunctions: {
      description: "List functions within a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const fns = (await az(
          [
            "functionapp",
            "function",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Found {count} functions in {name}", {
          count: fns.length,
          name: args.name,
        });
        const handles = [];
        for (const fn of fns) {
          const handle = await context.writeResource(
            "function",
            sanitizeInstanceName(fn.name as string),
            fn,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getFunction: {
      description: "Get a single function within a Function App.",
      arguments: z.object({
        name: z.string().describe("Function App name"),
        functionName: z.string().describe("Function name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const fn = await az(
          [
            "functionapp",
            "function",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--function-name",
            args.functionName,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "function",
          sanitizeInstanceName(`${args.name}-${args.functionName}`),
          fn as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
