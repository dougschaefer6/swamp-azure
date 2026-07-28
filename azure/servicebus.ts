import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const NamespaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    status: z.string().optional(),
    serviceBusEndpoint: z.string().optional(),
    sku: z.record(z.string(), z.unknown()).optional(),
    tags: z.record(z.string(), z.string()).nullish(),
  })
  .passthrough();

const QueueSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().optional(),
    messageCount: z.number().nullish(),
    countDetails: z.record(z.string(), z.unknown()).nullish(),
    maxSizeInMegabytes: z.number().nullish(),
  })
  .passthrough();

const TopicSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().optional(),
    subscriptionCount: z.number().nullish(),
    countDetails: z.record(z.string(), z.unknown()).nullish(),
    maxSizeInMegabytes: z.number().nullish(),
  })
  .passthrough();

const SubscriptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().optional(),
    messageCount: z.number().nullish(),
    countDetails: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-servicebus` model — read-only inventory of
 * Service Bus messaging topology, wrapping the `az servicebus` CLI.
 * listNamespaces enumerates namespaces across a subscription or
 * resource group; getNamespace and syncNamespace return or refresh a
 * single one. listQueues, listTopics, and listSubscriptions walk the
 * entities inside a namespace. Queue and topic depth attributes
 * (countDetails, messageCount) surface in the returned entities, so
 * dead-letter and backlog depth can be monitored straight from synced
 * data. The model is deliberately read-only: no create/delete, and no
 * methods that return authorization rules or SAS keys — connection
 * secrets belong in swamp vaults, never in model data.
 */
export const model = {
  type: "@dougschaefer/azure-servicebus",
  version: "2026.07.28.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    namespace: {
      description: "Azure Service Bus namespace",
      schema: NamespaceSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    queue: {
      description: "Queue within a Service Bus namespace",
      schema: QueueSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    topic: {
      description: "Topic within a Service Bus namespace",
      schema: TopicSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    subscription: {
      description: "Subscription on a Service Bus topic",
      schema: SubscriptionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listNamespaces: {
      description:
        "List Service Bus namespaces in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["servicebus", "namespace", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const namespaces = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Service Bus namespaces", {
          count: namespaces.length,
        });

        const handles = [];
        for (const ns of namespaces) {
          const handle = await context.writeResource(
            "namespace",
            sanitizeInstanceName(ns.name as string),
            ns,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getNamespace: {
      description: "Get a single Service Bus namespace.",
      arguments: z.object({
        name: z.string().describe("Namespace name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const ns = await az(
          [
            "servicebus",
            "namespace",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "namespace",
          sanitizeInstanceName(args.name),
          ns,
        );
        return { dataHandles: [handle] };
      },
    },

    syncNamespace: {
      description:
        "Refresh the stored state of a Service Bus namespace without making changes.",
      arguments: z.object({
        name: z.string().describe("Namespace name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const ns = await az(
          [
            "servicebus",
            "namespace",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "namespace",
          sanitizeInstanceName(args.name),
          ns,
        );
        context.logger.info("Synced Service Bus namespace {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    listQueues: {
      description:
        "List queues in a Service Bus namespace, including depth attributes (messageCount, countDetails).",
      arguments: z.object({
        namespaceName: z.string().describe("Service Bus namespace name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const queues = (await az(
          [
            "servicebus",
            "queue",
            "list",
            "--namespace-name",
            args.namespaceName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} queues in {namespace}", {
          count: queues.length,
          namespace: args.namespaceName,
        });

        const handles = [];
        for (const q of queues) {
          const handle = await context.writeResource(
            "queue",
            sanitizeInstanceName(`${args.namespaceName}-${q.name as string}`),
            q,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listTopics: {
      description:
        "List topics in a Service Bus namespace, including depth attributes (countDetails, subscriptionCount).",
      arguments: z.object({
        namespaceName: z.string().describe("Service Bus namespace name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const topics = (await az(
          [
            "servicebus",
            "topic",
            "list",
            "--namespace-name",
            args.namespaceName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} topics in {namespace}", {
          count: topics.length,
          namespace: args.namespaceName,
        });

        const handles = [];
        for (const t of topics) {
          const handle = await context.writeResource(
            "topic",
            sanitizeInstanceName(`${args.namespaceName}-${t.name as string}`),
            t,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listSubscriptions: {
      description:
        "List subscriptions on a Service Bus topic, including depth attributes (messageCount, countDetails).",
      arguments: z.object({
        namespaceName: z.string().describe("Service Bus namespace name"),
        topicName: z.string().describe("Topic name within the namespace"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const subscriptions = (await az(
          [
            "servicebus",
            "topic",
            "subscription",
            "list",
            "--namespace-name",
            args.namespaceName,
            "--topic-name",
            args.topicName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info(
          "Found {count} subscriptions on {namespace}/{topic}",
          {
            count: subscriptions.length,
            namespace: args.namespaceName,
            topic: args.topicName,
          },
        );

        const handles = [];
        for (const sub of subscriptions) {
          const handle = await context.writeResource(
            "subscription",
            sanitizeInstanceName(
              `${args.namespaceName}-${args.topicName}-${sub.name as string}`,
            ),
            sub,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
