import { z } from "npm:zod@4.3.6";
import {
  az,
  EntraGlobalArgsSchema,
  graphRequest,
  isAzAlreadyExists,
  sanitizeInstanceName,
} from "./_helpers.ts";

/**
 * Generate a single-use temporary password that satisfies the Entra default
 * complexity policy (>= 3 of 4 character categories). The value exists only in
 * this process's memory for the duration of one create call — it is never
 * returned, logged, persisted to model data, or written to a vault. The
 * account is created with force-change-on-next-sign-in, so the human replaces
 * it immediately and this value is discarded.
 */
function generateTempPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  // Suffix guarantees upper, lower, digit, and symbol categories.
  return `${body}Aa1!`;
}

const UserSchema = z
  .object({
    id: z.string(),
    displayName: z.string().optional(),
    userPrincipalName: z.string().optional(),
    givenName: z.string().nullish(),
    surname: z.string().nullish(),
    jobTitle: z.string().nullish(),
    department: z.string().nullish(),
    mail: z.string().nullish(),
    mobilePhone: z.string().nullish(),
    officeLocation: z.string().nullish(),
    businessPhones: z.array(z.string()).optional(),
    preferredLanguage: z.string().nullish(),
    accountEnabled: z.boolean().optional(),
    managerId: z.string().nullish(),
    managerDisplayName: z.string().nullish(),
  })
  .passthrough();

