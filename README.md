# @dougschaefer/azure

Azure infrastructure management for [Swamp](https://swamp.club), covering 42 model types across compute, networking, data services, security, RBAC, Azure Policy, Defender for Cloud, Entra ID directory, monitoring, DNS, DevOps, Azure AI Foundry (accounts, model deployments, projects, quota), AI Search, Cosmos DB, PostgreSQL Flexible Server, Static Web Apps, Service Bus, Event Grid, Recovery Services, Log Analytics, subscription-wide topology visualization, and the Azure AI Vision Face REST API for identity-aware room services. Most methods run through the Azure CLI as a subprocess, so authentication delegates to whatever `az login` session is active on the machine and there is nothing proprietary sitting between you and your subscription. The one exception is `azure-face`, a data-plane REST type authenticated by a per-resource subscription key supplied via vault (see Vault setup below).

Container Apps, Container Apps Jobs, and Azure Container Registry are covered by the companion extension [`@rkcoleman/azure-containers`](https://github.com/rkcoleman/swamp-azure-containers), which is designed to compose with these models.

The extension goes beyond standard CRUD. The topology model performs subscription-wide inventory across 16 resource types, generates Azure-branded Mermaid diagrams of resource group network architecture, estimates monthly costs against the public Azure Retail Pricing API, and exports ARM templates for IaC documentation. The DNS model handles zone and record lifecycle with enum-validated record types. The DevOps model covers projects, repos, pipelines, builds, and work items so you can wire CI/CD operations into the same workflows that manage the infrastructure those pipelines deploy to.

Most models include a `sync` method that refreshes stored state without making changes, which means you can keep your swamp data current with what actually exists in Azure and use CEL expressions to reference live resource attributes in downstream workflows.

## Models

| Model Type | Description |
|---|---|
| `azure-vm` | Virtual machines with full lifecycle, remote command execution, and size enumeration |
| `azure-disk` | Managed disks with orphan detection |
| `azure-vnet` | Virtual networks, subnets, and peering connections |
| `azure-nsg` | Network security groups and security rules |
| `azure-firewall` | Azure Firewall instances, policies, and rule collection groups |
| `azure-route-table` | Route tables and user-defined routes |
| `azure-public-ip` | Public IP addresses (Standard/Basic, Static/Dynamic) |
| `azure-nat-gateway` | NAT gateways for outbound connectivity |
| `azure-load-balancer` | Load balancers with backend pool and health probe enumeration |
| `azure-application-gateway` | Application gateways (read and delete) |
| `azure-bastion` | Bastion hosts for secure VM access |
| `azure-private-endpoint` | Private endpoints with private DNS zone enumeration |
| `azure-key-vault` | Key Vault lifecycle |
| `azure-sql` | SQL logical servers and databases |
| `azure-ssh-key` | SSH public key resources (Microsoft.Compute/sshPublicKeys) with full lifecycle |
| `azure-storage-account` | Storage accounts (Blob, File, Table, Queue) |
| `azure-managed-identity` | User-assigned managed identities |
| `azure-ad-user` | Entra ID users — directory reads and group memberships |
| `azure-ad-group` | Entra ID groups — lifecycle and membership management |
| `azure-ad-service-principal` | Entra ID service principals — reads and credential-expiry auditing |
| `azure-ad-app-registration` | Entra ID app registrations — reads and credential-expiry auditing |
| `azure-role-assignment` | Azure RBAC role assignments and definitions |
| `azure-policy` | Azure Policy assignments, definitions, initiatives, and compliance state |
| `azure-defender` | Microsoft Defender for Cloud pricing, secure score, assessments, and alerts |
| `azure-monitor` | Metric alerts, activity log alerts, action groups, and diagnostic settings |
| `azure-network-watcher` | Network Watcher instances, flow logs, connection monitors, and connectivity checks |
| `azure-dns` | DNS zones and records with full record type support |
| `azure-devops` | Projects, repos, pipelines, builds, work items, service connections, variable groups, pull requests, and agent pools |
| `azure-vwan` | Virtual WANs, hubs, hub connections, VPN sites, and VPN gateways |
| `azure-resource-group` | Resource group lifecycle |
| `azure-topology` | Subscription-wide inventory, Mermaid diagrams, cost estimation, and ARM template export |
| `azure-face` | Azure AI Vision Face REST API — detect faces, manage PersonGroups, enroll Persons (Entra objectId in userData), train, and run 1:N identify for identity-aware room services |
| `azure-ai-foundry` | Azure AI Foundry / AI Services — accounts, model deployments (create/delete), Foundry projects and connections, per-region model catalog and quota |
| `azure-ai-search` | Azure AI Search service lifecycle — the retrieval layer behind Foundry RAG agents |
| `azure-cosmos` | Cosmos DB inventory — accounts, SQL databases, and containers (read-only) |
| `azure-staticwebapp` | Static Web Apps inventory — sites and deployment environments (read-only) |
| `azure-servicebus` | Service Bus inventory — namespaces, queues, topics, and subscriptions with message-depth attributes (read-only) |
| `azure-eventgrid` | Event Grid inventory — topics, system topics, and event subscriptions (read-only) |
| `azure-postgres-flexible-server` | PostgreSQL Flexible Server inventory — servers, databases, and firewall rules (read-only) |
| `azure-recovery-services-vault` | Recovery Services vaults and their backup items (read-only) |
| `azure-log-analytics-workspace` | Log Analytics workspace inventory (read-only) |
| `azure-network-interface` | Network interface inventory (read-only) |

## Method Reference

### azure-vm

| Method | Description |
|---|---|
| `list` | List all VMs in a resource group or subscription |
| `get` | Get a VM by name |
| `sync` | Refresh stored state without making changes |
| `getInstanceView` | Get power state, agent status, and platform fault domain |
| `create` | Create a VM with image, size, networking, and OS configuration |
| `delete` | Delete a VM |
| `start` | Start a stopped or deallocated VM |
| `stop` | Stop (power off) a VM without deallocating |
| `deallocate` | Deallocate a VM to stop billing for compute, or hibernate it (`hibernate: true`) to preserve in-memory state |
| `restart` | Restart a running VM |
| `resize` | Change VM size (SKU) |
| `listSizes` | List available VM sizes for a region |
| `runCommand` | Execute a command on the VM via the Azure agent |

### azure-disk

| Method | Description |
|---|---|
| `list` | List managed disks in a resource group or subscription |
| `get` | Get a managed disk by name |
| `sync` | Refresh stored state without making changes |
| `listOrphaned` | List disks not attached to any VM |
| `create` | Create a managed disk |
| `delete` | Delete a managed disk |

### azure-vnet

| Method | Description |
|---|---|
| `list` | List VNets in a resource group or subscription |
| `get` | Get a VNet by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a VNet with address space and optional subnets |
| `delete` | Delete a VNet |
| `listSubnets` | List subnets in a VNet |
| `getSubnet` | Get a subnet by name |
| `createSubnet` | Create a subnet with address prefix |
| `updateSubnet` | Update a subnet's properties |
| `deleteSubnet` | Delete a subnet |
| `listPeerings` | List VNet peering connections |
| `createPeering` | Create a peering connection to another VNet |
| `deletePeering` | Delete a peering connection |

### azure-nsg

| Method | Description |
|---|---|
| `list` | List NSGs in a resource group or subscription |
| `get` | Get an NSG by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create an NSG |
| `delete` | Delete an NSG |
| `listRules` | List security rules in an NSG |
| `getRule` | Get a security rule by name |
| `createRule` | Create a security rule with priority, direction, protocol, and port ranges |
| `updateRule` | Update an existing security rule |
| `deleteRule` | Delete a security rule |

### azure-firewall

| Method | Description |
|---|---|
| `list` | List firewalls in a resource group or subscription |
| `get` | Get a firewall by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create an Azure Firewall |
| `delete` | Delete an Azure Firewall |
| `listPolicies` | List firewall policies |
| `getPolicy` | Get a firewall policy by name |
| `syncPolicy` | Refresh stored state of a firewall policy |
| `listRuleCollectionGroups` | List rule collection groups in a policy |
| `getRuleCollectionGroup` | Get a single rule collection group |
| `createPolicy` | Create a firewall policy |

### azure-route-table

| Method | Description |
|---|---|
| `list` | List route tables in a resource group or subscription |
| `get` | Get a route table by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a route table |
| `delete` | Delete a route table |
| `listRoutes` | List routes in a route table |
| `createRoute` | Create a user-defined route |
| `updateRoute` | Update an existing route |
| `deleteRoute` | Delete a route |

### azure-public-ip

| Method | Description |
|---|---|
| `list` | List public IPs in a resource group or subscription |
| `get` | Get a public IP by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a public IP address |
| `delete` | Delete a public IP address |

### azure-nat-gateway

| Method | Description |
|---|---|
| `list` | List NAT gateways in a resource group or subscription |
| `get` | Get a NAT gateway by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a NAT gateway |
| `delete` | Delete a NAT gateway |

### azure-load-balancer

| Method | Description |
|---|---|
| `list` | List load balancers in a resource group or subscription |
| `get` | Get a load balancer by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a load balancer |
| `delete` | Delete a load balancer |
| `listBackendPools` | List backend address pools |
| `listProbes` | List health probes |

### azure-application-gateway

| Method | Description |
|---|---|
| `list` | List application gateways in a resource group or subscription |
| `get` | Get an application gateway by name |
| `sync` | Refresh stored state without making changes |
| `delete` | Delete an application gateway |

### azure-bastion

| Method | Description |
|---|---|
| `list` | List Bastion hosts in the subscription |
| `get` | Get a Bastion host by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a Bastion host (requires AzureBastionSubnet) |
| `delete` | Delete a Bastion host |

### azure-private-endpoint

| Method | Description |
|---|---|
| `list` | List private endpoints in a resource group or subscription |
| `get` | Get a private endpoint by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a private endpoint to a service |
| `delete` | Delete a private endpoint |
| `listPrivateDnsZones` | List private DNS zones linked to the endpoint |

### azure-key-vault

| Method | Description |
|---|---|
| `list` | List Key Vaults in a resource group or subscription |
| `get` | Get a Key Vault by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a Key Vault |
| `delete` | Delete a Key Vault (soft delete aware) |

### azure-sql

| Method | Description |
|---|---|
| `listServers` | List SQL logical servers in a resource group or subscription |
| `getServer` | Get a SQL server by name |
| `syncServer` | Refresh stored state of a SQL server |
| `createServer` | Create a SQL logical server with admin credentials |
| `deleteServer` | Delete a SQL server and all its databases |
| `listDatabases` | List databases on a SQL server |
| `getDatabase` | Get a database by name |
| `syncDatabase` | Refresh stored state of a database |
| `createDatabase` | Create a database with SKU and max size |
| `deleteDatabase` | Delete a database |

### azure-ssh-key

SSH public key resources (`Microsoft.Compute/sshPublicKeys`) wrapped via `az sshkey`. Used by VM provisioning to reference a centrally-managed key by ID.

| Method | Description |
|---|---|
| `list` | List all SSH public keys in a resource group or subscription |
| `get` | Get a single SSH public key by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a new SSH public key resource with supplied public-key content |
| `delete` | Delete an SSH public key resource |

### azure-storage-account

| Method | Description |
|---|---|
| `list` | List storage accounts in a resource group or subscription |
| `get` | Get a storage account by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a storage account with SKU and kind |
| `delete` | Delete a storage account |

### azure-managed-identity

Covers workload identity federation as well as identity lifecycle: federated credentials let GitHub Actions, Kubernetes, or any OIDC issuer exchange its own token for the identity — no stored secret. `createFederatedCredential` matches the incoming token by exact `subject` or, on az CLI 2.87+, by a preview wildcard `claimsMatchingExpression` (exactly one of the two).

| Method | Description |
|---|---|
| `list` | List user-assigned managed identities in a resource group or subscription |
| `get` | Get a managed identity by name |
| `sync` | Refresh stored state without making changes |
| `create` | Create a user-assigned managed identity |
| `update` | Replace the tags on a managed identity (az CLI 2.87+) |
| `delete` | Delete a managed identity |
| `listFederatedCredentials` | List federated identity credentials on an identity |
| `createFederatedCredential` | Add a federated credential (issuer + subject or claims-matching expression); idempotent |
| `deleteFederatedCredential` | Remove a federated credential; idempotent |

### azure-ad-user

Tenant-scoped (Entra ID) — authenticates via the active `az login` session, no subscription. Reads, plus a security-conscious `provision` write.

| Method | Description |
|---|---|
| `list` | List users, optionally narrowed by an OData `$filter` |
| `get` | Get a user by UPN or object id |
| `sync` | Refresh stored state without making changes |
| `getMemberGroups` | List the groups a user belongs to (access review) |
| `provision` | Create a user from non-secret fields via Microsoft Graph. A single-use temp password is generated in-process, sent in the request body (never in argv), set with force-change-on-next-sign-in, then discarded — never an input, returned, logged, persisted, or vaulted. The method persists nothing |

`provision` is the deliberate inverse of credential-bearing service-principal/app creation: a person's temp password is ephemeral, so nothing is kept; a service principal's minted secret is long-lived, so it would be captured into a vault. Guarded by a `live` `directory-access` pre-flight check (skip with `--skip-check-label live`).

### azure-ad-group

Tenant-scoped (Entra ID). Membership writes (`addMember`/`removeMember`) and group lifecycle (`create`/`delete`) touch live directory state — adding a member can grant access through group-based RBAC.

| Method | Description |
|---|---|
| `list` | List groups, optionally narrowed by an OData `$filter` |
| `get` | Get a group by object id or display name |
| `sync` | Refresh stored state without making changes |
| `listMembers` | List the member principals of a group |
| `addMember` | Add a user, group, or service principal to a group |
| `removeMember` | Remove a principal from a group |
| `create` | Create a new group |
| `delete` | Delete a group |

### azure-ad-service-principal

Tenant-scoped (Entra ID). Read-only — `create-for-rbac` is excluded because it emits secret material. `listCredentials` surfaces credential `endDateTime` for expiry auditing; secret values are never returned by Graph.

| Method | Description |
|---|---|
| `list` | List service principals (require one of all/displayName/filter/spn) |
| `get` | Get a service principal by appId or object id |
| `sync` | Refresh stored state without making changes |
| `listCredentials` | List password/certificate credential metadata for expiry auditing |
| `listOwners` | List the owners of a service principal |
| `listAppRoleAssignments` | List principals (users/groups) assigned an app role — the source of truth for who actually has access |
| `listSynchronizationJobs` | List SCIM provisioning synchronization jobs configured on the service principal |

### azure-ad-app-registration

Tenant-scoped (Entra ID). Read-only. `listCredentials` is the primary tool for catching expiring app secrets before they break an integration; secret values are never returned by Graph.

| Method | Description |
|---|---|
| `list` | List app registrations, optionally narrowed by displayName or `$filter` |
| `get` | Get an app registration by appId or object id |
| `sync` | Refresh stored state without making changes |
| `listCredentials` | List password/certificate credential metadata for expiry auditing |
| `listOwners` | List the owners of an app registration |

### azure-role-assignment

The direct complement to `azure-managed-identity` — granting an identity access to a Key Vault, Storage account, or resource group is a role assignment. Mutations change who can do what; verify principal, role, and scope first. On az CLI 2.87+ `list` also returns assignments inherited from management groups, and `fillPrincipalName: false` / `fillRoleDefinitionName: false` skip the per-row Graph and ARM name lookups for fast bulk audits.

| Method | Description |
|---|---|
| `list` | List role assignments at the subscription, a resource group, or an explicit scope |
| `listDenyAssignments` | List deny assignments — Azure-managed blocks that override any role grant (read-only) |
| `create` | Grant a principal a role at a scope |
| `delete` | Revoke a role assignment by its fully-qualified id |
| `listDefinitions` | List role definitions (optionally custom-only) |
| `getDefinition` | Get a role definition by role name (e.g. Contributor) |

### azure-policy

Governance via Azure Policy. Assignment mutations change enforcement — a Deny-mode assignment can block resource operations.

| Method | Description |
|---|---|
| `listAssignments` | List policy assignments at the subscription or a resource group |
| `getAssignment` | Get a policy assignment by name |
| `createAssignment` | Assign a policy or initiative at a scope |
| `deleteAssignment` | Remove a policy assignment by name |
| `listDefinitions` | List policy definitions (use `customOnly` to skip the built-in catalog) |
| `getDefinition` | Get a policy definition by name |
| `listSetDefinitions` | List policy initiatives (set definitions) |
| `summarizeCompliance` | Summarize compliance state across a scope via Policy Insights |

### azure-defender

Microsoft Defender for Cloud posture and detections. `setPricing` changes billing and protection coverage.

| Method | Description |
|---|---|
| `listPricing` | List Defender plans (Free/Standard) per resource type |
| `setPricing` | Set a Defender plan's tier for a resource type |
| `listSecureScores` | List Defender for Cloud secure scores |
| `listSecureScoreControls` | List the per-control breakdown behind the secure score |
| `listAssessments` | List security assessments (recommendations) |
| `listAlerts` | List active security alerts (detections) |

### azure-monitor

| Method | Description |
|---|---|
| `listMetricAlerts` | List metric alerts in a resource group or subscription |
| `listActivityLogAlerts` | List activity log alerts in a resource group or subscription |
| `listActionGroups` | List action groups in a resource group or subscription |
| `getDiagnosticSettings` | Get diagnostic settings for a specific resource |

### azure-network-watcher

| Method | Description |
|---|---|
| `list` | List Network Watcher instances in the subscription |
| `listFlowLogs` | List NSG flow logs for a Network Watcher |
| `listConnectionMonitors` | List connection monitors for a Network Watcher |
| `checkConnectivity` | Test connectivity from a source VM to a destination endpoint |

### azure-dns

| Method | Description |
|---|---|
| `listZones` | List DNS zones in a resource group or subscription |
| `getZone` | Get a DNS zone by name |
| `createZone` | Create a DNS zone |
| `deleteZone` | Delete a DNS zone |
| `syncZone` | Refresh stored state of a DNS zone |
| `listRecords` | List all records in a DNS zone |
| `getRecord` | Get a single DNS record (enum-validated record type) |
| `createRecord` | Add a record to a record set (A, AAAA, CNAME, MX, TXT, NS, SRV, PTR) |
| `deleteRecord` | Remove a record from a record set |
| `deleteRecordSet` | Delete an entire record set |
| `exportZone` | Export a DNS zone to a file |

### azure-devops

| Method | Description |
|---|---|
| `listProjects` | List all projects in the organization |
| `getProject` | Get a project by name |
| `listRepos` | List repositories in a project |
| `getRepo` | Get a repository by name |
| `createRepo` | Create a repository |
| `deleteRepo` | Delete a repository |
| `listPipelines` | List pipelines in a project |
| `getPipeline` | Get a pipeline by name |
| `runPipeline` | Trigger a pipeline run |
| `listBuilds` | List builds in a project |
| `getBuild` | Get a build by ID |
| `listWorkItems` | List work items in a project |
| `getWorkItem` | Get a work item by ID |
| `createWorkItem` | Create a work item |
| `updateWorkItem` | Update a work item |
| `listServiceConnections` | List service connections (service endpoints) in a project |
| `getServiceConnection` | Get a service connection by id |
| `listVariableGroups` | List pipeline variable groups in a project |
| `getVariableGroup` | Get a variable group by id |
| `listPullRequests` | List pull requests across a project or one repository |
| `getPullRequest` | Get a pull request by id |
| `listAgentPools` | List the organization's agent pools |

### azure-vwan

The vWAN model manages the full hub-and-spoke topology as a set of interdependent resources, from the WAN itself through virtual hubs, hub-to-VNet connections, VPN sites, and VPN gateways.

| Method | Description |
|---|---|
| `list` | List virtual WANs in a resource group |
| `get` | Get a virtual WAN by name |
| `create` | Create a virtual WAN |
| `delete` | Delete a virtual WAN |
| `listHubs` | List virtual hubs in a vWAN |
| `getHub` | Get a virtual hub by name |
| `createHub` | Create a virtual hub with address prefix and region |
| `deleteHub` | Delete a virtual hub |
| `listHubConnections` | List VNet connections on a hub |
| `createHubConnection` | Connect a VNet to a virtual hub |
| `deleteHubConnection` | Remove a VNet connection from a hub |
| `listVpnSites` | List VPN sites in a resource group |
| `getVpnSite` | Get a VPN site by name |
| `createVpnSite` | Create a VPN site with device properties and link configuration |
| `deleteVpnSite` | Delete a VPN site |
| `listVpnGateways` | List VPN gateways in a resource group |
| `getVpnGateway` | Get a VPN gateway by name |
| `inventory` | Full inventory of all vWAN resources (WANs, hubs, connections, sites, gateways) |

### azure-resource-group

| Method | Description |
|---|---|
| `list` | List resource groups in a subscription |
| `get` | Get a resource group by name |
| `create` | Create a resource group in a location |
| `delete` | Delete a resource group and all its contents |

### azure-topology

The topology model operates at the subscription level rather than on individual resources. The `inventory` method discovers all resources across 16 Azure resource types and produces per-resource data handles that downstream workflows can reference. The `generate` method builds Mermaid diagrams with Azure-branded colors and resource relationship mapping. The `costEstimate` method calls the Azure Retail Pricing API directly (no authentication required) to estimate monthly spend for VMs and firewalls. The `exportTemplate` method pulls the full ARM template for a resource group.

| Method | Description |
|---|---|
| `inventory` | Discover all resources across the subscription (or a single resource group) |
| `generate` | Produce a Mermaid diagram of network topology with Azure-branded colors |
| `costEstimate` | Estimate monthly VM and firewall costs via the Azure Retail Pricing API |
| `exportTemplate` | Export the full ARM template for a resource group |

### azure-face

The Face model wraps the [Azure AI Vision Face REST API](https://learn.microsoft.com/rest/api/face/) for identity-aware room services (IARS). It is the only type in this extension that does not shell out to `az` — it is a data-plane REST service authenticated by a per-resource subscription key, so it carries its own fetch-based client and its own global arguments (`endpoint`, `key`) supplied from vault. The recognition pipeline is: a camera frame goes to `detect` (returns ephemeral faceIds), those faceIds go to `identify` (1:N match against a PersonGroup), and the matched Person's `userData` field carries the Entra objectId that the downstream `iars-correlate` workflow consumes to load the right AV scene.

`detect` works at all Face subscription tiers today. `identify`, `addPersonFace`, and `trainPersonGroup` are gated behind Microsoft's [Limited Access](https://aka.ms/facerecognition) program for the Face API and will return HTTP 401 until that approval is in place. `detectLiveness` is a documented stub — Azure liveness is a client-side SDK session flow, not a single REST call.

| Method | Description |
|---|---|
| `detect` | Detect faces in an image URL; returns ephemeral faceIds for `identify` |
| `identify` | 1:N identify faceIds against a PersonGroup; top candidate `userData` = Entra objectId (Limited Access) |
| `createPersonGroup` | Create a PersonGroup for enrollment |
| `listPersonGroups` | List all PersonGroups under the Face resource |
| `deletePersonGroup` | Delete a PersonGroup and all its Persons/faces (destructive) |
| `addPerson` | Add a Person with `userData` set to the Entra objectId |
| `addPersonFace` | Enroll a face image for a Person (Limited Access) |
| `listPersons` | List enrolled Persons in a PersonGroup |
| `trainPersonGroup` | Trigger training after enrollment changes (Limited Access) |
| `getPersonGroupTrainingStatus` | Poll training status until `succeeded` |
| `detectLiveness` | Stub — liveness requires the Azure AI Vision Face client SDK session flow |

### azure-ai-foundry

Azure AI Foundry and the AI Services accounts it is built on. `listDeployments` is a fan-out — omit `accountName` to sweep every account in the subscription in one run. Foundry projects and connections are read over ARM (the CLI does not expose them yet). Account keys are never fetched; data-plane credentials belong in vaults, following the `azure-face` pattern.

| Method | Description |
|---|---|
| `listAccounts` | List AI Services / Cognitive Services accounts, optionally filtered by kind (AIServices, OpenAI, Face, ...) |
| `getAccount` | Get a single account |
| `syncAccount` | Refresh stored account state without making changes |
| `listDeployments` | List model deployments on one account, or fan out across every account in scope |
| `createDeployment` | Deploy a model (name, version, format, SKU, capacity); idempotent |
| `deleteDeployment` | Remove a model deployment; idempotent |
| `listProjects` | List Foundry projects on an account (AIServices kind) |
| `listConnections` | List Foundry connections on an account (metadata only, no secrets) |
| `listModels` | Snapshot the deployable model catalog for a region as one resource |
| `listUsage` | Snapshot per-region quota usage (current vs. limit) as one resource |

### azure-ai-search

The retrieval layer behind Foundry RAG agents. Admin/query keys are never fetched, and index/document operations are data plane and out of scope.

| Method | Description |
|---|---|
| `list` | List search services (subscription-wide via ARM when no resource group given) |
| `get` | Get a search service |
| `sync` | Refresh stored state without making changes |
| `create` | Create a search service (SKU, replicas, partitions); idempotent |
| `delete` | Delete a search service and its indexes; idempotent |

### azure-cosmos

Read-only Cosmos DB inventory over the SQL (Core) API surface. Keys and connection strings are deliberately excluded.

| Method | Description |
|---|---|
| `list` | List Cosmos DB accounts in a resource group or subscription |
| `get` | Get a Cosmos DB account |
| `sync` | Refresh stored state without making changes |
| `listDatabases` | List SQL databases on an account |
| `listContainers` | List containers in a database |

### azure-staticwebapp

Read-only Static Web Apps inventory. Creation is excluded (real deployments are repo/CI-wired); app settings and deployment tokens are secret material and never flow through model data.

| Method | Description |
|---|---|
| `list` | List Static Web Apps in a resource group or subscription |
| `get` | Get a Static Web App |
| `sync` | Refresh stored state without making changes |
| `listEnvironments` | List deployment environments (including production) |

### azure-servicebus

Read-only Service Bus inventory; queue/topic entities carry message-depth attributes for monitoring. Authorization rules and SAS keys are excluded.

| Method | Description |
|---|---|
| `listNamespaces` | List Service Bus namespaces |
| `getNamespace` | Get a namespace |
| `syncNamespace` | Refresh stored state without making changes |
| `listQueues` | List queues in a namespace |
| `listTopics` | List topics in a namespace |
| `listSubscriptions` | List subscriptions on a topic |

### azure-eventgrid

Read-only Event Grid inventory.

| Method | Description |
|---|---|
| `listTopics` | List custom topics |
| `getTopic` | Get a custom topic |
| `syncTopic` | Refresh stored state without making changes |
| `listSystemTopics` | List system topics |
| `listSubscriptions` | List event subscriptions for a source resource id |

### azure-postgres-flexible-server

Read-only inventory of the Flexible Server offering (not the retired single server). Server, database, and firewall lifecycle stay out of scope, and no method returns connection credentials. Contributed by [@NeilHanlon](https://github.com/NeilHanlon).

| Method | Description |
|---|---|
| `list` | List flexible servers in a resource group or subscription |
| `get` | Get a flexible server (SKU, storage, HA, backup, network exposure) |
| `sync` | Refresh stored state without making changes |
| `listDatabases` | List databases on a server |
| `listFirewallRules` | List public-access firewall rules on a server |

### azure-recovery-services-vault

Read-only view of backup posture. Contributed by [@NeilHanlon](https://github.com/NeilHanlon).

| Method | Description |
|---|---|
| `list` | List Recovery Services vaults in a resource group or subscription |
| `get` | Get a vault |
| `sync` | Refresh stored state without making changes |
| `listBackupItems` | List the items protected by a vault |

### azure-log-analytics-workspace

Read-only workspace inventory — the ingestion side of Azure Monitor. Shared keys are never fetched. Contributed by [@NeilHanlon](https://github.com/NeilHanlon).

| Method | Description |
|---|---|
| `list` | List Log Analytics workspaces in a resource group or subscription |
| `get` | Get a workspace (SKU, retention, ingestion settings) |
| `sync` | Refresh stored state without making changes |

### azure-network-interface

Read-only NIC inventory — the join point between VMs, subnets, NSGs, and IPs that `azure-topology` approximates. Contributed by [@NeilHanlon](https://github.com/NeilHanlon).

| Method | Description |
|---|---|
| `list` | List network interfaces in a resource group or subscription |
| `get` | Get a NIC (IP configurations, attached VM, NSG, DNS settings) |
| `sync` | Refresh stored state without making changes |

## Workflows

| Workflow | Description |
|---|---|
| `@dougschaefer/provision-entra-user` | Operator-facing entrypoint that takes non-secret user fields (`displayName`, `userPrincipalName`, optional `mailNickname`) and delegates to `azure-ad-user.provision`. The temp password is generated inside the model and never crosses an input, log, audit entry, or stored resource. Expects an `azure-ad-user` instance named `entra-users`. |
| `@dougschaefer/azure-rbac-audit` | Read-only subscription RBAC snapshot for access reviews: every role assignment at every scope (including management-group inheritance on az CLI 2.87+), every deny assignment, and every custom role definition, captured as versioned model data. Pass `fast: true` to skip principal/role-name resolution on large tenants. Expects an `azure-role-assignment` instance named `rbac-assignments`. |
| `@dougschaefer/azure-ai-inventory` | Read-only subscription AI footprint snapshot: every AI Services account, every model deployment (single fan-out run), and every AI Search service. Expects an `azure-ai-foundry` instance named `ai-foundry` and an `azure-ai-search` instance named `ai-search`. |

## Installation

```bash
swamp extension pull @dougschaefer/azure
```

## Setup

All models authenticate through the Azure CLI, so you need `az` installed and an active login session before running any methods.

1. Install the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and authenticate:

```bash
az login
```

2. Create a swamp vault and store your subscription ID:

```bash
swamp vault create azure --type local_encryption
swamp vault set azure SUBSCRIPTION_ID <your-subscription-id>
```

3. Create a model instance, wiring the subscription ID from vault:

```bash
swamp model create @dougschaefer/azure-vm my-vms --json
```

When prompted for the `subscriptionId` global argument, use the vault expression `${{ vault.get('azure', 'SUBSCRIPTION_ID') }}`. You can also set a default resource group at this point, which saves you from passing it on every method call.

4. Run methods against the instance:

```bash
swamp model method run my-vms list --json
```

For the DevOps model, you will need a separate vault entry for your organization URL:

```bash
swamp vault set azure-devops ORG_URL https://dev.azure.com/your-org
```

The `azure-face` model does not use the `az` session. Create a dedicated vault and store the Face resource endpoint and subscription key:

```bash
swamp vault create azure-face --type local_encryption
swamp vault set azure-face endpoint https://<resource>.cognitiveservices.azure.com
swamp vault set azure-face key <subscription-key>
```

Wire them into the instance global arguments as `${{ vault.get(azure-face, endpoint) }}` and `${{ vault.get(azure-face, key) }}`. `detect` works on any tier; `identify`/enrollment/training require Microsoft Limited Access.

The Entra ID models (`azure-ad-*`) are tenant-scoped rather than subscription-scoped: they take no `subscriptionId` and run `az ad` against whatever tenant your `az login` session is signed in to. They require directory read permissions (e.g. Directory Readers / `Directory.Read.All`), and credential and membership writes require the corresponding directory roles. The `azure-defender` model requires the Security Reader role to read posture, and Security Admin to change pricing tiers.

## API Compatibility

All operations shell out to Azure CLI 2.x via `Deno.Command` subprocess with an args array (no shell interpolation). The topology model's `costEstimate` method calls the [Azure Retail Pricing API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices) directly via fetch, which is public and requires no authentication.

Tested against Azure CLI 2.67+ and the current Azure Resource Manager API versions as of March 2026. Resource group operations and ARM template export use whichever API versions the installed CLI targets.

## License

MIT
