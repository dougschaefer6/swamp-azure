import { z } from "npm:zod@4.3.6";
import {
  az,
  EntraGlobalArgsSchema,
  isAzAlreadyExists,
  isAzNotFound,
  sanitizeInstanceName,
} from "./_helpers.ts";

const GroupSchema = z
  .object({
    id: z.string(),
    displayName: z.string().optional(),
    description: z.string().nullish(),
    mail: z.string().nullish(),
    mailNickname: z.string().nullish(),
    mailEnabled: z.boolean().optional(),
    securityEnabled: z.boolean().optional(),
    groupTypes: z.array(z.string()).optional(),
    membershipRule: z.string().nullish(),
    onPremisesSyncEnabled: z.boolean().nullish(),
    createdDateTime: z.string().nullish(),
  })
  .passthrough();

const MemberSchema = z
  .object({
    id: z.string(),
    displayName: z.string().nullish(),
    userPrincipalName: z.string().nullish(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-ad-group` model — Entra ID (Azure AD) group
 * lifecycle and membership management, wrapping the `az ad group`
 * CLI. This model is tenant-scoped, not subscription-scoped:
 * authentication uses the active `az login` session and no
 * `--subscription` flag is emitted. list and get/sync read groups
 * (optionally narrowed by an OData `$filter`); listMembers enumerates
 * the principals in a group; addMember and removeMember adjust
 * membership (the common access-automation write); create and delete
 * manage security/M365 groups. Mutations touch live directory state —
 * adding a member can grant access through group-based RBAC or app
 * assignment, so verify the group before writing.
 */
export const model = {
  type: "@dougschaefer/azure-ad-group",
  version: "2026.07.28.2",
  globalArguments: EntraGlobalArgsSchema,
  resources: {
    group: {
      description: "Entra ID group",
      schema: GroupSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    member: {
      description: "Member principal of a group",
      schema: MemberSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List groups in the directory. Optionally narrow with an OData $filter.",
      arguments: z.object({
        filter: z
          .string()
          .optional()
          .describe(
            'OData filter, e.g. "startswith(displayName,\'AV\')" or "securityEnabled eq true"',
          ),
      }),
      execute: async (args, context) => {
        const cmdArgs = ["ad", "group", "list"];
        if (args.filter) cmdArgs.push("--filter", args.filter);

        const groups = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} groups", { count: groups.length });

        const handles = [];
        for (const grp of groups) {
          const handle = await context.writeResource(
            "group",
            sanitizeInstanceName(grp.id as string),
            grp,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single group by object id or display name.",
      arguments: z.object({
        group: z.string().describe("Group object id or display name"),
      }),
      execute: async (args, context) => {
        const grp = (await az(
          ["ad", "group", "show", "--group", args.group],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "group",
          sanitizeInstanceName(grp.id as string),
          grp,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a group without making changes.",
      arguments: z.object({
        group: z.string().describe("Group object id or display name"),
      }),
      execute: async (args, context) => {
        const grp = (await az(
          ["ad", "group", "show", "--group", args.group],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "group",
          sanitizeInstanceName(grp.id as string),
          grp,
        );
        context.logger.info("Synced group {group}", { group: args.group });
        return { dataHandles: [handle] };
      },
    },

    listMembers: {
      description: "List the member principals of a group.",
      arguments: z.object({
        group: z.string().describe("Group object id or display name"),
      }),
      execute: async (args, context) => {
        const members = (await az(
          ["ad", "group", "member", "list", "--group", args.group],
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Group {group} has {count} members", {
          group: args.group,
          count: members.length,
        });

        const handles = [];
        for (const m of members) {
          const handle = await context.writeResource(
            "member",
            sanitizeInstanceName(m.id as string),
            m,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    addMember: {
      description: "Add a principal (user, group, or SP) to a group.",
      arguments: z.object({
        group: z.string().describe("Group object id or display name"),
        memberId: z
          .string()
          .describe("Object id of the user, group, or service principal"),
      }),
      execute: async (args, context) => {
        try {
          await az(
            [
              "ad",
              "group",
              "member",
              "add",
              "--group",
              args.group,
              "--member-id",
              args.memberId,
            ],
            undefined,
          );
          context.logger.info("Added member {memberId} to group {group}", {
            memberId: args.memberId,
            group: args.group,
          });
        } catch (err) {
          if (isAzAlreadyExists(err)) {
            context.logger.info(
              "Member {memberId} already in group {group} — no change",
              { memberId: args.memberId, group: args.group },
            );
          } else {
            throw err;
          }
        }
        return { dataHandles: [] };
      },
    },

    removeMember: {
      description: "Remove a principal from a group.",
      arguments: z.object({
        group: z.string().describe("Group object id or display name"),
        memberId: z.string().describe("Object id of the principal to remove"),
      }),
      execute: async (args, context) => {
        try {
          await az(
            [
              "ad",
              "group",
              "member",
              "remove",
              "--group",
              args.group,
              "--member-id",
              args.memberId,
            ],
            undefined,
          );
          context.logger.info("Removed member {memberId} from group {group}", {
            memberId: args.memberId,
            group: args.group,
          });
        } catch (err) {
          if (isAzNotFound(err)) {
            context.logger.info(
              "Member {memberId} not in group {group} — nothing to remove",
              { memberId: args.memberId, group: args.group },
            );
          } else {
            throw err;
          }
        }
        return { dataHandles: [] };
      },
    },

    create: {
      description: "Create a new Entra ID group.",
      arguments: z.object({
        displayName: z.string().describe("Group display name"),
        mailNickname: z.string().describe("Mail nickname (alias)"),
        description: z.string().optional().describe("Group description"),
      }),
      execute: async (args, context) => {
        const cmdArgs = [
          "ad",
          "group",
          "create",
          "--display-name",
          args.displayName,
          "--mail-nickname",
          args.mailNickname,
        ];
        if (args.description) cmdArgs.push("--description", args.description);

        let grp: Record<string, unknown>;
        try {
          grp = (await az(cmdArgs, undefined)) as Record<string, unknown>;
          context.logger.info("Created group {name}", {
            name: args.displayName,
          });
        } catch (err) {
          if (!isAzAlreadyExists(err)) throw err;
          // Converge on the existing group with the same mailNickname.
          const existing = (await az(
            [
              "ad",
              "group",
              "list",
              "--filter",
              `mailNickname eq '${args.mailNickname}'`,
            ],
            undefined,
          )) as Array<Record<string, unknown>>;
          if (!existing || existing.length === 0) throw err;
          grp = existing[0];
          context.logger.info(
            "Group {name} already exists — returning existing",
            { name: args.displayName },
          );
        }

        const handle = await context.writeResource(
          "group",
          sanitizeInstanceName(grp.id as string),
          grp,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a group by object id or display name.",
      arguments: z.object({
        group: z.string().describe("Group object id or display name"),
      }),
      execute: async (args, context) => {
        try {
          await az(
            ["ad", "group", "delete", "--group", args.group],
            undefined,
          );
          context.logger.info("Deleted group {group}", { group: args.group });
        } catch (err) {
          if (isAzNotFound(err)) {
            context.logger.info("Group {group} already absent", {
              group: args.group,
            });
          } else {
            throw err;
          }
        }
        return { dataHandles: [] };
      },
    },
  },

  checks: {
    "directory-access": {
      description:
        "Verify the active az login session can read the Entra directory before mutating group state.",
      labels: ["live"],
      appliesTo: ["create", "delete", "addMember", "removeMember"],
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
