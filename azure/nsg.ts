import { z } from "npm:zod@4.3.6";
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

const RuleSetResultSchema = z
  .object({
    nsgName: z.string(),
    resourceGroup: z.string(),
    dryRun: z.boolean(),
    pruneUndeclared: z.boolean(),
    toCreate: z.array(z.string()),
    toUpdate: z.array(z.string()),
    unchanged: z.array(z.string()),
    undeclared: z.array(z.record(z.string(), z.unknown())),
    applied: z.array(z.string()),
    failed: z.array(z.object({ rule: z.string(), error: z.string() })),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-nsg` model — Network Security Group and
 * security-rule management, wrapping the `az network nsg` CLI. NSG-
 * level methods (list, get, sync, create, delete) cover the NSG
 * resource itself with its security-rule and default-security-rule
 * collections plus the NICs and subnets it's attached to. Rule
 * methods (listRules, getRule, createRule, updateRule, deleteRule)
 * operate on the individual security rules including priority,
 * direction, access (Allow/Deny), protocol, and source/destination
 * address-and-port matchers with both single-value and array forms.
 * NSG changes affect live east-west and north-south traffic
 * immediately — pair with change windows and validation against the
 * flow-log inventory.
 */
export const model = {
  type: "@dougschaefer/azure-nsg",
  version: "2026.07.28.4",
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
    ruleSetResult: {
      description:
        "Outcome of one rule-set convergence — the plan (create/update/unchanged/undeclared) and what was applied",
      schema: RuleSetResultSchema,
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

    sync: {
      description:
        "Refresh the stored state of an NSG and its rules without making changes.",
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
        context.logger.info("Synced NSG {name}", { name: args.name });
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
            "--yes",
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

    applyRuleSet: {
      description:
        "Converge an NSG onto a declared set of rules in ONE execution — creates what is missing, updates what differs, and reports what is present but undeclared. Plans first and only acts when dryRun is false, so the diff can be reviewed before anything changes.",
      arguments: z.object({
        nsgName: z.string().describe("NSG name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        rules: z
          .array(
            z.object({
              name: z.string(),
              priority: z.number(),
              direction: z.enum(["Inbound", "Outbound"]).default("Inbound"),
              access: z.enum(["Allow", "Deny"]).default("Allow"),
              protocol: z.string().default("*"),
              sourceAddressPrefixes: z.array(z.string()).default(["*"]),
              destinationPortRanges: z.array(z.string()).default(["*"]),
              destinationAddressPrefixes: z.array(z.string()).default(["*"]),
              sourcePortRanges: z.array(z.string()).default(["*"]),
              description: z.string().optional(),
            }),
          )
          .min(1)
          .describe("The declared rule set — the intended state of this NSG"),
        pruneUndeclared: z
          .boolean()
          .default(false)
          .describe(
            "Delete rules that are present but not declared. Off by default: an access path the declaration missed disappears the moment this is on.",
          ),
        dryRun: z
          .boolean()
          .default(true)
          .describe(
            "Plan only, change nothing. Defaults TRUE because this method rewrites a firewall.",
          ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);

        const existing = (await az(
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

        const byName = new Map<string, Record<string, unknown>>();
        for (const r of existing) {
          byName.set(String(r.name || "").toLowerCase(), r);
        }

        const toCreate = [], toUpdate = [], unchanged = [], undeclared = [];
        const declaredNames = new Set(
          args.rules.map((r) => r.name.toLowerCase()),
        );

        for (const want of args.rules) {
          const have = byName.get(want.name.toLowerCase());
          if (!have) {
            toCreate.push(want);
          } else if (ruleDiffers(want, have)) {
            toUpdate.push(want);
          } else {
            unchanged.push(want.name);
          }
        }
        for (const r of existing) {
          const name = String(r.name || "");
          if (!declaredNames.has(name.toLowerCase())) {
            undeclared.push({
              name,
              priority: r.priority,
              direction: r.direction,
              access: r.access,
            });
          }
        }

        context.logger.info(
          "{nsg}: {create} to create, {update} to update, {same} unchanged, {extra} undeclared{mode}",
          {
            nsg: args.nsgName,
            create: toCreate.length,
            update: toUpdate.length,
            same: unchanged.length,
            extra: undeclared.length,
            mode: args.dryRun ? " (DRY RUN — nothing applied)" : "",
          },
        );

        const applied: string[] = [];
        const failed: Array<{ rule: string; error: string }> = [];

        if (!args.dryRun) {
          // Creates run BEFORE updates and deletes. A declared Deny that does not
          // exist yet is the whole point of the convergence, and applying it first
          // means an interrupted run leaves the NSG more closed, never more open.
          for (const want of toCreate) {
            try {
              await az(
                ruleArgs("create", args.nsgName, rg, want),
                g.subscriptionId,
              );
              applied.push(`created ${want.name}`);
              context.logger.info("Created {rule} on {nsg}", {
                rule: want.name,
                nsg: args.nsgName,
              });
            } catch (err) {
              failed.push({ rule: want.name, error: String(err) });
            }
          }
          for (const want of toUpdate) {
            try {
              await az(
                ruleArgs("update", args.nsgName, rg, want),
                g.subscriptionId,
              );
              applied.push(`updated ${want.name}`);
              context.logger.info("Updated {rule} on {nsg}", {
                rule: want.name,
                nsg: args.nsgName,
              });
            } catch (err) {
              failed.push({ rule: want.name, error: String(err) });
            }
          }
          if (args.pruneUndeclared) {
            for (const extra of undeclared) {
              try {
                await az(
                  [
                    "network",
                    "nsg",
                    "rule",
                    "delete",
                    "--nsg-name",
                    args.nsgName,
                    "--name",
                    extra.name,
                    "--resource-group",
                    rg,
                    "--yes",
                  ],
                  g.subscriptionId,
                );
                applied.push(`deleted ${extra.name}`);
                context.logger.info(
                  "Deleted undeclared rule {rule} from {nsg}",
                  {
                    rule: extra.name,
                    nsg: args.nsgName,
                  },
                );
              } catch (err) {
                failed.push({ rule: extra.name, error: String(err) });
              }
            }
          }
        }

        const result = {
          nsgName: args.nsgName,
          resourceGroup: rg,
          dryRun: args.dryRun,
          pruneUndeclared: args.pruneUndeclared,
          toCreate: toCreate.map((r) => r.name),
          toUpdate: toUpdate.map((r) => r.name),
          unchanged,
          undeclared,
          applied,
          failed,
        };
        const handle = await context.writeResource(
          "ruleSetResult",
          sanitizeInstanceName(`${args.nsgName}--ruleset`),
          result,
        );

        // Written before raising, so a partially applied rule set is inspectable
        // rather than lost with the error.
        if (failed.length > 0) {
          throw new Error(
            `Rule set convergence failed for ${failed.length} rule(s) on ${args.nsgName}: ${
              failed.map((f) => f.rule).join(", ")
            }`,
          );
        }

        return { dataHandles: [handle] };
      },
    },
  },
};

/** Normalise Azure's single-or-list rule fields to a comparable sorted list. */
function normList(single: unknown, plural: unknown): string[] {
  if (Array.isArray(plural) && plural.length) {
    return plural.map((x) => String(x)).sort();
  }
  if (single !== undefined && single !== null && String(single) !== "") {
    return [String(single)];
  }
  return [];
}

/**
 * Decide whether a live rule already matches its declaration. Azure returns
 * source and port fields as either a scalar or a list depending on how the rule
 * was written, and echoes protocol back with inconsistent casing (`TCP` for
 * rules created through the portal, `Tcp` through the CLI), so both sides are
 * normalised before comparing. Without that, every run would report drift on
 * rules that are in fact identical and rewrite them forever.
 */
function ruleDiffers(want, have): boolean {
  if (Number(have.priority) !== Number(want.priority)) return true;
  if (String(have.direction) !== want.direction) return true;
  if (String(have.access) !== want.access) return true;
  if (
    String(have.protocol).toLowerCase() !== String(want.protocol).toLowerCase()
  ) return true;

  const pairs: Array<[string[], string[]]> = [
    [
      normList(have.sourceAddressPrefix, have.sourceAddressPrefixes),
      [...want.sourceAddressPrefixes].sort(),
    ],
    [
      normList(have.destinationPortRange, have.destinationPortRanges),
      [...want.destinationPortRanges].sort(),
    ],
    [
      normList(have.destinationAddressPrefix, have.destinationAddressPrefixes),
      [...want.destinationAddressPrefixes].sort(),
    ],
    [
      normList(have.sourcePortRange, have.sourcePortRanges),
      [...want.sourcePortRanges].sort(),
    ],
  ];
  for (const [a, b] of pairs) {
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) return true;
  }
  return false;
}

/** Build the `az network nsg rule create|update` argv for one declared rule. */
function ruleArgs(verb: string, nsgName: string, rg: string, want): string[] {
  const argv = [
    "network",
    "nsg",
    "rule",
    verb,
    "--nsg-name",
    nsgName,
    "--name",
    want.name,
    "--resource-group",
    rg,
    "--priority",
    String(want.priority),
    "--direction",
    want.direction,
    "--access",
    want.access,
    "--protocol",
    want.protocol,
    "--source-address-prefixes",
    ...want.sourceAddressPrefixes,
    "--source-port-ranges",
    ...want.sourcePortRanges,
    "--destination-address-prefixes",
    ...want.destinationAddressPrefixes,
    "--destination-port-ranges",
    ...want.destinationPortRanges,
  ];
  if (want.description) {
    // Azure caps rule descriptions at 140 characters and rejects the whole call
    // if that is exceeded, so truncate rather than fail a firewall change.
    argv.push("--description", String(want.description).slice(0, 140));
  }
  return argv;
}
