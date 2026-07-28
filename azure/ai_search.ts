import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  isAzAlreadyExists,
  isAzNotFound,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const SearchServiceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    sku: z.record(z.string(), z.unknown()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    replicaCount: z.number().optional(),
    partitionCount: z.number().optional(),
    status: z.string().optional(),
    tags: z.record(z.string(), z.string()).nullish(),
  })
  .passthrough();

const SEARCH_API_VERSION = "2023-11-01";

/**
 * `@dougschaefer/azure-ai-search` model — Azure AI Search service
 * lifecycle, wrapping the `az search` CLI plus one ARM REST call for
 * the subscription-wide listing the CLI lacks (`az search service
 * list` requires a resource group). AI Search is the retrieval layer
 * behind Foundry RAG agents, so this is the natural companion to
 * `@dougschaefer/azure-ai-foundry`. list/get/sync read services with
 * SKU, replica/partition topology, and provisioning status; create
 * and delete manage the service itself and are idempotent. Admin and
 * query keys are deliberately never fetched — data-plane credentials
 * belong in swamp vaults, and index/document operations are data
 * plane and out of scope here.
 */
export const model = {
  type: "@dougschaefer/azure-ai-search",
  version: "2026.07.28.4",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    service: {
      description: "Azure AI Search service",
      schema: SearchServiceSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List AI Search services in a resource group, or subscription-wide via ARM when no resource group is given.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = args.resourceGroup || g.resourceGroup;

        let services: Array<Record<string, unknown>>;
        if (rg) {
          services = (await az(
            ["search", "service", "list", "--resource-group", rg],
            g.subscriptionId,
          )) as Array<Record<string, unknown>>;
        } else {
          // The CLI requires --resource-group; ARM does not.
          const url =
            `https://management.azure.com/subscriptions/${g.subscriptionId}` +
            `/providers/Microsoft.Search/searchServices` +
            `?api-version=${SEARCH_API_VERSION}`;
          const response = (await az(
            ["rest", "--method", "get", "--url", url],
          )) as { value: Array<Record<string, unknown>> };
          services = response?.value ?? [];
        }

        context.logger.info("Found {count} AI Search services", {
          count: services.length,
        });

        const handles = [];
        for (const s of services) {
          const handle = await context.writeResource(
            "service",
            sanitizeInstanceName(s.name as string),
            s,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single AI Search service.",
      arguments: z.object({
        name: z.string().describe("Search service name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const service = await az(
          [
            "search",
            "service",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "service",
          sanitizeInstanceName(args.name),
          service,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of an AI Search service without making changes.",
      arguments: z.object({
        name: z.string().describe("Search service name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const service = await az(
          [
            "search",
            "service",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Synced AI Search service {name}", {
          name: args.name,
        });
        const handle = await context.writeResource(
          "service",
          sanitizeInstanceName(args.name),
          service,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description:
        "Create an AI Search service. Idempotent — an existing service of the same name is returned instead. Note the free SKU allows one service per subscription.",
      arguments: z.object({
        name: z.string().describe("Search service name (globally unique)"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        sku: z
          .string()
          .default("basic")
          .describe("SKU: free, basic, standard, standard2, standard3"),
        replicaCount: z
          .number()
          .optional()
          .describe("Replica count (availability/QPS)"),
        partitionCount: z
          .number()
          .optional()
          .describe("Partition count (index size/throughput)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "search",
          "service",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--sku",
          args.sku,
        ];
        if (args.replicaCount !== undefined) {
          cmdArgs.push("--replica-count", args.replicaCount.toString());
        }
        if (args.partitionCount !== undefined) {
          cmdArgs.push("--partition-count", args.partitionCount.toString());
        }

        let service: Record<string, unknown>;
        try {
          service = (await az(cmdArgs, g.subscriptionId)) as Record<
            string,
            unknown
          >;
          context.logger.info("Created AI Search service {name} ({sku})", {
            name: args.name,
            sku: args.sku,
          });
        } catch (err) {
          if (!isAzAlreadyExists(err)) throw err;
          // Converge on the existing service of the same name.
          service = (await az(
            [
              "search",
              "service",
              "show",
              "--name",
              args.name,
              "--resource-group",
              rg,
            ],
            g.subscriptionId,
          )) as Record<string, unknown>;
          context.logger.info(
            "AI Search service {name} already exists — returning existing",
            { name: args.name },
          );
        }

        const handle = await context.writeResource(
          "service",
          sanitizeInstanceName(args.name),
          service,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description:
        "Delete an AI Search service and all its indexes. Idempotent — an already-absent service is not an error. Verify with get first.",
      arguments: z.object({
        name: z.string().describe("Search service name to delete"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        try {
          await az(
            [
              "search",
              "service",
              "delete",
              "--name",
              args.name,
              "--resource-group",
              rg,
              "--yes",
            ],
            g.subscriptionId,
          );
          context.logger.info("Deleted AI Search service {name}", {
            name: args.name,
          });
        } catch (err) {
          if (isAzNotFound(err)) {
            context.logger.info("AI Search service {name} already absent", {
              name: args.name,
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
    "subscription-accessible": {
      description:
        "Verify the target subscription is reachable from the active az session before changing search services.",
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
