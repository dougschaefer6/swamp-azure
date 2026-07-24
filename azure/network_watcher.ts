import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const NetworkWatcherSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const FlowLogSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string().optional(),
    targetResourceId: z.string().optional(),
    storageId: z.string().optional(),
    enabled: z.boolean().optional(),
    retentionPolicy: z.record(z.string(), z.unknown()).optional(),
    flowAnalyticsConfiguration: z
      .record(z.string(), z.unknown())
      .optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const ConnectionMonitorSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    location: z.string().optional(),
    monitoringStatus: z.string().optional(),
    source: z.record(z.string(), z.unknown()).optional(),
    destination: z.record(z.string(), z.unknown()).optional(),
    endpoints: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    testConfigurations: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    testGroups: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-network-watcher` model — Network Watcher
 * inspection surface, wrapping the `az network watcher` CLI. list
 * enumerates Network Watcher instances per region. listFlowLogs
 * surfaces NSG flow-log configurations including retention,
 * traffic-analytics, and storage destinations. listConnectionMonitors
 * enumerates ongoing connection-monitor probes with endpoints, test
 * configurations, and test groups. checkConnectivity runs a one-shot
 * source-to-destination reachability probe useful for diagnosing
 * spoke-to-spoke or on-prem-to-Azure traffic against the hub
 * firewall. Useful as the inventory backbone for compliance reports
 * (every region has a Network Watcher, every NSG has a flow log).
 */
export const model = {
  type: "@dougschaefer/azure-network-watcher",
  version: "2026.07.24.2",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    watcher: {
      description: "Azure Network Watcher instance",
      schema: NetworkWatcherSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    flowLog: {
      description: "NSG flow log configuration",
      schema: FlowLogSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    connectionMonitor: {
      description: "Connection monitor test",
      schema: ConnectionMonitorSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description: "List all Network Watcher instances in the subscription.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const watchers = (await az(
          ["network", "watcher", "list"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} Network Watchers", {
          count: watchers.length,
        });

        const handles = [];
        for (const w of watchers) {
          const handle = await context.writeResource(
            "watcher",
            sanitizeInstanceName(w.name as string),
            w,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listFlowLogs: {
      description: "List all NSG flow logs for a Network Watcher.",
      arguments: z.object({
        watcherName: z.string().describe("Network Watcher name"),
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group of the Network Watcher"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(
          args.resourceGroup,
          g.resourceGroup,
        );
        const logs = (await az(
          [
            "network",
            "watcher",
            "flow-log",
            "list",
            "--location",
            rg, // flow-log list uses --location, but we can try watcher name approach
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} flow logs", {
          count: logs.length,
        });

        const handles = [];
        for (const log of logs) {
          const handle = await context.writeResource(
            "flowLog",
            sanitizeInstanceName(log.name as string),
            log,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    listConnectionMonitors: {
      description: "List all connection monitors for a Network Watcher.",
      arguments: z.object({
        watcherName: z.string().describe("Network Watcher name"),
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group of the Network Watcher"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(
          args.resourceGroup,
          g.resourceGroup,
        );
        const monitors = (await az(
          [
            "network",
            "watcher",
            "connection-monitor",
            "list",
            "--watcher-name",
            args.watcherName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} connection monitors", {
          count: monitors.length,
        });

        const handles = [];
        for (const mon of monitors) {
          const handle = await context.writeResource(
            "connectionMonitor",
            sanitizeInstanceName(mon.name as string),
            mon,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    checkConnectivity: {
      description:
        "Test connectivity from a source VM to a destination endpoint.",
      arguments: z.object({
        sourceVmId: z.string().describe("Source VM resource ID"),
        destAddress: z
          .string()
          .describe("Destination IP address or FQDN"),
        destPort: z.number().describe("Destination port"),
        protocol: z
          .enum(["TCP", "HTTP", "HTTPS", "ICMP"])
          .default("TCP")
          .describe("Protocol to test"),
        watcherRg: z
          .string()
          .optional()
          .describe(
            "Network Watcher resource group (usually NetworkWatcherRG)",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = args.watcherRg || "NetworkWatcherRG";

        const result = await az(
          [
            "network",
            "watcher",
            "test-connectivity",
            "--source-resource",
            args.sourceVmId,
            "--dest-address",
            args.destAddress,
            "--dest-port",
            args.destPort.toString(),
            "--protocol",
            args.protocol,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Connectivity test: {source} -> {dest}:{port} ({protocol})",
          {
            source: args.sourceVmId.split("/").pop(),
            dest: args.destAddress,
            port: args.destPort,
            protocol: args.protocol,
          },
        );

        const handle = await context.writeResource(
          "watcher",
          sanitizeInstanceName(
            `connectivity-${args.destAddress}-${args.destPort}`,
          ),
          result as Record<string, unknown>,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
