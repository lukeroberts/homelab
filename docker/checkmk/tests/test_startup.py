"""Startup regression tests using command stubs, not production credentials.

Run: python3 -m unittest discover -s docker/checkmk/tests -v
Requires Docker Compose; no Docker daemon is needed for these unit tests.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.yml"


class StartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = {**os.environ, "CMK_PASSWORD": "test-only", "CMK_SITE_ID": "testsite"}
        result = subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE), "config", "--format", "json"],
            env=env, check=True, capture_output=True, text=True,
        )
        cls.service = json.loads(result.stdout)["services"]["checkmk"]

    def setUp(self):
        self.assertTrue(self.service.get("entrypoint"), "No durable Apache startup hook")
        self.entrypoint = self.service["entrypoint"]
        self.assertEqual(self.entrypoint[:2], ["/bin/bash", "-ec"])
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.hooks = self.root / "hooks"
        self.log = self.root / "calls"
        vendor = self.root / "vendor.sh"
        vendor.write_text(
            '#!/bin/sh\nset -eu\n'
            'test "$1" = "argument with spaces"\n'
            'test -x "$HOOKROOT/post-start/10-system-apache.sh"\n'
            '"$HOOKROOT/post-start/10-system-apache.sh"\n'
        )
        vendor.chmod(0o755)
        commands = self.root / "bin"
        commands.mkdir()
        for command in ("omd", "apache2ctl", "service"):
            stub = commands / command
            stub.write_text(
                '#!/bin/sh\n'
                f'printf "%s\\n" "{command} $*" >> "$CALL_LOG"\n'
                f'test "${{FAIL_COMMAND:-}}" != "{command}"\n'
            )
            stub.chmod(0o755)
        # Compose config output retains $$; container creation resolves it to $.
        # Full real-image restart/recreation validation is a separate deployment gate.
        self.script = self.entrypoint[2].replace("$$", "$").replace(
            "/docker-entrypoint.d", str(self.hooks)
        ).replace("/docker-entrypoint.sh", str(vendor))
        self.env = {
            **os.environ, "PATH": f"{commands}:{os.environ['PATH']}",
            "CMK_SITE_ID": "testsite", "CALL_LOG": str(self.log),
            "HOOKROOT": str(self.hooks), "FAIL_COMMAND": "",
        }

    def run_wrapper(self):
        return subprocess.run(
            [*self.entrypoint[:2], self.script, "test-wrapper", "argument with spaces"],
            env=self.env, capture_output=True, text=True,
        )

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_installs_executable_hook_and_preserves_vendor_arguments(self):
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [
            "omd update-apache-config testsite", "apache2ctl configtest", "service apache2 start",
        ])
        self.assertTrue(os.access(self.hooks / "post-start/10-system-apache.sh", os.X_OK))

    def test_every_start_regenerates_configuration(self):
        for _ in range(2):
            result = self.run_wrapper()
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls().count("omd update-apache-config testsite"), 2)
        self.assertEqual(self.calls().count("service apache2 start"), 2)

    def test_update_failure_aborts_startup(self):
        self.env["FAIL_COMMAND"] = "omd"
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertEqual(self.calls(), ["omd update-apache-config testsite"])

    def test_invalid_apache_configuration_aborts_startup(self):
        self.env["FAIL_COMMAND"] = "apache2ctl"
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertEqual(self.calls(), ["omd update-apache-config testsite", "apache2ctl configtest"])

    def test_service_start_failure_is_propagated(self):
        self.env["FAIL_COMMAND"] = "service"
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertEqual(self.calls()[-1], "service apache2 start")

    def test_missing_site_id_does_not_target_another_site(self):
        self.env.pop("CMK_SITE_ID")
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_healthcheck_covers_port_80(self):
        healthcheck = self.service.get("healthcheck", {}).get("test", [])
        self.assertTrue(healthcheck, "Image healthcheck does not cover system Apache")
        self.assertIn("omd status", healthcheck[-1])
        self.assertIn("http://127.0.0.1:80/", healthcheck[-1])
        self.assertIn("curl", healthcheck[-1])


if __name__ == "__main__":
    unittest.main()
