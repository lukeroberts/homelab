# Checkmk system Apache startup

The official Docker image normally serves the site on port 5000. The built-in
MCP server also needs OAuth discovery and issuer routes outside the site prefix;
Checkmk generates those routes for system Apache on port 80.

This Compose file installs executable `pre-start` and `post-start` hooks inside the container
before handing control to the original `/docker-entrypoint.sh`. The image runs
them around site startup. On every start the hooks:

1. Before starting the site, sets `APACHE_FORWARDED_HEADERS` to `manual`.
2. After starting the site, runs `omd update-apache-config "$CMK_SITE_ID"` as root.
3. Checks Apache configuration syntax.
4. Ensures system Apache is started.

The `manual` setting preserves the `X-Forwarded-Proto` header supplied by the
TLS-terminating reverse proxy. The default `auto` setting replaces it with the
scheme of the connection to system Apache (HTTP), causing OAuth to advertise
HTTP resources even when clients connect using HTTPS. The setting is persisted
in the site volume and reasserted on every startup. This deployment assumes a
trusted reverse proxy supplies the scheme header; do not expose the container's
HTTP frontend directly to untrusted clients.

The hook deliberately runs every time, not just after a version upgrade. A
same-version container replacement can retain the site volume but lose the
system-level Apache configuration. Failures propagate to the vendor entrypoint
rather than silently reporting a successful startup.

The inline wrapper avoids a repository-relative bind mount, which would require
additional host-path handling for a Portainer Git-backed deployment. It uses
`exec` to preserve the vendor entrypoint as PID 1 and forwards any arguments.

The healthcheck retains `omd status` and requests both OAuth metadata documents
through port 80 with a synthetic HTTPS forwarded header. It validates the exact
HTTPS resource, issuer, and authorization/token/registration endpoint URLs.
This tests the container's forwarding behavior, not external TLS or proxy reachability.
Docker marking a container unhealthy does not itself
restart it. The existing reverse proxy should continue forwarding to the
container's port 80; this change adds no published ports and does not modify the
reverse proxy, site volume, image version, MCP enablement, or OAuth permissions.

This is deployment glue using the image's existing hook mechanism and Checkmk's
documented command, not a claim that the MCP KB documents this complete Docker
recipe. Future image upgrades should be checked for entrypoint/hook changes.

## Validation

From the repository root:

```sh
CMK_PASSWORD=test-only docker compose -f docker/checkmk/docker-compose.yml config --quiet
python3 -m unittest discover -s docker/checkmk/tests -v
git diff --check
```

The tests use the Compose CLI for rendering and command stubs to exercise the
real wrapper/hook shell code. They do not require a Docker daemon or credentials.
They cover argument forwarding, hook permissions, repeated startup, failures,
a missing site ID, and rejection of HTTP OAuth metadata by the healthcheck. They are not a substitute for a
real-image restart/recreation test.

Before deployment, test the exact image in an isolated Docker project with a
new disposable site volume, no production mounts or credentials, no published
ports, and explicit CPU/memory limits on a host with sufficient spare capacity.
Verify the UI and both OAuth metadata documents, MCP service status, and denial
of public access to `/<site>/check_mk/oauth_introspect.py`. Repeat after a restart
and a same-version forced recreation while retaining the disposable site volume.
Remove the test containers, volume, and network afterward.

References:

- [Using the Checkmk MCP Server](https://checkmk.atlassian.net/wiki/spaces/KB/pages/1356660737/Using+the+Checkmk+MCP+Server)
- [Werk 22263: MCP server and system Apache discovery routes](https://checkmk.com/werk/22263)
- [Checkmk Docker entrypoint](https://github.com/Checkmk/checkmk/blob/master/docker_image/docker-entrypoint.sh)
