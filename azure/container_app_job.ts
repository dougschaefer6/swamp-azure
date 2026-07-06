// Ported from https://github.com/rkcoleman/swamp-azure-containers — MIT © Ryan Coleman
/**
 * `@dougschaefer/azure-container-app-job` model — Azure Container Apps
 * Jobs lifecycle, wrapping `az containerapp job`. A Container Apps
 * Job runs a containerized workload to completion on a schedule
 * (cron), in response to an event, or manually — distinct from a
 * Container App (`@dougschaefer/azure-container-app`) which serves
 * long-running traffic. Jobs run inside the same managed environment
 * (`@dougschaefer/azure-container-app-environment`). Covers CRUD,
 * start/stop, execution history, and secret management.
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

const JobSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string().optional(),
    type: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    identity: z.record(z.string(), z.unknown()).optional().nullable(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

const ExecutionSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const SecretSchema = z
  .object({
    name: z.string(),
    value: z.string().optional(),
    identity: z.string().optional(),
    keyVaultUrl: z.string().optional(),
  })
  .passthrough();

const SecretsSchema = z
  .object({
    job: z.string(),
    secrets: z.array(SecretSchema),
  })
  .passthrough();

/** Swamp model for Azure Container Apps Job lifecycle. */
export const model = {
  type: "@dougschaefer/azure-container-app-job",
  version: "2026.07.06.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    job: {
      description: "Azure Container Apps Job",
      schema: JobSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    execution: {
      description: "Container Apps Job execution",
      schema: ExecutionSchema,
      lifetime: "infinite",
      garbageCollection: 25,
    },
    secrets: {
      description: "Container Apps Job secrets (values redacted by Azure)",
      schema: SecretsSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
  },
  methods: {
    list: {
      description:
        "List Container Apps Jobs in a resource group (or across the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["containerapp", "job", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const jobs = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;
        context.logger.info("Found {count} Container Apps Jobs", {
          count: jobs.length,
        });

        const handles = [];
        for (const job of jobs) {
          const handle = await context.writeResource(
            "job",
            sanitizeInstanceName(job.name as string),
            job,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get details of a single Container Apps Job.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const job = await az(
          [
            "containerapp",
            "job",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "job",
          sanitizeInstanceName(args.name),
          job,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Container Apps Job without changes.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const job = await az(
          [
            "containerapp",
            "job",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "job",
          sanitizeInstanceName(args.name),
          job,
        );
        context.logger.info("Synced Container Apps Job {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description:
        "Create a Container Apps Job. Choose triggerType: 'Schedule' (with cronExpression), 'Event' (with KEDA scale rule), or 'Manual'.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        environment: z
          .string()
          .describe("Container Apps Environment name or resource ID"),
        image: z.string().describe(
          "Container image (e.g. 'myacr.azurecr.io/img:tag')",
        ),
        triggerType: z
          .enum(["Schedule", "Event", "Manual"])
          .default("Manual")
          .describe("Job trigger type"),
        cronExpression: z
          .string()
          .optional()
          .describe(
            "Cron expression (e.g. '0 6 * * *'). Required when triggerType=Schedule.",
          ),
        replicaTimeout: z
          .number()
          .int()
          .optional()
          .describe("Max seconds a replica can execute (default 1800)"),
        replicaRetryLimit: z
          .number()
          .int()
          .optional()
          .describe("Max retries before a replica fails"),
        replicaCompletionCount: z
          .number()
          .int()
          .optional()
          .describe(
            "Replicas that must complete successfully per execution (default 1)",
          ),
        parallelism: z
          .number()
          .int()
          .optional()
          .describe("Max replicas per execution (default 1)"),
        cpu: z.string().optional().describe("CPU in cores (e.g. '0.5')"),
        memory: z
          .string()
          .optional()
          .describe("Memory ending with 'Gi' (e.g. '1Gi')"),
        containerName: z.string().optional().describe("Container name"),
        command: z
          .array(z.string())
          .optional()
          .describe("Container startup command"),
        args: z
          .array(z.string())
          .optional()
          .describe("Container startup command arguments"),
        envVars: z
          .record(z.string(), z.string())
          .optional()
          .describe("Environment variables as key=value pairs"),
        registryServer: z
          .string()
          .optional()
          .describe("Container registry server (e.g. 'myacr.azurecr.io')"),
        registryUsername: z.string().optional().describe("Registry username"),
        registryPassword: z.string().optional().describe("Registry password"),
        registryIdentity: z
          .string()
          .optional()
          .describe(
            "Managed identity for registry auth ('system' or user MI ID)",
          ),
        miSystemAssigned: z
          .boolean()
          .optional()
          .describe("Assign system-assigned managed identity"),
        miUserAssigned: z
          .array(z.string())
          .optional()
          .describe("User-assigned managed identity resource IDs"),
        secrets: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Job secrets as key=value pairs (referenced from env vars)",
          ),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        if (args.triggerType === "Schedule" && !args.cronExpression) {
          throw new Error(
            "cronExpression is required when triggerType is 'Schedule'",
          );
        }
        const cmdArgs = [
          "containerapp",
          "job",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--environment",
          args.environment,
          "--image",
          args.image,
          "--trigger-type",
          args.triggerType,
        ];
        if (args.cronExpression) {
          cmdArgs.push("--cron-expression", args.cronExpression);
        }
        if (args.replicaTimeout !== undefined) {
          cmdArgs.push("--replica-timeout", args.replicaTimeout.toString());
        }
        if (args.replicaRetryLimit !== undefined) {
          cmdArgs.push(
            "--replica-retry-limit",
            args.replicaRetryLimit.toString(),
          );
        }
        if (args.replicaCompletionCount !== undefined) {
          cmdArgs.push(
            "--replica-completion-count",
            args.replicaCompletionCount.toString(),
          );
        }
        if (args.parallelism !== undefined) {
          cmdArgs.push("--parallelism", args.parallelism.toString());
        }
        if (args.cpu) cmdArgs.push("--cpu", args.cpu);
        if (args.memory) cmdArgs.push("--memory", args.memory);
        if (args.containerName) {
          cmdArgs.push("--container-name", args.containerName);
        }
        if (args.command && args.command.length > 0) {
          cmdArgs.push("--command", ...args.command);
        }
        if (args.args && args.args.length > 0) {
          cmdArgs.push("--args", ...args.args);
        }
        if (args.envVars) {
          const pairs = Object.entries(args.envVars).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--env-vars", ...pairs);
        }
        if (args.registryServer) {
          cmdArgs.push("--registry-server", args.registryServer);
        }
        if (args.registryUsername) {
          cmdArgs.push("--registry-username", args.registryUsername);
        }
        if (args.registryPassword) {
          cmdArgs.push("--registry-password", args.registryPassword);
        }
        if (args.registryIdentity) {
          cmdArgs.push("--registry-identity", args.registryIdentity);
        }
        if (args.miSystemAssigned) cmdArgs.push("--mi-system-assigned");
        if (args.miUserAssigned && args.miUserAssigned.length > 0) {
          cmdArgs.push("--mi-user-assigned", ...args.miUserAssigned);
        }
        if (args.secrets) {
          const pairs = Object.entries(args.secrets).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--secrets", ...pairs);
        }
        if (args.tags) {
          const pairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...pairs);
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Created Container Apps Job {name}", {
          name: args.name,
        });

        const job = await az(
          [
            "containerapp",
            "job",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "job",
          sanitizeInstanceName(args.name),
          job,
        );
        return { dataHandles: [handle] };
      },
    },

    update: {
      description:
        "Update a Container Apps Job — change image, cron expression, replica settings, env vars, or tags.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        image: z.string().optional().describe("New container image"),
        cronExpression: z
          .string()
          .optional()
          .describe("New cron expression (only valid for Schedule jobs)"),
        replicaTimeout: z.number().int().optional(),
        replicaRetryLimit: z.number().int().optional(),
        replicaCompletionCount: z.number().int().optional(),
        parallelism: z.number().int().optional(),
        cpu: z.string().optional(),
        memory: z.string().optional(),
        envVars: z
          .record(z.string(), z.string())
          .optional()
          .describe("Environment variables to set as key=value pairs"),
        tags: z.record(z.string(), z.string()).optional(),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "containerapp",
          "job",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.image) cmdArgs.push("--image", args.image);
        if (args.cronExpression) {
          cmdArgs.push("--cron-expression", args.cronExpression);
        }
        if (args.replicaTimeout !== undefined) {
          cmdArgs.push("--replica-timeout", args.replicaTimeout.toString());
        }
        if (args.replicaRetryLimit !== undefined) {
          cmdArgs.push(
            "--replica-retry-limit",
            args.replicaRetryLimit.toString(),
          );
        }
        if (args.replicaCompletionCount !== undefined) {
          cmdArgs.push(
            "--replica-completion-count",
            args.replicaCompletionCount.toString(),
          );
        }
        if (args.parallelism !== undefined) {
          cmdArgs.push("--parallelism", args.parallelism.toString());
        }
        if (args.cpu) cmdArgs.push("--cpu", args.cpu);
        if (args.memory) cmdArgs.push("--memory", args.memory);
        if (args.envVars) {
          const pairs = Object.entries(args.envVars).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--set-env-vars", ...pairs);
        }
        if (args.tags) {
          const pairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...pairs);
        }

        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Updated Container Apps Job {name}", {
          name: args.name,
        });

        const job = await az(
          [
            "containerapp",
            "job",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "job",
          sanitizeInstanceName(args.name),
          job,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a Container Apps Job.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "containerapp",
            "job",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted Container Apps Job {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    start: {
      description:
        "Start a Container Apps Job execution. For Manual jobs this is how you trigger a run; for Schedule jobs this triggers an ad-hoc run outside the cron schedule.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        image: z
          .string()
          .optional()
          .describe("Override the container image for this execution"),
        command: z
          .array(z.string())
          .optional()
          .describe("Override the container startup command"),
        args: z
          .array(z.string())
          .optional()
          .describe("Override the container startup command arguments"),
        cpu: z.string().optional().describe("Override CPU"),
        memory: z.string().optional().describe("Override memory"),
        envVars: z
          .record(z.string(), z.string())
          .optional()
          .describe("Override environment variables"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "containerapp",
          "job",
          "start",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.image) cmdArgs.push("--image", args.image);
        if (args.command && args.command.length > 0) {
          cmdArgs.push("--command", ...args.command);
        }
        if (args.args && args.args.length > 0) {
          cmdArgs.push("--args", ...args.args);
        }
        if (args.cpu) cmdArgs.push("--cpu", args.cpu);
        if (args.memory) cmdArgs.push("--memory", args.memory);
        if (args.envVars) {
          const pairs = Object.entries(args.envVars).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--env-vars", ...pairs);
        }

        const execution = await az(cmdArgs, g.subscriptionId);
        context.logger.info("Started Container Apps Job {name}", {
          name: args.name,
        });
        const execName =
          (execution as Record<string, unknown>).name as string ??
            `${args.name}-exec`;
        const handle = await context.writeResource(
          "execution",
          sanitizeInstanceName(execName),
          execution as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },

    stop: {
      description:
        "Stop a running Container Apps Job execution. If executionName is omitted, stops all currently-running executions.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        executionName: z
          .string()
          .optional()
          .describe(
            "Specific execution to stop. Omit to stop all running executions.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "containerapp",
          "job",
          "stop",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.executionName) {
          cmdArgs.push("--job-execution-name", args.executionName);
        }
        await az(cmdArgs, g.subscriptionId);
        context.logger.info("Stopped Container Apps Job {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    listExecutions: {
      description: "List executions (run history) of a Container Apps Job.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const result = (await az(
          [
            "containerapp",
            "job",
            "execution",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as
          | Array<Record<string, unknown>>
          | { value: Array<Record<string, unknown>> };
        const executions = Array.isArray(result) ? result : result.value ?? [];
        context.logger.info("Found {count} executions of {name}", {
          count: executions.length,
          name: args.name,
        });
        const handles = [];
        for (const exec of executions) {
          const handle = await context.writeResource(
            "execution",
            sanitizeInstanceName(exec.name as string),
            exec,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getExecution: {
      description: "Get a single Container Apps Job execution.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        executionName: z.string().describe("Execution name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const exec = await az(
          [
            "containerapp",
            "job",
            "execution",
            "show",
            "--name",
            args.name,
            "--job-execution-name",
            args.executionName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "execution",
          sanitizeInstanceName(args.executionName),
          exec as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },

    listSecrets: {
      description:
        "List secrets attached to a Container Apps Job (Azure returns redacted values).",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const result = (await az(
          [
            "containerapp",
            "job",
            "secret",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        context.logger.info("Found {count} secrets on {name}", {
          count: result.length,
          name: args.name,
        });
        const handle = await context.writeResource(
          "secrets",
          sanitizeInstanceName(args.name),
          { job: args.name, secrets: result },
        );
        return { dataHandles: [handle] };
      },
    },

    setSecrets: {
      description: "Create or update secrets on a Container Apps Job.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        secrets: z
          .record(z.string(), z.string())
          .describe("Secrets to set as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const pairs = Object.entries(args.secrets).map(
          ([k, v]) => `${k}=${v}`,
        );
        await az(
          [
            "containerapp",
            "job",
            "secret",
            "set",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--secrets",
            ...pairs,
          ],
          g.subscriptionId,
        );
        context.logger.info("Set {count} secrets on {name}", {
          count: pairs.length,
          name: args.name,
        });
        const result = (await az(
          [
            "containerapp",
            "job",
            "secret",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;
        const handle = await context.writeResource(
          "secrets",
          sanitizeInstanceName(args.name),
          { job: args.name, secrets: result },
        );
        return { dataHandles: [handle] };
      },
    },

    removeSecrets: {
      description: "Remove named secrets from a Container Apps Job.",
      arguments: z.object({
        name: z.string().describe("Container Apps Job name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        secretNames: z
          .array(z.string())
          .min(1)
          .describe("Names of secrets to remove"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "containerapp",
            "job",
            "secret",
            "remove",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--secret-names",
            ...args.secretNames,
          ],
          g.subscriptionId,
        );
        context.logger.info("Removed {count} secrets from {name}", {
          count: args.secretNames.length,
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
