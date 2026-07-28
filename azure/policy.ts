import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  isAzNotFound,
  sanitizeInstanceName,
} from "./_helpers.ts";

const AssignmentSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    displayName: z.string().nullish(),
    scope: z.string().nullish(),
    policyDefinitionId: z.string().nullish(),
    enforcementMode: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

const DefinitionSchema = z
  .object({
    name: z.string(),
    displayName: z.string().nullish(),
    policyType: z.string().nullish(),
    mode: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

const SetDefinitionSchema = z
  .object({
    name: z.string(),
    displayName: z.string().nullish(),
    policyType: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

const ComplianceSummarySchema = z
  .object({
    results: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-policy` model — Azure Policy governance,
 * wrapping the `az policy` CLI. listAssignments and getAssignment
 * read policy and initiative assignments at the subscription or a
 * resource group; createAssignment and deleteAssignment manage the
 * assignment lifecycle. listDefinitions and listSetDefinitions
 * enumerate policy and initiative (policy set) definitions — both
 * accept a `customOnly` filter because the built-in catalog runs to
 * hundreds of entries — and getDefinition reads one by name.
 * summarizeCompliance rolls up the compliance state across an
 * assignment scope via Policy Insights. Assignment mutations change
 * governance enforcement — a new assignment in Deny mode can block
 * resource operations — so verify scope and definition first.
 */
export const model = {
  type: "@dougschaefer/azure-policy",
  version: "2026.07.28.2",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    assignment: {
      description: "Azure Policy assignment",
      schema: AssignmentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    definition: {
      description: "Azure Policy definition",
      schema: DefinitionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    setDefinition: {
      description: "Azure Policy initiative (set definition)",
      schema: SetDefinitionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    complianceSummary: {
      description: "Policy compliance summary for a scope",
      schema: ComplianceSummarySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listAssignments: {
      description:
        "List policy assignments at the subscription or a resource group.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group to scope the listing to"),
        scope: z.string().optional().describe("Explicit ARM scope id"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["policy", "assignment", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);
        if (args.scope) cmdArgs.push("--scope", args.scope);

        const assignments = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} policy assignments", {
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

    getAssignment: {
      description: "Get a single policy assignment by name.",
      arguments: z.object({
        name: z.string().describe("Assignment name"),
        scope: z.string().optional().describe("Explicit ARM scope id"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["policy", "assignment", "show", "--name", args.name];
        if (args.scope) cmdArgs.push("--scope", args.scope);

        const assignment = (await az(cmdArgs, g.subscriptionId)) as Record<
          string,
          unknown
        >;
        const handle = await context.writeResource(
          "assignment",
          sanitizeInstanceName(args.name),
          assignment,
        );
        return { dataHandles: [handle] };
      },
    },

    createAssignment: {
      description:
        "Assign a policy or initiative at a scope (idempotent upsert by name).",
      arguments: z.object({
        name: z.string().describe("Assignment name"),
        policy: z
          .string()
          .optional()
          .describe("Policy definition name or id"),
        policySetDefinition: z
          .string()
          .optional()
          .describe("Initiative (set definition) name or id"),
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group scope; omit to use the subscription"),
        scope: z.string().optional().describe("Explicit ARM scope id"),
        displayName: z.string().optional().describe("Friendly display name"),
        enforcementMode: z
          .enum(["Default", "DoNotEnforce"])
          .optional()
          .describe("Default enforces; DoNotEnforce audits without blocking"),
        params: z
          .string()
          .optional()
          .describe("Policy parameters as a JSON string"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        if (!args.policy && !args.policySetDefinition) {
          throw new Error(
            "Provide either policy or policySetDefinition to assign",
          );
        }
        const cmdArgs = ["policy", "assignment", "create", "--name", args.name];
        if (args.policy) cmdArgs.push("--policy", args.policy);
        if (args.policySetDefinition) {
          cmdArgs.push("--policy-set-definition", args.policySetDefinition);
        }
        if (args.scope) {
          cmdArgs.push("--scope", args.scope);
        } else {
          const rg = args.resourceGroup || g.resourceGroup;
          if (rg) cmdArgs.push("--resource-group", rg);
        }
        if (args.displayName) cmdArgs.push("--display-name", args.displayName);
        if (args.enforcementMode) {
          cmdArgs.push("--enforcement-mode", args.enforcementMode);
        }
        if (args.params) cmdArgs.push("--params", args.params);

        const assignment = (await az(cmdArgs, g.subscriptionId)) as Record<
          string,
          unknown
        >;

        context.logger.info("Created policy assignment {name}", {
          name: args.name,
        });

        const handle = await context.writeResource(
          "assignment",
          sanitizeInstanceName(args.name),
          assignment,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteAssignment: {
      description: "Remove a policy assignment by name.",
      arguments: z.object({
        name: z.string().describe("Assignment name"),
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group scope of the assignment"),
        scope: z.string().optional().describe("Explicit ARM scope id"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["policy", "assignment", "delete", "--name", args.name];
        if (args.scope) {
          cmdArgs.push("--scope", args.scope);
        } else {
          const rg = args.resourceGroup || g.resourceGroup;
          if (rg) cmdArgs.push("--resource-group", rg);
        }
        try {
          await az(cmdArgs, g.subscriptionId);
          context.logger.info("Deleted policy assignment {name}", {
            name: args.name,
          });
        } catch (err) {
          if (isAzNotFound(err)) {
            context.logger.info("Policy assignment {name} already absent", {
              name: args.name,
            });
          } else {
            throw err;
          }
        }
        return { dataHandles: [] };
      },
    },

    listDefinitions: {
      description:
        "List policy definitions. Use customOnly to skip the large built-in catalog.",
      arguments: z.object({
        customOnly: z
          .boolean()
          .optional()
          .describe("Return only Custom policy definitions"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        let definitions = (await az(
          ["policy", "definition", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        if (args.customOnly) {
          definitions = definitions.filter((d) => d.policyType === "Custom");
        }

        context.logger.info("Found {count} policy definitions", {
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
      description: "Get a single policy definition by name.",
      arguments: z.object({
        name: z.string().describe("Policy definition name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const def = (await az(
          ["policy", "definition", "show", "--name", args.name],
          g.subscriptionId,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "definition",
          sanitizeInstanceName(args.name),
          def,
        );
        return { dataHandles: [handle] };
      },
    },

    listSetDefinitions: {
      description:
        "List policy initiatives (set definitions). Use customOnly to skip built-ins.",
      arguments: z.object({
        customOnly: z
          .boolean()
          .optional()
          .describe("Return only Custom initiatives"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        let sets = (await az(
          ["policy", "set-definition", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        if (args.customOnly) {
          sets = sets.filter((s) => s.policyType === "Custom");
        }

        context.logger.info("Found {count} policy initiatives", {
          count: sets.length,
        });

        const handles = [];
        for (const s of sets) {
          const handle = await context.writeResource(
            "setDefinition",
            sanitizeInstanceName(s.name as string),
            s,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    summarizeCompliance: {
      description:
        "Summarize policy compliance state across a scope via Policy Insights.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group to summarize; omit for the subscription"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["policy", "state", "summarize"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const result = (await az(cmdArgs, g.subscriptionId)) as Record<
          string,
          unknown
        >;
        const summary =
          ((result?.value as Array<Record<string, unknown>>)?.[0]) ?? result;

        const handle = await context.writeResource(
          "complianceSummary",
          sanitizeInstanceName(rg ?? "subscription"),
          summary,
        );
        context.logger.info("Summarized compliance for {scope}", {
          scope: rg ?? "subscription",
        });
        return { dataHandles: [handle] };
      },
    },
  },

  checks: {
    "subscription-accessible": {
      description:
        "Verify the target subscription is reachable from the active az session before changing policy assignments.",
      labels: ["live"],
      appliesTo: ["createAssignment", "deleteAssignment"],
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
