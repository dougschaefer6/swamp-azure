import { z } from "npm:zod@4.3.6";
import { az, AzureGlobalArgsSchema, sanitizeInstanceName } from "./_helpers.ts";

const ResourceProviderSchema = z
  .object({
    id: z.string().optional(),
    namespace: z.string(),
    registrationState: z.string().optional(),
    registrationPolicy: z.string().optional(),
    resourceTypes: z.array(z.record(z.string(), z.unknown())).optional()
      .nullable(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-resource-provider` model — Azure resource provider
 * registration state, wrapping `az provider`. A subscription can only create
 * resources in namespaces it has registered, and a namespace never used before
 * is silently unregistered: the first attempt to create the resource fails with
 * MissingSubscriptionRegistration rather than anything that names the real
 * cause. That makes registration a genuine prerequisite step for provisioning
 * workflows, which is why it belongs in the data model instead of being
 * rediscovered by hand each time. list and get read current state; register is
 * idempotent and waits for the namespace to reach Registered, so a workflow can
 * depend on it and know the provider is usable when the step returns.
 * Unregistering is deliberately absent — it fails while any resource of the
 * namespace exists, and offering it would only invite that discovery in
 * production.
 */
export const model = {
  type: "@dougschaefer/azure-resource-provider",
  version: "2026.07.28.5",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    provider: {
      description:
        "An Azure resource provider namespace and its registration state",
      schema: ResourceProviderSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List resource providers in the subscription with their registration state.",
      arguments: z.object({
        registeredOnly: z
          .boolean()
          .optional()
          .describe("Keep only namespaces already registered"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const providers = (await az(
          ["provider", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        const rows = args.registeredOnly
          ? providers.filter(
            (p) => String(p.registrationState || "") === "Registered",
          )
          : providers;

        context.logger.info("Found {count} resource providers", {
          count: rows.length,
        });

        const handles = [];
        for (const p of rows) {
          const handle = await context.writeResource(
            "provider",
            sanitizeInstanceName(p.namespace as string),
            p,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get one resource provider and its registration state.",
      arguments: z.object({
        namespace: z
          .string()
          .describe("Provider namespace, e.g. Microsoft.RecoveryServices"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const provider = (await az(
          ["provider", "show", "--namespace", args.namespace],
          g.subscriptionId,
        )) as Record<string, unknown>;

        const handle = await context.writeResource(
          "provider",
          sanitizeInstanceName(args.namespace),
          provider,
        );
        return { dataHandles: [handle] };
      },
    },

    register: {
      description:
        "Register a resource provider namespace and wait for it to reach Registered. Idempotent — an already-registered namespace returns immediately.",
      arguments: z.object({
        namespace: z
          .string()
          .describe("Provider namespace, e.g. Microsoft.RecoveryServices"),
        timeoutSeconds: z
          .number()
          .int()
          .default(300)
          .describe("How long to wait for registration to complete"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        const show = async () =>
          (await az(
            ["provider", "show", "--namespace", args.namespace],
            g.subscriptionId,
          )) as Record<string, unknown>;

        let provider = await show();
        if (String(provider.registrationState || "") === "Registered") {
          context.logger.info("{ns} is already registered", {
            ns: args.namespace,
          });
        } else {
          // --wait is not used: it polls with no ceiling, so a provider stuck in
          // Registering would hang the workflow instead of failing it.
          await az(
            ["provider", "register", "--namespace", args.namespace],
            g.subscriptionId,
          );
          context.logger.info("Registering {ns} — waiting for completion", {
            ns: args.namespace,
          });

          const deadline = Date.now() + args.timeoutSeconds * 1000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 10000));
            provider = await show();
            const state = String(provider.registrationState || "");
            if (state === "Registered") break;
            context.logger.info("{ns} is {state}", {
              ns: args.namespace,
              state,
            });
          }

          if (String(provider.registrationState || "") !== "Registered") {
            throw new Error(
              `${args.namespace} did not reach Registered within ${args.timeoutSeconds}s (state: ${provider.registrationState})`,
            );
          }
          context.logger.info("{ns} is now registered", { ns: args.namespace });
        }

        const handle = await context.writeResource(
          "provider",
          sanitizeInstanceName(args.namespace),
          provider,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
