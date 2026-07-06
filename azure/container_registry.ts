// Ported from https://github.com/rkcoleman/swamp-azure-containers — MIT © Ryan Coleman
/**
 * `@dougschaefer/azure-container-registry` model — Azure Container Registry
 * (ACR) lifecycle, wrapping the `az acr` CLI. list enumerates registries
 * across a subscription or resource group with SKU, login server, admin
 * status, and network rules. get/sync read or refresh one registry.
 * create provisions a new registry. delete removes it. Repository and
 * image management (push/pull/tagging) is out of scope — use `az acr
 * repository` or extend this model with data-plane methods.
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

const RegistrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string().optional(),
    type: z.string().optional(),
    sku: z
      .object({ name: z.string(), tier: z.string().optional() })
      .passthrough()
      .optional(),
    loginServer: z.string().optional(),
    adminUserEnabled: z.boolean().optional(),
    provisioningState: z.string().optional(),
    publicNetworkAccess: z.string().optional(),
    networkRuleSet: z.record(z.string(), z.unknown()).optional().nullable(),
    encryption: z.record(z.string(), z.unknown()).optional().nullable(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

const RepositorySchema = z
  .object({
    registry: z.string(),
    name: z.string(),
  })
  .passthrough();

const CredentialsSchema = z
  .object({
    username: z.string(),
    passwords: z.array(
      z.object({ name: z.string(), value: z.string() }).passthrough(),
    ),
  })
  .passthrough();

/** Swamp model for Azure Container Registry lifecycle. */
export const model = {
  type: "@dougschaefer/azure-container-registry",
  version: "2026.07.06.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    registry: {
      description: "Azure Container Registry",
      schema: RegistrySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    repository: {
      description: "Repository within an Azure Container Registry",
      schema: RepositorySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    credentials: {
      description:
        "Admin login credentials for an Azure Container Registry (sensitive)",
      schema: CredentialsSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
  },
  methods: {
    list: {
      description:
        "List all Azure Container Registries in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["acr", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const registries = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} container registries", {
          count: registries.length,
        });

        const handles = [];
        for (const reg of registries) {
          const handle = await context.writeResource(
            "registry",
            sanitizeInstanceName(reg.name as string),
            reg,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Azure Container Registry.",
      arguments: z.object({
        name: z.string().describe("Registry name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const reg = await az(
          [
            "acr",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "registry",
          sanitizeInstanceName(args.name),
          reg,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a container registry without making changes.",
      arguments: z.object({
        name: z.string().describe("Registry name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const reg = await az(
          [
            "acr",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "registry",
          sanitizeInstanceName(args.name),
          reg,
        );
        context.logger.info("Synced container registry {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create an Azure Container Registry.",
      arguments: z.object({
        name: z
          .string()
          .describe(
            "Registry name (5-50 chars, alphanumeric, globally unique)",
          ),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        sku: z
          .enum(["Basic", "Standard", "Premium"])
          .default("Basic")
          .describe("Registry SKU"),
        adminEnabled: z
          .boolean()
          .optional()
          .describe("Enable the admin user (default: false)"),
        publicNetworkAccess: z
          .enum(["Enabled", "Disabled"])
          .optional()
          .describe("Allow public network access"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "acr",
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
        if (args.adminEnabled !== undefined) {
          cmdArgs.push("--admin-enabled", args.adminEnabled.toString());
        }
        if (args.publicNetworkAccess) {
          cmdArgs.push(
            "--public-network-enabled",
            args.publicNetworkAccess === "Enabled" ? "true" : "false",
          );
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created container registry {name} ({sku}) in {location}",
          { name: args.name, sku: args.sku, location: args.location },
        );

        const reg = await az(
          [
            "acr",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "registry",
          sanitizeInstanceName(args.name),
          reg,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete an Azure Container Registry.",
      arguments: z.object({
        name: z.string().describe("Registry name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "acr",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted container registry {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    update: {
      description:
        "Update a container registry — change SKU, admin status, public network access, or tags.",
      arguments: z.object({
        name: z.string().describe("Registry name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        sku: z
          .enum(["Basic", "Standard", "Premium"])
          .optional()
          .describe("New registry SKU"),
        adminEnabled: z
          .boolean()
          .optional()
          .describe("Enable or disable the admin user"),
        publicNetworkAccess: z
          .enum(["Enabled", "Disabled"])
          .optional()
          .describe("Allow or block public network access"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "acr",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        if (args.sku) cmdArgs.push("--sku", args.sku);
        if (args.adminEnabled !== undefined) {
          cmdArgs.push("--admin-enabled", args.adminEnabled.toString());
        }
        if (args.publicNetworkAccess) {
          cmdArgs.push(
            "--public-network-enabled",
            args.publicNetworkAccess === "Enabled" ? "true" : "false",
          );
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Updated container registry {name}", {
          name: args.name,
        });

        const reg = await az(
          [
            "acr",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "registry",
          sanitizeInstanceName(args.name),
          reg,
        );
        return { dataHandles: [handle] };
      },
    },

    listRepositories: {
      description:
        "List repositories (image names) inside a container registry. Requires admin auth or AAD permissions on the registry.",
      arguments: z.object({
        name: z.string().describe("Registry name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const repoNames = (await az(
          [
            "acr",
            "repository",
            "list",
            "--name",
            args.name,
          ],
          g.subscriptionId,
        )) as string[];

        context.logger.info("Found {count} repositories in {name}", {
          count: repoNames.length,
          name: args.name,
        });

        const handles = [];
        for (const repoName of repoNames) {
          const handle = await context.writeResource(
            "repository",
            sanitizeInstanceName(`${args.name}--${repoName}`),
            { registry: args.name, name: repoName },
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listTags: {
      description: "List tags for a repository in a container registry.",
      arguments: z.object({
        name: z.string().describe("Registry name"),
        repository: z.string().describe("Repository (image) name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const tags = (await az(
          [
            "acr",
            "repository",
            "show-tags",
            "--name",
            args.name,
            "--repository",
            args.repository,
          ],
          g.subscriptionId,
        )) as string[];

        context.logger.info(
          "Found {count} tags for {registry}/{repo}",
          {
            count: tags.length,
            registry: args.name,
            repo: args.repository,
          },
        );

        const handle = await context.writeResource(
          "repository",
          sanitizeInstanceName(`${args.name}--${args.repository}`),
          { registry: args.name, name: args.repository, tags },
        );
        return { dataHandles: [handle] };
      },
    },

    getCredentials: {
      description:
        "Get admin login credentials for a container registry. Admin user must be enabled on the registry.",
      arguments: z.object({
        name: z.string().describe("Registry name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const creds = await az(
          [
            "acr",
            "credential",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "credentials",
          sanitizeInstanceName(args.name),
          creds as Record<string, unknown>,
        );
        context.logger.info(
          "Retrieved admin credentials for registry {name}",
          { name: args.name },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
