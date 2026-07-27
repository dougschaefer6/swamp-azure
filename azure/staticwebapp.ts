import { z } from "npm:zod@4.3.6";
import { az, AzureGlobalArgsSchema, sanitizeInstanceName } from "./_helpers.ts";

const StaticWebAppSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    defaultHostname: z.string().optional(),
    repositoryUrl: z.string().nullish(),
    branch: z.string().nullish(),
    sku: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string(), z.string()).nullish(),
  })
  .passthrough();

const EnvironmentSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    hostname: z.string().optional(),
    buildId: z.string().nullish(),
    sourceBranch: z.string().nullish(),
    status: z.string().optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-staticwebapp` model — read-only inventory of
 * Azure Static Web Apps and their deployment environments, wrapping
 * the `az staticwebapp` CLI. list enumerates Static Web Apps across a
 * subscription or resource group; get and sync return or refresh one
 * site; listEnvironments enumerates a site's deployment environments
 * (production plus preview/staging slots). Creation is deliberately
 * excluded because real deployments are wired to a repo/CI — use the
 * portal, the SWA CLI, or IaC for that. App settings and deployment
 * tokens are secret material that never flows through model data;
 * secrets belong in swamp vaults.
 */
export const model = {
  type: "@dougschaefer/azure-staticwebapp",
  version: "2026.07.24.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    site: {
      description: "Azure Static Web App",
      schema: StaticWebAppSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    environment: {
      description: "Deployment environment of an Azure Static Web App",
      schema: EnvironmentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List Static Web Apps in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["staticwebapp", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const sites = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Static Web Apps", {
          count: sites.length,
        });

        const handles = [];
        for (const site of sites) {
          const handle = await context.writeResource(
            "site",
            sanitizeInstanceName(site.name as string),
            site,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Static Web App.",
      arguments: z.object({
        name: z.string().describe("Static Web App name"),
        resourceGroup: z
          .string()
          .optional()
          .describe(
            "Resource group name. Optional — the CLI can resolve the app without it.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["staticwebapp", "show", "--name", args.name];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const site = await az(cmdArgs, g.subscriptionId);
        const handle = await context.writeResource(
          "site",
          sanitizeInstanceName(args.name),
          site,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Static Web App without making changes.",
      arguments: z.object({
        name: z.string().describe("Static Web App name"),
        resourceGroup: z
          .string()
          .optional()
          .describe(
            "Resource group name. Optional — the CLI can resolve the app without it.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["staticwebapp", "show", "--name", args.name];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const site = await az(cmdArgs, g.subscriptionId);
        const handle = await context.writeResource(
          "site",
          sanitizeInstanceName(args.name),
          site,
        );
        context.logger.info("Synced Static Web App {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    listEnvironments: {
      description:
        "List the deployment environments of a Static Web App, including production.",
      arguments: z.object({
        name: z.string().describe("Static Web App name"),
        resourceGroup: z
          .string()
          .optional()
          .describe(
            "Resource group name. Optional — the CLI can resolve the app without it.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = [
          "staticwebapp",
          "environment",
          "list",
          "--name",
          args.name,
        ];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const environments = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} environments on {site}", {
          count: environments.length,
          site: args.name,
        });

        const handles = [];
        for (const env of environments) {
          const envKey = (env.name ?? env.buildId ?? "default") as string;
          const handle = await context.writeResource(
            "environment",
            sanitizeInstanceName(`${args.name}-${envKey}`),
            env,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
