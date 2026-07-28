import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  isAzAlreadyExists,
  isAzNotFound,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const ManagedIdentitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    clientId: z.string().optional(),
    principalId: z.string().optional(),
    tenantId: z.string().optional(),
    type: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const FederatedCredentialSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    issuer: z.string().optional(),
    subject: z.string().nullish(),
    audiences: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-managed-identity` model — user-assigned managed-
 * identity lifecycle, wrapping the `az identity` CLI. list enumerates
 * user-assigned identities across a subscription or resource group
 * with clientId, principalId (the Entra service-principal object id),
 * and tenantId. get and sync return or refresh one identity. create
 * provisions a new user-assigned identity that can then be attached
 * to VMs, Key Vaults, Storage accounts, etc.; update replaces its tags
 * and delete removes it. Federated identity credentials (workload
 * identity federation for GitHub Actions, Kubernetes, or any OIDC
 * issuer) are managed with listFederatedCredentials,
 * createFederatedCredential, and deleteFederatedCredential — including
 * the az 2.87+ preview claims-matching expressions that replace an
 * exact subject match. RBAC role-assignment to these identities stays
 * out of scope and belongs to `@dougschaefer/azure-role-assignment`.
 */
export const model = {
  type: "@dougschaefer/azure-managed-identity",
  version: "2026.07.28.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    identity: {
      description: "Azure user-assigned managed identity",
      schema: ManagedIdentitySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    federatedCredential: {
      description:
        "Federated identity credential on a user-assigned managed identity",
      schema: FederatedCredentialSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all user-assigned managed identities in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["identity", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const identities = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} managed identities", {
          count: identities.length,
        });

        const handles = [];
        for (const id of identities) {
          const handle = await context.writeResource(
            "identity",
            sanitizeInstanceName(id.name as string),
            id,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single user-assigned managed identity.",
      arguments: z.object({
        name: z.string().describe("Identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const id = await az(
          [
            "identity",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "identity",
          sanitizeInstanceName(args.name),
          id,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a managed identity without making changes.",
      arguments: z.object({
        name: z.string().describe("Identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const id = await az(
          [
            "identity",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "identity",
          sanitizeInstanceName(args.name),
          id,
        );
        context.logger.info("Synced managed identity {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a user-assigned managed identity.",
      arguments: z.object({
        name: z.string().describe("Identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "identity",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
        ];

        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        const id = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created managed identity {name}", {
          name: args.name,
        });

        const handle = await context.writeResource(
          "identity",
          sanitizeInstanceName(args.name),
          id,
        );
        return { dataHandles: [handle] };
      },
    },

    update: {
      description:
        "Replace the tags on a user-assigned managed identity (az CLI 2.87+).",
      arguments: z.object({
        name: z.string().describe("Identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        tags: z
          .record(z.string(), z.string())
          .describe("Tags as key=value pairs; replaces the existing tag set"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "identity",
          "update",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];
        const tagPairs = Object.entries(args.tags).map(([k, v]) => `${k}=${v}`);
        cmdArgs.push("--tags", ...tagPairs);

        const id = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Updated managed identity {name}", {
          name: args.name,
        });

        const handle = await context.writeResource(
          "identity",
          sanitizeInstanceName(args.name),
          id,
        );
        return { dataHandles: [handle] };
      },
    },

    listFederatedCredentials: {
      description:
        "List federated identity credentials configured on a managed identity.",
      arguments: z.object({
        identityName: z.string().describe("Managed identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const credentials = (await az(
          [
            "identity",
            "federated-credential",
            "list",
            "--identity-name",
            args.identityName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info(
          "Found {count} federated credentials on {identity}",
          { count: credentials.length, identity: args.identityName },
        );

        const handles = [];
        for (const fc of credentials) {
          const handle = await context.writeResource(
            "federatedCredential",
            sanitizeInstanceName(`${args.identityName}-${fc.name as string}`),
            fc,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    createFederatedCredential: {
      description:
        "Create a federated identity credential on a managed identity for workload identity federation (GitHub Actions, Kubernetes, or any OIDC issuer). Identify the incoming token by exact subject OR by a claims-matching expression (az CLI 2.87+ preview) — exactly one of the two.",
      arguments: z.object({
        identityName: z.string().describe("Managed identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        name: z.string().describe("Federated credential name"),
        issuer: z
          .string()
          .describe(
            "OIDC issuer URL, e.g. https://token.actions.githubusercontent.com",
          ),
        subject: z
          .string()
          .optional()
          .describe(
            "Exact subject claim to match, e.g. repo:org/repo:ref:refs/heads/main. Mutually exclusive with claimsMatchingExpression.",
          ),
        claimsMatchingExpression: z
          .string()
          .optional()
          .describe(
            "Wildcard claims-matching expression instead of an exact subject, e.g. claims['sub'] matches 'repo:org/*:ref:refs/heads/*' (az CLI 2.87+, preview). Mutually exclusive with subject.",
          ),
        audiences: z
          .array(z.string())
          .optional()
          .describe(
            "Token audiences; defaults to api://AzureADTokenExchange when omitted",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        if (!args.subject === !args.claimsMatchingExpression) {
          throw new Error(
            "Provide exactly one of subject or claimsMatchingExpression",
          );
        }

        const cmdArgs = [
          "identity",
          "federated-credential",
          "create",
          "--name",
          args.name,
          "--identity-name",
          args.identityName,
          "--resource-group",
          rg,
          "--issuer",
          args.issuer,
        ];
        if (args.subject) cmdArgs.push("--subject", args.subject);
        if (args.claimsMatchingExpression) {
          cmdArgs.push(
            "--claims-matching-expression-value",
            args.claimsMatchingExpression,
            "--claims-matching-expression-version",
            "1",
          );
        }
        if (args.audiences) cmdArgs.push("--audiences", ...args.audiences);

        let credential: Record<string, unknown>;
        try {
          credential = (await az(cmdArgs, g.subscriptionId)) as Record<
            string,
            unknown
          >;
          context.logger.info(
            "Created federated credential {name} on {identity}",
            { name: args.name, identity: args.identityName },
          );
        } catch (err) {
          if (!isAzAlreadyExists(err)) throw err;
          // Converge on the existing credential of the same name.
          credential = (await az(
            [
              "identity",
              "federated-credential",
              "show",
              "--name",
              args.name,
              "--identity-name",
              args.identityName,
              "--resource-group",
              rg,
            ],
            g.subscriptionId,
          )) as Record<string, unknown>;
          context.logger.info(
            "Federated credential {name} already exists on {identity} — returning existing",
            { name: args.name, identity: args.identityName },
          );
        }

        const handle = await context.writeResource(
          "federatedCredential",
          sanitizeInstanceName(`${args.identityName}-${args.name}`),
          credential,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteFederatedCredential: {
      description:
        "Delete a federated identity credential from a managed identity.",
      arguments: z.object({
        identityName: z.string().describe("Managed identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        name: z.string().describe("Federated credential name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        try {
          await az(
            [
              "identity",
              "federated-credential",
              "delete",
              "--name",
              args.name,
              "--identity-name",
              args.identityName,
              "--resource-group",
              rg,
              "--yes",
            ],
            g.subscriptionId,
          );
          context.logger.info(
            "Deleted federated credential {name} from {identity}",
            { name: args.name, identity: args.identityName },
          );
        } catch (err) {
          if (isAzNotFound(err)) {
            context.logger.info(
              "Federated credential {name} already absent from {identity}",
              { name: args.name, identity: args.identityName },
            );
          } else {
            throw err;
          }
        }
        return { dataHandles: [] };
      },
    },

    delete: {
      description: "Delete a user-assigned managed identity.",
      arguments: z.object({
        name: z.string().describe("Identity name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "identity",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Deleted managed identity {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },
  },
};
