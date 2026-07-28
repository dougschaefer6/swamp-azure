import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const ZoneSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    resourceGroup: z.string(),
    zoneType: z.string().optional(),
    numberOfRecordSets: z.number().optional(),
    nameServers: z.array(z.string()).optional(),
    location: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const RecordSetSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    ttl: z.number().optional(),
    fqdn: z.string().optional(),
    aRecords: z.array(z.object({ ipv4Address: z.string() }).passthrough())
      .optional(),
    aaaaRecords: z.array(z.object({ ipv6Address: z.string() }).passthrough())
      .optional(),
    cnameRecord: z.object({ cname: z.string() }).passthrough().optional()
      .nullable(),
    mxRecords: z
      .array(
        z.object({ exchange: z.string(), preference: z.number() })
          .passthrough(),
      )
      .optional(),
    txtRecords: z
      .array(z.object({ value: z.array(z.string()) }).passthrough())
      .optional(),
    nsRecords: z.array(z.object({ nsdname: z.string() }).passthrough())
      .optional(),
    srvRecords: z
      .array(
        z
          .object({
            priority: z.number(),
            weight: z.number(),
            port: z.number(),
            target: z.string(),
          })
          .passthrough(),
      )
      .optional(),
    ptrRecords: z.array(z.object({ ptrdname: z.string() }).passthrough())
      .optional(),
    soaRecord: z
      .object({
        host: z.string(),
        email: z.string(),
        serialNumber: z.number(),
        refreshTime: z.number(),
        retryTime: z.number(),
        expireTime: z.number(),
        minimumTtl: z.number(),
      })
      .passthrough()
      .optional()
      .nullable(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-dns` model — Azure DNS zone and record-set
 * management, wrapping the `az network dns` CLI. Zone methods
 * (listZones, getZone, createZone, deleteZone, syncZone) cover both
 * public and private DNS zones with their delegating name servers,
 * record-set counts, and metadata. Record methods (listRecords,
 * getRecord, createRecord, deleteRecord, deleteRecordSet) operate on
 * the full Azure DNS record-type matrix — A, AAAA, CNAME, MX, NS,
 * PTR, SRV, TXT, SOA — including TTL changes and full record-set
 * removal. exportZone serializes a zone to BIND-format text for
 * backup or external review. Mutations apply immediately to live
 * resolution paths, so verify before touching production zones.
 */
export const model = {
  type: "@dougschaefer/azure-dns",
  version: "2026.07.28.4",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    zone: {
      description: "Azure DNS zone",
      schema: ZoneSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    recordSet: {
      description: "DNS record set within a zone",
      schema: RecordSetSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    listZones: {
      description:
        "List all DNS zones in a resource group (or all in the subscription if no resource group specified).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "dns", "zone", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const zones = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} DNS zones", { count: zones.length });

        const handles = [];
        for (const zone of zones) {
          const handle = await context.writeResource(
            "zone",
            sanitizeInstanceName(zone.name as string),
            zone,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getZone: {
      description: "Get a single DNS zone.",
      arguments: z.object({
        name: z.string().describe("DNS zone name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const zone = await az(
          [
            "network",
            "dns",
            "zone",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "zone",
          sanitizeInstanceName(args.name),
          zone,
        );
        return { dataHandles: [handle] };
      },
    },

    createZone: {
      description: "Create a DNS zone.",
      arguments: z.object({
        name: z.string().describe("DNS zone name, e.g. example.com"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z
          .string()
          .optional()
          .describe("Azure region (default: global)"),
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
          "dns",
          "zone",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
        ];

        if (args.location) {
          cmdArgs.push("--location", args.location);
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Created DNS zone {name}", { name: args.name });

        const zone = await az(
          [
            "network",
            "dns",
            "zone",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "zone",
          sanitizeInstanceName(args.name),
          zone,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteZone: {
      description: "Delete a DNS zone.",
      arguments: z.object({
        name: z.string().describe("DNS zone name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "dns",
            "zone",
            "delete",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info("Deleted DNS zone {name}", { name: args.name });
        return { dataHandles: [] };
      },
    },

    syncZone: {
      description: "Refresh stored state for a DNS zone.",
      arguments: z.object({
        name: z.string().describe("DNS zone name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const zone = await az(
          [
            "network",
            "dns",
            "zone",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Synced DNS zone {name}", { name: args.name });

        const handle = await context.writeResource(
          "zone",
          sanitizeInstanceName(args.name),
          zone,
        );
        return { dataHandles: [handle] };
      },
    },

    // --- Record set operations ---

    listRecords: {
      description: "List all record sets in a DNS zone.",
      arguments: z.object({
        zoneName: z.string().describe("DNS zone name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const records = (await az(
          [
            "network",
            "dns",
            "record-set",
            "list",
            "--zone-name",
            args.zoneName,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        )) as Array<Record<string, unknown>>;

        context.logger.info("Found {count} record sets in zone {zone}", {
          count: records.length,
          zone: args.zoneName,
        });

        const handles = [];
        for (const record of records) {
          const recordType = (record.type as string).split("/").pop() ||
            "unknown";
          const instanceName = `${args.zoneName}--${record
            .name as string}--${recordType}`;
          const handle = await context.writeResource(
            "recordSet",
            sanitizeInstanceName(instanceName),
            record,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    getRecord: {
      description: "Get a specific record set from a DNS zone.",
      arguments: z.object({
        zoneName: z.string().describe("DNS zone name"),
        name: z.string().describe("Record set name (e.g. 'www', '@' for apex)"),
        recordType: z
          .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "PTR", "SOA"])
          .describe("Record type"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const record = await az(
          [
            "network",
            "dns",
            "record-set",
            args.recordType.toLowerCase(),
            "show",
            "--zone-name",
            args.zoneName,
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        const instanceName =
          `${args.zoneName}--${args.name}--${args.recordType}`;
        const handle = await context.writeResource(
          "recordSet",
          sanitizeInstanceName(instanceName),
          record,
        );
        return { dataHandles: [handle] };
      },
    },

    createRecord: {
      description:
        "Add a record to a record set in a DNS zone. Creates the record set if it does not exist.",
      arguments: z.object({
        zoneName: z.string().describe("DNS zone name"),
        name: z.string().describe("Record set name (e.g. 'www', '@' for apex)"),
        recordType: z
          .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "PTR"])
          .describe("Record type"),
        value: z
          .string()
          .describe(
            "Record value — IP address for A/AAAA, hostname for CNAME/NS/PTR, exchange for MX, text for TXT, target for SRV",
          ),
        ttl: z
          .number()
          .optional()
          .describe("Time to live in seconds (default: 3600)"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        preference: z
          .number()
          .optional()
          .describe("MX preference/priority (default: 10)"),
        priority: z
          .number()
          .optional()
          .describe("SRV priority (default: 0)"),
        weight: z
          .number()
          .optional()
          .describe("SRV weight (default: 0)"),
        port: z
          .number()
          .optional()
          .describe("SRV port (default: 0)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "dns",
          "record-set",
          args.recordType.toLowerCase(),
          "add-record",
          "--zone-name",
          args.zoneName,
          "--record-set-name",
          args.name,
          "--resource-group",
          rg,
        ];

        if (args.ttl !== undefined) {
          cmdArgs.push("--ttl", String(args.ttl));
        }

        switch (args.recordType.toUpperCase()) {
          case "A":
            cmdArgs.push("--ipv4-address", args.value);
            break;
          case "AAAA":
            cmdArgs.push("--ipv6-address", args.value);
            break;
          case "CNAME":
            cmdArgs.push("--cname", args.value);
            break;
          case "MX":
            cmdArgs.push(
              "--exchange",
              args.value,
              "--preference",
              String(args.preference ?? 10),
            );
            break;
          case "TXT":
            cmdArgs.push("--value", args.value);
            break;
          case "NS":
            cmdArgs.push("--nsdname", args.value);
            break;
          case "SRV":
            cmdArgs.push(
              "--priority",
              String(args.priority ?? 0),
              "--weight",
              String(args.weight ?? 0),
              "--port",
              String(args.port ?? 0),
              "--target",
              args.value,
            );
            break;
          case "PTR":
            cmdArgs.push("--ptrdname", args.value);
            break;
        }

        const record = await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Added {type} record '{name}' in zone {zone}",
          {
            type: args.recordType,
            name: args.name,
            zone: args.zoneName,
          },
        );

        const instanceName =
          `${args.zoneName}--${args.name}--${args.recordType}`;
        const handle = await context.writeResource(
          "recordSet",
          sanitizeInstanceName(instanceName),
          record,
        );
        return { dataHandles: [handle] };
      },
    },

    deleteRecord: {
      description: "Remove a single record from a record set in a DNS zone.",
      arguments: z.object({
        zoneName: z.string().describe("DNS zone name"),
        name: z.string().describe("Record set name"),
        recordType: z
          .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "PTR"])
          .describe("Record type"),
        value: z
          .string()
          .describe("Record value to remove"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        preference: z
          .number()
          .optional()
          .describe("MX preference (required for MX removal)"),
        priority: z
          .number()
          .optional()
          .describe("SRV priority (required for SRV removal)"),
        weight: z
          .number()
          .optional()
          .describe("SRV weight (required for SRV removal)"),
        port: z
          .number()
          .optional()
          .describe("SRV port (required for SRV removal)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "network",
          "dns",
          "record-set",
          args.recordType.toLowerCase(),
          "remove-record",
          "--zone-name",
          args.zoneName,
          "--record-set-name",
          args.name,
          "--resource-group",
          rg,
        ];

        switch (args.recordType.toUpperCase()) {
          case "A":
            cmdArgs.push("--ipv4-address", args.value);
            break;
          case "AAAA":
            cmdArgs.push("--ipv6-address", args.value);
            break;
          case "CNAME":
            cmdArgs.push("--cname", args.value);
            break;
          case "MX":
            cmdArgs.push(
              "--exchange",
              args.value,
              "--preference",
              String(args.preference ?? 10),
            );
            break;
          case "TXT":
            cmdArgs.push("--value", args.value);
            break;
          case "NS":
            cmdArgs.push("--nsdname", args.value);
            break;
          case "SRV":
            cmdArgs.push(
              "--priority",
              String(args.priority ?? 0),
              "--weight",
              String(args.weight ?? 0),
              "--port",
              String(args.port ?? 0),
              "--target",
              args.value,
            );
            break;
          case "PTR":
            cmdArgs.push("--ptrdname", args.value);
            break;
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Removed {type} record '{name}' from zone {zone}",
          {
            type: args.recordType,
            name: args.name,
            zone: args.zoneName,
          },
        );

        return { dataHandles: [] };
      },
    },

    deleteRecordSet: {
      description: "Delete an entire record set from a DNS zone.",
      arguments: z.object({
        zoneName: z.string().describe("DNS zone name"),
        name: z.string().describe("Record set name"),
        recordType: z
          .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "PTR", "SOA"])
          .describe("Record type"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "network",
            "dns",
            "record-set",
            args.recordType.toLowerCase(),
            "delete",
            "--zone-name",
            args.zoneName,
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--yes",
          ],
          g.subscriptionId,
        );

        context.logger.info(
          "Deleted {type} record set '{name}' from zone {zone}",
          {
            type: args.recordType,
            name: args.name,
            zone: args.zoneName,
          },
        );

        return { dataHandles: [] };
      },
    },

    exportZone: {
      description:
        "Export a DNS zone as a zone file. Returns the zone file content as a string.",
      arguments: z.object({
        zoneName: z.string().describe("DNS zone name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);

        const cmd = new Deno.Command("az", {
          args: [
            "network",
            "dns",
            "zone",
            "export",
            "--name",
            args.zoneName,
            "--resource-group",
            rg,
            ...(g.subscriptionId ? ["--subscription", g.subscriptionId] : []),
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const result = await cmd.output();
        const stderr = new TextDecoder().decode(result.stderr);

        if (result.code !== 0) {
          throw new Error(`az network dns zone export failed: ${stderr}`);
        }

        const zoneFile = new TextDecoder().decode(result.stdout).trim();

        context.logger.info("Exported zone file for {zone}", {
          zone: args.zoneName,
        });

        return { zoneFile };
      },
    },
  },
};
