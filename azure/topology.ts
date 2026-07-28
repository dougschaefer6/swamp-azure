import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const TopologySchema = z
  .object({
    resourceGroup: z.string(),
    generatedAt: z.string(),
    mermaid: z.string(),
    resourceCounts: z.record(z.string(), z.number()),
  })
  .passthrough();

const CostEstimateSchema = z
  .object({
    resourceGroup: z.string(),
    estimatedAt: z.string(),
    currency: z.string(),
    totalMonthly: z.number(),
    items: z.array(
      z.object({
        resourceType: z.string(),
        name: z.string(),
        sku: z.string(),
        location: z.string(),
        estimatedMonthly: z.number(),
      }),
    ),
  })
  .passthrough();

const ArmTemplateSchema = z
  .object({
    resourceGroup: z.string(),
    exportedAt: z.string(),
    template: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const InventoryItemSchema = z
  .object({
    resourceType: z.string(),
    name: z.string(),
    resourceGroup: z.string(),
    location: z.string().optional(),
    azureId: z.string().optional(),
    raw: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/**
 * Pull the trailing resource name from a full Azure resource ID.
 */
function extractName(resourceId: string): string {
  const parts = resourceId.split("/");
  return parts[parts.length - 1] || resourceId;
}

/**
 * Escape double quotes in a Mermaid node label so the rendered
 * diagram doesn't break on resource names containing quotes.
 */
function escapeLabel(s: string): string {
  return s.replace(/"/g, "#quot;");
}

/**
 * `@dougschaefer/azure-topology` model — cross-cutting introspection
 * over an Azure resource group's contents, wrapping `az resource
 * list` and several focused `az` queries. inventory walks a resource
 * group and produces typed inventoryItem records suitable for
 * dashboarding and compliance evidence. generate produces a Mermaid
 * diagram of the resources with their hierarchical and reference
 * relationships, useful for handoff documents and architecture
 * reviews. costEstimate combines the resource inventory with Azure
 * Retail Pricing API lookups to produce a monthly cost estimate per
 * resource type and overall. exportTemplate serializes the resource
 * group to an ARM template for backup or replication. Designed for
 * the hub-and-spoke topology pattern but works on any resource
 * group.
 */
export const model = {
  type: "@dougschaefer/azure-topology",
  version: "2026.07.28.5",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    topology: {
      description: "Mermaid topology diagram for an Azure resource group",
      schema: TopologySchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
    costEstimate: {
      description: "Cost estimate for resources in a resource group",
      schema: CostEstimateSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
    armTemplate: {
      description: "Exported ARM template for a resource group",
      schema: ArmTemplateSchema,
      lifetime: "infinite",
      garbageCollection: 5,
    },
    inventoryItem: {
      description:
        "Individual Azure resource discovered during subscription inventory",
      schema: InventoryItemSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    inventory: {
      description:
        "Discover all resources across the subscription (or a single resource group). Produces per-resource data handles for VMs, disks, VNets, NSGs, firewalls, public IPs, NAT gateways, route tables, load balancers, application gateways, Bastion, Key Vaults, storage accounts, private endpoints, managed identities, and SQL servers.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe(
            "Resource group name. Omit to scan the entire subscription.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = args.resourceGroup || g.resourceGroup;

        const rgArgs = rg ? ["--resource-group", rg] : [];

        const typeMap: Array<{
          short: string;
          azureType: string;
          cmd: string[];
        }> = [
          {
            short: "vm",
            azureType: "Microsoft.Compute/virtualMachines",
            cmd: ["vm", "list", "--show-details", ...rgArgs],
          },
          {
            short: "vnet",
            azureType: "Microsoft.Network/virtualNetworks",
            cmd: ["network", "vnet", "list", ...rgArgs],
          },
          {
            short: "nsg",
            azureType: "Microsoft.Network/networkSecurityGroups",
            cmd: ["network", "nsg", "list", ...rgArgs],
          },
          {
            short: "fw",
            azureType: "Microsoft.Network/azureFirewalls",
            cmd: ["network", "firewall", "list", ...rgArgs],
          },
          {
            short: "pip",
            azureType: "Microsoft.Network/publicIPAddresses",
            cmd: ["network", "public-ip", "list", ...rgArgs],
          },
          {
            short: "nat",
            azureType: "Microsoft.Network/natGateways",
            cmd: ["network", "nat", "gateway", "list", ...rgArgs],
          },
          {
            short: "rt",
            azureType: "Microsoft.Network/routeTables",
            cmd: ["network", "route-table", "list", ...rgArgs],
          },
          {
            short: "kv",
            azureType: "Microsoft.KeyVault/vaults",
            cmd: ["keyvault", "list", ...rgArgs],
          },
          {
            short: "sa",
            azureType: "Microsoft.Storage/storageAccounts",
            cmd: ["storage", "account", "list", ...rgArgs],
          },
          {
            short: "sql",
            azureType: "Microsoft.Sql/servers",
            cmd: ["sql", "server", "list", ...rgArgs],
          },
          {
            short: "disk",
            azureType: "Microsoft.Compute/disks",
            cmd: ["disk", "list", ...rgArgs],
          },
          {
            short: "lb",
            azureType: "Microsoft.Network/loadBalancers",
            cmd: ["network", "lb", "list", ...rgArgs],
          },
          {
            short: "appgw",
            azureType: "Microsoft.Network/applicationGateways",
            cmd: ["network", "application-gateway", "list", ...rgArgs],
          },
          {
            short: "bastion",
            azureType: "Microsoft.Network/bastionHosts",
            cmd: ["network", "bastion", "list"],
          },
          {
            short: "pe",
            azureType: "Microsoft.Network/privateEndpoints",
            cmd: ["network", "private-endpoint", "list", ...rgArgs],
          },
          {
            short: "identity",
            azureType: "Microsoft.ManagedIdentity/userAssignedIdentities",
            cmd: ["identity", "list", ...rgArgs],
          },
        ];

        const results = await Promise.all(
          typeMap.map((t) =>
            az(t.cmd, g.subscriptionId)
              .then((r) => ({
                ...t,
                items: (r || []) as Array<Record<string, unknown>>,
              }))
              .catch((err) => {
                context.logger.warning(
                  "Failed to list {type}: {error}",
                  { type: t.short, error: String(err) },
                );
                return { ...t, items: [] as Array<Record<string, unknown>> };
              })
          ),
        );

        const handles = [];
        const counts: Record<string, number> = {};

        for (const result of results) {
          counts[result.short] = result.items.length;
          for (const item of result.items) {
            const name = item.name as string;
            const itemRg = (item.resourceGroup as string) ||
              rg ||
              "unknown";
            const instanceName = `${result.short}--${name}`;

            const handle = await context.writeResource(
              "inventoryItem",
              sanitizeInstanceName(instanceName),
              {
                resourceType: result.azureType,
                name,
                resourceGroup: itemRg,
                location: (item.location as string) || undefined,
                azureId: (item.id as string) || undefined,
                raw: item,
              },
            );
            handles.push(handle);
          }
        }

        const total = handles.length;
        const scope = rg || "subscription";
        context.logger.info(
          "Inventory complete for {scope}: {total} resources ({counts})",
          {
            scope,
            total,
            counts: Object.entries(counts)
              .filter(([_, v]) => v > 0)
              .map(([k, v]) => `${v} ${k}`)
              .join(", "),
          },
        );

        return { dataHandles: handles };
      },
    },

    generate: {
      description:
        "Generate a Mermaid topology diagram. When resourceGroup is provided, diagrams a single RG. When omitted, produces a subscription-wide hub-and-spoke diagram across all resource groups with LR layout, traffic flow arrows, and Azure-branded colors.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe(
            "Resource group name. Omit for a subscription-wide topology.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = args.resourceGroup || g.resourceGroup;

        // --- Class definitions shared by both modes ---
        const classDefs = [
          "classDef vnet fill:#0078D4,color:#fff,stroke:#005A9E,stroke-width:2px",
          "classDef subnet fill:#50E6FF,color:#000,stroke:#0078D4",
          "classDef vm fill:#7FBA00,color:#fff,stroke:#5E8B00,stroke-width:2px",
          "classDef nsg fill:#FF8C00,color:#fff,stroke:#CC7000",
          "classDef firewall fill:#E81123,color:#fff,stroke:#B80E1C,stroke-width:2px",
          "classDef pip fill:#B4A0FF,color:#000,stroke:#7B6DB0",
          "classDef nat fill:#00BCF2,color:#000,stroke:#0099CC",
          "classDef rt fill:#FFB900,color:#000,stroke:#CC9400",
          "classDef vwan fill:#773ADC,color:#fff,stroke:#5B2D99,stroke-width:2px",
          "classDef vpn fill:#0063B1,color:#fff,stroke:#004E8C",
          "classDef storage fill:#744DA9,color:#fff,stroke:#5C3D87",
          "classDef image fill:#107C10,color:#fff,stroke:#0B5E0B",
          "classDef internet fill:#333,color:#fff,stroke:#000,stroke-width:2px",
          "classDef spacer fill:none,stroke:none,color:transparent",
        ];

        // --- Helper to build subnet map and NSG/RT associations for a set of VNets ---
        function buildSubnetMaps(vnets: Array<Record<string, unknown>>) {
          const subnetToNode = new Map<string, string>();
          const nsgSubnets = new Map<string, string[]>();
          const rtSubnets = new Map<string, string[]>();

          for (const vnet of vnets) {
            const vnetName = vnet.name as string;
            const subnets = (vnet.subnets || []) as Array<
              Record<string, unknown>
            >;
            for (const subnet of subnets) {
              const subnetName = subnet.name as string;
              const nodeId = `subnet_${sanitizeInstanceName(vnetName)}_${
                sanitizeInstanceName(subnetName)
              }`;
              if (subnet.id) {
                subnetToNode.set(
                  (subnet.id as string).toLowerCase(),
                  nodeId,
                );
              }
              const nsgRef = subnet.networkSecurityGroup as
                | { id: string }
                | null
                | undefined;
              if (nsgRef?.id) {
                const name = extractName(nsgRef.id);
                if (!nsgSubnets.has(name)) nsgSubnets.set(name, []);
                nsgSubnets.get(name)!.push(nodeId);
              }
              const rtRef = subnet.routeTable as
                | { id: string }
                | null
                | undefined;
              if (rtRef?.id) {
                const name = extractName(rtRef.id);
                if (!rtSubnets.has(name)) rtSubnets.set(name, []);
                rtSubnets.get(name)!.push(nodeId);
              }
            }
          }
          return { subnetToNode, nsgSubnets, rtSubnets };
        }

        // --- Helper to emit a VNet subgraph with subnets ---
        function emitVnet(
          vnet: Record<string, unknown>,
          indent: string,
        ): string[] {
          const out: string[] = [];
          const vnetName = vnet.name as string;
          const vnetId = `vnet_${sanitizeInstanceName(vnetName)}`;
          const addressSpace = vnet.addressSpace as
            | { addressPrefixes: string[] }
            | undefined;
          const prefixes = addressSpace?.addressPrefixes?.join(", ") || "";

          out.push(
            `${indent}subgraph ${vnetId}["${escapeLabel(vnetName)} ${
              escapeLabel(prefixes)
            }"]`,
          );
          out.push(`${indent}  direction TB`);

          const subnets = (vnet.subnets || []) as Array<
            Record<string, unknown>
          >;
          for (const subnet of subnets) {
            const subnetName = subnet.name as string;
            const nodeId = `subnet_${sanitizeInstanceName(vnetName)}_${
              sanitizeInstanceName(subnetName)
            }`;
            const prefix = (subnet.addressPrefix as string) ||
              ((subnet.addressPrefixes as string[]) || [])[0] || "";
            out.push(
              `${indent}  ${nodeId}["${escapeLabel(subnetName)}\\n${
                escapeLabel(prefix)
              }"]:::subnet`,
            );
          }

          out.push(`${indent}end`);
          out.push(`${indent}class ${vnetId} vnet`);
          return out;
        }

        // ================================================================
        // SUBSCRIPTION-WIDE MODE (no resourceGroup specified)
        // Produces an LR hub-and-spoke diagram across all resource groups.
        // ================================================================
        if (!rg) {
          // Fetch all resource groups, then resources per group in parallel
          const allRgs = (await az(
            ["group", "list"],
            g.subscriptionId,
          )) as Array<Record<string, unknown>>;

          // Collect resources across all RGs in parallel
          const fetchForRg = async (rgName: string) => {
            const rgArgs = ["--resource-group", rgName];
            const [vnets, nsgs, vms, firewalls, storageAccts, vpnSites, vwans] =
              await Promise.all([
                az(["network", "vnet", "list", ...rgArgs], g.subscriptionId)
                  .catch(() => []) as Promise<Array<Record<string, unknown>>>,
                az(["network", "nsg", "list", ...rgArgs], g.subscriptionId)
                  .catch(() => []) as Promise<Array<Record<string, unknown>>>,
                az(
                  ["vm", "list", ...rgArgs, "--show-details"],
                  g.subscriptionId,
                ).catch(() => []) as Promise<Array<Record<string, unknown>>>,
                az(
                  ["network", "firewall", "list", ...rgArgs],
                  g.subscriptionId,
                ).catch(() => []) as Promise<Array<Record<string, unknown>>>,
                az(
                  ["storage", "account", "list", ...rgArgs],
                  g.subscriptionId,
                ).catch(() => []) as Promise<Array<Record<string, unknown>>>,
                az(
                  ["network", "vpn-site", "list", ...rgArgs],
                  g.subscriptionId,
                ).catch(() => []) as Promise<Array<Record<string, unknown>>>,
                az(
                  ["network", "vwan", "list", ...rgArgs],
                  g.subscriptionId,
                ).catch(() => []) as Promise<Array<Record<string, unknown>>>,
              ]);
            return {
              rgName,
              vnets,
              nsgs,
              vms,
              firewalls,
              storageAccts,
              vpnSites,
              vwans,
            };
          };

          const rgData = await Promise.all(
            allRgs.map((r) => fetchForRg(r.name as string)),
          );

          // Separate hub RG (contains vWAN/firewall) from spoke RGs (contain VNets with VMs)
          const hubRgs = rgData.filter(
            (r) => r.firewalls.length > 0 || r.vwans.length > 0,
          );
          const spokeRgs = rgData.filter(
            (r) =>
              r.vnets.length > 0 &&
              r.firewalls.length === 0 &&
              r.vwans.length === 0,
          );
          const imageRgs = rgData.filter(
            (r) =>
              r.storageAccts.length > 0 &&
              r.vnets.length === 0 &&
              r.vms.length === 0 &&
              r.firewalls.length === 0,
          );

          const lines: string[] = [];
          lines.push(
            `%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'subGraphTitleMargin': {'top': 15, 'bottom': 15}, 'padding': 20}}}%%`,
          );
          lines.push("graph LR");
          for (const c of classDefs) lines.push(`  ${c}`);
          lines.push("");

          // External zone (VPN sites + internet)
          const allVpnSites = rgData.flatMap((r) => r.vpnSites);
          if (allVpnSites.length > 0) {
            lines.push(`  subgraph external["On-Premises / External"]`);
            lines.push(`    direction TB`);
            for (const site of allVpnSites) {
              const siteName = site.name as string;
              const siteId = `vpn_${sanitizeInstanceName(siteName)}`;
              const addrPrefixes =
                ((site.addressSpace as { addressPrefixes?: string[] })
                  ?.addressPrefixes || []).join(", ");
              const label = addrPrefixes
                ? `${escapeLabel(siteName)}\\n${escapeLabel(addrPrefixes)}`
                : escapeLabel(siteName);
              lines.push(`    ${siteId}["${label}"]:::vpn`);
            }
            lines.push(`    internet_node["Internet"]:::internet`);
            lines.push(`  end`);
            lines.push("");
          }

          // Subscription container
          const shortSub = g.subscriptionId.substring(0, 8);
          lines.push(`  subgraph sub["Subscription ${shortSub}"]`);
          lines.push("");

          // Hub resource group(s)
          for (const hub of hubRgs) {
            lines.push(
              `    subgraph rg_${sanitizeInstanceName(hub.rgName)}["RG: ${
                escapeLabel(hub.rgName)
              }"]`,
            );
            lines.push(`      direction TB`);

            for (const vwan of hub.vwans) {
              const vwanName = vwan.name as string;
              lines.push(
                `      vwan_${sanitizeInstanceName(vwanName)}["${
                  escapeLabel(vwanName)
                }"]:::vwan`,
              );
            }

            // VPN gateway (inferred from vWAN hub presence)
            if (hub.vwans.length > 0) {
              lines.push(
                `      vpn_gw["VPN Gateway\\nS2S IPsec"]:::vpn`,
              );
            }

            for (const fw of hub.firewalls) {
              const fwName = fw.name as string;
              const tier = (fw.sku as { tier: string } | undefined)?.tier ||
                "Standard";
              const policyName = fw.firewallPolicy
                ? extractName(
                  (fw.firewallPolicy as { id: string }).id,
                )
                : "";
              const policyLabel = policyName
                ? `\\n${escapeLabel(policyName)}`
                : "";
              lines.push(
                `      fw_${sanitizeInstanceName(fwName)}["Azure Firewall\\n${
                  escapeLabel(tier)
                }${policyLabel}"]:::firewall`,
              );
            }

            for (const sa of hub.storageAccts) {
              const saName = sa.name as string;
              lines.push(
                `      sa_${sanitizeInstanceName(saName)}["${
                  escapeLabel(saName)
                }"]:::storage`,
              );
            }

            lines.push(`    end`);
            lines.push("");

            // Internal hub connections
            if (hub.vwans.length > 0 && hub.firewalls.length > 0) {
              const vwanId = `vwan_${
                sanitizeInstanceName(hub.vwans[0].name as string)
              }`;
              const fwId = `fw_${
                sanitizeInstanceName(hub.firewalls[0].name as string)
              }`;
              lines.push(`    ${vwanId} --- vpn_gw`);
              lines.push(`    ${vwanId} --- ${fwId}`);
            }
          }

          // Spoke resource groups
          for (const spoke of spokeRgs) {
            const rgId = `rg_${sanitizeInstanceName(spoke.rgName)}`;
            lines.push(
              `    subgraph ${rgId}["RG: ${escapeLabel(spoke.rgName)}"]`,
            );
            lines.push(`      direction TB`);
            // Spacer to push content below RG title
            lines.push(`      ${rgId}_spacer[ ]:::spacer`);

            const { subnetToNode, nsgSubnets } = buildSubnetMaps(spoke.vnets);

            for (const vnet of spoke.vnets) {
              const vnetLines = emitVnet(vnet, "      ");
              lines.push(...vnetLines);
            }

            for (const vm of spoke.vms) {
              const vmName = vm.name as string;
              const vmId = `vm_${sanitizeInstanceName(vmName)}`;
              const vmSize =
                (vm.hardwareProfile as { vmSize: string } | undefined)
                  ?.vmSize || "";
              const osType = (
                vm.storageProfile as {
                  osDisk?: { osType?: string };
                } | undefined
              )?.osDisk?.osType || "";
              const privateIp = (vm.privateIps as string) || "";
              const tags = (vm.tags || {}) as Record<string, string>;
              const version = tags["pexip-version"] || "";
              const versionLabel = version ? `\\n${escapeLabel(version)}` : "";

              lines.push(
                `      ${vmId}["${escapeLabel(vmName)}\\n${
                  escapeLabel(vmSize.replace("Standard_", ""))
                } - ${escapeLabel(osType)}${versionLabel}\\n${
                  escapeLabel(privateIp)
                }"]:::vm`,
              );
            }

            for (const nsg of spoke.nsgs) {
              const nsgName = nsg.name as string;
              const nsgId = `nsg_${sanitizeInstanceName(nsgName)}`;
              const ruleCount = (
                (nsg.securityRules as Array<unknown>) || []
              ).length;
              lines.push(
                `      ${nsgId}["${
                  escapeLabel(nsgName)
                }\\n${ruleCount} rules"]:::nsg`,
              );
            }

            lines.push(`    end`);
            lines.push("");

            // Subnet-to-VM connections
            for (const vm of spoke.vms) {
              const vmName = vm.name as string;
              const vmId = `vm_${sanitizeInstanceName(vmName)}`;
              const nics = (
                vm.networkProfile as {
                  networkInterfaces?: Array<{ id: string }>;
                } | undefined
              )?.networkInterfaces || [];
              for (const nic of nics) {
                // Resolve NIC subnet
                const nicId = nic.id.toLowerCase();
                for (const [subId, nodeId] of subnetToNode) {
                  if (
                    nicId.includes(
                      subId.split("/subnets/")[0]?.split("/virtualnetworks/")[1]
                        ?.toLowerCase() || "___",
                    )
                  ) {
                    lines.push(`    ${nodeId} --> ${vmId}`);
                    break;
                  }
                }
                // Fallback: connect to first subnet
                if (subnetToNode.size > 0) {
                  const firstSubnet = [...subnetToNode.values()][0];
                  if (
                    !lines.some((l) => l.includes(`--> ${vmId}`))
                  ) {
                    lines.push(`    ${firstSubnet} --> ${vmId}`);
                  }
                }
              }
            }

            // NSG associations
            for (const nsg of spoke.nsgs) {
              const nsgName = nsg.name as string;
              const nsgId = `nsg_${sanitizeInstanceName(nsgName)}`;
              const associated = nsgSubnets.get(nsgName) || [];
              for (const subnetNodeId of associated) {
                lines.push(
                  `    ${nsgId} -.->|"applied"| ${subnetNodeId}`,
                );
              }
            }
          }

          // Image/storage-only resource groups
          for (const imgRg of imageRgs) {
            const rgId = `rg_${sanitizeInstanceName(imgRg.rgName)}`;
            lines.push(
              `    subgraph ${rgId}["RG: ${escapeLabel(imgRg.rgName)}"]`,
            );
            lines.push(`      direction TB`);
            lines.push(`      ${rgId}_spacer[ ]:::spacer`);
            for (const sa of imgRg.storageAccts) {
              const saName = sa.name as string;
              lines.push(
                `      sa_${sanitizeInstanceName(saName)}["${
                  escapeLabel(saName)
                }"]:::storage`,
              );
            }
            lines.push(`    end`);
            lines.push("");
          }

          lines.push(`  end`); // close subscription
          lines.push("");

          // Force spoke RGs side-by-side with invisible links
          if (spokeRgs.length > 1) {
            const spokeIds = spokeRgs.map(
              (s) => `rg_${sanitizeInstanceName(s.rgName)}`,
            );
            lines.push(`  ${spokeIds.join(" ~~~ ")}`);
            lines.push("");
          }

          // VPN ingress arrows
          for (const site of allVpnSites) {
            const siteId = `vpn_${sanitizeInstanceName(site.name as string)}`;
            lines.push(`  ${siteId} -->|"S2S IPsec"| vpn_gw`);
          }

          // Internet egress through firewall
          if (hubRgs.length > 0 && hubRgs[0].firewalls.length > 0) {
            const fwId = `fw_${
              sanitizeInstanceName(hubRgs[0].firewalls[0].name as string)
            }`;
            if (allVpnSites.length > 0) {
              lines.push(`  ${fwId} -->|"outbound NAT"| internet_node`);
            }

            // Hub connections to spoke VNets
            for (const spoke of spokeRgs) {
              for (const vnet of spoke.vnets) {
                const vnetId = `vnet_${
                  sanitizeInstanceName(vnet.name as string)
                }`;
                lines.push(
                  `  ${fwId} ==>|"hub connection"| ${vnetId}`,
                );
              }
            }
          }

          const mermaid = lines.join("\n");
          const totalVms = rgData.reduce((s, r) => s + r.vms.length, 0);
          const totalVnets = rgData.reduce(
            (s, r) => s + r.vnets.length,
            0,
          );

          context.logger.info(
            "Generated subscription-wide topology: {rgs} RGs, {vnets} VNets, {vms} VMs",
            { rgs: allRgs.length, vnets: totalVnets, vms: totalVms },
          );

          const data = {
            resourceGroup: "subscription",
            generatedAt: new Date().toISOString(),
            mermaid,
            resourceCounts: {
              resourceGroups: allRgs.length,
              vnets: totalVnets,
              vms: totalVms,
              firewalls: rgData.reduce(
                (s, r) => s + r.firewalls.length,
                0,
              ),
              nsgs: rgData.reduce((s, r) => s + r.nsgs.length, 0),
              vpnSites: allVpnSites.length,
            },
          };

          const handle = await context.writeResource(
            "topology",
            "subscription-wide",
            data,
          );
          return { dataHandles: [handle] };
        }

        // ================================================================
        // SINGLE RESOURCE GROUP MODE (original behavior, same style)
        // ================================================================

        const [
          vnets,
          nsgs,
          routeTables,
          publicIps,
          natGateways,
          firewalls,
          vms,
        ] = await Promise.all([
          az(
            ["network", "vnet", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "nsg", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "route-table", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "public-ip", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "nat", "gateway", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["network", "firewall", "list", "--resource-group", rg],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
          az(
            ["vm", "list", "--resource-group", rg, "--show-details"],
            g.subscriptionId,
          ) as Promise<Array<Record<string, unknown>>>,
        ]);

        const lines: string[] = [];
        lines.push(
          `%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 80, 'subGraphTitleMargin': {'top': 15, 'bottom': 15}, 'padding': 20}}}%%`,
        );
        lines.push("graph LR");
        for (const c of classDefs) lines.push(`  ${c}`);
        lines.push("");

        const { subnetToNode, nsgSubnets, rtSubnets } = buildSubnetMaps(vnets);

        // VNets and subnets
        for (const vnet of vnets) {
          const vnetLines = emitVnet(vnet, "  ");
          lines.push(...vnetLines);
          lines.push("");
        }

        // VMs
        for (const vm of vms) {
          const vmName = vm.name as string;
          const vmId = `vm_${sanitizeInstanceName(vmName)}`;
          const vmSize = (
            vm.hardwareProfile as { vmSize: string } | undefined
          )?.vmSize || "";
          const powerState = (vm.powerState as string) || "";
          const privateIp = (vm.privateIps as string) || "";

          lines.push(
            `  ${vmId}["${escapeLabel(vmName)}\\n${
              escapeLabel(vmSize.replace("Standard_", ""))
            }\\n${escapeLabel(powerState)}\\n${escapeLabel(privateIp)}"]:::vm`,
          );

          const privateIps = (vm.privateIps as string) || "";
          if (privateIps && subnetToNode.size > 0) {
            const firstSubnet = [...subnetToNode.values()][0];
            lines.push(`  ${firstSubnet} --> ${vmId}`);
          }

          const publicIpAddr = (vm.publicIps as string) || "";
          if (publicIpAddr) {
            const pipId = `pip_vm_${sanitizeInstanceName(vmName)}`;
            lines.push(
              `  ${pipId}["${escapeLabel(publicIpAddr)}"]:::pip`,
            );
            lines.push(`  ${pipId} --> ${vmId}`);
          }
        }
        lines.push("");

        // NSGs
        for (const nsg of nsgs) {
          const nsgName = nsg.name as string;
          const nsgId = `nsg_${sanitizeInstanceName(nsgName)}`;
          const ruleCount = (
            (nsg.securityRules as Array<unknown>) || []
          ).length;
          lines.push(
            `  ${nsgId}["${escapeLabel(nsgName)}\\n${ruleCount} rules"]:::nsg`,
          );
          const associated = nsgSubnets.get(nsgName) || [];
          for (const subnetNodeId of associated) {
            lines.push(`  ${nsgId} -.->|"applied"| ${subnetNodeId}`);
          }
        }

        // Route tables
        for (const rt of routeTables) {
          const rtName = rt.name as string;
          const rtId = `rt_${sanitizeInstanceName(rtName)}`;
          const routeCount = (
            (rt.routes as Array<unknown>) || []
          ).length;
          lines.push(
            `  ${rtId}["${escapeLabel(rtName)}\\n${routeCount} routes"]:::rt`,
          );
          const associated = rtSubnets.get(rtName) || [];
          for (const subnetNodeId of associated) {
            lines.push(`  ${rtId} -.->|"applied"| ${subnetNodeId}`);
          }
        }

        // NAT gateways
        for (const gw of natGateways) {
          const gwName = gw.name as string;
          const gwId = `nat_${sanitizeInstanceName(gwName)}`;
          lines.push(
            `  ${gwId}["NAT: ${escapeLabel(gwName)}"]:::nat`,
          );
          const gwSubnets = (gw.subnets || []) as Array<{ id: string }>;
          for (const sub of gwSubnets) {
            const subnetNodeId = subnetToNode.get(sub.id.toLowerCase());
            if (subnetNodeId) lines.push(`  ${subnetNodeId} --> ${gwId}`);
          }
        }

        // Standalone public IPs
        for (const pip of publicIps) {
          const pipName = pip.name as string;
          const ipAddr = (pip.ipAddress as string) || "unassigned";
          const ipConfig = pip.ipConfiguration as
            | { id: string }
            | null
            | undefined;
          if (
            ipConfig?.id &&
            ipConfig.id.toLowerCase().includes("/networkinterfaces/")
          ) {
            continue;
          }
          const pipId = `pip_${sanitizeInstanceName(pipName)}`;
          lines.push(
            `  ${pipId}["${escapeLabel(pipName)}\\n${
              escapeLabel(ipAddr)
            }"]:::pip`,
          );
          if (ipConfig?.id?.toLowerCase().includes("/azurefirewalls/")) {
            const fwName = extractName(
              ipConfig.id.split("/azureFirewallIpConfigurations/")[0],
            );
            lines.push(
              `  ${pipId} --> fw_${sanitizeInstanceName(fwName)}`,
            );
          }
        }

        // Firewalls
        for (const fw of firewalls) {
          const fwName = fw.name as string;
          const fwId = `fw_${sanitizeInstanceName(fwName)}`;
          const tier = (fw.sku as { tier: string } | undefined)?.tier || "";
          lines.push(
            `  ${fwId}["Azure Firewall\\n${escapeLabel(tier)}"]:::firewall`,
          );
          const ipConfigs = (fw.ipConfigurations || []) as Array<
            Record<string, unknown>
          >;
          for (const ipConfig of ipConfigs) {
            const subnetRef = ipConfig.subnet as
              | { id: string }
              | null
              | undefined;
            if (subnetRef?.id) {
              const subnetNodeId = subnetToNode.get(
                subnetRef.id.toLowerCase(),
              );
              if (subnetNodeId) {
                lines.push(`  ${subnetNodeId} --> ${fwId}`);
              }
            }
          }
        }

        const mermaid = lines.join("\n");

        const resourceCounts: Record<string, number> = {
          vnets: vnets.length,
          vms: vms.length,
          nsgs: nsgs.length,
          routeTables: routeTables.length,
          publicIps: publicIps.length,
          natGateways: natGateways.length,
          firewalls: firewalls.length,
        };
        const totalSubnets = vnets.reduce(
          (sum, vnet) => sum + ((vnet.subnets as Array<unknown>) || []).length,
          0,
        );
        resourceCounts.subnets = totalSubnets;

        context.logger.info(
          "Generated topology for {rg}: {vnets} VNets, {subnets} subnets, {vms} VMs, {nsgs} NSGs, {firewalls} firewalls",
          {
            rg,
            vnets: vnets.length,
            subnets: totalSubnets,
            vms: vms.length,
            nsgs: nsgs.length,
            firewalls: firewalls.length,
          },
        );

        const data = {
          resourceGroup: rg,
          generatedAt: new Date().toISOString(),
          mermaid,
          resourceCounts,
        };

        const handle = await context.writeResource(
          "topology",
          sanitizeInstanceName(rg),
          data,
        );
        return { dataHandles: [handle] };
      },
    },

    costEstimate: {
      description:
        "Estimate monthly costs for VMs in a resource group using the Azure Retail Pricing API (public, no auth required).",
      arguments: z.object({
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);

        // Get VMs with details
        const vms = (await az(
          ["vm", "list", "--resource-group", rg, "--show-details"],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        const items: Array<{
          resourceType: string;
          name: string;
          sku: string;
          location: string;
          estimatedMonthly: number;
        }> = [];

        for (const vm of vms) {
          const vmName = vm.name as string;
          const vmSize = (
            vm.hardwareProfile as { vmSize: string } | undefined
          )?.vmSize || "";
          const location = vm.location as string;

          // Query Azure Retail Pricing API
          const filter =
            `armSkuName eq '${vmSize}' and armRegionName eq '${location}' and priceType eq 'Consumption' and serviceName eq 'Virtual Machines'`;
          const url = `https://prices.azure.com/api/retail/prices?$filter=${
            encodeURIComponent(filter)
          }`;

          try {
            const resp = await fetch(url);
            if (resp.ok) {
              const data = await resp.json();
              const priceItems = (data.Items || []) as Array<
                Record<string, unknown>
              >;
              // Find Linux pay-as-you-go price (most common baseline)
              const linuxPrice = priceItems.find(
                (p) =>
                  (p.productName as string || "").includes(
                    "Virtual Machines",
                  ) &&
                  !(p.productName as string || "").includes("Windows") &&
                  !(p.productName as string || "").includes("Spot") &&
                  !(p.meterName as string || "").includes("Low Priority") &&
                  (p.type as string) === "Consumption",
              );
              const hourlyRate = (linuxPrice?.retailPrice as number) || 0;
              const monthlyEstimate = hourlyRate * 730; // ~730 hours/month

              items.push({
                resourceType: "Microsoft.Compute/virtualMachines",
                name: vmName,
                sku: vmSize,
                location,
                estimatedMonthly: Math.round(monthlyEstimate * 100) / 100,
              });
            }
          } catch {
            // Pricing API unavailable — record zero
            items.push({
              resourceType: "Microsoft.Compute/virtualMachines",
              name: vmName,
              sku: vmSize,
              location,
              estimatedMonthly: 0,
            });
          }
        }

        // Storage accounts — flat estimate based on SKU
        const storageAccounts = (await az(
          ["storage", "account", "list", "--resource-group", rg],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        for (const acct of storageAccounts) {
          const sku = acct.sku as
            | { name: string }
            | undefined;
          items.push({
            resourceType: "Microsoft.Storage/storageAccounts",
            name: acct.name as string,
            sku: sku?.name || "unknown",
            location: acct.location as string,
            estimatedMonthly: 0, // Storage costs depend on usage, not predictable from config alone
          });
        }

        // SQL databases
        const sqlServers = (await az(
          ["sql", "server", "list", "--resource-group", rg],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        for (const server of sqlServers) {
          const dbs = (await az(
            [
              "sql",
              "db",
              "list",
              "--server",
              server.name as string,
              "--resource-group",
              rg,
            ],
            g.subscriptionId,
          )) as Array<Record<string, unknown>>;

          for (const db of dbs) {
            if ((db.name as string) === "master") continue;
            const sku = db.sku as
              | { name: string; tier: string }
              | undefined;
            items.push({
              resourceType: "Microsoft.Sql/servers/databases",
              name: `${server.name}/${db.name}`,
              sku: sku ? `${sku.tier} / ${sku.name}` : "unknown",
              location: db.location as string,
              estimatedMonthly: 0, // SQL pricing depends on DTU/vCore config
            });
          }
        }

        // Firewalls — known base cost
        const firewalls = (await az(
          ["network", "firewall", "list", "--resource-group", rg],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        for (const fw of firewalls) {
          const sku = fw.sku as
            | { tier: string }
            | undefined;
          // Azure Firewall Standard base: ~$912/month, Premium: ~$1095/month
          const baseCost = sku?.tier === "Premium" ? 1095 : 912;
          items.push({
            resourceType: "Microsoft.Network/azureFirewalls",
            name: fw.name as string,
            sku: sku?.tier || "Standard",
            location: fw.location as string,
            estimatedMonthly: baseCost,
          });
        }

        const totalMonthly = items.reduce(
          (sum, item) => sum + item.estimatedMonthly,
          0,
        );

        context.logger.info(
          "Cost estimate for {rg}: ${total}/month across {count} resources",
          {
            rg,
            total: Math.round(totalMonthly * 100) / 100,
            count: items.length,
          },
        );

        const data = {
          resourceGroup: rg,
          estimatedAt: new Date().toISOString(),
          currency: "USD",
          totalMonthly: Math.round(totalMonthly * 100) / 100,
          items,
        };

        const handle = await context.writeResource(
          "costEstimate",
          sanitizeInstanceName(rg),
          data,
        );
        return { dataHandles: [handle] };
      },
    },

    exportTemplate: {
      description:
        "Export an ARM template for all resources in a resource group.",
      arguments: z.object({
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);

        const template = await az(
          ["group", "export", "--name", rg, "--include-comments"],
          g.subscriptionId,
        );

        context.logger.info("Exported ARM template for {rg}", { rg });

        const data = {
          resourceGroup: rg,
          exportedAt: new Date().toISOString(),
          template: template as Record<string, unknown>,
        };

        const handle = await context.writeResource(
          "armTemplate",
          sanitizeInstanceName(rg),
          data,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
