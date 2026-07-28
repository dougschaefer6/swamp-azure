import { z } from "npm:zod@4.3.6";
import {
  armRequest,
  az,
  AzureGlobalArgsSchema,
  sanitizeInstanceName,
} from "./_helpers.ts";

const COST_API = "2023-03-01";
const GRAPH_API = "2022-10-01";
const ADVISOR_API = "2023-01-01";
const CONSUMPTION_API = "2024-08-01";
const NETWORK_API = "2023-09-01";
const ARM = "https://management.azure.com";

/** Hours in an average month — used to annualize hourly meter rates. */
const HOURS_PER_MONTH = 730;
/** Throughput of one vWAN S2S/P2S scale unit, in megabits per second. */
const MBPS_PER_SCALE_UNIT = 500;

const CostQuerySchema = z
  .object({
    subscriptionId: z.string(),
    groupBy: z.string(),
    granularity: z.string(),
    from: z.string(),
    to: z.string(),
    currency: z.string().optional(),
    totalCost: z.number(),
    rowCount: z.number(),
    rows: z.array(z.record(z.string(), z.unknown())),
    queriedAt: z.string(),
  })
  .passthrough();

const UtilizationSchema = z
  .object({
    name: z.string(),
    id: z.string(),
    resourceGroup: z.string(),
    vmSize: z.string(),
    powerState: z.string().optional(),
    days: z.number(),
    avgCpuPercent: z.number().nullable(),
    maxCpuPercent: z.number().nullable(),
    networkInGb: z.number().nullable(),
    networkOutGb: z.number().nullable(),
    verdict: z.string(),
    measuredAt: z.string(),
  })
  .passthrough();

