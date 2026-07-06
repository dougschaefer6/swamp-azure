// Ported from https://github.com/rkcoleman/swamp-azure-containers — MIT © Ryan Coleman
/**
 * `@dougschaefer/azure-container-app-environment` model — Azure Container Apps
 * managed environment lifecycle, wrapping the `az containerapp env` CLI.
 * The environment is the compute boundary for one or more Container Apps —
 * it owns the VNet integration, Log Analytics workspace binding, Dapr
 * configuration, and zone redundancy. list enumerates environments in a
 * resource group or subscription; get/sync read or refresh one; create
 * provisions a new environment (optionally with Log Analytics); delete
 * removes it (and all apps in it).
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

const EnvironmentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string().optional(),
    type: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

const CertificateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Swamp model for Azure Container Apps managed environment lifecycle. */
export const model = {
  type: "@dougschaefer/azure-container-app-environment",
  version: "2026.07.06.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    environment: {
      description: "Azure Container Apps managed environment",
      schema: EnvironmentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    certificate: {
      description: "Container Apps environment certificate",
      schema: CertificateSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all Container Apps environments in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["containerapp", "env", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const envs = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Container Apps environments", {
          count: envs.length,
        });

        const handles = [];
        for (const env of envs) {
          const handle = await context.writeResource(
            "environment",
            sanitizeInstanceName(env.name as string),
            env,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Container Apps environment.",
      arguments: z.object({
        name: z.string().describe("Environment name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const env = await az(
          [
            "containerapp",
            "env",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "environment",
          sanitizeInstanceName(args.name),
          env,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a Container Apps environment without making changes.",
      arguments: z.object({
        name: z.string().describe("Environment name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const env = await az(
          [
            "containerapp",
            "env",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "environment",
          sanitizeInstanceName(args.name),
          env,
        );
        context.logger.info("Synced environment {name}", { name: args.name });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a Container Apps managed environment.",
      arguments: z.object({
        name: z.string().describe("Environment name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        logsWorkspaceId: z
          .string()
          .optional()
          .describe(
            "Log Analytics workspace customer ID to associate with the environment",
          ),
        logsWorkspaceKey: z
          .string()
          .optional()
          .describe("Log Analytics workspace shared key"),
        infrastructureSubnetResourceId: z
          .string()
          .optional()
          .describe(
            "Resource ID of the subnet for VNet integration (must be /23 or larger and delegated)",
          ),
        internalOnly: z
          .boolean()
          .optional()
          .describe(
            "If true, environment is only reachable from within the VNet",
          ),
        zoneRedundant: z
          .boolean()
          .optional()
          .describe("Enable zone redundancy (requires VNet integration)"),
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
          "env",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
        ];
        if (args.logsWorkspaceId) {
          cmdArgs.push("--logs-workspace-id", args.logsWorkspaceId);
        }
        if (args.logsWorkspaceKey) {
          cmdArgs.push("--logs-workspace-key", args.logsWorkspaceKey);
        }
        if (args.infrastructureSubnetResourceId) {
          cmdArgs.push(
            "--infrastructure-subnet-resource-id",
            args.infrastructureSubnetResourceId,
          );
        }
        if (args.internalOnly !== undefined) {
          cmdArgs.push("--internal-only", args.internalOnly.toString());
        }
        if (args.zoneRedundant) cmdArgs.push("--zone-redundant");
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created Container Apps environment {name} in {location}",
          { name: args.name, location: args.location },
        );

        const env = await az(
          [
            "containerapp",
            "env",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "environment",
          sanitizeInstanceName(args.name),
          env,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description:
        "Delete a Container Apps environment. All apps in the environment must be deleted first.",
      arguments: z.object({
        name: z.string().describe("Environment name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "containerapp",
            "env",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted Container Apps environment {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    update: {
      description:
        "Update a Container Apps environment — change Log Analytics workspace, workload profiles, or tags.",
      arguments: z.object({
        name: z.string().describe("Environment name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        logsWorkspaceId: z
          .string()
          .optional()
          .describe("New Log Analytics workspace customer ID"),
        logsWorkspaceKey: z
          .string()
          .optional()
          .describe("New Log Analytics workspace shared key"),
        workloadProfileName: z
          .string()
          .optional()
          .describe("Name of the workload profile to add/update"),
        workloadProfileType: z
          .string()
          .optional()
          .describe(
            "Workload profile type (e.g. Consumption, D4, D8, E4) — required when adding a profile",
          ),
        minNodes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Minimum nodes for the workload profile"),
        maxNodes: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Maximum nodes for the workload profile"),
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
          "env",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.logsWorkspaceId) {
          cmdArgs.push("--logs-workspace-id", args.logsWorkspaceId);
        }
        if (args.logsWorkspaceKey) {
          cmdArgs.push("--logs-workspace-key", args.logsWorkspaceKey);
        }
        if (args.workloadProfileName) {
          cmdArgs.push("--workload-profile-name", args.workloadProfileName);
        }
        if (args.workloadProfileType) {
          cmdArgs.push("--workload-profile-type", args.workloadProfileType);
        }
        if (args.minNodes !== undefined) {
          cmdArgs.push("--min-nodes", args.minNodes.toString());
        }
        if (args.maxNodes !== undefined) {
          cmdArgs.push("--max-nodes", args.maxNodes.toString());
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Updated Container Apps environment {name}",
          { name: args.name },
        );

        const env = await az(
          [
            "containerapp",
            "env",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "environment",
          sanitizeInstanceName(args.name),
          env,
        );
        return { dataHandles: [handle] };
      },
    },

    listCertificates: {
      description:
        "List custom-domain certificates installed on a Container Apps environment.",
      arguments: z.object({
        name: z.string().describe("Environment name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const certs = (await az(
          [
            "containerapp",
            "env",
            "certificate",
            "list",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} certificates on {name}", {
          count: certs.length,
          name: args.name,
        });

        const handles = [];
        for (const cert of certs) {
          const handle = await context.writeResource(
            "certificate",
            sanitizeInstanceName(cert.name as string),
            cert,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    uploadCertificate: {
      description:
        "Upload a PFX certificate to a Container Apps environment for custom-domain binding.",
      arguments: z.object({
        name: z.string().describe("Environment name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        certificateName: z
          .string()
          .describe("Friendly name for the certificate inside the environment"),
        certificateFile: z
          .string()
          .describe("Path to the PFX certificate file"),
        certificatePassword: z
          .string()
          .optional()
          .describe("Password for the PFX certificate file"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "containerapp",
          "env",
          "certificate",
          "upload",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--certificate-file",
          args.certificateFile,
          "--certificate-name",
          args.certificateName,
        ];
        if (args.certificatePassword) {
          cmdArgs.push("--password", args.certificatePassword);
        }

        const cert = await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Uploaded certificate {cert} to environment {name}",
          { cert: args.certificateName, name: args.name },
        );

        const handle = await context.writeResource(
          "certificate",
          sanitizeInstanceName(args.certificateName),
          cert as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
