import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const FirewallRuleSchema = z
  .object({
    name: z.string(),
    priority: z.number().optional(),
    action: z
      .object({ type: z.string() })
      .passthrough()
      .optional(),
    rules: z.array(z.record(z.string(), z.unknown())).optional(),
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

export const model = {
  type: "@dougschaefer/azure-firewall",
  version: "2026.03.05.1",
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
    ruleCollection: {
      description: "Firewall network or application rule collection",
      schema: FirewallRuleSchema,
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
