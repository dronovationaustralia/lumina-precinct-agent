# Deploy to Azure

Lumina Precinct Agent runs on:

| Piece | Azure service | Default size |
| --- | --- | --- |
| App (portal + `/api/v1`) | App Service, Linux, Node 22, `node server.js` (Next.js standalone) | B1 plan |
| Database | Azure Database for PostgreSQL Flexible Server 16 with PostGIS | Burstable B1ms, 32 GB |
| Deploys | GitHub Actions with OpenID Connect (no stored Azure password) | |

Region: Australia East (Sydney). The web apps connect as `lumina_agent`, a read-only login that can
only read the governed views. The admin password is used once, from your machine, to set up the
schema.

Commands below are for PowerShell with the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
and the [GitHub CLI](https://cli.github.com/). Run them from the repo folder.

## 1. Create the resources (about 10 minutes)

```powershell
az login
az account set --subscription "<your subscription name or id>"

$rg = "rg-lumina-precinct"
az group create -n $rg -l australiaeast

$myIp = (Invoke-RestMethod https://api.ipify.org)
az deployment group create -g $rg -n main -f infra/main.bicep -p infra/main.parameters.json -p clientIp=$myIp
```

The CLI prompts for the three secrets:

- `pgAdminPassword`: 12+ characters, mixing upper case, lower case, digits and symbols.
- `agentDbPassword`: 16+ characters. Avoid `@ : / ? #` to keep connection strings simple.
- `modelApiKey`: your Meta Model API key.

Keep both passwords in your password manager. Then read the outputs:

```powershell
az deployment group show -g $rg -n main --query properties.outputs -o json
```

Note `webAppName`, `webAppUrl` and `adminConnectionTemplate`.

## 2. Set up the database from your machine

Put these in `.env.local` (gitignored). Replace `<password>` in the admin template, URL-encoding any
special characters (for example `@` becomes `%40`):

```
DATABASE_URL=postgres://luminaadmin:<password>@<postgresHost>:5432/lumina?sslmode=require
AGENT_DB_PASSWORD=<the agentDbPassword you chose>
```

Then:

```powershell
npm install
npm run db:setup -- --agent-login --seed-demo
```

This applies `db/schema.sql` (PostGIS, governed views, the `agent_ro` role), creates the
`lumina_agent` login, and loads the labelled demo data until the real NSW data is ingested. It is
safe to run again.

Local development can now use the Azure database: keep `DATABASE_URL` in `.env.local` and run
`npm run dev`. Remove it to go back to the built-in PGlite database.

If your IP changes, allow the new one:

```powershell
az postgres flexible-server firewall-rule create -g $rg -n <postgresServerName> -r AllowDeveloperMachine --start-ip-address $myIp --end-ip-address $myIp
```

## 3. Connect GitHub Actions (once)

Create an identity GitHub can sign in as, scoped to this resource group:

```powershell
$sub = az account show --query id -o tsv
$tenant = az account show --query tenantId -o tsv
$appId = az ad app create --display-name "lumina-precinct-agent-deploy" --query appId -o tsv
az ad sp create --id $appId
az role assignment create --assignee $appId --role "Website Contributor" --scope "/subscriptions/$sub/resourceGroups/$rg"
az ad app federated-credential create --id $appId --parameters infra/oidc/hackathon.json
az ad app federated-credential create --id $appId --parameters infra/oidc/quest.json
```

Tell GitHub about it:

```powershell
gh secret set AZURE_CLIENT_ID --body $appId
gh secret set AZURE_TENANT_ID --body $tenant
gh secret set AZURE_SUBSCRIPTION_ID --body $sub
gh variable set AZURE_WEBAPP_NAME --body "<webAppName>"
gh variable set AZURE_DEPLOY_ON_PUSH --body "true"
```

## 4. Deploy

Every push to `main` now deploys to the hackathon app while `AZURE_DEPLOY_ON_PUSH` is `true`. To
deploy by hand:

```powershell
gh workflow run "Deploy to Azure" -f target=hackathon
gh run watch
```

The workflow runs the type check and tests, builds the standalone server, deploys it, and waits for
`/api/v1/health` to report `ok`. Open `webAppUrl` to see the portal.

## 5. Freeze for judging, then add the Quest deployment

Before submitting (5 Nov):

```powershell
gh variable set AZURE_DEPLOY_ON_PUSH --body "false"
```

Also add a required reviewer to the `hackathon` environment in GitHub (Settings, Environments) so
nothing deploys to it by accident during judging (5 to 9 Nov ET).

For the Quest app, create the second web app and point the `quest` target at it:

```powershell
az deployment group create -g $rg -n main -f infra/main.bicep -p infra/main.parameters.json -p clientIp=$myIp deployQuestApp=true
gh variable set AZURE_QUEST_WEBAPP_NAME --body "<questAppName from the outputs>"
gh workflow run "Deploy to Azure" -f target=quest
```

## Costs and housekeeping

Both default sizes are low-cost tiers billed by the hour; check the
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) for current Australia
East prices. Set a budget alert on the resource group. Do not stop the database during judging.

## Hardening after the hackathon

- Move `MODEL_API_KEY` and the database URL to Key Vault references.
- Replace the `AllowAzureServices` firewall rule (it admits any Azure-hosted client that has the
  password) with VNet integration and a private endpoint.
- Use Microsoft Entra authentication for the database instead of passwords.
- Upgrade the runtime to Node 24 LTS before App Service ends Node 22 support (30 Apr 2027).
