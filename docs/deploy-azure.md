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
$pg = Read-Host "Postgres admin password" -AsSecureString
$pgPw = [System.Net.NetworkCredential]::new('', $pg).Password
az deployment group create -g $rg -n main -f infra/main.bicep -p infra/main.parameters.json -p clientIp=$myIp pgAdminPassword=$pgPw
```

`pgAdminPassword` (12+ characters, mixing upper case, lower case, digits and symbols) must be passed
as above: it is optional in the template (not needed with an existing server), so the CLI does not
prompt for it. The CLI prompts for the rest:

- `agentDbPassword`: 16+ characters. Avoid `@ : / ? #` to keep connection strings simple.
- `modelApiKey`: your Meta Model API key.
- `authSecret`: 32+ random characters that sign session cookies. Generate one with
  `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})`.

Microsoft sign-in is optional: add `-p authMicrosoftClientId=<id> authMicrosoftClientSecret=<secret>`
(see 3b). Without it, the sign-in page offers only "Try the demo (no account)".

Keep both passwords in your password manager. Then read the outputs:

```powershell
az deployment group show -g $rg -n main --query properties.outputs -o json
```

Note `webAppName`, `webAppUrl` and `adminConnectionTemplate`.

### Already have a PostgreSQL Flexible Server?

Use it instead of creating one: switch on PostGIS, add a `lumina` database, and let Azure services
(the web app) connect. Then deploy only the app with `existingPostgresHost`.

```powershell
$pg = "<server name>"   # e.g. the part before .postgres.database.azure.com
az postgres flexible-server show -g $rg -n $pg --query "{tier:sku.tier, sku:sku.name, version:version}" -o table
az postgres flexible-server parameter show -g $rg -s $pg -n azure.extensions --query value -o tsv
az postgres flexible-server parameter set -g $rg -s $pg -n azure.extensions -v POSTGIS
az postgres flexible-server db create -g $rg -s $pg -d lumina
az postgres flexible-server firewall-rule create -g $rg -n $pg -r AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
az deployment group create -g $rg -n main -f infra/main.bicep -p infra/main.parameters.json -p existingPostgresHost="$pg.postgres.database.azure.com" pgAdminLogin=<admin login>
```

If the second command already lists other extensions, keep them: pass the full comma-separated
list with POSTGIS added (for example `-v PG_STAT_STATEMENTS,POSTGIS`). The first command shows the
tier; General Purpose costs several times more than Burstable, and Burstable B1ms is enough here.

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
npm run db:setup -- --agent-login --seed-demo --load-real
```

`--load-real` loads the processed NSW data from `data/derived` (sales, patronage, land use and,
if present, SAM 3.1 cover) over the demo data; it takes several minutes over the network. After a
new `npm run sam:batch`, load only the cover with `npm run db:setup -- --load-cover`.

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

The subjects in `infra/oidc/*.json` use GitHub's ID-based format
(`repo:<owner>@<owner id>/<repo>@<repo id>:environment:<env>`), which this organisation sends. If a
deploy fails with AADSTS700213, copy the subject from the error into the JSON and create the
credential again.

Tell GitHub about it:

```powershell
gh secret set AZURE_CLIENT_ID --body $appId
gh secret set AZURE_TENANT_ID --body $tenant
gh secret set AZURE_SUBSCRIPTION_ID --body $sub
gh variable set AZURE_WEBAPP_NAME --body "<webAppName>"
gh variable set AZURE_DEPLOY_ON_PUSH --body "true"
```

## 3b. Sign-in settings

The portal and API require sign-in. `AUTH_SECRET`, `AUTH_URL` and the Microsoft settings are set by
the Bicep deployment. To change them later, open the Web App → Settings → Environment variables:

| Name | Value |
| --- | --- |
| `AUTH_SECRET` | 32+ random characters (different from your local one) |
| `AUTH_MICROSOFT_CLIENT_ID` | Application (client) ID of the Entra app registration |
| `AUTH_MICROSOFT_CLIENT_SECRET` | Client secret value |
| `AUTH_MICROSOFT_TENANT` | Optional: your tenant ID, to accept only accounts from your organisation |
| `LUMINA_API_KEYS` | Optional, comma-separated 24+ character keys for the Quest app |

Setting these with `az webapp config appsettings set` works, but a later Bicep deployment without
`authMicrosoftClientId`/`authMicrosoftClientSecret` clears them; pass both when you re-run it.

In the Entra app registration, add the redirect URI
`https://<web-app-name>.azurewebsites.net/api/auth/callback/microsoft` (platform: Web).
Judges use "Try the demo (no account)", which needs no account; set `AUTH_DEMO_DISABLED=1` after judging.

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
