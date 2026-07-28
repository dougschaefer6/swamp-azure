import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const RuleCollectionGroupSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    priority: z.number().optional(),
    ruleCollections: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const FirewallSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z
      .object({ name: z.string(), tier: z.string() })
      .passthrough()
      .optional(),
    firewallPolicy: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    ipConfigurations: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    threatIntelMode: z.string().optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const FirewallPolicySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    sku: z.object({ tier: z.string() }).passthrough().optional(),
    threatIntelMode: z.string().optional(),
    dnsSettings: z.record(z.string(), z.unknown()).optional(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-firewall` model — Azure Firewall instance,
 * policy, and rule-collection management, wrapping the `az network
 * firewall` CLI. Firewall instance methods (list, get, sync, create,
 * delete) cover the AzureFirewall resource itself with its SKU,
 * tier, IP configurations, threat-intel mode, and attached policy.
 * Policy methods (listPolicies, getPolicy, syncPolicy, createPolicy)
 * manage standalone FirewallPolicy objects. Rule-collection-group
 * CRUD (listRuleCollectionGroups, getRuleCollectionGroup,
 * createRuleCollectionGroup, deleteRuleCollectionGroup) organizes
 * priority-ordered collections inside a policy. Granular helpers
 * (addFilterCollection, addNatCollection, addRule, removeRule,
 * removeCollection) avoid the full PATCH-payload pattern that the
 * raw CLI forces, which matters for DNAT pinholes on the hub public
 * IP and other production network paths. Mutations are
 * traffic-affecting — coordinate with change windows.
 */
export const model = {
  type: "@dougschaefer/azure-firewall",
  version: "2026.07.28.3",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    firewall: {
      description: "Azure Firewall instance",
      schema: FirewallSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    policy: {
      description: "Azure Firewall policy",
      schema: FirewallPolicySchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    ruleCollectionGroup: {
      description: "Firewall policy rule collection group",
      schema: RuleCollectionGroupSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all Azure Firewalls in a resource group (or all in the subscription).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "firewall", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const firewalls = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} firewalls", {
          count: firewalls.length,
        });

        const handles = [];
        for (const fw of firewalls) {
          const handle = await context.writeResource(
            "firewall",
            sanitizeInstanceName(fw.name as string),
            fw,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single Azure Firewall.",
      arguments: z.object({
        name: z.string().describe("Firewall name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const fw = await az(
          [
            "network",
            "firewall",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "firewall",
          sanitizeInstanceName(args.name),
          fw,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of an Azure Firewall without making changes.",
      arguments: z.object({
        name: z.string().describe("Firewall name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const fw = await az(
          [
            "network",
            "firewall",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "firewall",
          sanitizeInstanceName(args.name),
          fw,
        );
        context.logger.info("Synced Azure Firewall {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    create: {
      description:
        "Create an Azure Firewall. Requires a VNet with an AzureFirewallSubnet.",
      arguments: z.object({
        name: z.string().describe("Firewall name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        vnetName: z.string().describe(
          "VNet name (must have AzureFirewallSubnet)",
        ),
        publicIpAddress: z
          .string()
          .describe("Public IP name or ID for the firewall"),
        skuTier: z
          .enum(["Basic", "Standard", "Premium"])
          .default("Standard")
          .describe("Firewall SKU tier"),
        firewallPolicy: z
          .string()
          .optional()
          .describe("Firewall policy name or ID to associate"),
        threatIntelMode: z
          .enum(["Alert", "Deny", "Off"])
          .optional()
          .describe("Threat intelligence mode"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "firewall",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--vnet-name",
          args.vnetName,
          "--public-ip",
          args.publicIpAddress,
          "--sku",
          "AZFW_VNet",
          "--tier",
          args.skuTier,
        ];

        if (args.firewallPolicy) {
          cmdArgs.push("--firewall-policy", args.firewallPolicy);
        }
        if (args.threatIntelMode) {
          cmdArgs.push("--threat-intel-mode", args.threatIntelMode);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created Azure Firewall {name} ({tier}) in {location}",
          { name: args.name, tier: args.skuTier, location: args.location },
        );

        const fw = await az(
          [
            "network",
            "firewall",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "firewall",
          sanitizeInstanceName(args.name),
          fw,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete an Azure Firewall.",
      arguments: z.object({
        name: z.string().describe("Firewall name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "firewall",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted Azure Firewall {name}", {
          name: args.name,
        });
        return { dataHandles: [] };
      },
    },

    // --- Firewall Policy operations ---

    listPolicies: {
      description: "List all firewall policies in a resource group.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "firewall", "policy", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const policies = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} firewall policies", {
          count: policies.length,
        });

        const handles = [];
        for (const policy of policies) {
          const handle = await context.writeResource(
            "policy",
            sanitizeInstanceName(policy.name as string),
            policy,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getPolicy: {
      description: "Get a single firewall policy.",
      arguments: z.object({
        name: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const policy = await az(
          [
            "network",
            "firewall",
            "policy",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "policy",
          sanitizeInstanceName(args.name),
          policy,
        );
        return { dataHandles: [handle] };
      },
    },

    syncPolicy: {
      description:
        "Refresh the stored state of a firewall policy without making changes.",
      arguments: z.object({
        name: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const policy = await az(
          [
            "network",
            "firewall",
            "policy",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "policy",
          sanitizeInstanceName(args.name),
          policy,
        );
        context.logger.info("Synced firewall policy {name}", {
          name: args.name,
        });
        return { dataHandles: [handle] };
      },
    },

    listRuleCollectionGroups: {
      description: "List all rule collection groups in a firewall policy.",
      arguments: z.object({
        policyName: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const groups = (await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "list",
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info(
          "Found {count} rule collection groups in policy {policy}",
          { count: groups.length, policy: args.policyName },
        );

        const handles = [];
        for (const group of groups) {
          const instanceName = `${args.policyName}--${group.name as string}`;
          const handle = await context.writeResource(
            "ruleCollectionGroup",
            sanitizeInstanceName(instanceName),
            group,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getRuleCollectionGroup: {
      description: "Get a single rule collection group from a firewall policy.",
      arguments: z.object({
        name: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const group = await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "show",
            "--name",
            args.name,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.policyName}--${args.name}`;
        const handle = await context.writeResource(
          "ruleCollectionGroup",
          sanitizeInstanceName(instanceName),
          group,
        );
        return { dataHandles: [handle] };
      },
    },

    createRuleCollectionGroup: {
      description: "Create a rule collection group in a firewall policy.",
      arguments: z.object({
        name: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        priority: z.number().describe(
          "Priority (100-65000, lower = higher priority)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "create",
            "--name",
            args.name,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
            "--priority",
            String(args.priority),
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Created rule collection group {name} in policy {policy} (priority {priority})",
          { name: args.name, policy: args.policyName, priority: args.priority },
        );

        const group = await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "show",
            "--name",
            args.name,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.policyName}--${args.name}`;
        const handle = await context.writeResource(
          "ruleCollectionGroup",
          sanitizeInstanceName(instanceName),
          group,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteRuleCollectionGroup: {
      description: "Delete a rule collection group from a firewall policy.",
      arguments: z.object({
        name: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "delete",
            "--name",
            args.name,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Deleted rule collection group {name} from policy {policy}",
          { name: args.name, policy: args.policyName },
        );
        return { dataHandles: [] };
      },
    },

    addFilterCollection: {
      description:
        "Add a filter rule collection (network or application rules) to an existing rule collection group.",
      arguments: z.object({
        rcgName: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        collectionName: z.string().describe("New rule collection name"),
        collectionPriority: z.number().describe(
          "Collection priority (100-65000)",
        ),
        actionType: z.enum(["Allow", "Deny"]).describe("Filter action"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "collection",
            "add-filter-collection",
            "--rcg-name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
            "--name",
            args.collectionName,
            "--collection-priority",
            String(args.collectionPriority),
            "--action",
            args.actionType,
            "--rule-type",
            "NetworkRule",
            "--rule-name",
            "placeholder",
            "--source-addresses",
            "*",
            "--dest-addr",
            "*",
            "--destination-ports",
            "1",
            "--ip-protocols",
            "Any",
          ],
          g.subscriptionId,
        );

        // Remove the placeholder rule
        await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "collection",
            "rule",
            "remove",
            "--rcg-name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
            "--collection-name",
            args.collectionName,
            "--name",
            "placeholder",
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Created filter collection {name} in {rcg} ({action}, priority {priority})",
          {
            name: args.collectionName,
            rcg: args.rcgName,
            action: args.actionType,
            priority: args.collectionPriority,
          },
        );

        const group = await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "show",
            "--name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.policyName}--${args.rcgName}`;
        const handle = await context.writeResource(
          "ruleCollectionGroup",
          sanitizeInstanceName(instanceName),
          group,
        );
        return { dataHandles: [handle] };
      },
    },

    addNatCollection: {
      description:
        "Add a NAT (DNAT) rule collection to an existing rule collection group.",
      arguments: z.object({
        rcgName: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        collectionName: z.string().describe("New NAT collection name"),
        collectionPriority: z.number().describe(
          "Collection priority (100-65000)",
        ),
        ruleName: z.string().describe("First DNAT rule name"),
        sourceAddresses: z.array(z.string()).describe(
          "Source IP(s) or * for any",
        ),
        destinationAddresses: z.array(z.string()).describe(
          "Firewall public IP(s) to match",
        ),
        destinationPorts: z.array(z.string()).describe(
          "External port(s) to match",
        ),
        translatedAddress: z.string().describe("Internal IP to forward to"),
        translatedPort: z.string().describe("Internal port to forward to"),
        ipProtocols: z.array(z.enum(["TCP", "UDP"])).default(["TCP"]).describe(
          "Protocols",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "collection",
            "add-nat-collection",
            "--rcg-name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
            "--name",
            args.collectionName,
            "--collection-priority",
            String(args.collectionPriority),
            "--action",
            "DNAT",
            "--rule-name",
            args.ruleName,
            "--source-addresses",
            ...args.sourceAddresses,
            "--dest-addr",
            ...args.destinationAddresses,
            "--destination-ports",
            ...args.destinationPorts,
            "--translated-address",
            args.translatedAddress,
            "--translated-port",
            args.translatedPort,
            "--ip-protocols",
            ...args.ipProtocols,
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Created NAT collection {name} in {rcg} with DNAT rule {rule}",
          { name: args.collectionName, rcg: args.rcgName, rule: args.ruleName },
        );

        const group = await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "show",
            "--name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.policyName}--${args.rcgName}`;
        const handle = await context.writeResource(
          "ruleCollectionGroup",
          sanitizeInstanceName(instanceName),
          group,
        );
        return { dataHandles: [handle] };
      },
    },

    addRule: {
      description:
        "Add a rule to an existing rule collection. Supports NatRule, NetworkRule, and ApplicationRule types.",
      arguments: z.object({
        rcgName: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        collectionName: z.string().describe("Existing rule collection name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        ruleType: z.enum(["NatRule", "NetworkRule", "ApplicationRule"])
          .describe("Rule type"),
        ruleName: z.string().describe("Rule name"),
        sourceAddresses: z.array(z.string()).describe(
          "Source IP(s), CIDR(s), or * for any",
        ),
        destinationAddresses: z.array(z.string()).optional().describe(
          "Destination IP(s) or CIDR(s)",
        ),
        destinationPorts: z.array(z.string()).optional().describe(
          "Destination port(s)",
        ),
        ipProtocols: z.array(z.string()).optional().describe(
          "Protocols: TCP, UDP, Any, ICMP",
        ),
        translatedAddress: z.string().optional().describe(
          "DNAT translated internal IP (NatRule only)",
        ),
        translatedPort: z.string().optional().describe(
          "DNAT translated internal port (NatRule only)",
        ),
        targetFqdns: z.array(z.string()).optional().describe(
          "Target FQDNs (ApplicationRule only)",
        ),
        protocols: z.array(z.string()).optional().describe(
          "App protocols, e.g. Http=80 Https=443 (ApplicationRule only)",
        ),
        description: z.string().optional().describe("Rule description"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "firewall",
          "policy",
          "rule-collection-group",
          "collection",
          "rule",
          "add",
          "--rcg-name",
          args.rcgName,
          "--policy-name",
          args.policyName,
          "--resource-group",
          rg,
          "--collection-name",
          args.collectionName,
          "--rule-type",
          args.ruleType,
          "--name",
          args.ruleName,
          "--source-addresses",
          ...args.sourceAddresses,
        ];

        if (args.destinationAddresses) {
          cmdArgs.push("--dest-addr", ...args.destinationAddresses);
        }
        if (args.destinationPorts) {
          cmdArgs.push("--destination-ports", ...args.destinationPorts);
        }
        if (args.ipProtocols) {
          cmdArgs.push("--ip-protocols", ...args.ipProtocols);
        }
        if (args.translatedAddress) {
          cmdArgs.push("--translated-address", args.translatedAddress);
        }
        if (args.translatedPort) {
          cmdArgs.push("--translated-port", args.translatedPort);
        }
        if (args.targetFqdns) {
          cmdArgs.push("--target-fqdns", ...args.targetFqdns);
        }
        if (args.protocols) {
          cmdArgs.push("--protocols", ...args.protocols);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Added {ruleType} {ruleName} to collection {collection} in {rcg}",
          {
            ruleType: args.ruleType,
            ruleName: args.ruleName,
            collection: args.collectionName,
            rcg: args.rcgName,
          },
        );

        const group = await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "show",
            "--name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.policyName}--${args.rcgName}`;
        const handle = await context.writeResource(
          "ruleCollectionGroup",
          sanitizeInstanceName(instanceName),
          group,
        );
        return { dataHandles: [handle] };
      },
    },

    removeRule: {
      description: "Remove a rule from a rule collection.",
      arguments: z.object({
        rcgName: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        collectionName: z.string().describe("Rule collection name"),
        ruleName: z.string().describe("Rule name to remove"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "collection",
            "rule",
            "remove",
            "--rcg-name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
            "--collection-name",
            args.collectionName,
            "--name",
            args.ruleName,
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Removed rule {ruleName} from collection {collection} in {rcg}",
          {
            ruleName: args.ruleName,
            collection: args.collectionName,
            rcg: args.rcgName,
          },
        );

        const group = await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "show",
            "--name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.policyName}--${args.rcgName}`;
        const handle = await context.writeResource(
          "ruleCollectionGroup",
          sanitizeInstanceName(instanceName),
          group,
        );
        return { dataHandles: [handle] };
      },
    },

    removeCollection: {
      description:
        "Remove an entire rule collection from a rule collection group.",
      arguments: z.object({
        rcgName: z.string().describe("Rule collection group name"),
        policyName: z.string().describe("Firewall policy name"),
        collectionName: z.string().describe("Rule collection name to remove"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "collection",
            "remove",
            "--rcg-name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
            "--name",
            args.collectionName,
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Removed collection {collection} from {rcg}",
          { collection: args.collectionName, rcg: args.rcgName },
        );

        const group = await az(
          [
            "network",
            "firewall",
            "policy",
            "rule-collection-group",
            "show",
            "--name",
            args.rcgName,
            "--policy-name",
            args.policyName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.policyName}--${args.rcgName}`;
        const handle = await context.writeResource(
          "ruleCollectionGroup",
          sanitizeInstanceName(instanceName),
          group,
        );
        return { dataHandles: [handle] };
      },
    },

    createPolicy: {
      description: "Create a firewall policy.",
      arguments: z.object({
        name: z.string().describe("Policy name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region"),
        skuTier: z
          .enum(["Basic", "Standard", "Premium"])
          .default("Standard")
          .describe("Policy SKU tier"),
        threatIntelMode: z
          .enum(["Alert", "Deny", "Off"])
          .optional()
          .describe("Threat intelligence mode"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "firewall",
          "policy",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--sku",
          args.skuTier,
        ];

        if (args.threatIntelMode) {
          cmdArgs.push("--threat-intel-mode", args.threatIntelMode);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created firewall policy {name}", {
          name: args.name,
        });

        const policy = await az(
          [
            "network",
            "firewall",
            "policy",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "policy",
          sanitizeInstanceName(args.name),
          policy,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