const MembershipSchema = z
  .object({
    id: z.string(),
    displayName: z.string().nullish(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-ad-user` model — Entra ID (Azure AD) user
 * directory reads, wrapping the `az ad user` CLI. This model is
 * tenant-scoped, not subscription-scoped: authentication uses the
 * active `az login` session and no `--subscription` flag is emitted.
 * list enumerates users (optionally narrowed by an OData `$filter`),
 * get and sync return or refresh one user by UPN or object id, and
 * getMemberGroups resolves the groups a user belongs to for access
 * audits. listWithManagers is the fan-out read: one paged Graph sweep
 * that returns every user with their manager already resolved, so a
 * reporting hierarchy costs a single execution instead of one manager
 * lookup per person. provision creates a new directory user from non-secret
 * profile fields via Microsoft Graph (POST /v1.0/users): it generates
 * a single-use temporary password in-process, sends it in the request
 * body (never in a process argument), creates the account with
 * force-change-on-next-sign-in, and then discards that password — it
 * is never an input, never returned, never logged, never written to
 * model data, and never vaulted. The method persists nothing; the
 * only record of the
 * operation is the non-secret action in swamp's audit trail and the
 * method's structured log (UPN + object id, no credential). This is
 * the deliberate inverse of credential-bearing service-principal or
 * app provisioning, where the minted secret is long-lived and must
 * be captured into a vault.
 */
export const model = {
  type: "@dougschaefer/azure-ad-user",
  version: "2026.08.04.1",
  globalArguments: EntraGlobalArgsSchema,
  resources: {
    user: {
      description: "Entra ID user",
      schema: UserSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    membership: {
      description: "Group a user is a member of",
      schema: MembershipSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List users in the directory. Optionally narrow with an OData $filter.",
      arguments: z.object({
        filter: z
          .string()
          .optional()
          .describe(
            'OData filter, e.g. "startswith(displayName,\'A\')" or "accountEnabled eq true"',
          ),
      }),
      execute: async (args, context) => {
        const cmdArgs = ["ad", "user", "list"];
        if (args.filter) cmdArgs.push("--filter", args.filter);

        const users = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} users", { count: users.length });

        const handles = [];
        for (const u of users) {
          const handle = await context.writeResource(
            "user",
            sanitizeInstanceName(u.id as string),
            u,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single user by UPN or object id.",
      arguments: z.object({
        id: z.string().describe("User principal name or object id"),
      }),
      execute: async (args, context) => {
        const user = (await az(
          ["ad", "user", "show", "--id", args.id],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "user",
          sanitizeInstanceName(user.id as string),
          user,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description: "Refresh the stored state of a user without making changes.",
      arguments: z.object({
        id: z.string().describe("User principal name or object id"),
      }),
      execute: async (args, context) => {
        const user = (await az(
          ["ad", "user", "show", "--id", args.id],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "user",
          sanitizeInstanceName(user.id as string),
          user,
        );
        context.logger.info("Synced user {id}", { id: args.id });
        return { dataHandles: [handle] };
      },
    },

    listWithManagers: {
      description:
        "Sweep the whole directory and resolve every user's manager in one paged Graph call (GET /users?$expand=manager), writing one user resource per person with managerId and managerDisplayName flattened onto the record. This is the fan-out alternative to calling getManager once per user: it acquires the model lock a single time and emits the entire reporting hierarchy in one execution, which is what a reporting-structure or org-chart view needs.",
      arguments: z.object({
        filter: z
          .string()
          .optional()
          .describe(
            'Server-side OData filter, e.g. "accountEnabled eq true" or "department eq \'Engineering\'"',
          ),
        enabledOnly: z
          .boolean()
          .optional()
          .describe(
            "Keep only enabled accounts, applied after the sweep (default false)",
          ),
        requireJobTitle: z
          .boolean()
          .optional()
          .describe(
            "Keep only accounts that carry a jobTitle, which drops most shared mailboxes and service accounts (default false)",
          ),
      }),
      execute: async (args, context) => {
        const select = [
          "id",
          "displayName",
          "userPrincipalName",
          "givenName",
          "surname",
          "jobTitle",
          "department",
          "mail",
          "officeLocation",
          "accountEnabled",
        ].join(",");

        // Plain $expand=manager needs no advanced-query header; a nested
        // $select inside the expand would require ConsistencyLevel: eventual,
        // which graphRequest does not send. The manager object is trimmed to
        // id and displayName below instead.
        let path: string | null = `/users?$select=${select}&$expand=manager` +
          `&$top=999${
            args.filter ? `&$filter=${encodeURIComponent(args.filter)}` : ""
          }`;

        const raw: Array<Record<string, unknown>> = [];
        let pages = 0;
        while (path) {
          const { status, data } = await graphRequest("GET", path);
          if (status !== 200) {
            const err =
              (data as { error?: { code?: string; message?: string } })
                ?.error;
            const detail = `${err?.code ?? ""} ${err?.message ?? ""}`.trim() ||
              `HTTP ${status}`;
            throw new Error(`Graph user sweep failed: ${detail}`);
          }
          const body = data as {
            value?: Array<Record<string, unknown>>;
            "@odata.nextLink"?: string;
          };
          raw.push(...(body.value ?? []));
          pages++;
          const next = body["@odata.nextLink"];
          // nextLink is absolute; graphRequest re-applies the v1.0 prefix.
          path = next
            ? next.replace("https://graph.microsoft.com/v1.0", "")
            : null;
        }

        const users = raw
          .filter((u) => !args.enabledOnly || u.accountEnabled === true)
          .filter((u) =>
            !args.requireJobTitle ||
            typeof u.jobTitle === "string" && u.jobTitle.trim() !== ""
          )
          .map((u) => {
            const manager = u.manager as
              | { id?: string; displayName?: string }
              | null
              | undefined;
            const { manager: _dropped, ...rest } = u;
            return {
              ...rest,
              managerId: manager?.id ?? null,
              managerDisplayName: manager?.displayName ?? null,
            };
          });

        const rooted = users.filter((u) => u.managerId === null).length;
        context.logger.info(
          "Swept {count} users across {pages} pages; {managed} have a manager, {rooted} have none",
          {
            count: users.length,
            pages,
            managed: users.length - rooted,
            rooted,
          },
        );

        const handles = [];
        for (const u of users) {
          const handle = await context.writeResource(
            "user",
            sanitizeInstanceName(u.id as string),
            u,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getMemberGroups: {
      description: "List the groups a user is a member of (for access review).",
      arguments: z.object({
        id: z.string().describe("User principal name or object id"),
        securityEnabledOnly: z
          .boolean()
          .optional()
          .describe("Return only security-enabled groups (default false)"),
      }),
      execute: async (args, context) => {
        const cmdArgs = ["ad", "user", "get-member-groups", "--id", args.id];
        if (args.securityEnabledOnly) cmdArgs.push("--security-enabled-only");

        const groups = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("User {id} is a member of {count} groups", {
          id: args.id,
          count: groups.length,
        });

        const handles = [];
        for (const grp of groups) {
          const handle = await context.writeResource(
            "membership",
            sanitizeInstanceName(grp.id as string),
            grp,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    provision: {
      description:
        "Create a directory user from non-secret profile fields via Microsoft Graph (POST /v1.0/users). A single-use temp password is generated in-process and placed in the request body (never in process arguments), the account is created with force-change-on-next-sign-in, and the password is then discarded — never an input, returned, logged, persisted, or vaulted. The method persists nothing.",
      arguments: z.object({
        displayName: z.string().describe("User display name"),
        userPrincipalName: z
          .string()
          .describe("UPN / sign-in name (user@verified-domain)"),
        mailNickname: z
          .string()
          .optional()
          .describe("Mail alias; defaults to the UPN local part"),
        jobTitle: z.string().optional().describe("Job title"),
        department: z.string().optional().describe("Department"),
        usageLocation: z
          .string()
          .optional()
          .describe("Two-letter ISO country code (required before licensing)"),
        accountEnabled: z
          .boolean()
          .optional()
          .describe("Whether the account is enabled (default true)"),
      }),
      execute: async (args, context) => {
        // Fall back to the UPN local part when mailNickname is omitted or
        // passed empty (e.g. an unset optional workflow input).
        const mailNickname = args.mailNickname?.trim() ||
          args.userPrincipalName.split("@")[0];
        const tempPassword = generateTempPassword();

        const body: Record<string, unknown> = {
          accountEnabled: args.accountEnabled ?? true,
          displayName: args.displayName,
          userPrincipalName: args.userPrincipalName,
          mailNickname,
          passwordProfile: {
            forceChangePasswordNextSignIn: true,
            password: tempPassword,
          },
        };
        if (args.jobTitle) body.jobTitle = args.jobTitle;
        if (args.department) body.department = args.department;
        if (args.usageLocation) body.usageLocation = args.usageLocation;

        const { status, data } = await graphRequest("POST", "/users", body);

        if (status === 201) {
          const user = data as Record<string, unknown>;
          // Non-secret confirmation only. The temp password never appears in
          // this log, the Graph response, or any persistence.
          context.logger.info(
            "Provisioned user {upn} (objectId {id}) via Graph; temp password set with force-change-on-next-sign-in and discarded",
            { upn: args.userPrincipalName, id: user.id },
          );
        } else {
          const err = (data as { error?: { code?: string; message?: string } })
            ?.error;
          const detail = `${err?.code ?? ""} ${err?.message ?? ""}`.trim() ||
            `HTTP ${status}`;
          // Graph error bodies never echo the request password.
          if (isAzAlreadyExists(detail)) {
            context.logger.info("User {upn} already exists — no change", {
              upn: args.userPrincipalName,
            });
          } else {
            throw new Error(
              `Graph create user failed for ${args.userPrincipalName} (HTTP ${status}): ${detail}`,
            );
          }
        }

        // Persist nothing: no user information is kept inside the model.
        return { dataHandles: [] };
      },
    },
  },

  checks: {
    "directory-access": {
      description:
        "Verify the active az login session can reach the Entra directory before provisioning a user.",
      labels: ["live"],
      appliesTo: ["provision"],
      execute: async (_context) => {
        try {
          await az(["ad", "signed-in-user", "show"], undefined);
          return { pass: true };
        } catch (err) {
          return {
            pass: false,
            errors: [
              `No Entra directory access from the active az session: ${
                String(err)
              }`,
            ],
          };
        }
      },
    },
  },
};
