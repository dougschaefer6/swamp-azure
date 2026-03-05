import { z } from "npm:zod@4";
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

function extractName(resourceId: string): string {
  const parts = resourceId.split("/");
  return parts[parts.length - 1] || resourceId;
}

function escapeLabel(s: string): string {
  return s.replace(/"/g, "#quot;");
}

export const model = {
  type: "@dougschaefer/azure-topology",
  version: "2026.03.05.1",
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
  },
  methods: {
    generate: {
      description:
        "Generate a Mermaid topology diagram for all resources in a resource group. Queries Azure directly for current state.",
      arguments: z.object({
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);

        // Fetch all resource types in parallel
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
        lines.push("graph TB");
        lines.push(`  classDef vnet fill:#0078D4,color:#fff,stroke:#005A9E`);
        lines.push(`  classDef subnet fill:#50E6FF,color:#000,stroke:#0078D4`);
        lines.push(`  classDef vm fill:#7FBA00,color:#fff,stroke:#5E8B00`);
        lines.push(`  classDef nsg fill:#FF8C00,color:#fff,stroke:#CC7000`);
        lines.push(
          `  classDef firewall fill:#E81123,color:#fff,stroke:#B80E1C`,
        );
        lines.push(`  classDef pip fill:#B4A0FF,color:#000,stroke:#7B6DB0`);
        lines.push(`  classDef nat fill:#00BCF2,color:#000,stroke:#0099CC`);
        lines.push(`  classDef rt fill:#FFB900,color:#000,stroke:#CC9400`);
        lines.push("");

        // Build a map of subnet IDs to their VNet for linking
        const subnetToVnet = new Map<string, string>();
        const nsgSubnets = new Map<string, string[]>();
        const rtSubnets = new Map<string, string[]>();

        // VNets and subnets
        for (const vnet of vnets) {
          const vnetName = vnet.name as string;
          const vnetId = `vnet_${sanitizeInstanceName(vnetName)}`;
          const addressSpace = vnet.addressSpace as
            | { addressPrefixes: string[] }
            | undefined;
          const prefixes = addressSpace?.addressPrefixes?.join(", ") || "";

          lines.push(
            `  subgraph ${vnetId}["${escapeLabel(vnetName)}<br/>${
              escapeLabel(prefixes)
            }"]`,
          );

          const subnets = (vnet.subnets || []) as Array<
            Record<string, unknown>
          >;
          for (const subnet of subnets) {
            const subnetName = subnet.name as string;
            const subnetNodeId = `subnet_${sanitizeInstanceName(vnetName)}_${
              sanitizeInstanceName(subnetName)
            }`;
            const subnetPrefix = (subnet.addressPrefix as string) ||
              ((subnet.addressPrefixes as string[]) || [])[0] ||
              "";

            lines.push(
              `    ${subnetNodeId}["${escapeLabel(subnetName)}<br/>${
                escapeLabel(subnetPrefix)
              }"]:::subnet`,
            );

            if (subnet.id) {
              subnetToVnet.set(
                (subnet.id as string).toLowerCase(),
                subnetNodeId,
              );
            }

            // Track NSG associations
            const nsgRef = subnet.networkSecurityGroup as
              | { id: string }
              | null
              | undefined;
            if (nsgRef?.id) {
              const nsgName = extractName(nsgRef.id);
              if (!nsgSubnets.has(nsgName)) nsgSubnets.set(nsgName, []);
              nsgSubnets.get(nsgName)!.push(subnetNodeId);
            }

            // Track route table associations
            const rtRef = subnet.routeTable as
              | { id: string }
              | null
              | undefined;
            if (rtRef?.id) {
              const rtName = extractName(rtRef.id);
              if (!rtSubnets.has(rtName)) rtSubnets.set(rtName, []);
              rtSubnets.get(rtName)!.push(subnetNodeId);
            }
          }

          lines.push("  end");
          lines.push(`  class ${vnetId} vnet`);
          lines.push("");
        }

        // VMs — connect to their subnets
        for (const vm of vms) {
          const vmName = vm.name as string;
          const vmId = `vm_${sanitizeInstanceName(vmName)}`;
          const vmSize = (
            vm.hardwareProfile as { vmSize: string } | undefined
          )?.vmSize || "";
          const powerState = (vm.powerState as string) || "";

          lines.push(
            `  ${vmId}["💻 ${escapeLabel(vmName)}<br/>${
              escapeLabel(vmSize)
            }<br/>${escapeLabel(powerState)}"]:::vm`,
          );

          // Link VM to subnet via NIC
          const networkProfile = vm.networkProfile as
            | {
              networkInterfaces: Array<{ id: string }>;
            }
            | undefined;
          const nics = networkProfile?.networkInterfaces || [];
          for (const _nic of nics) {
            // Try to find subnet from the NIC's IP config
            const privateIps = (vm.privateIps as string) || "";
            // Connect to first matching subnet by checking all subnets
            for (const [_subnetId, subnetNodeId] of subnetToVnet) {
              // Match VM's private IP against subnet — simplified: connect to first subnet in same VNet
              if (privateIps) {
                lines.push(`  ${subnetNodeId} --> ${vmId}`);
                break;
              }
            }
          }

          // Public IP association
          const publicIpAddr = (vm.publicIps as string) || "";
          if (publicIpAddr) {
            const pipId = `pip_vm_${sanitizeInstanceName(vmName)}`;
            lines.push(
              `  ${pipId}["🌐 ${escapeLabel(publicIpAddr)}"]:::pip`,
            );
            lines.push(`  ${pipId} --> ${vmId}`);
          }
        }

        lines.push("");

        // NSGs — connect to associated subnets
        for (const nsg of nsgs) {
          const nsgName = nsg.name as string;
          const nsgId = `nsg_${sanitizeInstanceName(nsgName)}`;
          const ruleCount = (
            (nsg.securityRules as Array<unknown>) || []
          ).length;

          lines.push(
            `  ${nsgId}["🛡️ ${
              escapeLabel(nsgName)
            }<br/>${ruleCount} rules"]:::nsg`,
          );

          const associated = nsgSubnets.get(nsgName) || [];
          for (const subnetNodeId of associated) {
            lines.push(`  ${nsgId} -.-> ${subnetNodeId}`);
          }
        }

        // Route tables — connect to associated subnets
        for (const rt of routeTables) {
          const rtName = rt.name as string;
          const rtId = `rt_${sanitizeInstanceName(rtName)}`;
          const routeCount = (
            (rt.routes as Array<unknown>) || []
          ).length;

          lines.push(
            `  ${rtId}["🔀 ${
              escapeLabel(rtName)
            }<br/>${routeCount} routes"]:::rt`,
          );

          const associated = rtSubnets.get(rtName) || [];
          for (const subnetNodeId of associated) {
            lines.push(`  ${rtId} -.-> ${subnetNodeId}`);
          }
        }

        // NAT gateways — connect to subnets
        for (const gw of natGateways) {
          const gwName = gw.name as string;
          const gwId = `nat_${sanitizeInstanceName(gwName)}`;

          lines.push(
            `  ${gwId}["🔄 NAT: ${escapeLabel(gwName)}"]:::nat`,
          );

          const gwSubnets = (gw.subnets || []) as Array<{ id: string }>;
          for (const sub of gwSubnets) {
            const subnetNodeId = subnetToVnet.get(sub.id.toLowerCase());
            if (subnetNodeId) {
              lines.push(`  ${subnetNodeId} --> ${gwId}`);
            }
          }
        }

        // Standalone public IPs (not attached to VMs)
        for (const pip of publicIps) {
          const pipName = pip.name as string;
          const ipAddr = (pip.ipAddress as string) || "unassigned";
          const ipConfig = pip.ipConfiguration as
            | { id: string }
            | null
            | undefined;

          // Skip if this public IP is already shown via a VM
          if (
            ipConfig?.id &&
            (ipConfig.id.toLowerCase().includes("/networkinterfaces/"))
          ) {
            continue;
          }

          const pipId = `pip_${sanitizeInstanceName(pipName)}`;
          lines.push(
            `  ${pipId}["🌐 ${escapeLabel(pipName)}<br/>${
              escapeLabel(ipAddr)
            }"]:::pip`,
          );

          // If attached to a firewall or gateway, connect it
          if (ipConfig?.id) {
            if (ipConfig.id.toLowerCase().includes("/azurefirewalls/")) {
              const fwName = extractName(
                ipConfig.id.split("/azureFirewallIpConfigurations/")[0],
              );
              lines.push(
                `  ${pipId} --> fw_${sanitizeInstanceName(fwName)}`,
              );
            }
          }
        }

        // Firewalls
        for (const fw of firewalls) {
          const fwName = fw.name as string;
          const fwId = `fw_${sanitizeInstanceName(fwName)}`;
          const tier = (fw.sku as { tier: string } | undefined)?.tier || "";

          lines.push(
            `  ${fwId}["🔥 ${escapeLabel(fwName)}<br/>${
              escapeLabel(tier)
            }"]:::firewall`,
          );

          // Connect firewall to its subnet (AzureFirewallSubnet)
          const ipConfigs = (fw.ipConfigurations || []) as Array<
            Record<string, unknown>
          >;
          for (const ipConfig of ipConfigs) {
            const subnetRef = ipConfig.subnet as
              | { id: string }
              | null
              | undefined;
            if (subnetRef?.id) {
              const subnetNodeId = subnetToVnet.get(
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

        const totalSubnets = vnets.reduce((sum, vnet) => {
          return (
            sum + ((vnet.subnets as Array<unknown>) || []).length
          );
        }, 0);
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
