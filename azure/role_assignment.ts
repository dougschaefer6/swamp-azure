import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  isAzAlreadyExists,
  isAzNotFound,
  sanitizeInstanceName,
} from "./_helpers.ts";

const AssignmentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    principalId: z.string().optional(),
    principalName: z.string().nullish(),
    principalType: z.string().nullish(),
    roleDefinitionId: z.string().optional(),
    roleDefinitionName: z.string().nullish(),
    scope: z.string().optional(),
    type: z.string().optional(),
    condition: z.string().nullish(),
    createdOn: z.string().nullish(),
    updatedOn: z.string().nullish(),
  })
  .passthrough();

const DefinitionSchema = z
  .object({
    name: z.string(),
    roleName: z.string().optional(),
    type: z.string().optional(),
    roleType: z.string().optional(),
    description: z.string().nullish(),
    assignableScopes: z.array(z.string()).optional(),
  })
  .passthrough();

const DenyAssignmentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    denyAssignmentName: z.string().nullish(),
    description: z.string().nullish(),
    scope: z.string().optional(),
    doNotApplyToChildScopes: z.boolean().optional(),
    isSystemProtected: z.boolean().optional(),
    principals: z.array(z.record(z.string(), z.unknown())).optional(),
    excludePrincipals: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-role-assignment` model — Azure RBAC role
 * assignments and definitions, wrapping the `az role` CLI. list
 * enumerates assignments at the subscription, a resource group, an
 * explicit scope, or (with all) every scope visible to the
 * subscription, optionally filtered to one assignee; on az CLI 2.87+
 * it also includes assignments inherited from management groups, and
 * the fillPrincipalName/fillRoleDefinitionName switches skip the
 * per-row Graph and ARM name lookups for fast bulk audits.
 * listDenyAssignments reads the subscription's deny assignments —
 * Azure-managed blocks that win over any role grant. create grants a
 * principal a role at a scope and delete revokes it — these are the
 * direct complement to `@dougschaefer/azure-managed-identity`, since
 * granting a managed identity access to a Key Vault, Storage account,
 * or resource group is a role assignment. listDefinitions and
 * getDefinition read built-in and custom role definitions so you can
 * resolve a role's permissions before assigning it. Assignment
 * mutations change who can do what in the subscription — verify the
 * principal, role, and scope before create/delete.
 */
export const model = {
  type: "@dougschaefer/azure-role-assignment",
  version: "2026.07.28.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    assignment: {
      description: "Azure RBAC role assignment",
      schema: AssignmentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    definition: {
      description: "Azure RBAC role definition",
      schema: DefinitionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    denyAssignment: {
      description: "Azure RBAC deny assignment (read-only, Azure-managed)",
      schema: DenyAssignmentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List role assignments at the subscription, a resource group, or an explicit scope.",
      arguments: z.object({
        assignee: z
          .string()
          .optional()
          .describe("Filter to one principal (object id, UPN, or SPN)"),
        scope: z
          .string()
          .optional()
          .describe("Explicit ARM scope id to list assignments at"),
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group to scope the listing to"),
        all: z
          .boolean()
          .optional()
          .describe("Include assignments at all scopes from the subscription"),
        fillPrincipalName: z
          .boolean()
          .optional()
          .describe(
            "Resolve principal display names via Microsoft Graph (CLI default true). Set false to skip the lookup for fast bulk audits (az CLI 2.87+).",
          ),
        fillRoleDefinitionName: z
          .boolean()
          .optional()
          .describe(
            "Resolve role definition names (CLI default true). Set false to skip the lookup for fast bulk audits (az CLI 2.87+).",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["role", "assignment", "list"];
        if (args.assignee) cmdArgs.push("--assignee", args.assignee);
        if (args.scope) cmdArgs.push("--scope", args.scope);
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg && !args.scope) cmdArgs.push("--resource-group", rg);
        if (args.all) cmdArgs.push("--all");
        if (args.fillPrincipalName === false) {
          cmdArgs.push("--fill-principal-name", "false");
        }
        if (args.fillRoleDefinitionName === false) {
          cmdArgs.push("--fill-role-definition-name", "false");
        }

        const assignments = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} role assignments", {
          count: assignments.length,
        });

        const handles = [];
        for (const a of assignments) {
          const handle = await context.writeResource(
            "assignment",
            sanitizeInstanceName(a.name as string),
            a,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    create: {
      description:
        "Grant a principal a role at a scope (subscription, resource group, or explicit scope).",
      arguments: z.object({
        assignee: z
          .string()
          .describe("Principal object id, UPN, or service principal name"),
        role: z.string().describe("Role name or role definition id"),
        scope: z
          .string()
          .optional()
          .describe("Explicit ARM scope id (overrides resourceGroup)"),
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group scope; omit both to use subscription"),
        assigneePrincipalType: z
          .enum(["User", "Group", "ServicePrincipal"])
          .optional()
          .describe(
            "Principal type — set when assignee is an object id to skip a Graph lookup",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const scope = args.scope ??
          (args.resourceGroup || g.resourceGroup
            ? `/subscriptions/${g.subscriptionId}/resourceGroups/${
              args.resourceGroup || g.resourceGroup
            }`
            : `/subscriptions/${g.subscriptionId}`);

        const cmdArgs = [
          "role",
          "assignment",
          "create",
          "--assignee",
          args.assignee,
          "--role",
          args.role,
          "--scope",
          scope,
        ];
        if (args.assigneePrincipalType) {
          cmdArgs.push("--assignee-principal-type", args.assigneePrincipalType);
        }

        let assignment: Record<string, unknown>;
        try {
          assignment = (await az(cmdArgs, g.subscriptionId)) as Record<
            string,
            unknown
          >;
          context.logger.info("Granted {role} to {assignee} at {scope}", {
            role: args.role,
            assignee: args.assignee,
            scope,
          });
        } catch (err) {
          if (!isAzAlreadyExists(err)) throw err;
          // Converge on the existing assignment for this assignee+role+scope.
          const existing = (await az(
            [
              "role",
              "assignment",
              "list",
              "--assignee",
              args.assignee,
              "--scope",
              scope,
              "--role",
              args.role,
            ],
            g.subscriptionId,
          )) as Array<Record<string, unknown>>;
          if (!existing || existing.length === 0) throw err;
          assignment = existing[0];
          context.logger.info(
            "{role} already granted to {assignee} at {scope} — returning existing",
            { role: args.role, assignee: args.assignee, scope },
          );
        }

        const handle = await context.writeResource(
          "assignment",
          sanitizeInstanceName(assignment.name as string),
          assignment,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description:
        "Revoke a role assignment by its fully-qualified id (verify with list first).",
      arguments: z.object({
        id: z
          .string()
          .describe("Fully-qualified role assignment id to delete"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        try {
          await az(
            ["role", "assignment", "delete", "--ids", args.id],
            g.subscriptionId,
          );
          context.logger.info("Deleted role assignment {id}", { id: args.id });
        } catch (err) {
          if (isAzNotFound(err)) {
            context.logger.info("Role assignment {id} already absent", {
              id: args.id,
            });
          } else {
            throw err;
          }
        }
        return { dataHandles: [] };
      },
    },

    listDenyAssignments: {
      description:
        "List RBAC deny assignments — Azure-managed blocks (from managed applications, Blueprints, or deployment stacks) that override any role grant. Read-only.",
      arguments: z.object({
        scope: z
          .string()
          .optional()
          .describe("Explicit ARM scope id to list deny assignments at"),
        filter: z
          .string()
          .optional()
          .describe(
            "OData filter, e.g. atScope() or principalId eq '<object-id>'",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["role", "deny-assignment", "list"];
        if (args.scope) cmdArgs.push("--scope", args.scope);
        if (args.filter) cmdArgs.push("--filter", args.filter);

        const denials = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} deny assignments", {
          count: denials.length,
        });

        const handles = [];
        for (const d of denials) {
          const handle = await context.writeResource(
            "denyAssignment",
            sanitizeInstanceName(d.name as string),
            d,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listDefinitions: {
      description:
        "List role definitions. Optionally restrict to custom roles only.",
      arguments: z.object({
        customOnly: z
          .boolean()
          .optional()
          .describe("Return only custom (non-built-in) role definitions"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["role", "definition", "list"];
        if (args.customOnly) cmdArgs.push("--custom-role-only", "true");

        const definitions = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} role definitions", {
          count: definitions.length,
        });

        const handles = [];
        for (const d of definitions) {
          const handle = await context.writeResource(
            "definition",
            sanitizeInstanceName(d.name as string),
            d,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getDefinition: {
      description: "Get a role definition by its role name (e.g. Contributor).",
      arguments: z.object({
        name: z.string().describe("Role name, e.g. Contributor or Reader"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const definitions = (await az(
          ["role", "definition", "list", "--name", args.name],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        if (!definitions || definitions.length === 0) {
          throw new Error(`Role definition not found: ${args.name}`);
        }

        const def = definitions[0];
        const handle = await context.writeResource(
          "definition",
          sanitizeInstanceName(def.name as string),
          def,
        );
        return { dataHandles: [handle] };
      },
    },
  },

  checks: {
    "subscription-accessible": {
      description:
        "Verify the target subscription is reachable from the active az session before changing role assignments.",
      labels: ["live"],
      appliesTo: ["create", "delete"],
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
