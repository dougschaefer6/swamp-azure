import { z } from "npm:zod@4.3.6";
import { az, AzureGlobalArgsSchema, sanitizeInstanceName } from "./_helpers.ts";

const ResourceGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-resource-group` model — Azure resource-group
 * lifecycle, wrapping the `az group` CLI. list enumerates resource
 * groups in the subscription with location, tags, and provisioning
 * state. get returns a single group. create provisions a new group
 * at the chosen region with tags. delete tears one down, which
 * cascades to every resource inside — verify before running against
 * production hub or spoke groups. The lowest-cardinality scope below
 * subscription, used by every other azure model as the default
 * containing scope.
 */
export const model = {
  type: "@dougschaefer/azure-resource-group",
  version: "2026.07.28.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    resourceGroup: {
      description: "Azure resource group",
      schema: ResourceGroupSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all resource groups in the subscription. Produces one resource instance per group.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const groups = (await az(
          ["group", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} resource groups", {
          count: groups.length,
        });

        const handles = [];
        for (const rg of groups) {
          const handle = await context.writeResource(
            "resourceGroup",
            sanitizeInstanceName(rg.name as string),
            rg,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single resource group by name.",
      arguments: z.object({
        name: z.string().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = await az(
          ["group", "show", "--name", args.name],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "resourceGroup",
          sanitizeInstanceName(args.name),
          rg,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a resource group.",
      arguments: z.object({
        name: z.string().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = [
          "group",
          "create",
          "--name",
          args.name,
          "--location",
          args.location,
        ];

        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        const rg = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created resource group {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const handle = await context.writeResource(
          "resourceGroup",
          sanitizeInstanceName(args.name),
          rg,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a resource group and all its resources.",
      arguments: z.object({
        name: z.string().describe("Resource group name to delete"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        await az(
          ["group", "delete", "--name", args.name, "--yes", "--no-wait"],
          g.subscriptionId,
        );

        context.logger.info("Initiated deletion of resource group {name}", {
          name: args.name,
        });

        return { dataHandles: [] };
      },
    },
  },
};
