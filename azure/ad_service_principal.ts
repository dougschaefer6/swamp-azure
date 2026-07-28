import { z } from "npm:zod@4.3.6";
import {
  az,
  EntraGlobalArgsSchema,
  graphRequest,
  sanitizeInstanceName,
} from "./_helpers.ts";

const ServicePrincipalSchema = z
  .object({
    id: z.string(),
    appId: z.string().optional(),
    displayName: z.string().optional(),
    servicePrincipalType: z.string().nullish(),
    accountEnabled: z.boolean().optional(),
    appOwnerOrganizationId: z.string().nullish(),
    appRoleAssignmentRequired: z.boolean().optional(),
    servicePrincipalNames: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const CredentialSchema = z
  .object({
    keyId: z.string().optional(),
    displayName: z.string().nullish(),
    startDateTime: z.string().nullish(),
    endDateTime: z.string().nullish(),
    hint: z.string().nullish(),
    type: z.string().nullish(),
    usage: z.string().nullish(),
  })
  .passthrough();

const OwnerSchema = z
  .object({
    id: z.string(),
    displayName: z.string().nullish(),
    userPrincipalName: z.string().nullish(),
  })
  .passthrough();

const AppRoleAssignmentSchema = z
  .object({
    id: z.string(),
    appRoleId: z.string().nullish(),
    principalId: z.string(),
    principalDisplayName: z.string().nullish(),
    principalType: z.string().nullish(),
    resourceDisplayName: z.string().nullish(),
  })
  .passthrough();

const SynchronizationJobSchema = z
  .object({
    id: z.string(),
    templateId: z.string().nullish(),
    schedule: z.object({ state: z.string().nullish() }).passthrough().nullish(),
    status: z
      .object({
        code: z.string().nullish(),
        lastSuccessfulExecution: z.unknown().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-ad-service-principal` model — Entra ID service
 * principal reads and credential auditing, wrapping the `az ad sp`
 * CLI. This model is tenant-scoped, not subscription-scoped:
 * authentication uses the active `az login` session and no
 * `--subscription` flag is emitted. list enumerates service
 * principals (require one of all/displayName/filter/spn to bound the
 * query — a tenant-wide `--all` can be slow), get and sync read one
 * SP by appId or object id, listCredentials surfaces password and
 * certificate credential metadata (including `endDateTime` for
 * expiry auditing — secret values are never returned by Graph), and
 * listOwners resolves who controls the SP. listAppRoleAssignments and
 * listSynchronizationJobs call Microsoft Graph directly via
 * {@link graphRequest} because the `az ad sp` CLI has no equivalent
 * subcommands: the former resolves which users/groups actually hold
 * access (the source of truth behind a SAML app's role assignments),
 * the latter surfaces SCIM provisioning job status for an enterprise
 * app. Creation is intentionally out of scope because `create-for-rbac`
 * emits secret material that should not flow through stored model data.
 */
export const model = {
  type: "@dougschaefer/azure-ad-service-principal",
  version: "2026.07.28.1",
  globalArguments: EntraGlobalArgsSchema,
  resources: {
    servicePrincipal: {
      description: "Entra ID service principal",
      schema: ServicePrincipalSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    credential: {
      description: "Service principal password or certificate credential",
      schema: CredentialSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    owner: {
      description: "Owner of a service principal",
      schema: OwnerSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    appRoleAssignment: {
      description:
        "Principal (user or group) assigned an app role on a service principal",
      schema: AppRoleAssignmentSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    synchronizationJob: {
      description:
        "SCIM provisioning synchronization job on a service principal",
      schema: SynchronizationJobSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List service principals. Provide one of all/displayName/filter/spn to bound the query.",
      arguments: z.object({
        all: z
          .boolean()
          .optional()
          .describe("List every SP in the tenant (slow on large orgs)"),
        displayName: z
          .string()
          .optional()
          .describe("Display name or prefix"),
        filter: z.string().optional().describe("OData filter"),
        spn: z.string().optional().describe("Service principal name"),
      }),
      execute: async (args, context) => {
        const cmdArgs = ["ad", "sp", "list"];
        if (args.all) {
          cmdArgs.push("--all");
        } else if (args.displayName) {
          cmdArgs.push("--display-name", args.displayName);
        } else if (args.filter) {
          cmdArgs.push("--filter", args.filter);
        } else if (args.spn) {
          cmdArgs.push("--spn", args.spn);
        } else {
          throw new Error(
            "Provide one of all, displayName, filter, or spn to bound the SP query",
          );
        }

        const sps = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} service principals", {
          count: sps.length,
        });

        const handles = [];
        for (const sp of sps) {
          const handle = await context.writeResource(
            "servicePrincipal",
            sanitizeInstanceName(sp.id as string),
            sp,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single service principal by appId or object id.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
      }),
      execute: async (args, context) => {
        const sp = (await az(
          ["ad", "sp", "show", "--id", args.id],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "servicePrincipal",
          sanitizeInstanceName(sp.id as string),
          sp,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a service principal without making changes.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
      }),
      execute: async (args, context) => {
        const sp = (await az(
          ["ad", "sp", "show", "--id", args.id],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "servicePrincipal",
          sanitizeInstanceName(sp.id as string),
          sp,
        );
        context.logger.info("Synced service principal {id}", { id: args.id });
        return { dataHandles: [handle] };
      },
    },

    listCredentials: {
      description:
        "List a service principal's credential metadata for expiry auditing. Secret values are never returned.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
        cert: z
          .boolean()
          .optional()
          .describe("List certificate credentials instead of passwords"),
      }),
      execute: async (args, context) => {
        const cmdArgs = ["ad", "sp", "credential", "list", "--id", args.id];
        if (args.cert) cmdArgs.push("--cert");

        const creds = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("SP {id} has {count} credentials", {
          id: args.id,
          count: creds.length,
        });

        const handles = [];
        for (const cred of creds) {
          const handle = await context.writeResource(
            "credential",
            sanitizeInstanceName(
              (cred.keyId as string) ?? crypto.randomUUID(),
            ),
            cred,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listOwners: {
      description: "List the owners of a service principal.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
      }),
      execute: async (args, context) => {
        const owners = (await az(
          ["ad", "sp", "owner", "list", "--id", args.id],
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("SP {id} has {count} owners", {
          id: args.id,
          count: owners.length,
        });

        const handles = [];
        for (const o of owners) {
          const handle = await context.writeResource(
            "owner",
            sanitizeInstanceName(o.id as string),
            o,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listAppRoleAssignments: {
      description:
        "List principals (users/groups) assigned an app role on this service principal — the source of truth for who actually has access.",
      arguments: z.object({
        id: z.string().describe("Service principal object id"),
      }),
      execute: async (args, context) => {
        const assignments: Array<Record<string, unknown>> = [];
        let path: string | null =
          `/servicePrincipals/${args.id}/appRoleAssignedTo`;

        while (path) {
          const { status, data } = await graphRequest("GET", path);
          if (status !== 200) {
            throw new Error(
              `Graph list appRoleAssignedTo failed for ${args.id} (HTTP ${status})`,
            );
          }

          const page = data as {
            value?: Array<Record<string, unknown>>;
            "@odata.nextLink"?: string;
          };
          assignments.push(...(page?.value ?? []));

          // appRoleAssignedTo pages at 100 via @odata.nextLink; graphRequest
          // prefixes the Graph v1.0 base URL, so strip it back off before
          // following the link — otherwise the base URL doubles up.
          const nextLink = page?.["@odata.nextLink"];
          path = nextLink
            ? nextLink.replace("https://graph.microsoft.com/v1.0", "")
            : null;
        }

        context.logger.info("SP {id} has {count} app role assignments", {
          id: args.id,
          count: assignments.length,
        });

        const handles = [];
        for (const a of assignments) {
          const handle = await context.writeResource(
            "appRoleAssignment",
            sanitizeInstanceName(a.id as string),
            a,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listSynchronizationJobs: {
      description:
        "List SCIM provisioning synchronization jobs configured on this service principal.",
      arguments: z.object({
        id: z.string().describe("Service principal object id"),
      }),
      execute: async (args, context) => {
        const { status, data } = await graphRequest(
          "GET",
          `/servicePrincipals/${args.id}/synchronization/jobs`,
        );
        if (status !== 200 && status !== 404) {
          throw new Error(
            `Graph list synchronization jobs failed for ${args.id} (HTTP ${status})`,
          );
        }

        // A 404 means the SP has no synchronization template provisioned —
        // treat that as zero jobs rather than an error.
        const jobs = status === 404
          ? []
          : ((data as { value?: Array<Record<string, unknown>> })?.value) ??
            [];

        context.logger.info("SP {id} has {count} synchronization jobs", {
          id: args.id,
          count: jobs.length,
        });

        const handles = [];
        for (const j of jobs) {
          const handle = await context.writeResource(
            "synchronizationJob",
            sanitizeInstanceName(j.id as string),
            j,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
