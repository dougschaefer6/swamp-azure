// Ported from https://github.com/rkcoleman/swamp-azure-containers — MIT © Ryan Coleman
/**
 * `@dougschaefer/azure-container-app` model — Azure Container Apps
 * lifecycle, wrapping the `az containerapp` CLI. A Container App runs
 * inside a managed environment (see `@dougschaefer/azure-container-app-environment`)
 * and serves one or more revisions of a container image with HTTP or TCP
 * ingress, auto-scaling, and Dapr integration. list enumerates apps in
 * a resource group or subscription; get/sync read or refresh one app's
 * full configuration (template, ingress, revisions, identity); create
 * provisions a new app from an image; delete removes it.
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

const ContainerAppSchema = z
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

const RevisionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Swamp model for Azure Container App lifecycle. See module docs for scope. */
export const model = {
  type: "@dougschaefer/azure-container-app",
  version: "2026.07.06.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    containerApp: {
      description: "Azure Container App",
      schema: ContainerAppSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    revision: {
      description: "Container App revision",
      schema: RevisionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all Container Apps in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["containerapp", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const apps = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Container Apps", {
          count: apps.length,
        });

        const handles = [];
        for (const app of apps) {
          const handle = await context.writeResource(
            "containerApp",
            sanitizeInstanceName(app.name as string),
            app,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Container App with full configuration.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const app = await az(
          [
            "containerapp",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "containerApp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Container App without making changes.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const app = await az(
          [
            "containerapp",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "containerApp",
          sanitizeInstanceName(args.name),
          app,
        );
        context.logger.info("Synced Container App {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a Container App from an image.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        environment: z
          .string()
          .describe(
            "Name or resource ID of the Container Apps managed environment",
          ),
        image: z
          .string()
          .describe(
            "Container image, e.g. mcr.microsoft.com/k8se/quickstart:latest",
          ),
        targetPort: z
          .number()
          .int()
          .optional()
          .describe("Container port to expose via ingress"),
        ingress: z
          .enum(["external", "internal", "disabled"])
          .optional()
          .describe("Ingress visibility"),
        cpu: z
          .string()
          .optional()
          .describe("CPU cores (e.g. '0.5')"),
        memory: z
          .string()
          .optional()
          .describe("Memory (e.g. '1.0Gi')"),
        minReplicas: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Minimum replica count"),
        maxReplicas: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Maximum replica count"),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Environment variables as key=value pairs"),
        registryServer: z
          .string()
          .optional()
          .describe("Container registry server (for private images)"),
        registryIdentity: z
          .string()
          .optional()
          .describe(
            "User-assigned managed identity resource ID to pull from registry",
          ),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "containerapp",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--environment",
          args.environment,
          "--image",
          args.image,
        ];
        if (args.targetPort !== undefined) {
          cmdArgs.push("--target-port", args.targetPort.toString());
        }
        if (args.ingress) cmdArgs.push("--ingress", args.ingress);
        if (args.cpu) cmdArgs.push("--cpu", args.cpu);
        if (args.memory) cmdArgs.push("--memory", args.memory);
        if (args.minReplicas !== undefined) {
          cmdArgs.push("--min-replicas", args.minReplicas.toString());
        }
        if (args.maxReplicas !== undefined) {
          cmdArgs.push("--max-replicas", args.maxReplicas.toString());
        }
        if (args.env) {
          const envPairs = Object.entries(args.env).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--env-vars", ...envPairs);
        }
        if (args.registryServer) {
          cmdArgs.push("--registry-server", args.registryServer);
        }
        if (args.registryIdentity) {
          cmdArgs.push("--registry-identity", args.registryIdentity);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created Container App {name}", {
          name: args.name,
        });

        const app = await az(
          [
            "containerapp",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "containerApp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a Container App.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "containerapp",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted Container App {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    update: {
      description:
        "Update a Container App — change image, scale, env vars, resources, or tags. Creates a new revision.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        image: z.string().optional().describe("New container image"),
        cpu: z.string().optional().describe("CPU cores (e.g. '0.5')"),
        memory: z.string().optional().describe("Memory (e.g. '1.0Gi')"),
        minReplicas: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Minimum replica count"),
        maxReplicas: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Maximum replica count"),
        setEnvVars: z
          .record(z.string(), z.string())
          .optional()
          .describe("Add or update environment variables (key=value pairs)"),
        revisionSuffix: z
          .string()
          .optional()
          .describe("User-friendly suffix appended to the new revision name"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "containerapp",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.image) cmdArgs.push("--image", args.image);
        if (args.cpu) cmdArgs.push("--cpu", args.cpu);
        if (args.memory) cmdArgs.push("--memory", args.memory);
        if (args.minReplicas !== undefined) {
          cmdArgs.push("--min-replicas", args.minReplicas.toString());
        }
        if (args.maxReplicas !== undefined) {
          cmdArgs.push("--max-replicas", args.maxReplicas.toString());
        }
        if (args.setEnvVars) {
          const pairs = Object.entries(args.setEnvVars).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--set-env-vars", ...pairs);
        }
        if (args.revisionSuffix) {
          cmdArgs.push("--revision-suffix", args.revisionSuffix);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Updated Container App {name}", {
          name: args.name,
        });

        const app = await az(
          [
            "containerapp",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "containerApp",
          sanitizeInstanceName(args.name),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    listRevisions: {
      description: "List all revisions of a Container App.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const revisions = (await az(
          [
            "containerapp",
            "revision",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} revisions for {name}", {
          count: revisions.length,
          name: args.name,
        });

        const handles = [];
        for (const rev of revisions) {
          const handle = await context.writeResource(
            "revision",
            sanitizeInstanceName(rev.name as string),
            rev,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getRevision: {
      description: "Get a single revision of a Container App.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        revision: z.string().describe("Revision name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const rev = await az(
          [
            "containerapp",
            "revision",
            "show",
            "--name",
            args.name,
            "--revision",
            args.revision,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "revision",
          sanitizeInstanceName(args.revision),
          rev,
        );
        return { dataHandles: [handle] };
      },
    },

    activateRevision: {
      description:
        "Activate a Container App revision (for multiple-revision mode).",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        revision: z.string().describe("Revision name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "containerapp",
            "revision",
            "activate",
            "--name",
            args.name,
            "--revision",
            args.revision,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const rev = await az(
          [
            "containerapp",
            "revision",
            "show",
            "--name",
            args.name,
            "--revision",
            args.revision,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "revision",
          sanitizeInstanceName(args.revision),
          rev,
        );
        context.logger.info("Activated revision {revision} of {name}", {
          revision: args.revision,
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    deactivateRevision: {
      description: "Deactivate a Container App revision.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        revision: z.string().describe("Revision name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "containerapp",
            "revision",
            "deactivate",
            "--name",
            args.name,
            "--revision",
            args.revision,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const rev = await az(
          [
            "containerapp",
            "revision",
            "show",
            "--name",
            args.name,
            "--revision",
            args.revision,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "revision",
          sanitizeInstanceName(args.revision),
          rev,
        );
        context.logger.info("Deactivated revision {revision} of {name}", {
          revision: args.revision,
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    restartRevision: {
      description: "Restart a Container App revision.",
      arguments: z.object({
        name: z.string().describe("Container App name"),
        revision: z.string().describe("Revision name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "containerapp",
            "revision",
            "restart",
            "--name",
            args.name,
            "--revision",
            args.revision,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Restarted revision {revision} of {name}", {
          revision: args.revision,
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
