import { z } from "npm:zod@4";
import {
  az,
  AzureGlobalArgsSchema,
  requireResourceGroup,
  sanitizeInstanceName,
} from "./_helpers.ts";

const VmSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    location: z.string(),
    resourceGroup: z.string(),
    hardwareProfile: z
      .object({ vmSize: z.string() })
      .passthrough()
      .optional(),
    storageProfile: z.record(z.string(), z.unknown()).optional(),
    osProfile: z.record(z.string(), z.unknown()).optional(),
    networkProfile: z.record(z.string(), z.unknown()).optional(),
    provisioningState: z.string().optional(),
    powerState: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const VmInstanceViewSchema = z
  .object({
    name: z.string(),
    computerName: z.string().optional(),
    osName: z.string().optional(),
    osVersion: z.string().optional(),
    vmAgent: z.record(z.string(), z.unknown()).optional(),
    statuses: z.array(z.record(z.string(), z.unknown())).optional(),
    disks: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const model = {
  type: "@dougschaefer/azure-vm",
  version: "2026.03.05.1",
  globalArguments: AzureGlobalArgsSchema,
  resources: {
    vm: {
      description: "Azure virtual machine",
      schema: VmSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
    instanceView: {
      description: "VM instance view with power state and agent status",
      schema: VmInstanceViewSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    list: {
      description:
        "List VMs in a resource group (or all in the subscription if no resource group specified). Includes power state.",
      arguments: z.object({
        resourceGroup: z
          .string()
          .optional()
          .describe("Resource group name. Omit to list across subscription."),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const cmdArgs = ["vm", "list", "--show-details"];
        const rg = args.resourceGroup || g.resourceGroup;
        if (rg) {
          cmdArgs.push("--resource-group", rg);
        }

        const vms = (await az(cmdArgs, g.subscriptionId)) as Array<
          Record<string, unknown>
        >;

        context.logger.info("Found {count} VMs", { count: vms.length });

        const handles = [];
        for (const vm of vms) {
          const handle = await context.writeResource(
            "vm",
            sanitizeInstanceName(vm.name as string),
            vm,
          );
          handles.push(handle);
        }
        return { dataHandles: handles };
      },
    },

    get: {
      description: "Get a single VM with instance details.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const vm = await az(
          [
            "vm",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--show-details",
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vm",
          sanitizeInstanceName(args.name),
          vm,
        );
        return { dataHandles: [handle] };
      },
    },

    getInstanceView: {
      description:
        "Get the instance view of a VM — power state, agent status, disk status.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const view = await az(
          [
            "vm",
            "get-instance-view",
            "--name",
            args.name,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "instanceView",
          sanitizeInstanceName(args.name),
          view,
        );
        return { dataHandles: [handle] };
      },
    },

    create: {
      description:
        "Create a virtual machine. Creates NIC, public IP, and OS disk automatically unless specified.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        location: z.string().describe("Azure region, e.g. eastus2"),
        size: z
          .string()
          .default("Standard_B2s")
          .describe("VM size, e.g. Standard_B2s, Standard_D4s_v5"),
        image: z
          .string()
          .describe(
            "OS image URN, e.g. 'Canonical:ubuntu-24_04-lts:server:latest', 'MicrosoftWindowsServer:WindowsServer:2022-datacenter-g2:latest'",
          ),
        adminUsername: z.string().describe("Admin username"),
        adminPassword: z
          .string()
          .optional()
          .describe(
            "Admin password (Windows or password-based Linux). Use: ${{ vault.get('azure', 'VM_ADMIN_PASSWORD') }}",
          ),
        sshKeyValue: z
          .string()
          .optional()
          .describe(
            "SSH public key for Linux VMs. Use: ${{ vault.get('azure', 'SSH_PUBLIC_KEY') }}",
          ),
        generateSshKeys: z
          .boolean()
          .optional()
          .describe("Auto-generate SSH keys if none exist"),
        vnetName: z.string().optional().describe("Existing VNet name"),
        subnetName: z.string().optional().describe("Existing subnet name"),
        nsgName: z
          .string()
          .optional()
          .describe("Existing NSG to attach to the NIC"),
        publicIpAddress: z
          .string()
          .optional()
          .describe("Public IP name, or empty string for no public IP"),
        osDiskSizeGb: z.number().optional().describe("OS disk size in GB"),
        dataDiskSizes: z
          .array(z.number())
          .optional()
          .describe("Data disk sizes in GB, e.g. [128, 256]"),
        tags: z
          .record(z.string(), z.string())
          .optional()
          .describe("Tags as key=value pairs"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "vm",
          "create",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--location",
          args.location,
          "--size",
          args.size,
          "--image",
          args.image,
          "--admin-username",
          args.adminUsername,
        ];

        if (args.adminPassword) {
          cmdArgs.push("--admin-password", args.adminPassword);
        }
        if (args.sshKeyValue) {
          cmdArgs.push("--ssh-key-value", args.sshKeyValue);
        }
        if (args.generateSshKeys) {
          cmdArgs.push("--generate-ssh-keys");
        }
        if (args.vnetName) {
          cmdArgs.push("--vnet-name", args.vnetName);
        }
        if (args.subnetName) {
          cmdArgs.push("--subnet", args.subnetName);
        }
        if (args.nsgName) {
          cmdArgs.push("--nsg", args.nsgName);
        }
        if (args.publicIpAddress !== undefined) {
          cmdArgs.push(
            "--public-ip-address",
            args.publicIpAddress || '""',
          );
        }
        if (args.osDiskSizeGb) {
          cmdArgs.push("--os-disk-size-gb", args.osDiskSizeGb.toString());
        }
        if (args.dataDiskSizes && args.dataDiskSizes.length > 0) {
          cmdArgs.push(
            "--data-disk-sizes-gb",
            ...args.dataDiskSizes.map((s) => s.toString()),
          );
        }
        if (args.tags) {
          const tagPairs = Object.entries(args.tags).map(
            ([k, v]) => `${k}=${v}`,
          );
          cmdArgs.push("--tags", ...tagPairs);
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info(
          "Created VM {name} ({size}) in {location}",
          { name: args.name, size: args.size, location: args.location },
        );

        const vm = await az(
          [
            "vm",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--show-details",
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vm",
          sanitizeInstanceName(args.name),
          vm,
        );
        return { dataHandles: [handle] };
      },
    },

    delete: {
      description: "Delete a virtual machine.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        forceDeleteDataDisks: z
          .boolean()
          .optional()
          .describe("Also delete attached data disks"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "vm",
          "delete",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--yes",
          "--no-wait",
        ];

        if (args.forceDeleteDataDisks) {
          cmdArgs.push("--force-deletion", "true");
        }

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Initiated deletion of VM {name}", {
          name: args.name,
        });

        return { dataHandles: [] };
      },
    },

    start: {
      description: "Start a stopped/deallocated VM.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["vm", "start", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );

        context.logger.info("Started VM {name}", { name: args.name });

        const vm = await az(
          [
            "vm",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--show-details",
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vm",
          sanitizeInstanceName(args.name),
          vm,
        );
        return { dataHandles: [handle] };
      },
    },

    stop: {
      description:
        "Power off a VM without deallocating (still incurs compute charges).",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["vm", "stop", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );

        context.logger.info("Stopped VM {name}", { name: args.name });

        const vm = await az(
          [
            "vm",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--show-details",
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vm",
          sanitizeInstanceName(args.name),
          vm,
        );
        return { dataHandles: [handle] };
      },
    },

    deallocate: {
      description:
        "Deallocate a VM (releases compute resources, stops charges).",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["vm", "deallocate", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );

        context.logger.info("Deallocated VM {name}", { name: args.name });

        const vm = await az(
          [
            "vm",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--show-details",
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vm",
          sanitizeInstanceName(args.name),
          vm,
        );
        return { dataHandles: [handle] };
      },
    },

    restart: {
      description: "Restart a running VM.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          ["vm", "restart", "--name", args.name, "--resource-group", rg],
          g.subscriptionId,
        );

        context.logger.info("Restarted VM {name}", { name: args.name });

        const vm = await az(
          [
            "vm",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--show-details",
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vm",
          sanitizeInstanceName(args.name),
          vm,
        );
        return { dataHandles: [handle] };
      },
    },

    resize: {
      description:
        "Resize a VM to a different size. VM must be deallocated first for some size changes.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        size: z.string().describe("New VM size, e.g. Standard_D4s_v5"),
        resourceGroup: z.string().optional().describe("Resource group name"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        await az(
          [
            "vm",
            "resize",
            "--name",
            args.name,
            "--size",
            args.size,
            "--resource-group",
            rg,
          ],
          g.subscriptionId,
        );

        context.logger.info("Resized VM {name} to {size}", {
          name: args.name,
          size: args.size,
        });

        const vm = await az(
          [
            "vm",
            "show",
            "--name",
            args.name,
            "--resource-group",
            rg,
            "--show-details",
          ],
          g.subscriptionId,
        );
        const handle = await context.writeResource(
          "vm",
          sanitizeInstanceName(args.name),
          vm,
        );
        return { dataHandles: [handle] };
      },
    },

    listSizes: {
      description: "List available VM sizes in a location.",
      arguments: z.object({
        location: z.string().describe("Azure region, e.g. eastus2"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const sizes = await az(
          ["vm", "list-sizes", "--location", args.location],
          g.subscriptionId,
        );

        const sizeList = sizes as Array<Record<string, unknown>>;
        context.logger.info("Found {count} VM sizes in {location}", {
          count: sizeList.length,
          location: args.location,
        });

        return { dataHandles: [] };
      },
    },

    runCommand: {
      description:
        "Run a shell command on a VM via the Azure VM Run Command extension.",
      arguments: z.object({
        name: z.string().describe("VM name"),
        resourceGroup: z.string().optional().describe("Resource group name"),
        commandId: z
          .string()
          .default("RunShellScript")
          .describe(
            "Command ID: RunShellScript (Linux) or RunPowerShellScript (Windows)",
          ),
        scripts: z
          .array(z.string())
          .describe("Script lines to execute on the VM"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const rg = requireResourceGroup(args.resourceGroup, g.resourceGroup);
        const cmdArgs = [
          "vm",
          "run-command",
          "invoke",
          "--name",
          args.name,
          "--resource-group",
          rg,
          "--command-id",
          args.commandId,
          "--scripts",
          ...args.scripts,
        ];

        await az(cmdArgs, g.subscriptionId);

        context.logger.info("Executed command on VM {name}", {
          name: args.name,
        });

        return { dataHandles: [] };
      },
    },
  },
};
