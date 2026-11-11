import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("cloud_shell_compare", ROOT / "scripts/cloud-shell-compare.py")
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def service(env, annotations=None):
    return {"metadata": {"name": "orihani-chart"}, "spec": {"template": {
        "metadata": {"annotations": annotations or {}}, "spec": {"containers": [{"env": env}]}}}}


def plain_service():
    return service([{"name": name, "value": "fake-key-for-" + name} for name in runner.KEY_NAMES])


class CloudShellCompareTests(unittest.TestCase):
    def test_child_setup_environment_scrubs_credentials_and_disables_gcloud_logs(self):
        scrubbed = (*runner.KEY_NAMES, "OPENAI_API_KEY1", "GOOGLE_API_KEY", "NODE_OPTIONS", "GOOGLE_GEMINI_BASE_URL", "GOOGLE_VERTEX_BASE_URL", "GOOGLE_GENAI_USE_VERTEXAI")
        with patch.dict(os.environ, {name: "SENSITIVE" for name in scrubbed}):
            env = runner.clean_environment()
        for name in scrubbed:
            self.assertNotIn(name, env)
        self.assertEqual(env["CLOUDSDK_CORE_LOG_HTTP"], "false")
        self.assertEqual(env["CLOUDSDK_CORE_DISABLE_FILE_LOGGING"], "true")

    def test_gcloud_failure_never_exposes_raw_output_or_error(self):
        failed = subprocess.CompletedProcess(["gcloud"], 1, "RAW-SECRET-STDOUT", "RAW-SECRET-STDERR")
        with patch.object(runner.subprocess, "run", return_value=failed) as execute:
            with self.assertRaisesRegex(runner.SetupError, "fixed error") as caught:
                runner.captured(["gcloud", "config", "get-value", "project"], error="fixed error")
        self.assertNotIn("RAW-SECRET", str(caught.exception))
        self.assertEqual(execute.call_args.kwargs["stdout"], subprocess.PIPE)
        self.assertEqual(execute.call_args.kwargs["stderr"], subprocess.PIPE)

    def test_exact_service_and_single_container_required(self):
        good = {"metadata": {"name": "orihani-chart", "labels": {"cloud.googleapis.com/location": "asia-northeast3"}}}
        self.assertEqual(runner.select_service_region([good]), "asia-northeast3")
        for entries in ([], [good, good], [{"metadata": {"name": "orihani-translate"}}]):
            with self.assertRaises(runner.SetupError):
                runner.select_service_region(entries)
        described = plain_service()
        described["spec"]["template"]["spec"]["containers"].append({"env": []})
        with self.assertRaises(runner.SetupError):
            runner.extract_key_sources(described, "fixture-project")

    def test_plain_keys_need_no_secret_manager_and_are_not_in_repr(self):
        sources = runner.extract_key_sources(plain_service(), "fixture-project")
        with patch.object(runner, "captured", side_effect=AssertionError("Unexpected secret read")):
            keys = runner.resolve_keys(sources)
        for name in runner.KEY_NAMES:
            self.assertEqual(keys[name], "fake-key-for-" + name)
            self.assertNotIn(keys[name], repr(sources))

    def test_cross_project_alias_and_versions_are_honored(self):
        described = service([
            {"name": "OPENAI_API_KEY", "valueFrom": {"secretKeyRef": {"name": "openai-alias", "key": "2"}}},
            {"name": "GEMINI_API_KEY", "valueFrom": {"secretKeyRef": {"name": "gemini-secret", "key": "latest"}}},
        ], {"run.googleapis.com/secrets": "openai-alias:projects/other-project/secrets/openai-secret"})
        sources = runner.extract_key_sources(described, "fixture-project")
        with patch.object(runner, "captured", side_effect=["FAKE-OPENAI", "FAKE-GEMINI"]) as execute:
            self.assertEqual(runner.resolve_keys(sources), {"OPENAI_API_KEY": "FAKE-OPENAI", "GEMINI_API_KEY": "FAKE-GEMINI"})
        commands = [call.args[0] for call in execute.call_args_list]
        self.assertEqual(commands[0], ["gcloud", "secrets", "versions", "access", "2", "--secret", "openai-secret", "--project", "other-project", "--quiet"])
        self.assertIn("fixture-project", commands[1])

    def test_duplicate_keys_and_mixed_value_reference_are_rejected(self):
        described = plain_service()
        env = described["spec"]["template"]["spec"]["containers"][0]["env"]
        env.append(dict(env[0]))
        with self.assertRaises(runner.SetupError):
            runner.extract_key_sources(described, "fixture-project")
        env.pop()
        env[0]["valueFrom"] = {"secretKeyRef": {"name": "other", "key": "1"}}
        with self.assertRaises(runner.SetupError):
            runner.extract_key_sources(described, "fixture-project")

    def test_live_keys_go_to_direct_node_only_and_output_stays_captured(self):
        child = Mock(returncode=0)
        child.communicate.return_value = (b"SHOULD-NOT-PRINT", b"SHOULD-NOT-PRINT")
        child.poll.return_value = 0
        observed = {}
        def launch(command, **kwargs):
            observed.update(command=command, env=dict(kwargs["env"]), stdout=kwargs["stdout"], stderr=kwargs["stderr"], pass_fds=kwargs["pass_fds"])
            return child
        output = io.StringIO()
        keys = {"OPENAI_API_KEY": "FAKE-OPENAI", "GEMINI_API_KEY": "FAKE-GEMINI"}
        with patch.object(runner.subprocess, "Popen", side_effect=launch), contextlib.redirect_stdout(output):
            self.assertEqual(runner.run_comparison(Path("/repo"), Path("/result"), keys, lock_fd=123), 0)
        self.assertEqual(observed["command"][:3], ["node", "--experimental-strip-types", "scripts/compare-ai.ts"])
        self.assertEqual(observed["env"]["OPENAI_API_KEY"], "FAKE-OPENAI")
        self.assertEqual(observed["env"]["ORI_COMPARISON_COMMIT"], runner.PINNED_COMMIT)
        self.assertIn("--resume", observed["command"])
        self.assertEqual(observed["pass_fds"], (123,))
        self.assertNotIn("FAKE-OPENAI", " ".join(observed["command"]))
        self.assertEqual(observed["stdout"], subprocess.PIPE)
        self.assertEqual(observed["stderr"], subprocess.PIPE)
        self.assertNotIn("SHOULD-NOT-PRINT", output.getvalue())

    def test_progress_reconstructs_only_known_events_and_hides_raw_output(self):
        event = {"index": 1, "total": 14, "caseId": "chart-mild-pain", "engine": "gemini", "status": "completed"}
        data = b"raw SECRET must not appear\nORI_PROGRESS " + json.dumps(event).encode() + b"\nORI_PROGRESS {\"caseId\":\"SECRET\"}\n"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            offset = runner.emit_progress(data, 0)
            runner.emit_progress(data + b"incomplete", offset)
        self.assertEqual(output.getvalue().count("[1/14]"), 1)
        self.assertIn("완료·저장됨", output.getvalue())
        self.assertNotIn("SECRET", output.getvalue())

    def test_persistent_output_is_private_and_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner.Path, "home", return_value=Path(temporary)):
            output = runner.persistent_output("fixture-project", "asia-northeast3")
            self.assertTrue(output.is_relative_to(Path(temporary)))
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            (output / "comparison.json").symlink_to(Path(temporary) / "somewhere")
            with self.assertRaises(runner.SetupError):
                runner.persistent_output("fixture-project", "asia-northeast3")

    def test_ctrl_c_preserves_checkpoint_outside_temporary_checkout(self):
        described = plain_service()
        def capture(command, **kwargs):
            if command[:2] == ["node", "--version"]:
                return "v22.16.0"
            if command[:4] == ["gcloud", "config", "get-value", "project"]:
                return "fixture-project"
            if command[:4] == ["gcloud", "run", "services", "list"]:
                return json.dumps([{"metadata": {"name": "orihani-chart", "labels": {"cloud.googleapis.com/location": "asia-northeast3"}}}])
            if command[:4] == ["gcloud", "run", "services", "describe"]:
                return json.dumps(described)
            if command == ["git", "rev-parse", "HEAD"]:
                return runner.PINNED_COMMIT
            return ""
        def interrupted(repo, output, keys, *, lock_fd=None, baseline=None):
            self.assertIsInstance(lock_fd, int)
            self.assertIsNone(baseline)
            (output / "comparison.json").write_text('{"saved":true}')
            raise KeyboardInterrupt()
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner.Path, "home", return_value=Path(temporary)), \
                patch.object(runner.shutil, "which", return_value="/fake/tool"), \
                patch.object(runner, "captured", side_effect=capture), \
                patch.object(runner, "run_comparison", side_effect=interrupted), contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertEqual(runner.main([]), 130)
            output = runner.persistent_output("fixture-project", "asia-northeast3")
            self.assertEqual((output / "comparison.json").read_text(), '{"saved":true}')
            self.assertIn("저장된 결과는 유지", stdout.getvalue())
            self.assertFalse(list(Path(temporary).glob("*.zip")))

    def test_existing_baseline_is_selected_without_modification(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner.Path, "home", return_value=Path(temporary)):
            directory = Path(temporary) / "orihani-ai-comparison" / "fixture-project" / "asia-northeast3" / runner.GEMINI_BASELINE_COMMIT
            directory.mkdir(parents=True)
            report = directory / "comparison.json"
            report.write_text('{"original":true}', encoding="utf-8")
            self.assertEqual(runner.existing_gemini_baseline("fixture-project", "asia-northeast3"), report)
            self.assertEqual(report.read_text(encoding="utf-8"), '{"original":true}')
            self.assertEqual(list(directory.iterdir()), [report])

    def test_missing_or_invalid_baseline_never_creates_fresh_output(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner.Path, "home", return_value=Path(temporary)):
            for project, region in (("fixture-project", "asia-northeast3"), ("../other", "asia-northeast3"), ("fixture-project", "../other")):
                with self.subTest(project=project, region=region), self.assertRaises(runner.SetupError):
                    runner.existing_gemini_baseline(project, region)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_baseline_symlink_report_and_ancestor_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner.Path, "home", return_value=Path(temporary)):
            directory = Path(temporary) / "orihani-ai-comparison" / "fixture-project" / "asia-northeast3" / runner.GEMINI_BASELINE_COMMIT
            directory.mkdir(parents=True)
            target = Path(temporary) / "source.json"
            target.write_text("{}", encoding="utf-8")
            report = directory / "comparison.json"
            report.symlink_to(target)
            with self.assertRaises(runner.SetupError):
                runner.existing_gemini_baseline("fixture-project", "asia-northeast3")
            report.unlink()
            directory.rmdir()
            directory.symlink_to(Path(temporary), target_is_directory=True)
            with self.assertRaises(runner.SetupError):
                runner.existing_gemini_baseline("fixture-project", "asia-northeast3")

    def test_candidate_child_receives_baseline_path_as_separate_argument(self):
        child = Mock(returncode=0)
        child.communicate.return_value = (b"", b"")
        child.poll.return_value = 0
        baseline = Path("/old reports/comparison.json")
        keys = {"OPENAI_API_KEY": "FAKE-OPENAI", "GEMINI_API_KEY": "FAKE-GEMINI"}
        with patch.object(runner.subprocess, "Popen", return_value=child) as launch:
            self.assertEqual(runner.run_comparison(Path("/repo"), Path("/new"), keys, baseline=baseline), 0)
        command = launch.call_args.args[0]
        self.assertEqual(command[-2:], ["--baseline", str(baseline)])
        self.assertEqual(command.count("--baseline"), 1)
        self.assertNotIn("FAKE-OPENAI", " ".join(command))
        self.assertTrue(launch.call_args.kwargs["start_new_session"])

    def test_missing_baseline_stops_before_service_details_or_key_reads(self):
        commands = []
        def capture(command, **kwargs):
            commands.append(command)
            if command[:2] == ["node", "--version"]:
                return "v22.16.0"
            if command[:4] == ["gcloud", "config", "get-value", "project"]:
                return "fixture-project"
            if command[:4] == ["gcloud", "run", "services", "list"]:
                return json.dumps([{"metadata": {"name": "orihani-chart", "labels": {"cloud.googleapis.com/location": "asia-northeast3"}}}])
            raise AssertionError("Unexpected command after missing baseline")
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner.Path, "home", return_value=Path(temporary)), \
                patch.object(runner.shutil, "which", return_value="/fake/tool"), \
                patch.object(runner, "captured", side_effect=capture), \
                patch.object(runner, "resolve_keys", side_effect=AssertionError("Unexpected key read")), \
                patch.object(runner, "run_comparison", side_effect=AssertionError("Unexpected model request")), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(runner.SetupError):
                runner.main(["--reuse-gemini"])
        self.assertEqual(len(commands), 3)

    def test_reuse_gemini_dry_run_does_not_access_baseline_or_cloud(self):
        def capture(command, **kwargs):
            self.assertNotEqual(command[0], "gcloud")
            if command[:2] == ["node", "--version"]:
                return "v22.16.0"
            if command == ["git", "rev-parse", "HEAD"]:
                return runner.PINNED_COMMIT
            return ""
        with patch.object(runner.shutil, "which", return_value="/fake/tool"), \
                patch.object(runner, "captured", side_effect=capture), \
                patch.object(runner, "existing_gemini_baseline", side_effect=AssertionError("Unexpected baseline lookup")), \
                patch.object(runner, "resolve_keys", side_effect=AssertionError("Unexpected key read")), \
                patch.object(runner, "run_comparison", side_effect=AssertionError("Unexpected model request")), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(["--dry-run", "--reuse-gemini"]), 0)

    def test_node_inherits_lock_even_if_parent_handle_closes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / ".lock"
            with path.open("w") as lock:
                runner.fcntl.flock(lock, runner.fcntl.LOCK_EX | runner.fcntl.LOCK_NB)
                child = subprocess.Popen(["node", "-e", "console.log('ready'); setTimeout(() => {}, 10000)"],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                         pass_fds=(lock.fileno(),))
                self.assertEqual(child.stdout.readline().strip(), "ready")
            try:
                with path.open("w") as next_owner:
                    with self.assertRaises(BlockingIOError):
                        runner.fcntl.flock(next_owner, runner.fcntl.LOCK_EX | runner.fcntl.LOCK_NB)
            finally:
                child.terminate()
                child.communicate(timeout=5)

    def test_zip_contains_only_reports_and_rejects_key_leakage(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            output = home / "results"
            output.mkdir()
            (output / "comparison.json").write_text(json.dumps({"cases": [{"runs": [{"status": "completed"}, {"status": "failed"}]}]}))
            (output / "comparison.html").write_text("<p>synthetic output</p>")
            (output / "unrelated.env").write_text("must not be archived")
            keys = {"OPENAI_API_KEY": "FAKE-OPENAI-KEY", "GEMINI_API_KEY": "FAKE-GEMINI-KEY"}
            with patch.object(runner.Path, "home", return_value=home):
                archive, count, failures = runner.archive_results(output, keys)
                self.assertEqual((count, failures), (1, 1))
                with zipfile.ZipFile(archive) as bundle:
                    self.assertEqual(set(bundle.namelist()), {"comparison.json", "comparison.html"})
                (output / "comparison.html").write_text("FAKE-OPENAI-KEY")
                with self.assertRaises(runner.SetupError):
                    runner.archive_results(output, keys)
                self.assertEqual(len(list(home.glob("*.zip"))), 1)


if __name__ == "__main__":
    unittest.main()
