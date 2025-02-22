import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { PlusCircleIcon } from "@heroicons/react/24/solid";
import type { LoaderArgs } from "@remix-run/server-runtime";
import type { IntegrationMetadata } from "@trigger.dev/integration-sdk";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import invariant from "tiny-invariant";
import { ApiLogoIcon } from "~/components/code/ApiLogoIcon";
import type { Status } from "~/components/integrations/ConnectButton";
import { ConnectButton } from "~/components/integrations/ConnectButton";
import { Container } from "~/components/layout/Container";
import { List } from "~/components/layout/List";
import { Body } from "~/components/primitives/text/Body";
import { Header3 } from "~/components/primitives/text/Headers";
import { SubTitle } from "~/components/primitives/text/SubTitle";
import { Title } from "~/components/primitives/text/Title";
import { useCurrentOrganization } from "~/hooks/useOrganizations";
import { getConnectedApiConnectionsForOrganizationSlug } from "~/models/apiConnection.server";
import { getIntegrationMetadatas } from "~/models/integrations.server";
import { requireUser } from "~/services/session.server";
import { formatDateTime } from "~/utils";
import { findIntegrationMetadata } from "~/utils/integrationMetadata";

export const loader = async ({ request, params }: LoaderArgs) => {
  const user = await requireUser(request);

  const { organizationSlug } = params;
  invariant(organizationSlug, "organizationSlug not found");

  const connections = await getConnectedApiConnectionsForOrganizationSlug({
    slug: organizationSlug,
  });

  return typedjson({
    connections,
    integrations: getIntegrationMetadatas(user.admin),
  });
};

export default function Integrations() {
  const { connections, integrations } = useTypedLoaderData<typeof loader>();
  const organization = useCurrentOrganization();
  invariant(organization, "Organization not found");

  return (
    <Container>
      <Title>API Integrations</Title>
      <div>
        {connections.length === 0 ? (
          <></>
        ) : (
          <>
            <SubTitle>
              {connections.length} connected API
              {connections.length > 1 ? "s" : ""}
            </SubTitle>
            <List>
              {connections.map((connection) => {
                return (
                  <li key={connection.id}>
                    <div className="flex gap-4 items-center px-4 py-4">
                      <ApiLogoIcon
                        integration={findIntegrationMetadata(
                          integrations,
                          connection.apiIdentifier
                        )}
                        size="regular"
                      />
                      <div className="flex flex-col gap-2">
                        <div>
                          <Header3
                            size="extra-small"
                            className="truncate font-medium"
                          >
                            {connection.title}
                          </Header3>
                          <Body size="small" className="text-slate-400">
                            Added {formatDateTime(connection.createdAt)}
                          </Body>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </List>
          </>
        )}
      </div>

      <div>
        <SubTitle>Add an API integration</SubTitle>
        <div className="flex flex-wrap gap-2 w-full">
          {integrations.map((integration) => (
            <ConnectButton
              key={integration.slug}
              integration={integration}
              organizationId={organization.id}
              className="flex flex-col group max-w-[160px] rounded-md bg-slate-800 border border-slate-800 gap-4 text-sm text-slate-200 items-center overflow-hidden hover:bg-slate-800/30 transition shadow-md disabled:opacity-50"
            >
              {(status) => (
                <AddButtonContent integration={integration} status={status} />
              )}
            </ConnectButton>
          ))}
          <a
            href="mailto:hello@trigger.dev"
            className="flex flex-col group max-w-[160px] rounded-md bg-slate-800 border border-slate-800 gap-4 text-sm text-slate-200 items-center overflow-hidden hover:bg-slate-800/30 transition shadow-md disabled:opacity-50"
          >
            <div className="relative flex items-center justify-center w-full py-6 bg-black/20 border-b border-slate-800">
              <EnvelopeIcon className="h-20 w-20 text-slate-400" />
            </div>
            <div className="flex flex-col items-center justify-center text-center leading-relaxed text-slate-400">
              <span className="px-2.5">Need an integration?</span>
              <span className="px-6 text-slate-200 text-base">
                Let us know!
              </span>
            </div>
          </a>
        </div>
      </div>
    </Container>
  );
}

function AddButtonContent({
  integration,
  status,
}: {
  integration: IntegrationMetadata;
  status: Status;
}) {
  return (
    <>
      <div className="relative flex items-center justify-center w-full py-6 bg-black/20 border-b border-slate-800">
        <PlusCircleIcon className="absolute h-7 w-7 top-[6px] right-[6px] z-10 text-green-600 shadow-md" />
        <img
          src={integration.icon}
          alt={integration.name}
          className="h-20 group-hover:opacity-80 transition"
        />
      </div>

      {status === "loading" ? (
        <span className="px-6 pb-4 leading-relaxed text-green-500 animate-pulse">
          Connecting to{" "}
          <span className="text-slate-200 text-base">{integration.name}</span>
        </span>
      ) : (
        <span className="px-6 pb-4 leading-relaxed text-slate-400">
          Connect to{" "}
          <span className="text-slate-200 text-base">{integration.name}</span>
        </span>
      )}
    </>
  );
}
