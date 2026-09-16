import { z } from "npm:zod@4.3.6";
import { az, sanitizeInstanceName } from "./_helpers.ts";

const DevOpsGlobalArgsSchema = z.object({
  organization: z.string().describe(
    "Azure DevOps organization URL. Use: ${{ vault.get('azure-devops', 'ORG_URL') }}",
  ),
  project: z
    .string()
    .optional()
    .describe("Default project name for operations that require one"),
});

/**
 * Build the common `--org` and `--project` arguments for `az devops`
 * invocations, prepending them to a method-specific base argv.
 */
function devopsArgs(
  baseArgs: string[],
  g: { organization: string; project?: string },
  projectOverride?: string,
): string[] {
  const args = [...baseArgs, "--org", g.organization];
  const proj = projectOverride || g.project;
  if (proj) args.push("--project", proj);
  return args;
}

/**
 * Build `--org` only, for the organization-scoped commands that reject
 * `--project` outright (`az devops project list` errors with "unrecognized
 * arguments" rather than ignoring it). Using {@link devopsArgs} for these
 * breaks any instance that sets a default project.
 */
function orgArgs(
  baseArgs: string[],
  g: { organization: string },
): string[] {
  return [...baseArgs, "--org", g.organization];
}

const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    visibility: z.string(),
    description: z.string().optional(),
  })
  .passthrough();

const RepoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    project: z.record(z.string(), z.unknown()).optional(),
    defaultBranch: z.string().optional(),
    remoteUrl: z.string().optional(),
    size: z.number().optional(),
  })
  .passthrough();

const PipelineSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    folder: z.string().optional(),
    revision: z.number().optional(),
  })
  .passthrough();

