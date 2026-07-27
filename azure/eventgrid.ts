import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const TopicSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    endpoint: z.string().nullish(),
    provisioningState: z.string().optional(),
    publicNetworkAccess: z.string().nullish(),
    tags: z.record(z.string(), z.string()).nullish(),
  })
  .passthrough();

const SystemTopicSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string().optional(),
    resourceGroup: z.string().optional(),
    source: z.string().nullish(),
    topicType: z.string().nullish(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const SubscriptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    topic: z.string().nullish(),
    provisioningState: z.string().optional(),
    destination: z.record(z.string(), z.unknown()).nullish(),
    eventDeliverySchema: z.string().nullish(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-eventgrid` model — read-only inventory of Event
 * Grid topology, wrapping the `az eventgrid` CLI. listTopics
 * enumerates custom topics across a subscription or resource group;
 * getTopic and syncTopic return or refresh a single one.
 * listSystemTopics enumerates system topics (the ones ARM creates for
 * platform events on Storage accounts, Key Vaults, etc.), and
 * listSubscriptions walks the event subscriptions attached to any
 * source resource by its full ARM id. The model is deliberately
 * read-only: no create/delete, and destination auth secrets are never
 * separately fetched (no get-delivery-attributes method by design) —
 * secrets belong in swamp vaults. Note that a subscription's raw
 * endpoint property is whatever ARM returns, and on some setups
 * webhook endpoint URLs embed secrets in query strings; treat synced
 * subscription data accordingly.
 */
export const model = {
  type: "@dougschaefer/azure-eventgrid",
  version: "2026.07.24.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    topic: {
      description: "Event Grid custom topic",
      schema: TopicSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    systemTopic: {
      description: "Event Grid system topic for platform events",
      schema: SystemTopicSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    subscription: {
      description: "Event subscription on a source resource",
      schema: SubscriptionSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listTopics: {
      description:
        "List Event Grid custom topics in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["eventgrid", "topic", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const topics = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Event Grid topics", {
          count: topics.length,
        });

        const handles = [];
        for (const t of topics) {
          const handle = await context.writeResource(
            "topic",
            sanitizeInstanceName(t.name as string),
            t,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getTopic: {
      description: "Get a single Event Grid custom topic.",
      arguments: z.object({
        name: z.string().describe("Topic name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const topic = await az(
          [
            "eventgrid",
            "topic",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "topic",
          sanitizeInstanceName(args.name),
          topic,
        );
        return { dataHandles: [handle] };
      },
    },

    syncTopic: {
      description:
        "Refresh the stored state of an Event Grid custom topic without making changes.",
      arguments: z.object({
        name: z.string().describe("Topic name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const topic = await az(
          [
            "eventgrid",
            "topic",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "topic",
          sanitizeInstanceName(args.name),
          topic,
        );
        context.logger.info("Synced Event Grid topic {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    listSystemTopics: {
      description:
        "List Event Grid system topics in a resource group (or subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["eventgrid", "system-topic", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) cmdArgs.push("--resource-group", rg);

        const systemTopics = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} Event Grid system topics", {
          count: systemTopics.length,
        });

        const handles = [];
        for (const st of systemTopics) {
          const handle = await context.writeResource(
            "systemTopic",
            sanitizeInstanceName(st.name as string),
            st,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listSubscriptions: {
      description:
        "List event subscriptions attached to a source resource by its full ARM id.",
      arguments: z.object({
        sourceResourceId: z
          .string()
          .describe(
            "Full ARM id of the topic/system-topic/resource whose event subscriptions to list, e.g. /subscriptions/.../providers/Microsoft.EventGrid/topics/my-topic",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const subscriptions = (await az(
          [
            "eventgrid",
            "event-subscription",
            "list",
            "--source-resource-id",
            args.sourceResourceId,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} event subscriptions on {source}", {
          count: subscriptions.length,
          source: args.sourceResourceId,
        });

        const handles = [];
        for (const sub of subscriptions) {
          const handle = await context.writeResource(
            "subscription",
            sanitizeInstanceName(sub.name as string),
            sub,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },
  },
};
