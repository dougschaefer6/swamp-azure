import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  isAzAlreadyExists,
  isAzNotFound,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const AccountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string().optional(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    sku: z.record(z.string(), z.unknown()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string(), z.string()).nullish(),
  })
  .passthrough();

const DeploymentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    properties: z.record(z.string(), z.unknown()).optional(),
    sku: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ConnectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const CatalogSchema = z
  .object({
    location: z.string(),
    count: z.number(),
    models: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

const UsageSchema = z
  .object({
    location: z.string(),
    count: z.number(),
    usages: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

const FOUNDRY_API_VERSION = "2025-06-01";

/**
 * `@dougschaefer/azure-ai-foundry` model — Azure AI Foundry and the
 * Azure AI Services accounts it is built on, wrapping `az
 * cognitiveservices` plus the ARM REST child resources the CLI does
 * not expose yet. listAccounts enumerates AI Services / Cognitive
 * Services accounts of any kind (AIServices is a Foundry resource;
 * OpenAI, Face, SpeechServices, etc. are single-service accounts).
 * listDeployments is a fan-out: name one account or omit it to sweep
 * every account in scope in one run. createDeployment and
 * deleteDeployment manage model deployments (the unit that makes a
 * model callable — e.g. deploy gpt-4o at a capacity on a SKU) and are
 * idempotent. listProjects and listConnections read the Foundry
 * project and connection child resources over ARM. listModels and
 * listUsage capture the per-region model catalog and quota
 * consumption as single snapshot resources. Account keys are
 * deliberately never fetched — data-plane credentials belong in swamp
 * vaults (see `@dougschaefer/azure-face` for the data-plane pattern).
 */
export const model = {
  type: "@dougschaefer/azure-ai-foundry",
  version: "2026.07.28.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    account: {
      description: "Azure AI Services / Cognitive Services account",
      schema: AccountSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    deployment: {
      description: "Model deployment on an AI Services account",
      schema: DeploymentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    project: {
      description: "Azure AI Foundry project (ARM child resource)",
      schema: ProjectSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    connection: {
      description: "Azure AI Foundry connection (ARM child resource)",
      schema: ConnectionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    modelCatalog: {
      description: "Per-region snapshot of deployable models",
      schema: CatalogSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
    usage: {
      description: "Per-region quota/usage snapshot",
      schema: UsageSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
  },
  methods: {
    listAccounts: {
      description:
        "List AI Services / Cognitive Services accounts in the subscription or a resource group, optionally filtered by kind (e.g. AIServices, OpenAI, Face).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
        kind: z
          .string()
          .optional()
          .describe(
            "Filter to one account kind, e.g. AIServices (Foundry), OpenAI, Face, SpeechServices",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["cognitiveservices", "account", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        let accounts = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;
        if (args.kind) {
          accounts = accounts.filter((a) => a.kind === args.kind);
        }

        context.logger.info("Found {count} AI service accounts", {
          count: accounts.length,
        });

        const handles = [];
        for (const a of accounts) {
          const handle = await context.writeResource(
            "account",
            sanitizeInstanceName(a.name as string),
            a,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getAccount: {
      description: "Get a single AI Services account.",
      arguments: z.object({
        name: z.string().describe("Account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const account = await az(
          [
            "cognitiveservices",
            "account",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "account",
          sanitizeInstanceName(args.name),
          account,
        );
        return { dataHandles: [handle] };
      },
    },

    syncAccount: {
      description:
        "Refresh the stored state of an AI Services account without making changes.",
      arguments: z.object({
        name: z.string().describe("Account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const account = await az(
          [
            "cognitiveservices",
            "account",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Synced AI service account {name}", {
          name: args.name,
        });
        const handle = await context.writeResource(
          "account",
          sanitizeInstanceName(args.name),
          account,
        );
        return { dataHandles: [handle] };
      },
    },

    listDeployments: {
      description:
        "List model deployments. Name one account, or omit accountName to fan out across every AI Services account in the subscription/resource group in a single run.",
      arguments: z.object({
        accountName: z
          .string()
          .optional()
          .describe(
            "Account to list deployments for; omit to sweep all accounts in scope",
          ),
        resourceGroup: z
          .string()
          .optional()
          .describe(
            "Resource group (required when accountName is set; otherwise narrows the sweep)",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        let targets: Array<{ name: string; resourceGroup: string }>;
        if (args.accountName) {
          const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
          targets = [{ name: args.accountName, resourceGroup: rg }];
        } else {
          const listArgs = ["cognitiveservices", "account", "list"];
          const rg = args.resourceGroup || g.resourceGroup;
          if (rg) listArgs.push("--resource-group", rg);
          const accounts = (await az(listArgs, g.subscriptionId)) as Array<
            Record<string, unknown>
          >;
          targets = accounts.map((a) => ({
            name: a.name as string,
            resourceGroup: a.resourceGroup as string,
          }));
        }

        const handles = [];
        let total = 0;
        for (const target of targets) {
          const deployments = (await az(
            [
              "cognitiveservices",
              "account",
              "deployment",
              "list",
              "--name",
              target.name,
              "--resource-group",
              target.resourceGroup,
            ],
            g.subscriptionId,
          )) as Array<Record<string, unknown>>;
          total += deployments.length;
          for (const d of deployments) {
            const handle = await context.writeResource(
              "deployment",
              sanitizeInstanceName(`${target.name}-${d.name as string}`),
              d,
            );
            handles.push(handle);
          }
        }

        context.logger.info(
          "Found {count} model deployments across {accounts} accounts",
          { count: total, accounts: targets.length },
        );
        return { dataHandles: handles };
      },
    },

    createDeployment: {
      description:
        "Deploy a model onto an AI Services account (e.g. gpt-4o on a Standard or GlobalStandard SKU). Idempotent — an existing deployment of the same name is returned instead.",
      arguments: z.object({
        accountName: z.string().describe("AI Services account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        deploymentName: z.string().describe("Deployment name"),
        modelName: z.string().describe("Model name, e.g. gpt-4o"),
        modelVersion: z
          .string()
          .describe("Model version, e.g. 2024-11-20 — see listModels"),
        modelFormat: z
          .string()
          .default("OpenAI")
          .describe("Model format/publisher, e.g. OpenAI"),
        skuName: z
          .string()
          .default("Standard")
          .describe("Deployment SKU, e.g. Standard, GlobalStandard"),
        capacity: z
          .number()
          .optional()
          .describe("SKU capacity in thousands of TPM units"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "cognitiveservices",
          "account",
          "deployment",
          "create",
          "--name",
          args.accountName,
          "--resource-group",
          rg,
          "--deployment-name",
          args.deploymentName,
          "--model-name",
          args.modelName,
          "--model-version",
          args.modelVersion,
          "--model-format",
          args.modelFormat,
          "--sku-name",
          args.skuName,
        ];
        if (args.capacity !== undefined) {
          cmdArgs.push("--sku-capacity", args.capacity.toString());
        }

        let deployment: Record<string, unknown>;
        try {
          deployment = (await az(cmdArgs, g.subscriptionId)) as Record<
            string,
            unknown
          >;
          context.logger.info(
            "Deployed {model} {version} as {deployment} on {account}",
            {
              model: args.modelName,
              version: args.modelVersion,
              deployment: args.deploymentName,
              account: args.accountName,
            },
          );
        } catch (err) {
          if (!isAzAlreadyExists(err)) throw err;
          // Converge on the existing deployment of the same name.
          deployment = (await az(
            [
              "cognitiveservices",
              "account",
              "deployment",
              "show",
              "--name",
              args.accountName,
              "--resource-group",
              rg,
              "--deployment-name",
              args.deploymentName,
            ],
            g.subscriptionId,
          )) as Record<string, unknown>;
          context.logger.info(
            "Deployment {deployment} already exists on {account} — returning existing",
            { deployment: args.deploymentName, account: args.accountName },
          );
        }

        const handle = await context.writeResource(
          "deployment",
          sanitizeInstanceName(`${args.accountName}-${args.deploymentName}`),
          deployment,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteDeployment: {
      description:
        "Delete a model deployment from an AI Services account. Idempotent — an already-absent deployment is not an error.",
      arguments: z.object({
        accountName: z.string().describe("AI Services account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        deploymentName: z.string().describe("Deployment name to delete"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        try {
          await az(
            [
              "cognitiveservices",
              "account",
              "deployment",
              "delete",
              "--name",
              args.accountName,
              "--resource-group",
              rg,
              "--deployment-name",
              args.deploymentName,
            ],
            g.subscriptionId,
          );
          context.logger.info(
            "Deleted deployment {deployment} from {account}",
            { deployment: args.deploymentName, account: args.accountName },
          );
        } catch (err) {
          if (isAzNotFound(err)) {
            context.logger.info(
              "Deployment {deployment} already absent from {account}",
              { deployment: args.deploymentName, account: args.accountName },
            );
          } else {
            throw err;
          }
        }
        return { dataHandles: [] };
      },
    },

    listProjects: {
      description:
        "List Azure AI Foundry projects on an account (ARM child resource — only AIServices-kind accounts host projects).",
      arguments: z.object({
        accountName: z.string().describe("AI Services account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const url =
          `https://management.azure.com/subscriptions/${g.subscriptionId}` +
          `/resourceGroups/${rg}/providers/Microsoft.CognitiveServices` +
          `/accounts/${args.accountName}/projects` +
          `?api-version=${FOUNDRY_API_VERSION}`;
        const response = (await az(
          ["rest", "--method", "get", "--url", url],
        )) as { value: Array<Record<string, unknown>> };
        const projects = response?.value ?? [];

        context.logger.info("Found {count} Foundry projects on {account}", {
          count: projects.length,
          account: args.accountName,
        });

        const handles = [];
        for (const p of projects) {
          const handle = await context.writeResource(
            "project",
            sanitizeInstanceName(`${args.accountName}-${p.name as string}`),
            p,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listConnections: {
      description:
        "List Azure AI Foundry connections on an account (ARM child resource). Connection secrets are never fetched — ARM returns metadata only.",
      arguments: z.object({
        accountName: z.string().describe("AI Services account name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const url =
          `https://management.azure.com/subscriptions/${g.subscriptionId}` +
          `/resourceGroups/${rg}/providers/Microsoft.CognitiveServices` +
          `/accounts/${args.accountName}/connections` +
          `?api-version=${FOUNDRY_API_VERSION}`;
        const response = (await az(
          ["rest", "--method", "get", "--url", url],
        )) as { value: Array<Record<string, unknown>> };
        const connections = response?.value ?? [];

        context.logger.info("Found {count} connections on {account}", {
          count: connections.length,
          account: args.accountName,
        });

        const handles = [];
        for (const c of connections) {
          const handle = await context.writeResource(
            "connection",
            sanitizeInstanceName(`${args.accountName}-${c.name as string}`),
            c,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listModels: {
      description:
        "Snapshot the deployable model catalog for a region (name, version, format, SKUs, capacities) as one modelCatalog resource.",
      arguments: z.object({
        location: z
          .string()
          .describe("Azure region to query, e.g. eastus2, centralus"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const models = (await az(
          ["cognitiveservices", "model", "list", "--location", args.location],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} deployable models in {location}", {
          count: models.length,
          location: args.location,
        });

        const handle = await context.writeResource(
          "modelCatalog",
          sanitizeInstanceName(args.location),
          { location: args.location, count: models.length, models },
        );
        return { dataHandles: [handle] };
      },
    },

    listUsage: {
      description:
        "Snapshot AI Services quota usage for a region (current value vs. limit per model/SKU) as one usage resource.",
      arguments: z.object({
        location: z
          .string()
          .describe("Azure region to query, e.g. eastus2, centralus"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const usages = (await az(
          ["cognitiveservices", "usage", "list", "--location", args.location],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} usage entries in {location}", {
          count: usages.length,
          location: args.location,
        });

        const handle = await context.writeResource(
          "usage",
          sanitizeInstanceName(args.location),
          { location: args.location, count: usages.length, usages },
        );
        return { dataHandles: [handle] };
      },
    },
  },

  checks: {
    "subscription-accessible": {
      description:
        "Verify the target subscription is reachable from the active az session before changing model deployments.",
      labels: ["live"],
      appliesTo: ["createDeployment", "deleteDeployment"],
      execute: async (context) => {
        const g = context.globalArgs;
        try {
          await az(["account", "show"], g.subscriptionId);
          return { pass: true };
        } catch (err) {
          return {
            pass: false,
            errors: [
              `Subscription ${g.subscriptionId} is not accessible from the active az session: ${
                String(err)
              }`,
            ],
          };
        }
      },
    },
  },
};