const FindingSchema = z
  .object({
    category: z.string(),
    severity: z.string(),
    resource: z.string(),
    resourceType: z.string().optional(),
    detail: z.string(),
    estimatedMonthlySavingsUsd: z.number().nullable(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    foundAt: z.string(),
  })
  .passthrough();

const AuditSchema = z
  .object({
    subscriptionId: z.string(),
    scope: z.string(),
    findingCount: z.number(),
    estimatedMonthlySavingsUsd: z.number(),
    findings: z.array(FindingSchema),
    auditedAt: z.string(),
  })
  .passthrough();

const AdvisorSchema = z
  .object({
    subscriptionId: z.string(),
    costRecommendations: z.array(z.record(z.string(), z.unknown())),
    reservationRecommendations: z.array(z.record(z.string(), z.unknown())),
    fetchedAt: z.string(),
  })
  .passthrough();

/** ISO timestamp for `days` ago, floored to midnight UTC. */
function daysAgoIso(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Pull a single Azure Monitor metric for a resource and reduce the requested
 * aggregation to one number. Returns null rather than throwing when a resource
 * has no metric data (a deallocated VM emits nothing), so callers can report
 * "no data" instead of failing the whole sweep.
 *
 * Both `--start-time` and `--end-time` are always passed. Given only a start,
 * `az monitor metrics list` defaults the window to start + 1 hour rather than
 * start-to-now, which silently collapses a 30-day request to a single sample
 * and badly understates totals and peaks.
 */
async function metric(
  resourceId: string,
  metricName: string,
  aggregation: "Average" | "Maximum" | "Total",
  days: number,
  subscriptionId: string,
  interval = "P1D",
): Promise<number | null> {
  try {
    const res = (await az(
      [
        "monitor",
        "metrics",
        "list",
        "--resource",
        resourceId,
        "--metric",
        metricName,
        "--interval",
        interval,
        "--start-time",
        daysAgoIso(days),
        "--end-time",
        nowIso(),
        "--aggregation",
        aggregation,
      ],
      subscriptionId,
    )) as {
      value?: Array<{
        timeseries?: Array<{ data?: Array<Record<string, number>> }>;
      }>;
    } | null;

    const points = res?.value?.[0]?.timeseries?.[0]?.data ?? [];
    const key = aggregation.toLowerCase();
    const vals = points
      .map((p) => p[key])
      .filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return null;

    if (aggregation === "Maximum") return Math.max(...vals);
    if (aggregation === "Total") return vals.reduce((a, b) => a + b, 0);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  } catch {
    return null;
  }
}

/**
 * Pull a metric split by a dimension (for example tunnel bytes per
 * ConnectionName) and total each series over the window. Used instead of the
 * cumulative byte counters on a gateway resource, which reset whenever the
 * gateway is re-provisioned and therefore read as zero for links that are
 * demonstrably carrying traffic.
 */
async function metricByDimension(
  resourceId: string,
  metricName: string,
  dimension: string,
  days: number,
  subscriptionId: string,
  interval = "PT6H",
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = (await az(
      [
        "monitor",
        "metrics",
        "list",
        "--resource",
        resourceId,
        "--metric",
        metricName,
        "--interval",
        interval,
        "--start-time",
        daysAgoIso(days),
        "--end-time",
        nowIso(),
        "--aggregation",
        "Total",
        "--filter",
        `${dimension} eq '*'`,
      ],
      subscriptionId,
    )) as {
      value?: Array<{
        timeseries?: Array<{
          metadatavalues?: Array<
            { name?: { value?: string } | string; value?: string }
          >;
          data?: Array<Record<string, number>>;
        }>;
      }>;
    } | null;

    for (const m of res?.value ?? []) {
      for (const series of m.timeseries ?? []) {
        const meta = series.metadatavalues?.[0];
        const key = typeof meta?.name === "string"
          ? meta.value
          : (meta?.name as { value?: string } | undefined)?.value
          ? meta?.value
          : undefined;
        if (!key) continue;
        const total = (series.data ?? []).reduce(
          (s, p) => s + (typeof p.total === "number" ? p.total : 0),
          0,
        );
        out.set(key, (out.get(key) ?? 0) + total);
      }
    }
  } catch {
    // Leave the map empty; callers treat "no data" as "cannot assess".
  }
  return out;
}

/**
 * `@dougschaefer/azure-cost` model — actual Azure spend analysis and cost
 * optimization, built on the Cost Management, Resource Graph, Advisor, and
 * Consumption APIs. This is the *actuals* counterpart to
 * `@dougschaefer/azure-topology`'s costEstimate, which projects forward from
 * resource config and Retail Pricing; this model reports what was really
 * billed and why. queryCosts pulls billed cost sliced by service, resource,
 * meter, or resource group — meter-level slicing is what exposes silent
 * increases like an added VPN scale unit or connection unit. vmUtilization
 * gathers the CPU and network evidence that distinguishes a genuinely idle VM
 * from a capacity-sized appliance that is merely quiet. auditNetworkSpend
 * checks whether expensive network plumbing is earning its price: whether a
 * secured-hub firewall is actually in the data path, whether its rules are
 * shadowed by a broader allow rule, whether VPN gateway scale units match
 * observed throughput, and which VPN links have never carried a byte.
 * findOrphans sweeps for unattached disks, unassociated public IPs, and stale
 * snapshots. advisorCostRecommendations collects first-party Advisor and
 * reservation guidance. Use these together for a repeatable cost review
 * rather than reconstructing the analysis by hand each month.
 */
export const model = {
  type: "@dougschaefer/azure-cost",
  version: "2026.07.28.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    costQuery: {
      description: "Billed cost for a subscription, sliced by a dimension",
      schema: CostQuerySchema,
      lifetime: "infinite",
      garbageCollection: 12,
    },
    utilization: {
      description: "Observed CPU and network utilization for a virtual machine",
      schema: UtilizationSchema,
      lifetime: "infinite",
      garbageCollection: 12,
    },
    audit: {
      description: "Cost optimization findings with estimated savings",
      schema: AuditSchema,
      lifetime: "infinite",
      garbageCollection: 12,
    },
    advisor: {
      description: "Azure Advisor cost and reservation recommendations",
      schema: AdvisorSchema,
      lifetime: "infinite",
      garbageCollection: 12,
    },
  },
  methods: {
    queryCosts: {
      description:
        "Query actual billed cost from Cost Management, sliced by a dimension. Group by Meter to expose silent rate changes (an added scale unit or connection unit) that a ServiceName rollup hides. Amounts are actual cost, not estimates or forecasts.",
      arguments: z.object({
        groupBy: z
          .enum([
            "ServiceName",
            "ResourceId",
            "ResourceType",
            "ResourceGroupName",
            "Meter",
            "MeterCategory",
          ])
          .default("ServiceName")
          .describe("Dimension to slice cost by"),
        granularity: z
          .enum(["None", "Daily", "Monthly"])
          .default("Monthly")
          .describe("Time bucketing. None returns a single total per group."),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(90)
          .describe("Look-back window in days"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const from = daysAgoIso(args.days);
        const to = nowIso();

        const body = {
          type: "ActualCost",
          timeframe: "Custom",
          timePeriod: { from, to },
          dataset: {
            granularity: args.granularity,
            aggregation: {
              totalCost: { name: "Cost", function: "Sum" },
              totalQuantity: { name: "UsageQuantity", function: "Sum" },
            },
            grouping: [{ type: "Dimension", name: args.groupBy }],
          },
        };

        const res = (await armRequest(
          "POST",
          `${ARM}/subscriptions/${g.subscriptionId}/providers/Microsoft.CostManagement/query?api-version=${COST_API}`,
          body,
        )) as {
          properties?: {
            columns?: Array<{ name: string }>;
            rows?: unknown[][];
          };
        };

        const columns = (res.properties?.columns ?? []).map((c) => c.name);
        const rawRows = res.properties?.rows ?? [];
        const rows = rawRows.map((r) => {
          const rec: Record<string, unknown> = {};
          columns.forEach((c, i) => (rec[c] = r[i]));
          return rec;
        });

        const totalCost = rows.reduce(
          (sum, r) => sum + (typeof r.Cost === "number" ? r.Cost : 0),
          0,
        );
        const currency = rows.find((r) => typeof r.Currency === "string")
          ?.Currency as string | undefined;

        // Rank groups by spend so the log surfaces the drivers, not just a total.
        const byGroup = new Map<string, number>();
        for (const r of rows) {
          const k = String(r[args.groupBy] ?? "(unattributed)");
          byGroup.set(k, (byGroup.get(k) ?? 0) + (Number(r.Cost) || 0));
        }
        const ranked = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);

        context.logger.info(
          "Billed cost by {groupBy} over {days}d: {total} {currency} across {groups} groups",
          {
            groupBy: args.groupBy,
            days: args.days,
            total: round(totalCost),
            currency: currency ?? "USD",
            groups: ranked.length,
          },
        );
        for (const [name, cost] of ranked.slice(0, 15)) {
          context.logger.info("  {name}: {cost}", {
            name,
            cost: round(cost),
          });
        }

        const handle = await context.writeResource(
          "costQuery",
          sanitizeInstanceName(`by-${args.groupBy}-${args.granularity}`),
          {
            subscriptionId: g.subscriptionId,
            groupBy: args.groupBy,
            granularity: args.granularity,
            from,
            to,
            currency,
            totalCost: round(totalCost),
            rowCount: rows.length,
            rows,
            queriedAt: nowIso(),
          },
        );
        return { dataHandles: [handle] };
      },
    },

    vmUtilization: {
      description:
        "Measure CPU and network utilization for every VM in the subscription and classify each as idle, oversized, or right-sized. Fans out across all VMs in one execution. Network counters matter as much as CPU — a capacity-sized appliance such as a media or conferencing node sits near-idle on CPU by design, and only the traffic counters reveal whether it is actually carrying load.",
      arguments: z.object({
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(30)
          .describe("Look-back window in days"),
        resourceGroup: z
          .string()
          .optional()
          .describe(
            "Limit to a resource group. Omit to sweep the subscription.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = args.resourceGroup || g.resourceGroup;

        const cmd = ["vm", "list", "-d"];
        if (rg) cmd.push("--resource-group", rg);
        const vms = (await az(cmd, g.subscriptionId)) as Array<
          Record<string, string | Record<string, string>>
        >;

        context.logger.info("Measuring {count} VMs over {days} days", {
          count: vms.length,
          days: args.days,
        });

        const handles = [];
        for (const vm of vms) {
          const id = vm.id as string;
          const name = vm.name as string;
          const size = (vm.hardwareProfile as Record<string, string>)?.vmSize ??
            "unknown";
          const power = (vm.powerState as string) ?? "unknown";

          const [avgCpu, maxCpu, netIn, netOut] = await Promise.all([
            metric(
              id,
              "Percentage CPU",
              "Average",
              args.days,
              g.subscriptionId,
            ),
            metric(
              id,
              "Percentage CPU",
              "Maximum",
              args.days,
              g.subscriptionId,
            ),
            metric(
              id,
              "Network In Total",
              "Total",
              args.days,
              g.subscriptionId,
            ),
            metric(
              id,
              "Network Out Total",
              "Total",
              args.days,
              g.subscriptionId,
            ),
          ]);

          const inGb = netIn === null ? null : round(netIn / 1e9, 3);
          const outGb = netOut === null ? null : round(netOut / 1e9, 3);

          let verdict: string;
          if (!power.toLowerCase().includes("running")) {
            verdict = "not running — no compute charge";
          } else if (maxCpu !== null && maxCpu < 5 && (inGb ?? 0) < 1) {
            verdict =
              "idle — negligible CPU and traffic; candidate for deallocation";
          } else if (maxCpu !== null && maxCpu < 20) {
            verdict =
              "low utilization — candidate for resize, subject to workload sizing rules";
          } else {
            verdict = "active";
          }

          context.logger.info(
            "  {name} [{size}] {power} avgCpu={avg}% maxCpu={max}% in={in}GB out={out}GB — {verdict}",
            {
              name,
              size,
              power,
              avg: avgCpu === null ? "n/a" : round(avgCpu, 1),
              max: maxCpu === null ? "n/a" : round(maxCpu, 1),
              in: inGb ?? "n/a",
              out: outGb ?? "n/a",
              verdict,
            },
          );

          handles.push(
            await context.writeResource(
              "utilization",
              sanitizeInstanceName(name),
              {
                name,
                id,
                resourceGroup: (vm.resourceGroup as string) ?? "",
                vmSize: size,
                powerState: power,
                days: args.days,
                avgCpuPercent: avgCpu === null ? null : round(avgCpu, 2),
                maxCpuPercent: maxCpu === null ? null : round(maxCpu, 2),
                networkInGb: inGb,
                networkOutGb: outGb,
                verdict,
                measuredAt: nowIso(),
              },
            ),
          );
        }
        return { dataHandles: handles };
      },
    },

    auditNetworkSpend: {
      description:
        "Audit whether expensive network plumbing is earning its cost. Checks that a secured-hub firewall is actually in the data path (routing intent present and data being processed), detects broad allow rules that shadow narrower rules in later-evaluated rule collection groups, compares VPN gateway scale units against observed tunnel throughput, and flags VPN links that have never carried a byte. Network transit is typically the largest and least-scrutinized line on a hub subscription.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Hub resource group holding the firewall and gateways"),
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .default(30)
          .describe(
            "Look-back window in days for throughput and link-liveness checks",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = args.resourceGroup || g.resourceGroup;
        const findings: Array<Record<string, unknown>> = [];
        const add = (f: Record<string, unknown>) =>
          findings.push({ ...f, foundAt: nowIso() });

        // --- Firewalls: in the data path at all, and are its rules shadowed? ---
        try {
          const fwCmd = ["network", "firewall", "list"];
          if (rg) fwCmd.push("--resource-group", rg);
          const firewalls = (await az(fwCmd, g.subscriptionId)) as Array<
            Record<string, unknown>
          >;

          for (const fw of firewalls) {
            const name = fw.name as string;
            const tier = ((fw.sku as Record<string, string>)?.tier as string) ??
              "unknown";
            const hubId = (fw.virtualHub as { id?: string })?.id;
            const hourly = tier === "Premium"
              ? 1.75
              : tier === "Basic"
              ? 0.395
              : 1.25;
            const monthly = round(hourly * HOURS_PER_MONTH);

            if (hubId) {
              const routingIntent = (await armRequest(
                "GET",
                `${ARM}${hubId}/routingIntent?api-version=${NETWORK_API}`,
              )) as { value?: unknown[] };

              if (!routingIntent?.value?.length) {
                add({
                  category: "firewall-not-in-path",
                  severity: "high",
                  resource: name,
                  resourceType: "Microsoft.Network/azureFirewalls",
                  detail:
                    `Secured-hub firewall '${name}' (${tier}) has no routing intent configured on its hub. A Virtual WAN hub is a router first: deploying a firewall into it does not steer anything through it, so without an Internet or Private traffic routing policy all spoke-to-spoke, branch-to-spoke and internet-egress traffic keeps its direct next hop and bypasses the firewall entirely. Inbound DNAT still works, because that arrives on the firewall's own public IP independently of hub routing. The appliance costs about $${monthly}/mo. Treat that as cost at risk, not recoverable savings — three options: enable routing intent so it performs the east-west and egress enforcement it was bought for, downgrade the tier and keep it as a DNAT box, or re-home the DNAT and remove it.`,
                  // Deliberately null: none of this is recoverable without
                  // first deciding where DNAT lives, so reporting the
                  // deployment cost as "savings" would overstate the case.
                  estimatedMonthlySavingsUsd: null,
                  evidence: {
                    tier,
                    hub: hubId.split("/").pop(),
                    hourly,
                    monthlyDeploymentCostUsd: monthly,
                  },
                });
              }
            }

            // An expensive appliance with no diagnostic setting emits nothing:
            // platform metrics still show rules being evaluated, but there is
            // no record of what was allowed or denied, so neither an incident
            // nor a rule-tuning exercise has anything to work from.
            try {
              const diag = (await armRequest(
                "GET",
                `${ARM}${fw.id}/providers/Microsoft.Insights/diagnosticSettings?api-version=2021-05-01-preview`,
              )) as { value?: unknown[] };
              if (!diag?.value?.length) {
                add({
                  category: "no-diagnostic-logging",
                  severity: "high",
                  resource: name,
                  resourceType: "Microsoft.Network/azureFirewalls",
                  detail:
                    `Firewall '${name}' has no diagnostic settings, so it ships no logs anywhere. At roughly $${monthly}/mo this is a security control with no telemetry: no record of allowed or denied flows, nothing to investigate an incident with, and no evidence for an audit. It also makes rule changes unobservable — you cannot tune a policy from denies you never recorded. Send AZFWNetworkRule, AZFWNatRule and AZFWApplicationRule to a Log Analytics workspace in resource-specific mode.`,
                  estimatedMonthlySavingsUsd: null,
                  evidence: { tier, monthlyDeploymentCostUsd: monthly },
                });
              }
            } catch (err) {
              context.logger.warn(
                "Diagnostic-setting check skipped for {name}: {err}",
                { name, err: String(err) },
              );
            }

            // Shadowing: a broad Allow in a lower-priority-number group wins.
            const policyId = (fw.firewallPolicy as { id?: string })?.id;
            if (!policyId) continue;
            const groups = (await armRequest(
              "GET",
              `${ARM}${policyId}/ruleCollectionGroups?api-version=${NETWORK_API}`,
            )) as {
              value?: Array<{
                name: string;
                properties?: {
                  priority?: number;
                  ruleCollections?: Array<Record<string, unknown>>;
                };
              }>;
            };

            const ordered = (groups.value ?? []).sort(
              (a, b) =>
                (a.properties?.priority ?? 0) -
                (b.properties?.priority ?? 0),
            );

            for (let i = 0; i < ordered.length; i++) {
              const grp = ordered[i];
              for (
                const rc of grp.properties?.ruleCollections ?? []
              ) {
                const action = (rc.action as Record<string, string>)?.type ??
                  "";
                if (action !== "Allow") continue;
                for (
                  const r of (rc.rules as Array<Record<string, unknown>>) ??
                    []
                ) {
                  const src = (r.sourceAddresses as string[]) ?? [];
                  const dst = (r.destinationAddresses as string[]) ?? [];
                  const ports = (r.destinationPorts as string[]) ?? [];
                  const isCatchAll = src.includes("*") && dst.includes("*") &&
                    ports.includes("*");
                  if (!isCatchAll) continue;

                  const shadowed = ordered.slice(i + 1).flatMap((later) =>
                    (later.properties?.ruleCollections ?? [])
                      .filter((c) =>
                        c.ruleCollectionType ===
                          "FirewallPolicyFilterRuleCollection"
                      )
                      .flatMap((c) =>
                        ((c.rules as Array<Record<string, unknown>>) ?? []).map(
                          (sr) => `${later.name}/${c.name}/${sr.name}`,
                        )
                      )
                  );
                  if (shadowed.length === 0) continue;

                  add({
                    category: "shadowed-firewall-rules",
                    severity: "high",
                    resource: `${
                      policyId.split("/").pop()
                    }/${grp.name}/${rc.name}`,
                    resourceType: "Microsoft.Network/firewallPolicies",
                    detail:
                      `Rule '${r.name}' allows all sources to all destinations on all ports at rule-collection-group priority ${grp.properties?.priority}. Azure Firewall evaluates lower priority numbers first, so ${shadowed.length} narrower rule(s) in later group(s) never take effect — the firewall permits everything regardless of the scoped policy.`,
                    estimatedMonthlySavingsUsd: null,
                    evidence: { shadowedRules: shadowed.slice(0, 25) },
                  });
                }
              }
            }
          }
        } catch (err) {
          context.logger.warn("Firewall audit skipped: {err}", {
            err: String(err),
          });
        }

        // --- VPN gateways: scale units vs observed throughput, dead links ---
        try {
          const gwCmd = ["network", "vpn-gateway", "list"];
          if (rg) gwCmd.push("--resource-group", rg);
          const gateways = (await az(gwCmd, g.subscriptionId)) as Array<
            Record<string, unknown>
          >;

          for (const gw of gateways) {
            const name = gw.name as string;
            const id = gw.id as string;
            const units = (gw.vpnGatewayScaleUnit as number) ?? 1;

            const peakBytesPerSec = await metric(
              id,
              "TunnelAverageBandwidth",
              "Maximum",
              args.days,
              g.subscriptionId,
              "PT5M",
            );

            if (peakBytesPerSec !== null && units > 1) {
              const peakMbps = (peakBytesPerSec * 8) / 1e6;
              const capacityMbps = units * MBPS_PER_SCALE_UNIT;
              const neededUnits = Math.max(
                1,
                Math.ceil(peakMbps / MBPS_PER_SCALE_UNIT),
              );
              if (neededUnits < units) {
                // vWAN S2S scale unit list price in most regions.
                const monthly = round(
                  (units - neededUnits) * 0.361 * HOURS_PER_MONTH,
                );
                add({
                  category: "vpn-gateway-oversized",
                  severity: "medium",
                  resource: name,
                  resourceType: "Microsoft.Network/vpnGateways",
                  detail:
                    `Gateway '${name}' is provisioned at ${units} scale units (${capacityMbps} Mbps) but peaked at ${
                      round(peakMbps, 2)
                    } Mbps over 30 days. ${neededUnits} scale unit(s) would cover observed load. Rescaling re-provisions the gateway and briefly drops every tunnel on it.`,
                  estimatedMonthlySavingsUsd: monthly,
                  evidence: {
                    units,
                    neededUnits,
                    peakMbps: round(peakMbps, 3),
                  },
                });
              }
            }

            // Judge link liveness from time-series traffic, never from the
            // cumulative counters on the gateway resource: those reset on
            // re-provision, so a busy tunnel reads as zero right after any
            // scale-unit change.
            const [ingressByConn, egressByConn] = await Promise.all([
              metricByDimension(
                id,
                "TunnelIngressBytes",
                "ConnectionName",
                args.days,
                g.subscriptionId,
              ),
              metricByDimension(
                id,
                "TunnelEgressBytes",
                "ConnectionName",
                args.days,
                g.subscriptionId,
              ),
            ]);
            const haveTelemetry = ingressByConn.size > 0 ||
              egressByConn.size > 0;

            for (
              const conn
                of (gw.connections as Array<Record<string, unknown>>) ??
                  []
            ) {
              for (
                const link of (conn.vpnLinkConnections as Array<
                  Record<string, unknown>
                >) ?? []
              ) {
                const linkName = String(link.name);
                if (!haveTelemetry) {
                  context.logger.warn(
                    "  No tunnel telemetry for {gw}; skipping link-liveness checks rather than guessing",
                    { gw: name },
                  );
                  break;
                }
                const bytes = (ingressByConn.get(linkName) ?? 0) +
                  (egressByConn.get(linkName) ?? 0);
                if (bytes > 0) continue;

                add({
                  category: "vpn-link-no-traffic",
                  severity: "low",
                  resource: `${name}/${conn.name}/${linkName}`,
                  resourceType: "Microsoft.Network/vpnGateways/connections",
                  detail:
                    `VPN link '${linkName}' on connection '${conn.name}' carried no measured traffic in the last ${args.days} days. Each vWAN S2S connection unit bills hourly whether or not the tunnel is up. Confirm against the branch build schedule before deleting — a site that is provisioned but not yet cut over will look identical to an abandoned one.`,
                  // vWAN S2S connection unit list price.
                  estimatedMonthlySavingsUsd: round(0.05 * HOURS_PER_MONTH),
                  evidence: {
                    connectionStatus: link.connectionStatus ?? null,
                    observedBytes: bytes,
                    windowDays: args.days,
                  },
                });
              }
            }
          }
        } catch (err) {
          context.logger.warn("VPN gateway audit skipped: {err}", {
            err: String(err),
          });
        }

        const totalSavings = round(
          findings.reduce(
            (s, f) => s + (Number(f.estimatedMonthlySavingsUsd) || 0),
            0,
          ),
        );

        context.logger.info(
          "Network spend audit: {count} finding(s), ~${savings}/mo identified",
          { count: findings.length, savings: totalSavings },
        );
        for (const f of findings) {
          context.logger.info("  [{sev}] {cat}: {res}", {
            sev: f.severity,
            cat: f.category,
            res: f.resource,
          });
        }

        const handle = await context.writeResource("audit", "network-spend", {
          subscriptionId: g.subscriptionId,
          scope: rg ?? "subscription",
          findingCount: findings.length,
          estimatedMonthlySavingsUsd: totalSavings,
          findings,
          auditedAt: nowIso(),
        });
        return { dataHandles: [handle] };
      },
    },

    findOrphans: {
      description:
        "Sweep the subscription for resources that bill without serving anything — unattached managed disks, public IPs associated with nothing, network interfaces with no owner, and stale snapshots. Uses Resource Graph so the whole sweep is a single query rather than a per-resource-group walk.",
      arguments: z.object({
        snapshotAgeDays: z
          .number()
          .int()
          .min(1)
          .default(90)
          .describe("Flag snapshots older than this many days"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        const query = `
          Resources
          | where type in (
              'microsoft.compute/disks',
              'microsoft.network/publicipaddresses',
              'microsoft.network/networkinterfaces',
              'microsoft.compute/snapshots')
          | extend
              diskState = tostring(properties.diskState),
              ipConfig = properties.ipConfiguration,
              nicVm = properties.virtualMachine,
              created = todatetime(properties.timeCreated),
              sizeGb = toint(properties.diskSizeGB),
              skuName = tostring(sku.name)
          | where (type == 'microsoft.compute/disks' and diskState == 'Unattached')
               or (type == 'microsoft.network/publicipaddresses' and isnull(ipConfig))
               or (type == 'microsoft.network/networkinterfaces' and isnull(nicVm))
               or (type == 'microsoft.compute/snapshots' and created < ago(${args.snapshotAgeDays}d))
          | project name, type, resourceGroup, sizeGb, skuName, created, location
        `;

        const res = (await armRequest(
          "POST",
          `${ARM}/providers/Microsoft.ResourceGraph/resources?api-version=${GRAPH_API}`,
          { subscriptions: [g.subscriptionId], query },
        )) as { data?: Array<Record<string, unknown>> };

        const rows = res.data ?? [];
        const findings = rows.map((r) => {
          const type = String(r.type);
          const sizeGb = Number(r.sizeGb) || 0;
          // Managed-disk list price varies by SKU; use a conservative
          // StandardSSD-class rate purely to rank findings by materiality.
          const savings = type === "microsoft.compute/disks"
            ? round(sizeGb * 0.096)
            : type === "microsoft.compute/snapshots"
            ? round(sizeGb * 0.05)
            : null;
          const detail = type === "microsoft.compute/disks"
            ? `Managed disk '${r.name}' (${sizeGb} GB ${r.skuName}) is Unattached and bills in full. Confirm no VM is pending restore, then snapshot and delete.`
            : type === "microsoft.network/publicipaddresses"
            ? `Public IP '${r.name}' (${r.skuName}) is associated with nothing. Standard SKU public IPs bill whether or not they carry traffic.`
            : type === "microsoft.network/networkinterfaces"
            ? `Network interface '${r.name}' has no attached virtual machine. It does not bill directly but holds an IP reservation and clutters inventory.`
            : `Snapshot '${r.name}' (${sizeGb} GB) was created ${r.created} and is older than ${args.snapshotAgeDays} days. Confirm the restore point is still required.`;

          return {
            category: "orphaned-resource",
            severity: savings && savings > 10 ? "medium" : "low",
            resource: String(r.name),
            resourceType: type,
            detail,
            estimatedMonthlySavingsUsd: savings,
            evidence: {
              resourceGroup: r.resourceGroup,
              location: r.location,
              sizeGb: sizeGb || null,
              sku: r.skuName ?? null,
            },
            foundAt: nowIso(),
          };
        });

        const totalSavings = round(
          findings.reduce(
            (s, f) => s + (Number(f.estimatedMonthlySavingsUsd) || 0),
            0,
          ),
        );

        context.logger.info(
          "Orphan sweep: {count} resource(s), ~${savings}/mo identified",
          { count: findings.length, savings: totalSavings },
        );
        for (const f of findings) {
          context.logger.info("  [{sev}] {res} ({type})", {
            sev: f.severity,
            res: f.resource,
            type: f.resourceType,
          });
        }

        const handle = await context.writeResource("audit", "orphans", {
          subscriptionId: g.subscriptionId,
          scope: "subscription",
          findingCount: findings.length,
          estimatedMonthlySavingsUsd: totalSavings,
          findings,
          auditedAt: nowIso(),
        });
        return { dataHandles: [handle] };
      },
    },

    advisorCostRecommendations: {
      description:
        "Collect Azure Advisor cost recommendations and Consumption reservation recommendations. Advisor reads idle CPU without knowing workload intent, so treat its resize advice as evidence rather than instruction — and settle right-sizing before committing to any reservation, since a reservation bought against a SKU you are about to change is wasted.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const advisor = (await armRequest(
          "GET",
          `${ARM}/subscriptions/${g.subscriptionId}/providers/Microsoft.Advisor/recommendations` +
            `?api-version=${ADVISOR_API}&$filter=${
              encodeURIComponent("Category eq 'Cost'")
            }`,
        )) as { value?: Array<Record<string, unknown>> };

        const costRecs = (advisor.value ?? []).map((r) => {
          const p = (r.properties ?? {}) as Record<string, unknown>;
          const ex = (p.extendedProperties ?? {}) as Record<string, unknown>;
          return {
            impact: p.impact,
            problem: (p.shortDescription as Record<string, string>)?.problem,
            resource:
              ((p.resourceMetadata as Record<string, string>)?.resourceId ?? "")
                .split("/")
                .pop(),
            currentSku: ex.currentSku ?? ex.sku ?? null,
            targetSku: ex.targetSku ?? null,
            term: ex.term ?? null,
            lookbackPeriod: ex.lookbackPeriod ?? null,
            annualSavingsUsd: ex.annualSavingsAmount
              ? Number(ex.annualSavingsAmount)
              : null,
            monthlySavingsUsd: ex.savingsAmount
              ? Number(ex.savingsAmount)
              : null,
          };
        });

        let reservationRecs: Array<Record<string, unknown>> = [];
        try {
          const consumption = (await armRequest(
            "GET",
            `${ARM}/subscriptions/${g.subscriptionId}/providers/Microsoft.Consumption/reservationRecommendations?api-version=${CONSUMPTION_API}`,
          )) as { value?: Array<Record<string, unknown>> };
          reservationRecs = (consumption.value ?? []).map((r) => {
            const p = (r.properties ?? {}) as Record<string, unknown>;
            return {
              sku: p.skuName ?? r.sku ?? null,
              term: p.term ?? null,
              lookBackPeriod: p.lookBackPeriod ?? null,
              scope: p.scope ?? null,
              recommendedQuantity: p.recommendedQuantity ?? null,
              netSavings: p.netSavings ?? null,
              costWithNoReservedInstances: p.costWithNoReservedInstances ??
                null,
              totalCostWithReservedInstances:
                p.totalCostWithReservedInstances ?? null,
            };
          });
        } catch (err) {
          context.logger.warn("Reservation recommendations skipped: {err}", {
            err: String(err),
          });
        }

        context.logger.info(
          "Advisor: {cost} cost recommendation(s), {res} reservation recommendation(s)",
          { cost: costRecs.length, res: reservationRecs.length },
        );
        for (const r of costRecs) {
          context.logger.info(
            "  [{impact}] {problem} — {resource} (~${monthly}/mo)",
            {
              impact: r.impact,
              problem: r.problem,
              resource: r.resource,
              monthly: r.monthlySavingsUsd ?? "n/a",
            },
          );
        }

        const handle = await context.writeResource("advisor", "cost", {
          subscriptionId: g.subscriptionId,
          costRecommendations: costRecs,
          reservationRecommendations: reservationRecs,
          fetchedAt: nowIso(),
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
