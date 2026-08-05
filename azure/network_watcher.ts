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
 * firewall. setFlowLog creates or converges a flow log on a virtual
 * network, subnet, or NIC — optionally with Traffic Analytics —
 * deriving the right CLI flag from the target resource ID; target a
 * VNet rather than an NSG, since Azure blocked new NSG flow logs on
 * 2025-06-30 ahead of their 2027-09-30 retirement. Flow logs are the
 * only record of which 5-tuples actually crossed the network, which
 * rules alone can never tell you. Useful as the inventory backbone
 * for compliance reports (every region has a Network Watcher, every
 * VNet has a flow log).
 */
export const model = {
  type: "@dougschaefer/azure-network-watcher",
  version: "2026.08.05.1",
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

    setFlowLog: {
      description:
        "Create or converge a flow log, optionally with Traffic Analytics. Flow logs are the only record of which 5-tuples actually crossed the network — rules state what is permitted, never what is used, so they cannot tell you whether a rule is load-bearing or dead. Indispensable before inserting a firewall into an existing path, where you need observed flows rather than assumed ones. Target a virtual network: Azure blocked creation of new *NSG* flow logs on 2025-06-30 ahead of their 2027-09-30 retirement, and VNet flow logs supersede them with broader coverage. The flow log, its storage account, and any Traffic Analytics workspace must all be in the same region as the target.",
      arguments: z.object({
        name: z.string().describe("Flow log resource name"),
        targetResourceId: z
          .string()
          .describe(
            "Full resource ID of the target — a virtual network (preferred), subnet, or NIC. Network security groups are rejected by Azure for new flow logs.",
          ),
        storageAccountId: z
          .string()
          .describe("Full resource ID of the storage account for raw logs"),
        location: z
          .string()
          .default("centralus")
          .describe("Region of the NSG and its Network Watcher"),
        retentionDays: z
          .number()
          .int()
          .min(0)
          .default(30)
          .describe("Days to retain raw flow logs. 0 retains indefinitely."),
        workspaceId: z
          .string()
          .optional()
          .describe(
            "Log Analytics workspace resource ID to enable Traffic Analytics. Omit for raw storage only.",
          ),
        // Deliberately a plain int rather than a literal union: CLI --input
        // arrives as a string, which z.number() coerces but z.literal() does
        // not, so a union of literals rejects every command-line invocation.
        trafficAnalyticsIntervalMinutes: z
          .number()
          .int()
          .default(60)
          .describe(
            "Traffic Analytics processing interval in minutes — 10 or 60. 10 costs materially more.",
          ),
        enabled: z.boolean().default(true).describe("Enable the flow log"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        if (
          args.workspaceId &&
          args.trafficAnalyticsIntervalMinutes !== 10 &&
          args.trafficAnalyticsIntervalMinutes !== 60
        ) {
          throw new Error(
            `trafficAnalyticsIntervalMinutes must be 10 or 60, got ${args.trafficAnalyticsIntervalMinutes}`,
          );
        }

        // The CLI takes a different flag per target kind, so derive it from
        // the resource ID rather than making the caller restate it.
        const id = args.targetResourceId.toLowerCase();
        const targetFlag = id.includes("/subnets/")
          ? "--subnet"
          : id.includes("/networkinterfaces/")
          ? "--nic"
          : id.includes("/virtualnetworks/")
          ? "--vnet"
          : id.includes("/networksecuritygroups/")
          ? "--nsg"
          : null;
        if (!targetFlag) {
          throw new Error(
            `Cannot determine flow-log target kind from resource ID: ${args.targetResourceId}`,
          );
        }
        if (targetFlag === "--nsg") {
          context.logger.warn(
            "Targeting an NSG — Azure blocks creation of new NSG flow logs since 2025-06-30 (retiring 2027-09-30). Target the virtual network instead.",
          );
        }

        const cmd = [
          "network",
          "watcher",
          "flow-log",
          "create",
          "--name",
          args.name,
          "--location",
          args.location,
          targetFlag,
          args.targetResourceId,
          "--storage-account",
          args.storageAccountId,
          "--retention",
          String(args.retentionDays),
          "--enabled",
          args.enabled ? "true" : "false",
        ];
        if (args.workspaceId) {
          cmd.push(
            "--workspace",
            args.workspaceId,
            "--traffic-analytics",
            "true",
            "--interval",
            String(args.trafficAnalyticsIntervalMinutes),
          );
        }

        const flowLog = (await az(cmd, g.subscriptionId)) as Record<
          string,
          unknown
        >;

        context.logger.info(
          "Flow log {name} on {target}: enabled={enabled} retention={days}d trafficAnalytics={ta}",
          {
            name: args.name,
            target: args.targetResourceId.split("/").pop(),
            enabled: args.enabled,
            days: args.retentionDays,
            ta: args.workspaceId
              ? `${
                args.workspaceId.split("/").pop()
              } @${args.trafficAnalyticsIntervalMinutes}m`
              : "off",
          },
        );

        const handle = await context.writeResource(
          "flowLog",
          sanitizeInstanceName(args.name),
          flowLog,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
