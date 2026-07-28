import { z } from "npm:zod@4.3.6";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const IpConfigurationSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    primary: z.boolean().optional(),
    privateIPAddress: z.string().optional(),
    privateIPAllocationMethod: z.string().optional(),
    subnet: z.object({ id: z.string() }).passthrough().optional().nullable(),
    publicIPAddress: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    provisioningState: z.string().optional(),
  })
  .passthrough();

const NetworkInterfaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    macAddress: z.string().optional().nullable(),
    enableIPForwarding: z.boolean().optional(),
    ipConfigurations: z.array(IpConfigurationSchema).optional(),
    networkSecurityGroup: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    virtualMachine: z
      .object({ id: z.string() })
      .passthrough()
      .optional()
      .nullable(),
    dnsSettings: z.record(z.string(), z.unknown()).optional().nullable(),
    provisioningState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional().nullable(),
  })
  .passthrough();

/**
 * `@dougschaefer/azure-network-interface` model — read-only view of
 * Azure network interfaces (NICs), wrapping the `az network nic` CLI.
 * list enumerates NICs across a resource group (or the whole
 * subscription) and get/sync return or refresh one NIC. Each NIC
 * exposes its MAC address, IP forwarding flag, per-`ipConfiguration`
 * private IP (with allocation method), attached subnet id and public
 * IP id, the associated network security group id
 * (`networkSecurityGroup.id`), the attached virtual machine id
 * (`virtualMachine.id`), and DNS settings. This model is deliberately
 * read-only — NIC creation, IP-config edits, and NSG/VM attach or
 * detach are out of scope; use the `az network nic` CLI directly for
 * those.
 */
export const model = {
  type: "@dougschaefer/azure-network-interface",
  version: "2026.07.28.2",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    networkInterface: {
      description: "Azure network interface (NIC)",
      schema: NetworkInterfaceSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List all network interfaces in a resource group (or all in the subscription if no resource group specified).",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["network", "nic", "list"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const nics = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} network interfaces", {
          count: nics.length,
        });

        const handles = [];
        for (const nic of nics) {
          const handle = await context.writeResource(
            "networkInterface",
            sanitizeInstanceName(nic.name as string),
            nic,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single network interface by name.",
      arguments: z.object({
        name: z.string().describe("Network interface (NIC) name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const nic = await az(
          [
            "network",
            "nic",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "networkInterface",
          sanitizeInstanceName(args.name),
          nic,
        );
        return { dataHandles: [handle] };
      },
    },

    sync: {
      description:
        "Refresh the stored state of a network interface without making changes.",
      arguments: z.object({
        name: z.string().describe("Network interface (NIC) name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const nic = await az(
          [
            "network",
            "nic",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        context.logger.info("Synced network interface {name}", {
          name: args.name,
        });
        const handle = await context.writeResource(
          "networkInterface",
          sanitizeInstanceName(args.name),
          nic,
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
