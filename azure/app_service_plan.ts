// Ported from https://github.com/rkcoleman/swamp-azure-app-service — MIT © Ryan Coleman

/**
 * `@dougschaefer/azure-app-service-plan` model — Azure App Service Plan
 * (Microsoft.Web/serverfarms) lifecycle, wrapping `az appservice plan`.
 * An App Service Plan is the compute fabric that hosts Web Apps and
 * Function Apps. It defines the region, OS, SKU (B1, S1, P1v3, …),
 * and worker count. list enumerates plans in a resource group or
 * subscription; get/sync read or refresh one plan; create provisions
 * a new plan; update scales SKU or worker count; delete removes it
 * (apps using the plan must be deleted or moved first).
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

const PlanSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string().optional(),
    kind: z.string().optional(),
    sku: z.record(z.string(), z.unknown()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    reserved: z.boolean().optional(),
    hyperV: z.boolean().optional(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

/** Swamp model for Azure App Service Plan lifecycle. */
export const model = {
  type: "@dougschaefer/azure-app-service-plan",
  version: "2026.07.06.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    plan: {
      description: "Azure App Service Plan",
      schema: PlanSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all App Service Plans in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["appservice", "plan", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const plans = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} App Service Plans", {
          count: plans.length,
        });

        const handles = [];
        for (const plan of plans) {
          const handle = await context.writeResource(
            "plan",
            sanitizeInstanceName(plan.name as string),
            plan,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single App Service Plan.",
      arguments: z.object({
        name: z.string().describe("Plan name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const plan = await az(
          [
            "appservice",
            "plan",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "plan",
          sanitizeInstanceName(args.name),
          plan,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of an App Service Plan without making changes.",
      arguments: z.object({
        name: z.string().describe("Plan name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const plan = await az(
          [
            "appservice",
            "plan",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "plan",
          sanitizeInstanceName(args.name),
          plan,
        );
        context.logger.info("Synced App Service Plan {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create an App Service Plan.",
      arguments: z.object({
        name: z.string().describe("Plan name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        sku: z
          .string()
          .default("B1")
          .describe(
            "Pricing SKU (F1, D1, B1, B2, B3, S1, S2, S3, P1v2, P2v2, P3v2, P1v3, P2v3, P3v3, I1, I2, I3)",
          ),
        isLinux: z
          .boolean()
          .optional()
          .describe("Create a Linux plan (default: false → Windows)"),
        numberOfWorkers: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Initial worker count"),
        hyperV: z
          .boolean()
          .optional()
          .describe("Create a Windows container plan"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "appservice",
          "plan",
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
        if (args.isLinux) cmdArgs.push("--is-linux");
        if (args.hyperV) cmdArgs.push("--hyper-v");
        if (args.numberOfWorkers !== undefined) {
          cmdArgs.push("--number-of-workers", args.numberOfWorkers.toString());
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Created App Service Plan {name} ({sku})", {
          name: args.name,
          sku: args.sku,
        });

        const plan = await az(
          [
            "appservice",
            "plan",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "plan",
          sanitizeInstanceName(args.name),
          plan,
        );
        return { dataHandles: [handle] };
      },
    },

    update: {
      description: "Update an App Service Plan — change SKU or worker count.",
      arguments: z.object({
        name: z.string().describe("Plan name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        sku: z.string().optional().describe("New pricing SKU"),
        numberOfWorkers: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("New worker count"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "appservice",
          "plan",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.sku) cmdArgs.push("--sku", args.sku);
        if (args.numberOfWorkers !== undefined) {
          cmdArgs.push("--number-of-workers", args.numberOfWorkers.toString());
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push(
            "--set",
            `tags={${
              tagPairs.map((p) =>
                `'${p.split("=")[0]}':'${p.split("=").slice(1).join("=")}'`
              ).join(",")
            }}`,
          );
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Updated App Service Plan {name}", {
          name: args.name,
        });

        const plan = await az(
          [
            "appservice",
            "plan",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "plan",
          sanitizeInstanceName(args.name),
          plan,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description:
        "Delete an App Service Plan. All apps using the plan must be deleted first.",
      arguments: z.object({
        name: z.string().describe("Plan name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "appservice",
            "plan",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted App Service Plan {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
