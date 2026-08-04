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
 * direct field updates; rollupParentStates sweeps a project and
 * rolls child state up into parents (Azure Boards rules cannot write
 * to a parent work item, so this closes that gap). Service-connection methods
 * (listServiceConnections, getServiceConnection) read the
 * service-endpoint inventory; variable-group methods
 * (listVariableGroups, getVariableGroup) read pipeline variable
 * groups; pull-request methods (listPullRequests, getPullRequest)
 * read PRs across a project or one repository; listAgentPools reads
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
  version: "2026.08.04.2",
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
          devopsArgs(
            ["boards", "work-item", "show", "--id", String(args.id)],
            g,
            args.project,
          ),
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

        const wi = await az(
          devopsArgs(cmdArgs, g, args.project),
          undefined,
        );

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
  },
};