const BuildSchema = z
  .object({
    id: z.number(),
    buildNumber: z.string().optional(),
    status: z.string().optional(),
    result: z.string().optional(),
    sourceBranch: z.string().optional(),
    startTime: z.string().optional(),
    finishTime: z.string().optional(),
    requestedBy: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const WorkItemSchema = z
  .object({
    id: z.number(),
    fields: z
      .object({
        "System.WorkItemType": z.string().optional(),
        "System.Title": z.string().optional(),
        "System.State": z.string().optional(),
        "System.AssignedTo": z.unknown().optional(),
        "System.AreaPath": z.string().optional(),
        "System.IterationPath": z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const RollupSchema = z
  .object({
    project: z.string(),
    dryRun: z.boolean(),
    scanned: z.number(),
    changed: z.number(),
    changes: z.array(
      z.object({
        id: z.number(),
        type: z.string(),
        title: z.string(),
        from: z.string(),
        to: z.string(),
        applied: z.boolean(),
        error: z.string().optional(),
      }),
    ),
  })
  .passthrough();

const ProjectMembersSchema = z
  .object({
    project: z.string(),
    group: z.string(),
    capturedAt: z.string(),
    count: z.number(),
    members: z.array(
      z.object({
        displayName: z.string(),
        email: z.string(),
        descriptor: z.string(),
        via: z.string().describe(
          "The group the person was found in — the named group itself or a group nested inside it",
        ),
      }),
    ),
  })
  .passthrough();

const GroupMembershipSchema = z
  .object({
    project: z.string(),
    group: z.string(),
    user: z.string(),
    outcome: z.enum(["added", "already-member"]),
    appliedAt: z.string(),
  })
  .passthrough();

const WorkItemPlanSchema = z
  .object({
    project: z.string(),
    dryRun: z.boolean(),
    scanned: z.number(),
    editableCreators: z.array(z.string()),
    results: z.array(
      z.object({
        op: z.enum(["create", "move", "update"]),
        key: z.string().optional(),
        id: z.number().optional(),
        type: z.string().optional(),
        title: z.string().optional(),
        parent: z.number().optional(),
        outcome: z.enum([
          "created",
          "moved",
          "updated",
          "exists",
          "unchanged",
          "planned",
          "refused",
          "failed",
        ]),
        reason: z.string().optional(),
        refusedLinks: z.array(z.string()).optional(),
        stateFrom: z.string().optional(),
        stateTo: z.string().optional(),
        assignedFrom: z.string().optional().describe(
          "Assignee before the update (display name), absent when unassigned",
        ),
        assignedTo: z.string().optional().describe(
          "Assignee the update sets; empty string means unassigned",
        ),
        commentsAdded: z.number().optional(),
        commentsAlreadyPresent: z.number().optional(),
      }),
    ),
  })
  .passthrough();

const WorkItemSnapshotSchema = z
  .object({
    project: z.string(),
    capturedAt: z.string(),
    count: z.number(),
    items: z.array(
      z.object({
        id: z.number(),
        type: z.string(),
        title: z.string(),
        state: z.string(),
        parent: z.number().optional(),
        createdBy: z.string().optional(),
        createdByEmail: z.string().optional(),
        assignedTo: z.string().optional(),
        assignedToEmail: z.string().optional(),
        tags: z.string().optional(),
      }),
    ),
  })
  .passthrough();

const ServiceConnectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    url: z.string().nullish(),
    isReady: z.boolean().optional(),
    owner: z.string().nullish(),
    createdBy: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const VariableGroupSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    type: z.string().optional(),
    description: z.string().nullish(),
    isShared: z.boolean().optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const PullRequestSchema = z
  .object({
    pullRequestId: z.number(),
    title: z.string().optional(),
    status: z.string().optional(),
    isDraft: z.boolean().optional(),
    sourceRefName: z.string().optional(),
    targetRefName: z.string().optional(),
    creationDate: z.string().optional(),
    createdBy: z.record(z.string(), z.unknown()).optional(),
    repository: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const AgentPoolSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    poolType: z.string().optional(),
    isHosted: z.boolean().optional(),
    size: z.number().optional(),
  })
  .passthrough();

const SecurityGroupSchema = z
  .object({
    displayName: z.string().optional(),
    principalName: z.string().optional(),
    descriptor: z.string().optional(),
    origin: z.string().optional(),
    subjectKind: z.string().optional(),
  })
  .passthrough();

const GroupRuleSchema = z
  .object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    principalName: z.string().optional(),
    origin: z.string().optional(),
    status: z.string().optional(),
    accessLevel: z.string().nullable().optional(),
    projectCount: z.number(),
    projects: z.array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        groupType: z.string().optional(),
      }).passthrough(),
    ),
    capturedAt: z.string(),
  })
  .passthrough();

const GroupRuleCoverageSchema = z
  .object({
    organization: z.string(),
    projectCount: z.number(),
    ruleCount: z.number(),
    expectedGroupType: z.string(),
    rules: z.array(
      z.object({
        groupId: z.string().optional(),
        displayName: z.string().optional(),
        covered: z.number(),
        missingCount: z.number(),
        missing: z.array(z.string()),
      }).passthrough(),
    ),
    // Projects absent from EVERY rule — the ones with no default access at all.
    missingFromAllRules: z.array(z.string()),
    capturedAt: z.string(),
  })
  .passthrough();

const UserEntitlementUpdateSchema = z
  .object({
    organization: z.string(),
    user: z.string(),
    userId: z.string().optional(),
    dryRun: z.boolean(),
    groupType: z.string(),
    mirroredFrom: z.string().nullable().optional(),
    added: z.array(z.string()),
    alreadyPresent: z.array(z.string()),
    isSuccess: z.boolean().optional(),
    status: z.string().optional(),
    errors: z.array(z.unknown()).optional(),
    capturedAt: z.string(),
  })
  .passthrough();

const GroupRuleUpdateSchema = z
  .object({
    organization: z.string(),
    dryRun: z.boolean(),
    groupType: z.string(),
    results: z.array(
      z.object({
        groupId: z.string().optional(),
        displayName: z.string().optional(),
        added: z.array(z.string()),
        alreadyPresent: z.array(z.string()),
        isSuccess: z.boolean().optional(),
        status: z.string().optional(),
        errors: z.array(z.unknown()).optional(),
      }).passthrough(),
    ),
    capturedAt: z.string(),
  })
  .passthrough();

/** Azure DevOps' AAD resource id — the audience every ADO REST call needs. */
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

/**
 * Entitlement PATCH bodies are capped server-side: more than 50 JSON Patch
 * operations in one request fails with "There can not be more than 50
 * operations processed." Mirroring a group rule onto a user routinely exceeds
 * that, so every patch is split into batches of this size.
 */
const MAX_PATCH_OPS = 50;

/** Split an array into consecutive chunks of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Extract the bare organization name from the `organization` global argument,
 * which is a URL such as `https://dev.azure.com/Contoso`. The entitlement APIs
 * live on a different host (`vsaex.dev.azure.com`) and address the org by name,
 * so the URL cannot be reused verbatim.
 */
function orgName(organization: string): string {
  const trimmed = organization.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/**
 * Call an Azure DevOps REST endpoint through `az rest`, which reuses the
 * active `az login` session — no PAT is stored or passed. Used for the
 * Member Entitlement Management APIs (group rules), which the `az devops`
 * CLI does not wrap. The body carries project ids and group types only,
 * never a credential.
 */
async function adoRest(
  method: string,
  uri: string,
  body?: unknown,
  contentType = "application/json",
): Promise<unknown> {
  const args = [
    "rest",
    "--method",
    method,
    "--resource",
    ADO_RESOURCE,
    "--uri",
    uri,
  ];
  if (body !== undefined) {
    args.push("--body", JSON.stringify(body));
    args.push("--headers", `Content-Type=${contentType}`);
  }
  return await az(args, undefined);
}

/**
 * `@dougschaefer/azure-devops` model — Azure DevOps Services
 * automation, wrapping the `az devops` and `az pipelines` /
 * `az repos` / `az boards` CLIs against an organization and project.
 * Project methods (listProjects, getProject) enumerate projects in
 * the organization. Repo methods (listRepos, getRepo, createRepo,
 * deleteRepo) manage Git repositories inside a project. Pipeline
 * methods (listPipelines, getPipeline, runPipeline, listBuilds,
 * getBuild) cover YAML and classic build/release definitions and the
 * builds they produce. Work-item methods (listWorkItems, getWorkItem,
 * createWorkItem, updateWorkItem) drive Boards items via WIQL and
 * direct field updates; applyWorkItemPlan creates and re-parents
 * items in one sweep behind an authorship guard; rollupParentStates sweeps a project and
 * rolls child state up into parents (Azure Boards rules cannot write
 * to a parent work item, so this closes that gap). Service-connection methods
 * (listServiceConnections, getServiceConnection) read the
 * service-endpoint inventory; variable-group methods
 * (listVariableGroups, getVariableGroup) read pipeline variable
 * groups; pull-request methods (listPullRequests, getPullRequest)
 * read PRs across a project or one repository and createPullRequests opens them with completion options set; listAgentPools reads
 * the organization-level agent pools. Access methods cover the way
 * Azure DevOps actually grants default project membership: group
 * rules. listSecurityGroups reads the group inventory at project or
 * organization scope; listGroupRules reads each rule with the
 * projects it entitles; auditGroupRuleCoverage is the fan-out
 * reconciliation read, comparing every project against every rule in
 * one execution to find projects no rule covers; and
 * addProjectsToGroupRules closes those gaps. Group rules enumerate
 * their projects explicitly and have no wildcard, so a project
 * created after a rule was written is silently outside it until
 * something adds it — which is the drift these two methods exist to
 * detect and repair. Used by CI/CD workflows that bootstrap repos,
 * trigger publish pipelines, and create tracking tickets — mutations
 * touch production project state and, for the access methods,
 * production permissions.
 */
export const model = {
  type: "@dougschaefer/azure-devops",
  version: "2026.09.15.1",
  globalArguments: DevOpsGlobalArgsSchema,
  resources: {
    project: {
      description: "Azure DevOps project",
      schema: ProjectSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    repo: {
      description: "Azure DevOps Git repository",
      schema: RepoSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    pipeline: {
      description: "Azure DevOps pipeline",
      schema: PipelineSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    build: {
      description: "Azure DevOps pipeline build/run",
      schema: BuildSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    workItem: {
      description: "Azure DevOps work item",
      schema: WorkItemSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    rollup: {
      description:
        "Result of a parent-state rollup sweep: the computed state changes and whether they were applied",
      schema: RollupSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    workItemSnapshot: {
      description:
        "Every work item in a project (or a WIQL subset) with type, title, state, parent, creator and assignee, captured as ONE dataset so a reader gets the whole board in a single read",
      schema: WorkItemSnapshotSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    projectMembers: {
      description:
        "Everyone who holds a role in a project through one security group, nested groups expanded",
      schema: ProjectMembersSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    groupMembership: {
      description: "One person's membership in one project security group",
      schema: GroupMembershipSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    workItemPlan: {
      description:
        "Result of applying a work-item plan: what was created, moved, found already present, or refused by the authorship guard",
      schema: WorkItemPlanSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    serviceConnection: {
      description: "Azure DevOps service connection (service endpoint)",
      schema: ServiceConnectionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    variableGroup: {
      description: "Azure DevOps pipeline variable group",
      schema: VariableGroupSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    pullRequest: {
      description: "Azure DevOps pull request",
      schema: PullRequestSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    securityGroup: {
      description:
        "Azure DevOps security group (project or organization scope)",
      schema: SecurityGroupSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    groupRule: {
      description:
        "Azure DevOps group rule (group entitlement) and the projects it grants membership in",
      schema: GroupRuleSchema,
      lifetime: "30d",
      garbageCollection: 10,
    },
    groupRuleCoverage: {
      description:
        "Which projects each group rule covers, and which projects no rule covers at all",
      schema: GroupRuleCoverageSchema,
      lifetime: "30d",
      garbageCollection: 10,
    },
    groupRuleUpdate: {
      description:
        "Result of adding projects to group rules: what was added, what was already present",
      schema: GroupRuleUpdateSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    userEntitlementUpdate: {
      description:
        "Result of granting one user project membership directly, outside any group rule",
      schema: UserEntitlementUpdateSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    agentPool: {
      description: "Azure DevOps organization agent pool",
      schema: AgentPoolSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listProjects: {
      description: "List all projects in the organization.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = (await az(
          orgArgs(["devops", "project", "list"], g),
          undefined,
        )) as Record<string, unknown>;

        const projects = (result?.value ?? result) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} projects", {
          count: projects.length,
        });

        const handles = [];
        for (const proj of projects) {
          const handle = await context.writeResource(
            "project",
            sanitizeInstanceName(proj.name as string),
            proj,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getProject: {
      description: "Get a single project by name.",
      arguments: z.object({
        project: z.string().describe("Project name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = await az(
          devopsArgs(
            ["devops", "project", "show", "--project", args.project],
            g,
          ),
          undefined,
        );
        const handle = await context.writeResource(
          "project",
          sanitizeInstanceName(args.project),
          proj,
        );
        return { dataHandles: [handle] };
      },
    },

    listRepos: {
      description: "List Git repositories in a project.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const repos = (await az(
          devopsArgs(["repos", "list"], g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} repos", { count: repos.length });

        const handles = [];
        for (const repo of repos) {
          const handle = await context.writeResource(
            "repo",
            sanitizeInstanceName(repo.name as string),
            repo,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getRepo: {
      description: "Get a single repository by name or ID.",
      arguments: z.object({
        repository: z.string().describe("Repository name or ID"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const repo = await az(
          devopsArgs(
            ["repos", "show", "--repository", args.repository],
            g,
            args.project,
          ),
          undefined,
        );
        const handle = await context.writeResource(
          "repo",
          sanitizeInstanceName(args.repository),
          repo,
        );
        return { dataHandles: [handle] };
      },
    },

    createRepo: {
      description: "Create a new Git repository.",
      arguments: z.object({
        name: z.string().describe("Repository name"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const repo = await az(
          devopsArgs(["repos", "create", "--name", args.name], g, args.project),
          undefined,
        );

        context.logger.info("Created repository {name}", { name: args.name });

        const handle = await context.writeResource(
          "repo",
          sanitizeInstanceName(args.name),
          repo,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteRepo: {
      description: "Delete a Git repository by ID.",
      arguments: z.object({
        id: z.string().describe("Repository ID"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        await az(
          devopsArgs(
            ["repos", "delete", "--id", args.id, "--yes"],
            g,
            args.project,
          ),
          undefined,
        );

        context.logger.info("Deleted repository {id}", { id: args.id });

        return { dataHandles: [] };
      },
    },

    listPipelines: {
      description: "List pipelines in a project.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const pipelines = (await az(
          devopsArgs(["pipelines", "list"], g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} pipelines", {
          count: pipelines.length,
        });

        const handles = [];
        for (const p of pipelines) {
          const handle = await context.writeResource(
            "pipeline",
            sanitizeInstanceName(p.name as string),
            p,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getPipeline: {
      description: "Get a single pipeline by ID.",
      arguments: z.object({
        id: z.number().describe("Pipeline ID"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const pipeline = await az(
          devopsArgs(
            ["pipelines", "show", "--id", String(args.id)],
            g,
            args.project,
          ),
          undefined,
        );
        const handle = await context.writeResource(
          "pipeline",
          sanitizeInstanceName(String(args.id)),
          pipeline,
        );
        return { dataHandles: [handle] };
      },
    },

    runPipeline: {
      description: "Trigger a pipeline run.",
      arguments: z.object({
        id: z.number().describe("Pipeline ID"),
        branch: z.string().optional().describe("Source branch to build"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["pipelines", "run", "--id", String(args.id)];
        if (args.branch) cmdArgs.push("--branch", args.branch);

        const build = await az(
          devopsArgs(cmdArgs, g, args.project),
          undefined,
        );

        context.logger.info("Triggered pipeline {id}", { id: args.id });

        const handle = await context.writeResource(
          "build",
          sanitizeInstanceName(
            String((build as Record<string, unknown>).id ?? args.id),
          ),
          build,
        );
        return { dataHandles: [handle] };
      },
    },

    listBuilds: {
      description: "List recent pipeline builds.",
      arguments: z.object({
        top: z.number().optional().describe(
          "Number of builds to return (default 20)",
        ),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const top = args.top ?? 20;
        const builds = (await az(
          devopsArgs(
            ["pipelines", "build", "list", "--top", String(top)],
            g,
            args.project,
          ),
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} builds", { count: builds.length });

        const handles = [];
        for (const b of builds) {
          const handle = await context.writeResource(
            "build",
            sanitizeInstanceName(String(b.id)),
            b,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getBuild: {
      description: "Get a single build by ID.",
      arguments: z.object({
        id: z.number().describe("Build ID"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const build = await az(
          devopsArgs(
            ["pipelines", "build", "show", "--id", String(args.id)],
            g,
            args.project,
          ),
          undefined,
        );
        const handle = await context.writeResource(
          "build",
          sanitizeInstanceName(String(args.id)),
          build,
        );
        return { dataHandles: [handle] };
      },
    },

    listWorkItems: {
      description:
        "Query work items using WIQL. Defaults to recent items in the project.",
      arguments: z.object({
        wiql: z.string().optional().describe("WIQL query string"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = args.project || g.project;
        const wiql = args.wiql ||
          `SELECT [System.Id],[System.Title],[System.State],[System.WorkItemType] FROM WorkItems WHERE [System.TeamProject] = '${proj}' ORDER BY [System.ChangedDate] DESC`;

        const result = (await az(
          devopsArgs(["boards", "query", "--wiql", wiql], g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Query returned {count} work items", {
          count: result.length,
        });

        const handles = [];
        for (const wi of result) {
          const handle = await context.writeResource(
            "workItem",
            sanitizeInstanceName(String(wi.id)),
            wi,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getWorkItem: {
      description: "Get a single work item by ID.",
      arguments: z.object({
        id: z.number().describe("Work item ID"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const wi = await az(
          orgArgs(["boards", "work-item", "show", "--id", String(args.id)], g),
          undefined,
        );
        const handle = await context.writeResource(
          "workItem",
          sanitizeInstanceName(String(args.id)),
          wi,
        );
        return { dataHandles: [handle] };
      },
    },

    createWorkItem: {
      description: "Create a new work item.",
      arguments: z.object({
        title: z.string().describe("Work item title"),
        type: z.string().describe(
          "Work item type (e.g. Bug, Task, User Story)",
        ),
        assignedTo: z.string().optional().describe("Assigned user"),
        areaPath: z.string().optional().describe("Area path"),
        description: z.string().optional().describe("Work item description"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = [
          "boards",
          "work-item",
          "create",
          "--title",
          args.title,
          "--type",
          args.type,
        ];

        if (args.assignedTo) {
          cmdArgs.push("--assigned-to", args.assignedTo);
        }
        if (args.areaPath) {
          cmdArgs.push("--area", args.areaPath);
        }
        if (args.description) {
          cmdArgs.push("--description", args.description);
        }

        const wi = await az(
          devopsArgs(cmdArgs, g, args.project),
          undefined,
        );

        context.logger.info("Created {type} work item: {title}", {
          type: args.type,
          title: args.title,
        });

        const handle = await context.writeResource(
          "workItem",
          sanitizeInstanceName(String((wi as Record<string, unknown>).id)),
          wi,
        );
        return { dataHandles: [handle] };
      },
    },

    updateWorkItem: {
      description: "Update a work item by ID with field/value pairs.",
      arguments: z.object({
        id: z.number().describe("Work item ID"),
        fields: z
          .record(z.string(), z.string())
          .describe("Field/value pairs to update (e.g. System.State=Closed)"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = [
          "boards",
          "work-item",
          "update",
          "--id",
          String(args.id),
        ];

        for (const [key, value] of Object.entries(args.fields)) {
          cmdArgs.push("--fields", `${key}=${value}`);
        }

        // `az boards work-item update` addresses the item globally by --id and
        // rejects --project outright, so pass only --org (same as the rollup).
        const wi = await az(orgArgs(cmdArgs, g), undefined);

        context.logger.info("Updated work item {id}", { id: args.id });

        const handle = await context.writeResource(
          "workItem",
          sanitizeInstanceName(String(args.id)),
          wi,
        );
        return { dataHandles: [handle] };
      },
    },

    rollupParentStates: {
      description:
        "Roll parent work-item state up from children in one sweep: a parent is Done when every child is Done, and in-progress as soon as any child has started. Azure Boards rules only act on the work item that triggered them and cannot write to a parent, so this fills that gap. Scans the whole project, computes desired states bottom-up (tasks feed issues, issues feed epics), and patches only the parents whose state actually differs. Set dryRun to preview.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "Compute the changes but do not write them (default false)",
          ),
        todoState: z.string().optional().describe(
          "State meaning 'not started' (default 'To Do'; Agile uses 'New')",
        ),
        doingState: z.string().optional().describe(
          "State meaning 'in progress' (default 'Doing'; Agile uses 'Active')",
        ),
        doneState: z.string().optional().describe(
          "State meaning 'complete' (default 'Done'; Agile uses 'Closed')",
        ),
        allowRegression: z
          .boolean()
          .optional()
          .describe(
            "Allow a parent to move backwards (e.g. Done → Doing when a child reopens). Default false: rollup only advances state, so a hand-set parent is never walked back by its children.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = args.project || g.project;
        if (!proj) {
          throw new Error(
            "rollupParentStates requires a project (set globalArgs.project or pass project)",
          );
        }

        const TODO = args.todoState ?? "To Do";
        const DOING = args.doingState ?? "Doing";
        const DONE = args.doneState ?? "Done";
        const dryRun = args.dryRun ?? false;
        const allowRegression = args.allowRegression ?? false;

        // Rank orders the three states so we can compare "how far along" two
        // states are. Anything unrecognized ranks alongside not-started.
        const rank = (s: string): number =>
          s === DONE ? 2 : s === DOING ? 1 : 0;

        const wiql =
          `SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State],[System.Parent] ` +
          `FROM WorkItems WHERE [System.TeamProject] = '${proj}'`;

        const rows = (await az(
          devopsArgs(["boards", "query", "--wiql", wiql], g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        type Node = {
          id: number;
          type: string;
          title: string;
          state: string;
          parent?: number;
        };
        const nodes = new Map<number, Node>();
        for (const r of rows) {
          const f = (r.fields ?? {}) as Record<string, unknown>;
          const id = Number(r.id);
          nodes.set(id, {
            id,
            type: String(f["System.WorkItemType"] ?? ""),
            title: String(f["System.Title"] ?? ""),
            state: String(f["System.State"] ?? ""),
            parent: f["System.Parent"] === undefined ||
                f["System.Parent"] === null
              ? undefined
              : Number(f["System.Parent"]),
          });
        }

        const children = new Map<number, number[]>();
        for (const n of nodes.values()) {
          if (n.parent !== undefined && nodes.has(n.parent)) {
            const list = children.get(n.parent) ?? [];
            list.push(n.id);
            children.set(n.parent, list);
          }
        }

        // Effective state of a node: leaves report their own state; parents
        // report what their children imply. Memoized, with a visiting set so a
        // cycle in the hierarchy can't spin forever.
        const memo = new Map<number, string>();
        const visiting = new Set<number>();
        const effective = (id: number): string => {
          const cached = memo.get(id);
          if (cached !== undefined) return cached;
          const node = nodes.get(id)!;
          if (visiting.has(id)) return node.state;
          visiting.add(id);

          const kids = children.get(id) ?? [];
          let result: string;
          if (kids.length === 0) {
            result = node.state;
          } else {
            const kidStates = kids.map(effective);
            if (kidStates.every((s) => s === DONE)) {
              result = DONE;
            } else if (kidStates.some((s) => rank(s) >= 1)) {
              result = DOING;
            } else {
              result = TODO;
            }
            if (!allowRegression && rank(result) < rank(node.state)) {
              result = node.state;
            }
          }

          visiting.delete(id);
          memo.set(id, result);
          return result;
        };

        const changes: Array<{
          id: number;
          type: string;
          title: string;
          from: string;
          to: string;
          applied: boolean;
          error?: string;
        }> = [];

        for (const node of nodes.values()) {
          if ((children.get(node.id) ?? []).length === 0) continue;
          const desired = effective(node.id);
          if (desired === node.state) continue;

          const change = {
            id: node.id,
            type: node.type,
            title: node.title,
            from: node.state,
            to: desired,
            applied: false,
          } as {
            id: number;
            type: string;
            title: string;
            from: string;
            to: string;
            applied: boolean;
            error?: string;
          };

          if (dryRun) {
            context.logger.info(
              "[dry-run] {type} {id} {from} -> {to}: {title}",
              {
                type: node.type,
                id: node.id,
                from: node.state,
                to: desired,
                title: node.title,
              },
            );
          } else {
            try {
              // `az boards work-item update` identifies the item globally by
              // --id and rejects --project (unlike the query/create paths), so
              // pass only --org here rather than going through devopsArgs.
              await az(
                [
                  "boards",
                  "work-item",
                  "update",
                  "--id",
                  String(node.id),
                  "--fields",
                  `System.State=${desired}`,
                  "--org",
                  g.organization,
                ],
                undefined,
              );
              change.applied = true;
              context.logger.info("{type} {id} {from} -> {to}: {title}", {
                type: node.type,
                id: node.id,
                from: node.state,
                to: desired,
                title: node.title,
              });
            } catch (err) {
              // One work item refusing a state transition (a process rule, a
              // required field) must not abandon the rest of the sweep.
              change.error = err instanceof Error ? err.message : String(err);
              context.logger.warn("Failed to update {id}: {error}", {
                id: node.id,
                error: change.error,
              });
            }
          }
          changes.push(change);
        }

        const applied = changes.filter((c) => c.applied).length;
        context.logger.info(
          "Rollup scanned {scanned} work items, {changed} parents need a state change, {applied} applied{suffix}",
          {
            scanned: nodes.size,
            changed: changes.length,
            applied,
            suffix: dryRun ? " (dry run)" : "",
          },
        );

        const handle = await context.writeResource(
          "rollup",
          sanitizeInstanceName(proj),
          {
            project: proj,
            dryRun,
            scanned: nodes.size,
            changed: changes.length,
            changes,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    listServiceConnections: {
      description: "List service connections (service endpoints) in a project.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const conns = (await az(
          devopsArgs(["devops", "service-endpoint", "list"], g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} service connections", {
          count: conns.length,
        });

        const handles = [];
        for (const c of conns) {
          const handle = await context.writeResource(
            "serviceConnection",
            sanitizeInstanceName(c.name as string),
            c,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getServiceConnection: {
      description: "Get a single service connection by id.",
      arguments: z.object({
        id: z.string().describe("Service endpoint id"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const conn = (await az(
          devopsArgs(
            ["devops", "service-endpoint", "show", "--id", args.id],
            g,
            args.project,
          ),
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "serviceConnection",
          sanitizeInstanceName((conn.name as string) ?? args.id),
          conn,
        );
        return { dataHandles: [handle] };
      },
    },

    listVariableGroups: {
      description: "List pipeline variable groups in a project.",
      arguments: z.object({
        groupName: z
          .string()
          .optional()
          .describe("Filter by name (wildcards allowed, e.g. prod*)"),
        top: z.number().optional().describe("Maximum number to return"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const baseArgs = ["pipelines", "variable-group", "list"];
        if (args.groupName) baseArgs.push("--group-name", args.groupName);
        if (args.top !== undefined) baseArgs.push("--top", String(args.top));

        const groups = (await az(
          devopsArgs(baseArgs, g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} variable groups", {
          count: groups.length,
        });

        const handles = [];
        for (const vg of groups) {
          const handle = await context.writeResource(
            "variableGroup",
            sanitizeInstanceName(String(vg.id)),
            vg,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getVariableGroup: {
      description: "Get a single variable group by id.",
      arguments: z.object({
        id: z.number().describe("Variable group id"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const vg = (await az(
          devopsArgs(
            [
              "pipelines",
              "variable-group",
              "show",
              "--group-id",
              String(
                args.id,
              ),
            ],
            g,
            args.project,
          ),
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "variableGroup",
          sanitizeInstanceName(String(args.id)),
          vg,
        );
        return { dataHandles: [handle] };
      },
    },

    listPullRequests: {
      description:
        "List pull requests across a project or a single repository.",
      arguments: z.object({
        repository: z.string().optional().describe("Repository name or id"),
        status: z
          .enum(["active", "completed", "abandoned", "all"])
          .optional()
          .describe("Filter by pull request status"),
        sourceBranch: z.string().optional().describe("Source branch filter"),
        targetBranch: z.string().optional().describe("Target branch filter"),
        creator: z
          .string()
          .optional()
          .describe("Limit to PRs created by this user"),
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const baseArgs = ["repos", "pr", "list"];
        if (args.repository) baseArgs.push("--repository", args.repository);
        if (args.status) baseArgs.push("--status", args.status);
        if (args.sourceBranch) {
          baseArgs.push("--source-branch", args.sourceBranch);
        }
        if (args.targetBranch) {
          baseArgs.push("--target-branch", args.targetBranch);
        }
        if (args.creator) baseArgs.push("--creator", args.creator);

        const prs = (await az(
          devopsArgs(baseArgs, g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} pull requests", {
          count: prs.length,
        });

        const handles = [];
        for (const pr of prs) {
          const handle = await context.writeResource(
            "pullRequest",
            sanitizeInstanceName(String(pr.pullRequestId)),
            pr,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getPullRequest: {
      description: "Get a single pull request by id.",
      arguments: z.object({
        id: z.number().describe("Pull request id"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const pr = (await az(
          [
            "repos",
            "pr",
            "show",
            "--id",
            String(args.id),
            "--org",
            g
              .organization,
          ],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "pullRequest",
          sanitizeInstanceName(String(args.id)),
          pr,
        );
        return { dataHandles: [handle] };
      },
    },

    createPullRequests: {
      description:
        "Open one or more pull requests in one execution. Each entry names a source and target branch, a title and a description; completion options (merge strategy, delete the source branch on completion) are set at creation so the reviewer's Complete button already carries them. Idempotent: when an active pull request already exists for the same source and target it is returned instead of a duplicate being opened. Goes through the REST API rather than `az repos pr create`, whose repeated --description flags keep only the last value.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
        repository: z.string().describe("Repository name or id"),
        pullRequests: z
          .array(
            z.object({
              sourceBranch: z.string().describe(
                "Source branch, with or without refs/heads/",
              ),
              targetBranch: z.string().optional().describe(
                "Target branch (default main)",
              ),
              title: z.string(),
              description: z.string().optional().describe(
                "Markdown description (Azure DevOps caps it at 4000 characters)",
              ),
              isDraft: z.boolean().optional(),
            }),
          )
          .min(1),
        deleteSourceBranch: z.boolean().optional().describe(
          "Delete the source branch when the pull request completes (default true)",
        ),
        mergeStrategy: z
          .enum(["noFastForward", "squash", "rebase", "rebaseMerge"])
          .optional()
          .describe("Merge strategy applied on completion (default squash)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = args.project || g.project;
        if (!proj) {
          throw new Error(
            "createPullRequests requires a project (set globalArgs.project or pass project)",
          );
        }
        const orgUrl = g.organization.replace(/\/+$/, "");
        const base = `${orgUrl}/${
          encodeURIComponent(proj)
        }/_apis/git/repositories/${
          encodeURIComponent(args.repository)
        }/pullrequests`;
        const ref = (b: string) =>
          b.startsWith("refs/") ? b : `refs/heads/${b}`;
        const completionOptions = {
          deleteSourceBranch: args.deleteSourceBranch ?? true,
          mergeStrategy: args.mergeStrategy ?? "squash",
        };

        const handles = [];
        for (const want of args.pullRequests) {
          const source = ref(want.sourceBranch);
          const target = ref(want.targetBranch ?? "main");
          const existing = (await adoRest(
            "GET",
            `${base}?searchCriteria.status=active&searchCriteria.sourceRefName=${
              encodeURIComponent(source)
            }&searchCriteria.targetRefName=${
              encodeURIComponent(target)
            }&api-version=7.1`,
          )) as { value?: Array<Record<string, unknown>> };
          let pr = existing?.value?.[0];
          if (pr) {
            context.logger.info(
              "Pull request {id} already open for {source} -> {target}",
              { id: pr.pullRequestId, source, target },
            );
          } else {
            const created = (await adoRest("POST", `${base}?api-version=7.1`, {
              sourceRefName: source,
              targetRefName: target,
              title: want.title,
              description: want.description ?? "",
              isDraft: want.isDraft ?? false,
            })) as Record<string, unknown>;
            // Completion options on the create body are not reliably kept, so
            // set them with an explicit update once the pull request exists.
            pr = (await adoRest(
              "PATCH",
              `${base}/${created.pullRequestId}?api-version=7.1`,
              { completionOptions },
            )) as Record<string, unknown>;
            context.logger.info("Opened pull request {id}: {title}", {
              id: pr.pullRequestId,
              title: want.title,
            });
          }
          handles.push(
            await context.writeResource(
              "pullRequest",
              sanitizeInstanceName(String(pr.pullRequestId)),
              pr,
            ),
          );
        }
        return { dataHandles: handles };
      },
    },

    listAgentPools: {
      description:
        "List the organization's agent pools (org-level, not project-scoped).",
      arguments: z.object({
        poolName: z.string().optional().describe(
          "Filter by matching pool name",
        ),
        poolType: z
          .enum(["automation", "deployment"])
          .optional()
          .describe("Filter by pool type"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["pipelines", "pool", "list", "--org", g.organization];
        if (args.poolName) cmdArgs.push("--pool-name", args.poolName);
        if (args.poolType) cmdArgs.push("--pool-type", args.poolType);

        const pools = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} agent pools", {
          count: pools.length,
        });

        const handles = [];
        for (const p of pools) {
          const handle = await context.writeResource(
            "agentPool",
            sanitizeInstanceName(String(p.id)),
            p,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listSecurityGroups: {
      description:
        "List Azure DevOps security groups. Scoped to one project by default, or to the whole organization with scope=organization. Reading group membership is how you verify effective access, which can differ from what the group rules declare when someone adds a group to a project by hand.",
      arguments: z.object({
        project: z
          .string()
          .optional()
          .describe("Project to scope to; omit with scope=organization"),
        scope: z
          .enum(["project", "organization"])
          .optional()
          .describe("Group scope to list (default project)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const baseArgs = ["devops", "security", "group", "list"];
        const cmdArgs = args.scope === "organization"
          ? [...baseArgs, "--org", g.organization, "--scope", "organization"]
          : devopsArgs(baseArgs, g, args.project);

        const result = (await az(cmdArgs, undefined)) as Record<
          string,
          unknown
        >;
        const groups = ((result?.graphGroups ?? result?.value ?? result) ??
          []) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} security groups in scope {scope}", {
          count: groups.length,
          scope: args.scope ?? "project",
        });

        const handles = [];
        for (const grp of groups) {
          const key = (grp.principalName ?? grp.descriptor ??
            grp.displayName) as string;
          const handle = await context.writeResource(
            "securityGroup",
            sanitizeInstanceName(key),
            grp,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listGroupRules: {
      description:
        "List the organization's group rules (group entitlements) and the projects each one grants membership in. A group rule is how Azure DevOps assigns an access level and project membership to everyone in a Microsoft Entra or Azure DevOps group. Requires Project Collection Administrator.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const org = orgName(g.organization);
        const body = (await adoRest(
          "get",
          `https://vsaex.dev.azure.com/${org}/_apis/groupentitlements?api-version=7.1-preview.1`,
        )) as Record<string, unknown>;

        const rules = ((body?.members ?? body?.value ?? []) ?? []) as Array<
          Record<string, unknown>
        >;
        const capturedAt = new Date().toISOString();

        const handles = [];
        for (const r of rules) {
          const grp = (r.group ?? {}) as Record<string, unknown>;
          const pes = (r.projectEntitlements ?? []) as Array<
            Record<string, unknown>
          >;
          const projects = pes.map((pe) => {
            const ref = (pe.projectRef ?? {}) as Record<string, unknown>;
            const pg = (pe.group ?? {}) as Record<string, unknown>;
            return {
              id: ref.id as string | undefined,
              name: ref.name as string | undefined,
              groupType: pg.groupType as string | undefined,
            };
          });

          const handle = await context.writeResource(
            "groupRule",
            sanitizeInstanceName(
              (grp.displayName as string) ?? (r.id as string),
            ),
            {
              id: r.id,
              displayName: grp.displayName,
              principalName: grp.principalName,
              origin: grp.origin,
              status: r.status,
              accessLevel: ((r.licenseRule ?? {}) as Record<string, unknown>)
                .licenseDisplayName ?? null,
              projectCount: projects.length,
              projects,
              capturedAt,
            },
          );
          handles.push(handle);
        }

        context.logger.info("Found {count} group rules", {
          count: rules.length,
        });
        return { dataHandles: handles };
      },
    },

    auditGroupRuleCoverage: {
      description:
        "Compare every project in the organization against every group rule in one sweep and report which projects each rule is missing. Group rules list their projects explicitly and have no wildcard, so any project created after a rule was written falls outside it silently — this is the read that surfaces that drift. Read-only; pair it with addProjectsToGroupRules to close what it finds.",
      arguments: z.object({
        groupNames: z
          .array(z.string())
          .optional()
          .describe(
            "Restrict the audit to these group rule display names (default all rules)",
          ),
        expectedGroupType: z
          .string()
          .optional()
          .describe(
            "Project group callers expect each rule to grant, recorded on the output for reference (default projectContributor)",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const org = orgName(g.organization);
        const expectedGroupType = args.expectedGroupType ??
          "projectContributor";

        const projResult = (await az(
          orgArgs(["devops", "project", "list"], g),
          undefined,
        )) as Record<string, unknown>;
        const projects = ((projResult?.value ?? projResult) ?? []) as Array<
          Record<string, unknown>
        >;
        const allNames = projects.map((p) => p.name as string);

        const body = (await adoRest(
          "get",
          `https://vsaex.dev.azure.com/${org}/_apis/groupentitlements?api-version=7.1-preview.1`,
        )) as Record<string, unknown>;
        let rules = ((body?.members ?? body?.value ?? []) ?? []) as Array<
          Record<string, unknown>
        >;
        if (args.groupNames?.length) {
          const want = new Set(args.groupNames);
          rules = rules.filter((r) =>
            want.has(
              ((r.group ?? {}) as Record<string, unknown>)
                .displayName as string,
            )
          );
        }

        const missingCounts = new Map<string, number>();
        const ruleRows = rules.map((r) => {
          const grp = (r.group ?? {}) as Record<string, unknown>;
          const pes = (r.projectEntitlements ?? []) as Array<
            Record<string, unknown>
          >;
          const covered = new Set(
            pes.map((pe) =>
              ((pe.projectRef ?? {}) as Record<string, unknown>).name as string
            ),
          );
          const missing = allNames.filter((n) => !covered.has(n)).sort();
          for (const m of missing) {
            missingCounts.set(m, (missingCounts.get(m) ?? 0) + 1);
          }
          return {
            groupId: r.id as string | undefined,
            displayName: grp.displayName as string | undefined,
            covered: covered.size,
            missingCount: missing.length,
            missing,
          };
        });

        // A project absent from every rule has no default access at all —
        // that is the population a user would report as "locked out".
        const missingFromAllRules = rules.length > 0
          ? allNames
            .filter((n) => (missingCounts.get(n) ?? 0) === rules.length)
            .sort()
          : [];

        context.logger.info(
          "Audited {projects} projects against {rules} rules; {orphans} project(s) covered by no rule",
          {
            projects: allNames.length,
            rules: rules.length,
            orphans: missingFromAllRules.length,
          },
        );

        const handle = await context.writeResource(
          "groupRuleCoverage",
          sanitizeInstanceName(`coverage-${org}`),
          {
            organization: org,
            projectCount: allNames.length,
            ruleCount: rules.length,
            expectedGroupType,
            rules: ruleRows,
            missingFromAllRules,
            capturedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      },
    },

    addProjectsToGroupRules: {
      description:
        "Add projects to one or more group rules in a single fan-out execution, granting every member of those groups membership in those projects. Strictly additive: a project already entitled is left untouched, so existing per-project group types (including custom ones) are never rewritten. dryRun defaults to true and routes through the API's own testApplyGroupRule mode, which validates without changing anything. Requires Project Collection Administrator; mutates production permissions.",
      arguments: z.object({
        groupNames: z
          .array(z.string())
          .optional()
          .describe(
            "Group rule display names to update (default every rule in the organization)",
          ),
        projects: z
          .array(z.string())
          .optional()
          .describe(
            "Project names to add (default every project the rule is missing)",
          ),
        groupType: z
          .string()
          .optional()
          .describe(
            "Project group to grant: projectReader, projectContributor, projectAdministrator, or projectStakeholder (default projectContributor)",
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "Validate through testApplyGroupRule without persisting (default true)",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const org = orgName(g.organization);
        const groupType = args.groupType ?? "projectContributor";
        const dryRun = args.dryRun ?? true;

        const projResult = (await az(
          orgArgs(["devops", "project", "list"], g),
          undefined,
        )) as Record<string, unknown>;
        const projects = ((projResult?.value ?? projResult) ?? []) as Array<
          Record<string, unknown>
        >;
        const idByName = new Map(
          projects.map((p) => [p.name as string, p.id as string]),
        );

        if (args.projects?.length) {
          const unknown = args.projects.filter((p) => !idByName.has(p));
          if (unknown.length) {
            throw new Error(
              `Unknown project(s): ${unknown.join(", ")}`,
            );
          }
        }

        const body = (await adoRest(
          "get",
          `https://vsaex.dev.azure.com/${org}/_apis/groupentitlements?api-version=7.1-preview.1`,
        )) as Record<string, unknown>;
        let rules = ((body?.members ?? body?.value ?? []) ?? []) as Array<
          Record<string, unknown>
        >;
        if (args.groupNames?.length) {
          const want = new Set(args.groupNames);
          rules = rules.filter((r) =>
            want.has(
              ((r.group ?? {}) as Record<string, unknown>)
                .displayName as string,
            )
          );
          if (rules.length !== args.groupNames.length) {
            const found = new Set(
              rules.map((r) =>
                ((r.group ?? {}) as Record<string, unknown>)
                  .displayName as string
              ),
            );
            throw new Error(
              `Group rule(s) not found: ${
                args.groupNames.filter((n) => !found.has(n)).join(", ")
              }`,
            );
          }
        }

        const ruleOption = dryRun ? "testApplyGroupRule" : "applyGroupRule";
        const results = [];

        for (const r of rules) {
          const grp = (r.group ?? {}) as Record<string, unknown>;
          const displayName = grp.displayName as string | undefined;
          const pes = (r.projectEntitlements ?? []) as Array<
            Record<string, unknown>
          >;
          const covered = new Set(
            pes.map((pe) =>
              ((pe.projectRef ?? {}) as Record<string, unknown>).name as string
            ),
          );

          const candidates = args.projects?.length
            ? args.projects
            : [...idByName.keys()];
          const toAdd = candidates.filter((n) => !covered.has(n)).sort();
          const alreadyPresent = candidates.filter((n) => covered.has(n))
            .sort();

          if (toAdd.length === 0) {
            context.logger.info(
              "Rule {rule}: nothing to add, all {count} requested project(s) already entitled",
              { rule: displayName, count: alreadyPresent.length },
            );
            results.push({
              groupId: r.id as string | undefined,
              displayName,
              added: [],
              alreadyPresent,
              isSuccess: true,
              status: "noop",
            });
            continue;
          }

          // Batched: the entitlement API rejects more than 50 ops per request.
          let resp: Record<string, unknown> = {};
          let errors: unknown[] = [];
          for (const batch of chunk(toAdd, MAX_PATCH_OPS)) {
            const patch = batch.map((name) => ({
              from: "",
              op: "add",
              path: "/projectEntitlements",
              value: {
                projectRef: { id: idByName.get(name) },
                group: { groupType },
              },
            }));

            resp = (await adoRest(
              "patch",
              `https://vsaex.dev.azure.com/${org}/_apis/groupentitlements/${r.id}` +
                `?ruleOption=${ruleOption}&api-version=7.1-preview.1`,
              patch,
              "application/json-patch+json",
            )) as Record<string, unknown>;

            errors = errors.concat(
              ((resp?.results ?? []) as Array<Record<string, unknown>>)
                .flatMap((x) => (x.errors ?? []) as Array<unknown>),
            );
          }

          context.logger.info(
            "Rule {rule}: {action} {count} project(s) as {groupType}{errs}",
            {
              rule: displayName,
              action: dryRun ? "would add" : "added",
              count: toAdd.length,
              groupType,
              errs: errors.length ? ` (${errors.length} error(s))` : "",
            },
          );

          results.push({
            groupId: r.id as string | undefined,
            displayName,
            added: toAdd,
            alreadyPresent,
            isSuccess: resp?.haveResultsSucceeded as boolean | undefined,
            status: resp?.status as string | undefined,
            errors,
          });
        }

        const handle = await context.writeResource(
          "groupRuleUpdate",
          sanitizeInstanceName(
            `rule-update-${org}-${dryRun ? "dryrun" : "applied"}`,
          ),
          {
            organization: org,
            dryRun,
            groupType,
            results,
            capturedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      },
    },

    addProjectsToUserEntitlement: {
      description:
        "Grant one user project membership directly, without routing through a group rule. Use mirrorGroupRule to copy the exact project set a group rule already grants, which is how you give someone a group's access when they cannot be placed in the backing directory group yet. Strictly additive: projects the user already holds are left untouched. Unlike the group-rule methods there is no server-side test mode on this endpoint, so dryRun (default true) reports the plan without calling the API at all. Requires Project Collection Administrator; mutates production permissions.",
      arguments: z.object({
        user: z
          .string()
          .describe("User principal name or entitlement id to grant access to"),
        mirrorGroupRule: z
          .string()
          .optional()
          .describe(
            "Copy the project set from this group rule's display name, e.g. Field Engineering Department",
          ),
        projects: z
          .array(z.string())
          .optional()
          .describe(
            "Explicit project names to grant; ignored when mirrorGroupRule is set",
          ),
        groupType: z
          .string()
          .optional()
          .describe(
            "Project group to grant: projectReader, projectContributor, projectAdministrator, or projectStakeholder (default projectContributor)",
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe("Report the plan without calling the API (default true)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const org = orgName(g.organization);
        const groupType = args.groupType ?? "projectContributor";
        const dryRun = args.dryRun ?? true;
        const base = `https://vsaex.dev.azure.com/${org}/_apis`;

        const found = (await adoRest(
          "get",
          `${base}/userentitlements?$filter=${
            encodeURIComponent(`name eq '${args.user}'`)
          }&api-version=7.1-preview.3`,
        )) as Record<string, unknown>;
        const matches = ((found?.members ?? found?.value ?? []) ?? []) as Array<
          Record<string, unknown>
        >;
        if (matches.length !== 1) {
          throw new Error(
            `Expected exactly one entitlement for "${args.user}", found ${matches.length}. The user must already exist in the organization.`,
          );
        }
        const userId = matches[0].id as string;

        // The $filter LIST endpoint omits projectEntitlements entirely — it
        // always reports an empty array, which would make every project look
        // unheld and re-send the whole set on each run. Only the per-user
        // detail endpoint returns them, so current state must be read there.
        const detail = (await adoRest(
          "get",
          `${base}/userentitlements/${userId}?api-version=7.1-preview.3`,
        )) as Record<string, unknown>;
        const held = new Set(
          ((detail?.projectEntitlements ?? []) as Array<
            Record<string, unknown>
          >).map((pe) =>
            ((pe.projectRef ?? {}) as Record<string, unknown>).name as string
          ),
        );

        const projResult = (await az(
          orgArgs(["devops", "project", "list"], g),
          undefined,
        )) as Record<string, unknown>;
        const idByName = new Map(
          (((projResult?.value ?? projResult) ?? []) as Array<
            Record<string, unknown>
          >).map((p) => [p.name as string, p.id as string]),
        );

        let wanted: string[];
        if (args.mirrorGroupRule) {
          const body = (await adoRest(
            "get",
            `${base}/groupentitlements?api-version=7.1-preview.1`,
          )) as Record<string, unknown>;
          const rules = ((body?.members ?? body?.value ?? []) ?? []) as Array<
            Record<string, unknown>
          >;
          const rule = rules.find((r) =>
            ((r.group ?? {}) as Record<string, unknown>).displayName ===
              args.mirrorGroupRule
          );
          if (!rule) {
            throw new Error(`Group rule not found: ${args.mirrorGroupRule}`);
          }
          wanted = ((rule.projectEntitlements ?? []) as Array<
            Record<string, unknown>
          >).map((pe) =>
            ((pe.projectRef ?? {}) as Record<string, unknown>).name as string
          );
        } else if (args.projects?.length) {
          wanted = args.projects;
        } else {
          throw new Error("Supply either mirrorGroupRule or projects.");
        }

        const unknown = wanted.filter((n) => !idByName.has(n));
        if (unknown.length) {
          throw new Error(`Unknown project(s): ${unknown.join(", ")}`);
        }

        const toAdd = wanted.filter((n) => !held.has(n)).sort();
        const alreadyPresent = wanted.filter((n) => held.has(n)).sort();

        let status: string | undefined;
        let isSuccess: boolean | undefined = true;
        let errors: unknown[] = [];

        if (toAdd.length === 0) {
          status = "noop";
        } else if (dryRun) {
          status = "dryRun";
        } else {
          const batches = chunk(toAdd, MAX_PATCH_OPS);
          for (const [i, batch] of batches.entries()) {
            const patch = batch.map((name) => ({
              from: "",
              op: "add",
              path: "/projectEntitlements",
              value: {
                projectRef: { id: idByName.get(name) },
                group: { groupType },
              },
            }));
            const resp = (await adoRest(
              "patch",
              `${base}/userentitlements/${userId}?api-version=7.1-preview.3`,
              patch,
              "application/json-patch+json",
            )) as Record<string, unknown>;
            const ok = resp?.isSuccess as boolean | undefined ??
              resp?.haveResultsSucceeded as boolean | undefined;
            if (ok === false) isSuccess = false;
            status = (resp?.status as string | undefined) ?? "applied";
            errors = errors.concat(
              ((resp?.results ?? []) as Array<Record<string, unknown>>)
                .flatMap((x) => (x.errors ?? []) as Array<unknown>),
            );
            context.logger.info(
              "Batch {n}/{total}: {count} operation(s), success={ok}",
              { n: i + 1, total: batches.length, count: batch.length, ok },
            );
          }
        }

        context.logger.info(
          "User {user}: {action} {count} project(s) as {groupType}; {held} already held",
          {
            user: args.user,
            action: dryRun ? "would grant" : "granted",
            count: toAdd.length,
            groupType,
            held: alreadyPresent.length,
          },
        );

        const handle = await context.writeResource(
          "userEntitlementUpdate",
          sanitizeInstanceName(
            `user-grant-${args.user}-${dryRun ? "dryrun" : "applied"}`,
          ),
          {
            organization: org,
            user: args.user,
            userId,
            dryRun,
            groupType,
            mirroredFrom: args.mirrorGroupRule ?? null,
            added: toAdd,
            alreadyPresent,
            isSuccess,
            status,
            errors,
            capturedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      },
    },
    snapshotWorkItems: {
      description:
        "Capture every work item in a project — or the subset a WIQL condition selects — as ONE dataset with type, title, state, parent, creator and assignee. listWorkItems writes one dataset per item, which a script or later reader cannot collect reliably; this is the single-read view for anything that needs the whole board at once.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
        name: z.string().optional().describe(
          "Dataset name to write (default: the project name)",
        ),
        where: z.string().optional().describe(
          "Extra WIQL condition ANDed onto the project filter, e.g. [System.State] <> 'Done'",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = args.project || g.project;
        if (!proj) {
          throw new Error(
            "snapshotWorkItems requires a project (set globalArgs.project or pass project)",
          );
        }
        const wiql =
          `SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State],[System.Parent],[System.CreatedBy],[System.AssignedTo],[System.Tags] ` +
          `FROM WorkItems WHERE [System.TeamProject] = '${proj}'` +
          (args.where ? ` AND (${args.where})` : "");
        const rows = (await az(
          devopsArgs(["boards", "query", "--wiql", wiql], g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;
        const who = (v: unknown) => {
          const o = (v ?? {}) as Record<string, unknown>;
          return {
            name: typeof o.displayName === "string" ? o.displayName : undefined,
            email: typeof o.uniqueName === "string" ? o.uniqueName : undefined,
          };
        };
        const items = rows.map((r) => {
          const f = (r.fields ?? {}) as Record<string, unknown>;
          const cb = who(f["System.CreatedBy"]);
          const at = who(f["System.AssignedTo"]);
          return {
            id: Number(r.id),
            type: String(f["System.WorkItemType"] ?? ""),
            title: String(f["System.Title"] ?? ""),
            state: String(f["System.State"] ?? ""),
            parent: f["System.Parent"] == null
              ? undefined
              : Number(f["System.Parent"]),
            createdBy: cb.name,
            createdByEmail: cb.email,
            assignedTo: at.name,
            assignedToEmail: at.email,
            tags: typeof f["System.Tags"] === "string"
              ? String(f["System.Tags"])
              : undefined,
          };
        }).sort((a, b) => a.id - b.id);
        context.logger.info("Captured {count} work items from {project}", {
          count: items.length,
          project: proj,
        });
        const handle = await context.writeResource(
          "workItemSnapshot",
          sanitizeInstanceName(args.name ?? proj),
          {
            project: proj,
            capturedAt: new Date().toISOString(),
            count: items.length,
            items,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    listProjectMembers: {
      description:
        "Resolve a project security group — Contributors by default — to the people in it, as ONE dataset. Azure DevOps grants project roles through groups that nest other groups (a project's team, a Microsoft Entra group), so a plain membership read stops one level down; this walks every nested group and returns the users, each tagged with the group it was found in. This is the roster to check a name against before assigning work: an assignee must hold a role in the project, and the organization directory is far wider than that.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
        group: z.string().optional().describe(
          "Project group to expand, matched on the name after the backslash (default Contributors)",
        ),
        name: z.string().optional().describe(
          "Dataset name to write (default: <project>-<group>)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = args.project || g.project;
        if (!proj) {
          throw new Error(
            "listProjectMembers requires a project (set globalArgs.project or pass project)",
          );
        }
        const groupName = (args.group ?? "Contributors").trim();
        context.logger.info("Expanding {group} in {project}", {
          group: groupName,
          project: proj,
        });
        const listed = (await az(
          devopsArgs(["devops", "security", "group", "list"], g, args.project),
          undefined,
        )) as Record<string, unknown>;
        const groups = (listed?.graphGroups ?? listed?.value ??
          []) as Array<Record<string, unknown>>;
        const root = groups.find((grp) =>
          String(grp.principalName ?? "").split("\\").pop()?.toLowerCase() ===
            groupName.toLowerCase()
        );
        if (!root) {
          throw new Error(
            `no group named '${groupName}' in project ${proj}; groups are ${
              groups.map((grp) => String(grp.principalName ?? "")).join(", ")
            }`,
          );
        }

        const members = new Map<
          string,
          {
            displayName: string;
            email: string;
            descriptor: string;
            via: string;
          }
        >();
        const seenGroups = new Set<string>();
        const queue: Array<{ descriptor: string; label: string }> = [{
          descriptor: String(root.descriptor),
          label: String(root.principalName ?? groupName),
        }];
        while (queue.length) {
          const cur = queue.shift()!;
          if (seenGroups.has(cur.descriptor)) continue;
          seenGroups.add(cur.descriptor);
          const raw = (await az(
            orgArgs(
              [
                "devops",
                "security",
                "group",
                "membership",
                "list",
                "--id",
                cur.descriptor,
              ],
              g,
            ),
            undefined,
          )) as
            | Record<string, Record<string, unknown>>
            | Array<Record<string, unknown>>;
          const subjects = Array.isArray(raw) ? raw : Object.values(raw ?? {});
          for (const sub of subjects) {
            const kind = String(sub.subjectKind ?? "");
            const descriptor = String(sub.descriptor ?? "");
            if (kind === "group") {
              queue.push({
                descriptor,
                label: String(
                  sub.principalName ?? sub.displayName ?? descriptor,
                ),
              });
              continue;
            }
            if (kind !== "user" || members.has(descriptor)) continue;
            const email = String(sub.mailAddress ?? sub.principalName ?? "");
            if (!email) continue;
            members.set(descriptor, {
              displayName: String(sub.displayName ?? email),
              email,
              descriptor,
              via: cur.label,
            });
          }
        }
        const list = [...members.values()].sort((a, b) =>
          a.displayName.localeCompare(b.displayName)
        );
        context.logger.info(
          "{group} in {project}: {count} people across {groups} group(s)",
          {
            group: groupName,
            project: proj,
            count: list.length,
            groups: seenGroups.size,
          },
        );
        const handle = await context.writeResource(
          "projectMembers",
          sanitizeInstanceName(args.name ?? `${proj}-${groupName}`),
          {
            project: proj,
            group: String(root.principalName ?? groupName),
            capturedAt: new Date().toISOString(),
            count: list.length,
            members: list,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    addProjectGroupMember: {
      description:
        "Add a user to a project security group — Contributors by default — by email. This is how someone gains a role in one project without touching the organization-wide group rules: use it when a person already in the organization needs to be assignable work in this project. Idempotent: a user already in the group is reported, not re-added. Direct membership only; it does not look through nested groups, so a person who holds the role through the project team or a Microsoft Entra group is added a second time directly, which Azure DevOps permits and which listProjectMembers still reports once.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
        group: z.string().optional().describe(
          "Project group, matched on the name after the backslash (default Contributors)",
        ),
        user: z.string().describe(
          "Email (user principal name) of the person to add; they must already exist in the organization",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = args.project || g.project;
        if (!proj) {
          throw new Error(
            "addProjectGroupMember requires a project (set globalArgs.project or pass project)",
          );
        }
        const groupName = (args.group ?? "Contributors").trim();
        const user = args.user.trim();
        context.logger.info("Adding {user} to {group} in {project}", {
          user,
          group: groupName,
          project: proj,
        });
        const listed = (await az(
          devopsArgs(["devops", "security", "group", "list"], g, args.project),
          undefined,
        )) as Record<string, unknown>;
        const groups = (listed?.graphGroups ?? listed?.value ??
          []) as Array<Record<string, unknown>>;
        const root = groups.find((grp) =>
          String(grp.principalName ?? "").split("\\").pop()?.toLowerCase() ===
            groupName.toLowerCase()
        );
        if (!root) {
          throw new Error(
            `no group named '${groupName}' in project ${proj}; groups are ${
              groups.map((grp) => String(grp.principalName ?? "")).join(", ")
            }`,
          );
        }
        const descriptor = String(root.descriptor);
        const label = String(root.principalName ?? groupName);

        const raw = (await az(
          orgArgs(
            [
              "devops",
              "security",
              "group",
              "membership",
              "list",
              "--id",
              descriptor,
            ],
            g,
          ),
          undefined,
        )) as
          | Record<string, Record<string, unknown>>
          | Array<Record<string, unknown>>;
        const subjects = Array.isArray(raw) ? raw : Object.values(raw ?? {});
        const already = subjects.some((sub) =>
          sub.subjectKind === "user" &&
          [sub.mailAddress, sub.principalName].some((v) =>
            typeof v === "string" && v.toLowerCase() === user.toLowerCase()
          )
        );

        let outcome: "added" | "already-member" = "already-member";
        if (already) {
          context.logger.info("{user} is already a direct member of {group}", {
            user,
            group: label,
          });
        } else {
          await az(
            orgArgs(
              [
                "devops",
                "security",
                "group",
                "membership",
                "add",
                "--group-id",
                descriptor,
                "--member-id",
                user,
              ],
              g,
            ),
            undefined,
          );
          outcome = "added";
          context.logger.info("Added {user} to {group}", {
            user,
            group: label,
          });
        }
        const handle = await context.writeResource(
          "groupMembership",
          sanitizeInstanceName(`${proj}-${groupName}-${user}`),
          {
            project: proj,
            group: label,
            user,
            outcome,
            appliedAt: new Date().toISOString(),
          },
        );
        return { dataHandles: [handle] };
      },
    },

    applyWorkItemPlan: {
      description:
        "Apply a board plan in one sweep: create work items with a parent, tags and Related links, re-parent existing items, and update existing items with a state change, a new assignee and discussion comments. Items are matched by type and title first, so a re-run never duplicates anything. Children may reference a parent created earlier in the same plan by its key. editableCreators is an authorship guard enforced in code — an existing item created by anyone else is never moved, never linked to and never given a new child; the attempt is refused and reported instead. dryRun defaults to TRUE.",
      arguments: z.object({
        project: z.string().optional().describe(
          "Project name (overrides global)",
        ),
        dryRun: z.boolean().optional().describe(
          "Report what would happen without writing anything (default TRUE)",
        ),
        editableCreators: z.array(z.string()).optional().describe(
          "Display names or emails of the people whose existing work items this plan may touch. Omit to allow edits to any item.",
        ),
        items: z
          .array(
            z.object({
              key: z.string().describe(
                "Plan-local handle other entries use to reference this item",
              ),
              type: z.string().describe("Work item type (Epic, Issue, Task)"),
              title: z.string(),
              parent: z.union([z.number(), z.string()]).optional().describe(
                "Existing work item id, or the key of an item earlier in this plan",
              ),
              tags: z.string().optional().describe(
                "Semicolon-separated tags, e.g. 'azure; cloud'",
              ),
              assignedTo: z.string().optional().describe(
                "Assignee email or display name for the new item",
              ),
              state: z.string().optional().describe(
                "State to move the new item to after creation (e.g. Doing, Done). Azure DevOps creates items in their initial state only, so this is a second write.",
              ),
              description: z.string().optional(),
              related: z.array(z.union([z.number(), z.string()])).optional()
                .describe(
                  "Work item ids or earlier plan keys to link as Related",
                ),
            }),
          )
          .optional(),
        moves: z
          .array(
            z.object({
              id: z.number().describe("Existing work item to re-parent"),
              parent: z.union([z.number(), z.string()]).describe(
                "New parent: existing id or a plan key",
              ),
            }),
          )
          .optional(),
        updates: z
          .array(
            z.object({
              id: z.number().describe("Existing work item to update"),
              state: z.string().optional().describe(
                "Target state. Never moves an item backwards out of Done.",
              ),
              comments: z.array(z.string()).optional().describe(
                "Discussion comments to add. A comment whose text is already on the item is skipped, so re-running a plan never posts it twice.",
              ),
              assignedTo: z.string().optional().describe(
                "Assignee email or display name to set; an empty string clears the assignment. Skipped when the item already has that assignee, so re-running a plan is a no-op.",
              ),
            }),
          )
          .optional(),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const proj = args.project || g.project;
        if (!proj) {
          throw new Error(
            "applyWorkItemPlan requires a project (set globalArgs.project or pass project)",
          );
        }
        const dryRun = args.dryRun ?? true;
        const orgUrl = g.organization.replace(/\/+$/, "");
        const editable = (args.editableCreators ?? []).map((c: string) =>
          c.trim().toLowerCase()
        );
        const guarded = editable.length > 0;

        const wiql =
          `SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State],[System.Parent],[System.CreatedBy],[System.AssignedTo] ` +
          `FROM WorkItems WHERE [System.TeamProject] = '${proj}'`;
        const rows = (await az(
          devopsArgs(["boards", "query", "--wiql", wiql], g, args.project),
          undefined,
        )) as Array<Record<string, unknown>>;

        type Existing = {
          id: number;
          type: string;
          title: string;
          state: string;
          parent?: number;
          creator: string[];
          assignee?: string;
          assigneeEmail?: string;
        };
        const existing = new Map<number, Existing>();
        const byTitle = new Map<string, number>();
        const titleKey = (type: string, title: string) =>
          `${type.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
        for (const r of rows) {
          const f = (r.fields ?? {}) as Record<string, unknown>;
          const cb = (f["System.CreatedBy"] ?? {}) as Record<string, unknown>;
          const at = (f["System.AssignedTo"] ?? {}) as Record<string, unknown>;
          const e: Existing = {
            id: Number(r.id),
            type: String(f["System.WorkItemType"] ?? ""),
            title: String(f["System.Title"] ?? ""),
            state: String(f["System.State"] ?? ""),
            parent: f["System.Parent"] == null
              ? undefined
              : Number(f["System.Parent"]),
            creator: [cb.displayName, cb.uniqueName]
              .filter((v) => typeof v === "string")
              .map((v) => String(v).toLowerCase()),
            assignee: typeof at.displayName === "string"
              ? at.displayName
              : undefined,
            assigneeEmail: typeof at.uniqueName === "string"
              ? at.uniqueName
              : undefined,
          };
          existing.set(e.id, e);
          if (!byTitle.has(titleKey(e.type, e.title))) {
            byTitle.set(titleKey(e.type, e.title), e.id);
          }
        }

        // An existing item is touchable only when the guard is off or its
        // creator is on the list. Items created by this run are always ours.
        const createdHere = new Set<number>();
        const mayTouch = (id: number): string | undefined => {
          if (!guarded || id < 0 || createdHere.has(id)) return undefined;
          const e = existing.get(id);
          if (!e) return `work item ${id} not found in ${proj}`;
          if (e.creator.some((c) => editable.includes(c))) return undefined;
          return `work item ${id} was created by someone outside editableCreators`;
        };

        const keyToId = new Map<string, number>();
        let placeholder = 0;
        const resolve = (ref: number | string): number | undefined =>
          typeof ref === "number" ? ref : keyToId.get(ref);

        const results: Array<
          z.infer<typeof WorkItemPlanSchema>["results"][number]
        > = [];

        for (const item of args.items ?? []) {
          const found = byTitle.get(titleKey(item.type, item.title));
          if (found !== undefined) {
            keyToId.set(item.key, found);
            results.push({
              op: "create",
              key: item.key,
              id: found,
              type: item.type,
              title: item.title,
              parent: existing.get(found)?.parent,
              outcome: "exists",
            });
            continue;
          }

          let parentId: number | undefined;
          if (item.parent !== undefined) {
            parentId = resolve(item.parent);
            if (parentId === undefined) {
              results.push({
                op: "create",
                key: item.key,
                type: item.type,
                title: item.title,
                outcome: "failed",
                reason:
                  `parent '${item.parent}' is not an id or an earlier plan key`,
              });
              continue;
            }
            const blocked = mayTouch(parentId);
            if (blocked) {
              results.push({
                op: "create",
                key: item.key,
                type: item.type,
                title: item.title,
                parent: parentId,
                outcome: "refused",
                reason: `parent: ${blocked}`,
              });
              continue;
            }
          }

          const links: number[] = [];
          const refusedLinks: string[] = [];
          for (const ref of item.related ?? []) {
            const target = resolve(ref);
            const blocked = target === undefined
              ? `'${ref}' is not an id or an earlier plan key`
              : mayTouch(target);
            if (blocked) refusedLinks.push(`${ref}: ${blocked}`);
            else links.push(target!);
          }

          if (dryRun) {
            const id = --placeholder;
            keyToId.set(item.key, id);
            createdHere.add(id);
            context.logger.info(
              "[dry-run] create {type} under {parent}: {title}",
              {
                type: item.type,
                parent: parentId ?? "(top level)",
                title: item.title,
              },
            );
            results.push({
              op: "create",
              key: item.key,
              type: item.type,
              title: item.title,
              parent: parentId,
              outcome: "planned",
              ...(refusedLinks.length ? { refusedLinks } : {}),
            });
            continue;
          }

          const patch: Array<Record<string, unknown>> = [
            { op: "add", path: "/fields/System.Title", value: item.title },
          ];
          if (item.tags) {
            patch.push({
              op: "add",
              path: "/fields/System.Tags",
              value: item.tags,
            });
          }
          if (item.assignedTo) {
            patch.push({
              op: "add",
              path: "/fields/System.AssignedTo",
              value: item.assignedTo,
            });
          }
          if (item.description) {
            patch.push({
              op: "add",
              path: "/fields/System.Description",
              value: item.description,
            });
          }
          if (parentId !== undefined) {
            patch.push({
              op: "add",
              path: "/relations/-",
              value: {
                rel: "System.LinkTypes.Hierarchy-Reverse",
                url: `${orgUrl}/_apis/wit/workItems/${parentId}`,
              },
            });
          }
          for (const t of links) {
            patch.push({
              op: "add",
              path: "/relations/-",
              value: {
                rel: "System.LinkTypes.Related",
                url: `${orgUrl}/_apis/wit/workItems/${t}`,
              },
            });
          }

          try {
            const wi = (await adoRest(
              "POST",
              `${orgUrl}/${encodeURIComponent(proj)}/_apis/wit/workitems/$${
                encodeURIComponent(item.type)
              }?api-version=7.1`,
              patch,
              "application/json-patch+json",
            )) as Record<string, unknown>;
            const id = Number(wi.id);
            keyToId.set(item.key, id);
            createdHere.add(id);
            if (
              item.state && item.state !== String(
                  ((wi.fields ?? {}) as Record<string, unknown>)[
                    "System.State"
                  ] ??
                    "",
                )
            ) {
              await adoRest(
                "PATCH",
                `${orgUrl}/_apis/wit/workitems/${id}?api-version=7.1`,
                [{
                  op: "add",
                  path: "/fields/System.State",
                  value: item.state,
                }],
                "application/json-patch+json",
              );
            }
            byTitle.set(titleKey(item.type, item.title), id);
            context.logger.info("Created {type} {id}: {title}", {
              type: item.type,
              id,
              title: item.title,
            });
            results.push({
              op: "create",
              key: item.key,
              id,
              type: item.type,
              title: item.title,
              parent: parentId,
              outcome: "created",
              ...(refusedLinks.length ? { refusedLinks } : {}),
            });
          } catch (err) {
            results.push({
              op: "create",
              key: item.key,
              type: item.type,
              title: item.title,
              parent: parentId,
              outcome: "failed",
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }

        for (const mv of args.moves ?? []) {
          const e = existing.get(mv.id);
          const target = resolve(mv.parent);
          const base = {
            op: "move" as const,
            id: mv.id,
            title: e?.title,
            type: e?.type,
          };
          if (!e) {
            results.push({
              ...base,
              outcome: "failed",
              reason: `work item ${mv.id} not found in ${proj}`,
            });
            continue;
          }
          if (target === undefined) {
            results.push({
              ...base,
              outcome: "failed",
              reason:
                `parent '${mv.parent}' is not an id or an earlier plan key`,
            });
            continue;
          }
          const blocked = mayTouch(mv.id) ?? mayTouch(target) ??
            (e.parent !== undefined ? mayTouch(e.parent) : undefined);
          if (blocked) {
            results.push({
              ...base,
              parent: target,
              outcome: "refused",
              reason: blocked,
            });
            continue;
          }
          if (e.parent === target) {
            results.push({ ...base, parent: target, outcome: "unchanged" });
            continue;
          }
          if (dryRun || target < 0) {
            context.logger.info(
              "[dry-run] move {id} from {from} to {to}: {title}",
              {
                id: mv.id,
                from: e.parent ?? "(top level)",
                to: target,
                title: e.title,
              },
            );
            results.push({ ...base, parent: target, outcome: "planned" });
            continue;
          }
          try {
            const cur = (await adoRest(
              "GET",
              `${orgUrl}/_apis/wit/workitems/${mv.id}?$expand=relations&api-version=7.1`,
            )) as Record<string, unknown>;
            const rels = (cur.relations ?? []) as Array<
              Record<string, unknown>
            >;
            const patch: Array<Record<string, unknown>> = [
              { op: "test", path: "/rev", value: cur.rev },
            ];
            const idx = rels.findIndex((r) =>
              r.rel === "System.LinkTypes.Hierarchy-Reverse"
            );
            if (idx >= 0) {
              patch.push({ op: "remove", path: `/relations/${idx}` });
            }
            patch.push({
              op: "add",
              path: "/relations/-",
              value: {
                rel: "System.LinkTypes.Hierarchy-Reverse",
                url: `${orgUrl}/_apis/wit/workItems/${target}`,
              },
            });
            await adoRest(
              "PATCH",
              `${orgUrl}/_apis/wit/workitems/${mv.id}?api-version=7.1`,
              patch,
              "application/json-patch+json",
            );
            context.logger.info("Moved {id} from {from} to {to}: {title}", {
              id: mv.id,
              from: e.parent ?? "(top level)",
              to: target,
              title: e.title,
            });
            results.push({ ...base, parent: target, outcome: "moved" });
          } catch (err) {
            results.push({
              ...base,
              parent: target,
              outcome: "failed",
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Plain text of a comment as Azure DevOps stores it (HTML), so an
        // already-posted comment is recognised on a re-run.
        const plain = (t: string) =>
          t.replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/\s+/g, " ")
            .trim();
        const escapeHtml = (t: string) =>
          t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        for (const up of args.updates ?? []) {
          const e = existing.get(up.id);
          const base = {
            op: "update" as const,
            id: up.id,
            title: e?.title,
            type: e?.type,
          };
          if (!e) {
            results.push({
              ...base,
              outcome: "failed",
              reason: `work item ${up.id} not found in ${proj}`,
            });
            continue;
          }
          const blocked = mayTouch(up.id);
          if (blocked) {
            results.push({ ...base, outcome: "refused", reason: blocked });
            continue;
          }

          const wantState = up.state && up.state !== e.state &&
              !(e.state === "Done" && up.state !== "Done")
            ? up.state
            : undefined;
          // An assignee is compared against both the display name and the
          // email on the item, case-insensitively; "" means unassign.
          const askedAssignee = up.assignedTo === undefined
            ? undefined
            : up.assignedTo.trim();
          const hasAssignee = e.assignee !== undefined ||
            e.assigneeEmail !== undefined;
          const sameAssignee = askedAssignee === undefined ||
            (askedAssignee === "" ? !hasAssignee : [e.assignee, e.assigneeEmail]
              .some((v) => v?.toLowerCase() === askedAssignee.toLowerCase()));
          const wantAssignee = sameAssignee ? undefined : askedAssignee;
          const assigneeFrom = e.assignee ?? e.assigneeEmail;
          const wanted = (up.comments ?? []).map((c: string) => c.trim())
            .filter((c: string) => c.length > 0);

          let toPost: string[] = wanted;
          let present = 0;
          if (wanted.length) {
            try {
              const got = (await adoRest(
                "GET",
                `${orgUrl}/${
                  encodeURIComponent(proj)
                }/_apis/wit/workItems/${up.id}/comments?$top=200&api-version=7.1-preview.4`,
              )) as { comments?: Array<{ text?: string }> };
              const have = new Set(
                (got?.comments ?? []).map((c) => plain(String(c.text ?? ""))),
              );
              toPost = wanted.filter((c: string) => !have.has(plain(c)));
              present = wanted.length - toPost.length;
            } catch (err) {
              results.push({
                ...base,
                outcome: "failed",
                reason: `reading existing comments: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              });
              continue;
            }
          }

          if (!wantState && wantAssignee === undefined && toPost.length === 0) {
            results.push({
              ...base,
              outcome: "unchanged",
              stateFrom: e.state,
              assignedFrom: assigneeFrom,
              commentsAlreadyPresent: present,
            });
            continue;
          }

          const assigneeFields = wantAssignee === undefined ? {} : {
            assignedFrom: assigneeFrom,
            assignedTo: wantAssignee,
          };
          if (dryRun) {
            context.logger.info(
              "[dry-run] update {id}: state {from} -> {to}, assignee {afrom} -> {ato}, {n} comment(s): {title}",
              {
                id: up.id,
                from: e.state,
                to: wantState ?? e.state,
                afrom: assigneeFrom ?? "(unassigned)",
                ato: wantAssignee === undefined
                  ? assigneeFrom ?? "(unassigned)"
                  : wantAssignee || "(unassigned)",
                n: toPost.length,
                title: e.title,
              },
            );
            results.push({
              ...base,
              outcome: "planned",
              stateFrom: e.state,
              stateTo: wantState ?? e.state,
              ...assigneeFields,
              commentsAdded: toPost.length,
              commentsAlreadyPresent: present,
            });
            continue;
          }

          try {
            for (const c of toPost) {
              await adoRest(
                "POST",
                `${orgUrl}/${
                  encodeURIComponent(proj)
                }/_apis/wit/workItems/${up.id}/comments?api-version=7.1-preview.4`,
                { text: escapeHtml(c) },
              );
            }
            const fieldPatch: Array<Record<string, unknown>> = [];
            if (wantState) {
              fieldPatch.push({
                op: "add",
                path: "/fields/System.State",
                value: wantState,
              });
            }
            if (wantAssignee !== undefined) {
              fieldPatch.push({
                op: "add",
                path: "/fields/System.AssignedTo",
                value: wantAssignee,
              });
            }
            if (fieldPatch.length) {
              await adoRest(
                "PATCH",
                `${orgUrl}/_apis/wit/workitems/${up.id}?api-version=7.1`,
                fieldPatch,
                "application/json-patch+json",
              );
            }
            context.logger.info(
              "Updated {id}: state {from} -> {to}, assignee {afrom} -> {ato}, {n} comment(s): {title}",
              {
                id: up.id,
                from: e.state,
                to: wantState ?? e.state,
                afrom: assigneeFrom ?? "(unassigned)",
                ato: wantAssignee === undefined
                  ? assigneeFrom ?? "(unassigned)"
                  : wantAssignee || "(unassigned)",
                n: toPost.length,
                title: e.title,
              },
            );
            results.push({
              ...base,
              outcome: "updated",
              stateFrom: e.state,
              stateTo: wantState ?? e.state,
              ...assigneeFields,
              commentsAdded: toPost.length,
              commentsAlreadyPresent: present,
            });
          } catch (err) {
            results.push({
              ...base,
              outcome: "failed",
              stateFrom: e.state,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const tally = (o: string) =>
          results.filter((r) => r.outcome === o).length;
        context.logger.info(
          "Plan against {project}: {created} created, {moved} moved, {updated} updated, {exists} already present, {planned} planned, {refused} refused, {failed} failed{suffix}",
          {
            project: proj,
            created: tally("created"),
            moved: tally("moved"),
            updated: tally("updated"),
            exists: tally("exists"),
            planned: tally("planned"),
            refused: tally("refused"),
            failed: tally("failed"),
            suffix: dryRun ? " (dry run)" : "",
          },
        );

        const handle = await context.writeResource(
          "workItemPlan",
          sanitizeInstanceName(proj),
          {
            project: proj,
            dryRun,
            scanned: existing.size,
            editableCreators: args.editableCreators ?? [],
            results,
          },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
