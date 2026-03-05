import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const SecurityRuleSchema = z
  .object({
    name: z.string(),
    priority: z.number(),
    direction: z.enum(["Inbound", "Outbound"]),
    access: z.enum(["Allow", "Deny"]),
    protocol: z.string(),
    sourceAddressPrefix: z.string().optional(),
    sourceAddressPrefixes: z.array(z.string()).optional(),
    sourcePortRange: z.string().optional(),
    sourcePortRanges: z.array(z.string()).optional(),
    destinationAddressPrefix: z.string().optional(),
    destinationAddressPrefixes: z.array(z.string()).optional(),
    destinationPortRange: z.string().optional(),
    destinationPortRanges: z.array(z.string()).optional(),
    description: z.string().optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const NsgSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    securityRules: z.array(SecurityRuleSchema).optional(),
    defaultSecurityRules: z.array(SecurityRuleSchema).optional(),
    networkInterfaces: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    subnets: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-nsg",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    nsg: {
      description: "Azure network security group",
      schema: NsgSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    rule: {
      description: "Individual security rule within an NSG",
      schema: SecurityRuleSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all NSGs in a resource group (or all in the subscription if no resource group specified).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "nsg", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const nsgs = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} NSGs", { count: nsgs.length });

        const handles = [];
        for (const nsg of nsgs) {
          const handle = await context.writeResource(
            "nsg",
            sanitizeInstanceName(nsg.name as string),
            nsg,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single NSG with all its rules.",
      arguments: z.object({
        name: z.string().describe("NSG name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const nsg = await az(
          [
            "network",
            "nsg",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "nsg",
          sanitizeInstanceName(args.name),
          nsg,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description: "Create a network security group.",
      arguments: z.object({
        name: z.string().describe("NSG name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
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
          "nsg",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
        ];

        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created NSG {name} in {location}", {
          name: args.name,
          location: args.location,
        });

        const nsg = await az(
          [
            "network",
            "nsg",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "nsg",
          sanitizeInstanceName(args.name),
          nsg,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a network security group.",
      arguments: z.object({
        name: z.string().describe("NSG name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "nsg",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted NSG {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    // --- Rule operations ---

    listRules: {
      description: "List all custom rules in an NSG.",
      arguments: z.object({
        nsgName: z.string().describe("NSG name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const rules = (await az(
          [
            "network",
            "nsg",
            "rule",
            "list",
            "--nsg-name",
            args.nsgName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} rules in NSG {nsg}", {
          count: rules.length,
          nsg: args.nsgName,
        });

        const handles = [];
        for (const rule of rules) {
          const instanceName = `${args.nsgName}--${rule.name as string}`;
          const handle = await context.writeResource(
            "rule",
            sanitizeInstanceName(instanceName),
            rule,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getRule: {
      description: "Get a single NSG rule.",
      arguments: z.object({
        nsgName: z.string().describe("NSG name"),
        ruleName: z.string().describe("Rule name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const rule = await az(
          [
            "network",
            "nsg",
            "rule",
            "show",
            "--nsg-name",
            args.nsgName,
            "--name",
            args.ruleName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const instanceName = `${args.nsgName}--${args.ruleName}`;
        const handle = await context.writeResource(
          "rule",
          sanitizeInstanceName(instanceName),
          rule,
        );
        return { dataHandles: [handle] };
      },
    },

    createRule: {
      description: "Create a security rule in an NSG.",
      arguments: z.object({
        nsgName: z.string().describe("NSG name"),
        ruleName: z.string().describe("Rule name"),
        priority: z
          .number()
          .describe("Priority (100-4096, lower = higher priority)"),
        direction: z
          .enum(["Inbound", "Outbound"])
          .describe("Traffic direction"),
        access: z.enum(["Allow", "Deny"]).describe("Allow or deny traffic"),
        protocol: z
          .string()
          .describe("Protocol: Tcp, Udp, Icmp, Esp, Ah, or * for any"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        sourceAddressPrefixes: z
          .array(z.string())
          .optional()
          .describe(
            "Source CIDR(s), e.g. ['10.0.0.0/24', '192.168.1.0/24']. Use '*' for any.",
          ),
        sourcePortRanges: z
          .array(z.string())
          .optional()
          .describe(
            "Source port(s), e.g. ['443', '8080-8090']. Use '*' for any.",
          ),
        destinationAddressPrefixes: z
          .array(z.string())
          .optional()
          .describe("Destination CIDR(s). Use '*' for any."),
        destinationPortRanges: z
          .array(z.string())
          .optional()
          .describe(
            "Destination port(s), e.g. ['443', '80']. Use '*' for any.",
          ),
        description: z
          .string()
          .optional()
          .describe("Rule description (max 140 chars)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "nsg",
          "rule",
          "create",
          "--nsg-name",
          args.nsgName,
          "--name",
          args.ruleName,
          "--priority",
          args.priority.toString(),
          "--direction",
          args.direction,
          "--access",
          args.access,
          "--protocol",
          args.protocol,
          "--resource-group",
          rg,
        ];

        if (args.sourceAddressPrefixes) {
          cmdArgs.push(
            "--source-address-prefixes",
            ...args.sourceAddressPrefixes,
          );
        }
        if (args.sourcePortRanges) {
          cmdArgs.push("--source-port-ranges", ...args.sourcePortRanges);
        }
        if (args.destinationAddressPrefixes) {
          cmdArgs.push(
            "--destination-address-prefixes",
            ...args.destinationAddressPrefixes,
          );
        }
        if (args.destinationPortRanges) {
          cmdArgs.push(
            "--destination-port-ranges",
            ...args.destinationPortRanges,
          );
        }
        if (args.description) {
          cmdArgs.push("--description", args.description);
        }

        const rule = await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created rule {rule} in NSG {nsg} (priority {priority}, {direction} {access})",
          {
            rule: args.ruleName,
            nsg: args.nsgName,
            priority: args.priority,
            direction: args.direction,
            access: args.access,
          },
        );

        const instanceName = `${args.nsgName}--${args.ruleName}`;
        const handle = await context.writeResource(
          "rule",
          sanitizeInstanceName(instanceName),
          rule,
        );
        return { dataHandles: [handle] };
      },
    },

    updateRule: {
      description:
        "Update an existing security rule. Only specified fields are changed.",
      arguments: z.object({
        nsgName: z.string().describe("NSG name"),
        ruleName: z.string().describe("Rule name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        priority: z.number().optional().describe("New priority"),
        access: z.enum(["Allow", "Deny"]).optional().describe("New access"),
        protocol: z.string().optional().describe("New protocol"),
        sourceAddressPrefixes: z
          .array(z.string())
          .optional()
          .describe("New source CIDRs"),
        sourcePortRanges: z
          .array(z.string())
          .optional()
          .describe("New source ports"),
        destinationAddressPrefixes: z
          .array(z.string())
          .optional()
          .describe("New destination CIDRs"),
        destinationPortRanges: z
          .array(z.string())
          .optional()
          .describe("New destination ports"),
        description: z.string().optional().describe("New description"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "nsg",
          "rule",
          "update",
          "--nsg-name",
          args.nsgName,
          "--name",
          args.ruleName,
          "--resource-group",
          rg,
        ];

        if (args.priority !== undefined) {
          cmdArgs.push("--priority", args.priority.toString());
        }
        if (args.access) {
          cmdArgs.push("--access", args.access);
        }
        if (args.protocol) {
          cmdArgs.push("--protocol", args.protocol);
        }
        if (args.sourceAddressPrefixes) {
          cmdArgs.push(
            "--source-address-prefixes",
            ...args.sourceAddressPrefixes,
          );
        }
        if (args.sourcePortRanges) {
          cmdArgs.push("--source-port-ranges", ...args.sourcePortRanges);
        }
        if (args.destinationAddressPrefixes) {
          cmdArgs.push(
            "--destination-address-prefixes",
            ...args.destinationAddressPrefixes,
          );
        }
        if (args.destinationPortRanges) {
          cmdArgs.push(
            "--destination-port-ranges",
            ...args.destinationPortRanges,
          );
        }
        if (args.description) {
          cmdArgs.push("--description", args.description);
        }

        const rule = await az(cmdArgs, g.subscriptionId);

        context.logger.info("Updated rule {rule} in NSG {nsg}", {
          rule: args.ruleName,
          nsg: args.nsgName,
        });

        const instanceName = `${args.nsgName}--${args.ruleName}`;
        const handle = await context.writeResource(
          "rule",
          sanitizeInstanceName(instanceName),
          rule,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteRule: {
      description: "Delete a security rule from an NSG.",
      arguments: z.object({
        nsgName: z.string().describe("NSG name"),
        ruleName: z.string().describe("Rule name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "nsg",
            "rule",
            "delete",
            "--nsg-name",
            args.nsgName,
            "--name",
            args.ruleName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted rule {rule} from NSG {nsg}", {
          rule: args.ruleName,
          nsg: args.nsgName,
        });

        return { dataHandles: [] };
      },
    },
  },
};
