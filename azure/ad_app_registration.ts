import { z } from "npm:zod@4.3.6";
import { az, EntraGlobalArgsSchema, sanitizeInstanceName } from "./_helpers.ts";

const ApplicationSchema = z
  .object({
    id: z.string(),
    appId: z.string().optional(),
    displayName: z.string().optional(),
    signInAudience: z.string().nullish(),
    createdDateTime: z.string().nullish(),
    identifierUris: z.array(z.string()).optional(),
    publisherDomain: z.string().nullish(),
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

/**
 * `@dougschaefer/azure-ad-app-registration` model — Entra ID
 * application registration reads and credential auditing, wrapping
 * the `az ad app` CLI. This model is tenant-scoped, not
 * subscription-scoped: authentication uses the active `az login`
 * session and no `--subscription` flag is emitted. list enumerates
 * app registrations (optionally narrowed by displayName or an OData
 * `$filter`), get and sync read one app by appId or object id,
 * listCredentials surfaces password and certificate credential
 * metadata — the `endDateTime` field makes this the primary tool for
 * catching expiring app secrets before they break an integration
 * (secret values themselves are never returned by Graph) — and
 * listOwners resolves who controls the registration. App creation,
 * update, and credential rotation are intentionally out of scope:
 * they emit secret material that should not flow through stored
 * model data and are better handled interactively.
 */
export const model = {
  type: "@dougschaefer/azure-ad-app-registration",
  version: "2026.07.24.3",
  globalArguments: EntraGlobalArgsSchema,
  resources: {
    application: {
      description: "Entra ID application registration",
      schema: ApplicationSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    credential: {
      description: "Application password or certificate credential",
      schema: CredentialSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    owner: {
      description: "Owner of an application registration",
      schema: OwnerSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List app registrations. Optionally narrow with displayName or an OData $filter.",
      arguments: z.object({
        displayName: z
          .string()
          .optional()
          .describe("Display name or prefix"),
        filter: z.string().optional().describe("OData filter"),
        all: z
          .boolean()
          .optional()
          .describe("List every app in the tenant (slow on large orgs)"),
      }),
      execute: async (args, context) => {
        const cmdArgs = ["ad", "app", "list"];
        if (args.displayName) {
          cmdArgs.push("--display-name", args.displayName);
        } else if (args.filter) {
          cmdArgs.push("--filter", args.filter);
        } else if (args.all) {
          cmdArgs.push("--all");
        }

        const apps = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} app registrations", {
          count: apps.length,
        });

        const handles = [];
        for (const app of apps) {
          const handle = await context.writeResource(
            "application",
            sanitizeInstanceName(app.id as string),
            app,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single app registration by appId or object id.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
      }),
      execute: async (args, context) => {
        const app = (await az(
          ["ad", "app", "show", "--id", args.id],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "application",
          sanitizeInstanceName(app.id as string),
          app,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of an app registration without making changes.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
      }),
      execute: async (args, context) => {
        const app = (await az(
          ["ad", "app", "show", "--id", args.id],
          undefined,
        )) as Record<string, unknown>;
        const handle = await context.writeResource(
          "application",
          sanitizeInstanceName(app.id as string),
          app,
        );
        context.logger.info("Synced app registration {id}", { id: args.id });
        return { dataHandles: [handle] };
      },
    },

    listCredentials: {
      description:
        "List an app's credential metadata for expiry auditing. Secret values are never returned.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
        cert: z
          .boolean()
          .optional()
          .describe("List certificate credentials instead of passwords"),
      }),
      execute: async (args, context) => {
        const cmdArgs = ["ad", "app", "credential", "list", "--id", args.id];
        if (args.cert) cmdArgs.push("--cert");

        const creds = (await az(cmdArgs, undefined)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("App {id} has {count} credentials", {
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
      description: "List the owners of an app registration.",
      arguments: z.object({
        id: z.string().describe("Application (client) id or object id"),
      }),
      execute: async (args, context) => {
        const owners = (await az(
          ["ad", "app", "owner", "list", "--id", args.id],
          undefined,
        )) as Array<Record<string, unknown>>;

        context.logger.info("App {id} has {count} owners", {
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
  },
};
