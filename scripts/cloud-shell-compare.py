#!/usr/bin/env python3
"""Read the existing Cloud Run configuration and compare synthetic cases only.

No deployment or cloud resource mutation. Credentials are captured in memory,
never printed or written to a key file, and passed only to the comparison child.
--dry-run does not access Cloud Run, Secret Manager, or either model API.
--config-check FILE checks an offline service-description fixture only.
--reuse-gemini reuses the completed first comparison's Gemini responses only.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

REPOSITORY = "https://github.com/kanata-git-hub/orihani-chart.git"
PINNED_COMMIT = "bcd998055187bbfd4dc223e14dbaa10b09ebf510"
GEMINI_BASELINE_COMMIT = "87dae4f47f6ba551bb02b4d0df4cb7bd86962b34"
SERVICE = "orihani-chart"
KEY_NAMES = ("OPENAI_API_KEY", "GEMINI_API_KEY")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
REGION = re.compile(r"[a-z]+-[a-z0-9-]+[0-9]\Z")
CASE_LABELS = {
    "chart-mild-pain": "초진 통증", "chart-traffic-injury": "초진 교통사고",
    "chart-digestion": "초진 소화기", "followup-improving": "재평가 호전",
    "followup-plateau": "재평가 정체", "followup-modifiers": "재평가 가감",
    "followup-constraints": "재평가 제약",
}


class SetupError(Exception):
    """Messages are fixed local strings and never contain subprocess output."""


@dataclass(repr=False)
class KeySource:
    kind: str
    value: str = field(default="", repr=False)
    project: str = ""
    secret: str = ""
    version: str = ""


def clean_environment() -> dict[str, str]:
    result = dict(os.environ)
    for name in (*KEY_NAMES, "OPENAI_API_KEY1", "GOOGLE_API_KEY", "NODE_OPTIONS",
                 "GOOGLE_GEMINI_BASE_URL", "GOOGLE_VERTEX_BASE_URL", "GOOGLE_GENAI_USE_VERTEXAI"):
        result.pop(name, None)
    # Cloud SDK debug settings must not persist service/secret responses to disk.
    result["CLOUDSDK_CORE_LOG_HTTP"] = "false"
    result["CLOUDSDK_CORE_DISABLE_FILE_LOGGING"] = "true"
    result["CLOUDSDK_CORE_VERBOSITY"] = "error"
    result["GIT_TERMINAL_PROMPT"] = "0"
    return result


def captured(command: list[str], *, cwd: Path | None = None,
             env: dict[str, str] | None = None, timeout: int = 120,
             error: str = "외부 명령을 완료하지 못했습니다.") -> str:
    try:
        process = subprocess.run(command, cwd=cwd, env=env or clean_environment(),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, encoding="utf-8", timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        raise SetupError(error) from None
    if process.returncode:
        raise SetupError(error)
    return process.stdout


def read_json(raw: str, error: str) -> object:
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise SetupError(error) from None


def valid_identifier(value: object) -> bool:
    return isinstance(value, str) and bool(IDENTIFIER.fullmatch(value))


def select_service_region(services: object) -> str:
    if not isinstance(services, list):
        raise SetupError("Cloud Run 서비스 목록 형식을 확인하지 못했습니다.")
    matches = [item for item in services if isinstance(item, dict)
               and isinstance(item.get("metadata"), dict)
               and item["metadata"].get("name") == SERVICE]
    if len(matches) != 1:
        raise SetupError("현재 프로젝트에서 orihani-chart 서비스를 하나로 확인하지 못했습니다. Cloud Shell의 선택 프로젝트를 확인해주세요.")
    labels = matches[0]["metadata"].get("labels", {})
    region = labels.get("cloud.googleapis.com/location") if isinstance(labels, dict) else None
    if not isinstance(region, str) or not REGION.fullmatch(region):
        raise SetupError("orihani-chart 서비스의 리전을 확인하지 못했습니다.")
    return region


def secret_aliases(service: dict) -> dict[str, str]:
    result: dict[str, str] = {}
    spec = service.get("spec", {})
    template = spec.get("template", {}) if isinstance(spec, dict) else {}
    if not isinstance(spec, dict) or not isinstance(template, dict):
        raise SetupError("Cloud Run 서비스 설정 형식을 확인하지 못했습니다.")
    locations = [service.get("metadata", {}), template.get("metadata", {})]
    for metadata in locations:
        annotations = metadata.get("annotations", {}) if isinstance(metadata, dict) else {}
        raw = annotations.get("run.googleapis.com/secrets", "") if isinstance(annotations, dict) else ""
        if not isinstance(raw, str):
            raise SetupError("보안 비밀 별칭 설정 형식을 확인하지 못했습니다.")
        for entry in filter(None, raw.split(",")):
            alias, separator, target = entry.strip().partition(":")
            if not separator or not valid_identifier(alias) or (alias in result and result[alias] != target):
                raise SetupError("보안 비밀 별칭 설정이 모호합니다.")
            result[alias] = target
    return result


def extract_key_sources(service: object, project: str) -> dict[str, KeySource]:
    if not isinstance(service, dict) or not valid_identifier(project):
        raise SetupError("Cloud Run 서비스 설정 형식을 확인하지 못했습니다.")
    metadata = service.get("metadata", {})
    if not isinstance(metadata, dict) or metadata.get("name") != SERVICE:
        raise SetupError("조회 결과가 정확한 orihani-chart 서비스가 아닙니다.")
    try:
        containers = service["spec"]["template"]["spec"]["containers"]
    except (KeyError, TypeError):
        raise SetupError("Cloud Run 컨테이너 설정을 확인하지 못했습니다.") from None
    if not isinstance(containers, list) or len(containers) != 1 or not isinstance(containers[0], dict):
        raise SetupError("컨테이너가 하나로 확인되지 않아 키 선택을 중단했습니다.")
    entries = containers[0].get("env", [])
    if not isinstance(entries, list):
        raise SetupError("환경변수 설정 형식을 확인하지 못했습니다.")
    aliases = secret_aliases(service)
    result: dict[str, KeySource] = {}
    for name in KEY_NAMES:
        found = [entry for entry in entries if isinstance(entry, dict) and entry.get("name") == name]
        if len(found) != 1:
            raise SetupError("필요한 API 환경변수가 없거나 중복되어 있습니다. OPENAI_API_KEY와 GEMINI_API_KEY 등록을 확인해주세요.")
        entry = found[0]
        if "value" in entry:
            if "valueFrom" in entry or not isinstance(entry["value"], str) or not entry["value"].strip():
                raise SetupError("API 환경변수 값 또는 참조 설정이 올바르지 않습니다.")
            result[name] = KeySource(kind="value", value=entry["value"])
            continue
        value_from = entry.get("valueFrom", {})
        if not isinstance(value_from, dict):
            raise SetupError("보안 비밀 참조 형식을 확인하지 못했습니다.")
        reference = value_from.get("secretKeyRef", {})
        if not isinstance(reference, dict):
            raise SetupError("보안 비밀 참조 형식을 확인하지 못했습니다.")
        secret, version = reference.get("name"), reference.get("key")
        if not isinstance(secret, str) or not isinstance(version, str) or not re.fullmatch(r"latest|[1-9][0-9]*", version):
            raise SetupError("보안 비밀 이름 또는 버전을 확인하지 못했습니다.")
        secret = aliases.get(secret, secret)
        if secret.startswith("projects/"):
            match = re.fullmatch(r"projects/([A-Za-z0-9_-]+)/secrets/([A-Za-z0-9_-]+)", secret)
            if not match:
                raise SetupError("프로젝트 간 보안 비밀 참조를 확인하지 못했습니다.")
            secret_project, secret_name = match.groups()
        else:
            secret_project, secret_name = project, secret
        if not valid_identifier(secret_project) or not valid_identifier(secret_name):
            raise SetupError("보안 비밀 참조 형식이 올바르지 않습니다.")
        result[name] = KeySource(kind="secret", project=secret_project, secret=secret_name, version=version)
    return result


def resolve_keys(sources: dict[str, KeySource]) -> dict[str, str]:
    result = {}
    for name in KEY_NAMES:
        source = sources[name]
        value = source.value if source.kind == "value" else captured([
            "gcloud", "secrets", "versions", "access", source.version,
            "--secret", source.secret, "--project", source.project, "--quiet",
        ], error="등록된 보안 비밀을 읽지 못했습니다. 현재 Cloud Shell 계정의 Secret Manager 접근 권한을 확인해주세요.")
        value = value.strip()
        if not value or len(value) > 16_384 or any(char in value for char in "\r\n\x00"):
            raise SetupError("등록된 API 키의 값 형식을 확인하지 못했습니다.")
        result[name] = value
    return result


def stop_child(child: subprocess.Popen) -> None:
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.communicate(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.communicate()
    except ProcessLookupError:
        pass


def emit_progress(data: bytes, offset: int) -> int:
    """Render only known progress fields; never forward raw child output."""
    end = data.rfind(b"\n") + 1
    for raw in data[offset:end].splitlines():
        if not raw.startswith(b"ORI_PROGRESS "):
            continue
        try:
            event = json.loads(raw[len(b"ORI_PROGRESS "):])
            case_id, engine, status = event.get("caseId"), event.get("engine"), event.get("status")
            index, total = event.get("index"), event.get("total")
            engines = {"gemini": "Gemini", "gpt-astra": "OpenAI"}
            statuses = {"started": "요청 중", "completed": "완료·저장됨", "failed": "실패·저장됨", "reused": "저장된 결과 사용"}
            if (case_id not in CASE_LABELS or engine not in engines or status not in statuses
                    or type(index) is not int or type(total) is not int or total != 14):
                continue
            expected = list(CASE_LABELS).index(case_id) * 2 + list(engines).index(engine) + 1
            if index != expected:
                continue
            print(f"[{index}/{total}] {CASE_LABELS[case_id]} · {engines[engine]}: {statuses[status]}", flush=True)
        except (ValueError, TypeError, AttributeError):
            continue
    return max(offset, end)


def persistent_output(project: str, region: str) -> Path:
    if not valid_identifier(project) or not REGION.fullmatch(region):
        raise SetupError("결과 저장 위치를 확인하지 못했습니다.")
    current = Path.home()
    for part in ("orihani-ai-comparison", project, region, PINNED_COMMIT):
        current = current / part
        if current.is_symlink():
            raise SetupError("결과 저장 위치가 심볼릭 링크여서 중단했습니다.")
        current.mkdir(mode=0o700, exist_ok=True)
        if not current.is_dir():
            raise SetupError("결과 저장 위치를 확인하지 못했습니다.")
        current.chmod(0o700)
    for name in ("comparison.json", "comparison.html", ".lock"):
        if (current / name).is_symlink():
            raise SetupError("결과 파일 경로가 심볼릭 링크여서 중단했습니다.")
    return current


def existing_gemini_baseline(project: str, region: str) -> Path:
    """Select the known earlier report without creating or changing its path.

    The comparison runner validates its contents before making any paid request.
    Missing or redirected reports must never turn a candidate-only run into a
    fresh two-provider comparison.
    """
    if not valid_identifier(project) or not REGION.fullmatch(region):
        raise SetupError("기존 Gemini 결과 위치를 확인하지 못했습니다.")
    current = Path.home()
    for part in ("orihani-ai-comparison", project, region, GEMINI_BASELINE_COMMIT):
        current = current / part
        if current.is_symlink() or not current.is_dir():
            raise SetupError("기존 Gemini 결과 폴더가 없거나 심볼릭 링크입니다. 이전 비교를 실행한 프로젝트와 Cloud Shell 계정을 확인해주세요. 새 Gemini 요청은 하지 않았습니다.")
    report = current / "comparison.json"
    if report.is_symlink() or not report.is_file():
        raise SetupError("기존 comparison.json이 없거나 심볼릭 링크입니다. 새 Gemini 요청은 하지 않았습니다.")
    return report


def run_comparison(repo: Path, output: Path, keys: dict[str, str], *, lock_fd: int | None = None,
                   baseline: Path | None = None) -> int:
    child_env = clean_environment()
    child_env.update(keys)
    child_env["ORI_COMPARISON_COMMIT"] = PINNED_COMMIT
    command = ["node", "--experimental-strip-types", "scripts/compare-ai.ts", "--out", str(output), "--resume"]
    if baseline is not None:
        command.extend(["--baseline", str(baseline)])
    child = None
    try:
        child = subprocess.Popen(command,
                                 cwd=repo, env=child_env, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, start_new_session=True,
                                 pass_fds=() if lock_fd is None else (lock_fd,))
        started = time.monotonic()
        offset = 0
        while True:
            try:
                stdout, _ = child.communicate(timeout=20)
                emit_progress(stdout or b"", offset)
                return child.returncode
            except subprocess.TimeoutExpired as error:
                previous = offset
                offset = emit_progress(error.output or b"", offset)
                if offset == previous:
                    print("현재 요청의 응답을 기다리고 있습니다. 완료된 요청은 자동 저장됩니다.", flush=True)
                if time.monotonic() - started > 5400:
                    raise SetupError("비교 실행이 제한 시간을 넘었습니다. API 상태와 할당량을 확인해주세요.")
    except OSError:
        raise SetupError("비교 프로그램을 시작하지 못했습니다.") from None
    finally:
        if child is not None:
            stop_child(child)
        for name in KEY_NAMES:
            child_env.pop(name, None)


def archive_results(output: Path, keys: dict[str, str]) -> tuple[Path, int, int]:
    contents: dict[str, bytes] = {}
    for name in ("comparison.json", "comparison.html"):
        path = output / name
        if path.is_symlink() or not path.is_file():
            raise SetupError("비교 결과 파일이 만들어지지 않았습니다. API 설정을 확인해주세요.")
        data = path.read_bytes()
        if any(value.encode("utf-8") in data for value in keys.values()):
            raise SetupError("결과 파일에서 민감정보 가능성을 발견해 압축 및 다운로드를 중단했습니다.")
        contents[name] = data
    report = read_json(contents["comparison.json"].decode("utf-8"), "비교 보고서 형식을 확인하지 못했습니다.")
    if not isinstance(report, dict) or not isinstance(report.get("cases"), list):
        raise SetupError("비교 보고서 형식을 확인하지 못했습니다.")
    cases = report["cases"]
    failures = sum(1 for case in cases for run in case.get("runs", []) if run.get("status") != "completed")
    descriptor, filename = tempfile.mkstemp(prefix="orihani-ai-comparison-", suffix=".zip", dir=Path.home())
    os.close(descriptor)
    archive = Path(filename)
    try:
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name, data in contents.items():
                bundle.writestr(name, data)
    except Exception:
        archive.unlink(missing_ok=True)
        raise SetupError("결과 압축 파일을 만들지 못했습니다.") from None
    return archive, len(cases), failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--config-check", type=Path, metavar="SERVICE_JSON")
    parser.add_argument("--reuse-gemini", action="store_true",
                        help="Reuse the first comparison's Gemini results; request only new OpenAI results.")
    options = parser.parse_args(argv)
    if options.config_check and options.reuse_gemini:
        parser.error("--reuse-gemini cannot be combined with --config-check")
    if options.config_check:
        service = read_json(options.config_check.read_text(encoding="utf-8"), "설정 점검 파일을 읽지 못했습니다.")
        extract_key_sources(service, "offline-config-check")
        print("오프라인 설정 형식 점검 완료. 키 조회·모델 API 호출 없음.", flush=True)
        return 0
    for command in ("git", "npm", "node") + (() if options.dry_run else ("gcloud",)):
        if not shutil.which(command):
            raise SetupError("필수 명령을 찾지 못했습니다. Cloud Shell에서 git, npm, Node.js, gcloud를 확인해주세요.")
    node = captured(["node", "--version"], error="Node.js 버전을 확인하지 못했습니다.").strip()
    match = re.fullmatch(r"v([0-9]+)\.([0-9]+)\.([0-9]+)", node)
    if not match or tuple(map(int, match.groups())) < (22, 6, 0):
        raise SetupError("Node.js 22.6 이상이 필요합니다. 실행 환경의 Node.js 버전을 확인해주세요. 자동 설치는 하지 않았습니다.")
    sources = None
    baseline = None
    if not options.dry_run:
        print("[1/5] 현재 프로젝트와 orihani-chart 설정을 확인합니다.", flush=True)
        project = captured(["gcloud", "config", "get-value", "project", "--quiet"], error="현재 Google Cloud 프로젝트를 확인하지 못했습니다.").strip()
        if not valid_identifier(project) or project == "unset":
            raise SetupError("Cloud Shell에 프로젝트가 지정되지 않았습니다. 서비스가 있는 프로젝트를 선택해주세요.")
        services = read_json(captured(["gcloud", "run", "services", "list", "--project", project,
                                      "--format=json(metadata.name,metadata.labels)", "--quiet"],
                                     error="현재 프로젝트의 Cloud Run 서비스를 조회하지 못했습니다."),
                             "Cloud Run 서비스 목록 형식을 확인하지 못했습니다.")
        region = select_service_region(services)
        if options.reuse_gemini:
            baseline = existing_gemini_baseline(project, region)
        service = read_json(captured(["gcloud", "run", "services", "describe", SERVICE, "--project", project,
                                     "--region", region, "--format=json", "--quiet"],
                                    error="orihani-chart 설정을 조회하지 못했습니다."),
                            "Cloud Run 서비스 설정 형식을 확인하지 못했습니다.")
        sources = extract_key_sources(service, project)
        print(f"대상: {project} / {region} / {SERVICE}", flush=True)
        del service
    with tempfile.TemporaryDirectory(prefix="orihani-compare-") as temporary:
        base = Path(temporary)
        repo = base / "repo"
        print("[2/5] 검증 대상 코드를 고정 커밋으로 준비합니다.", flush=True)
        captured(["git", "clone", "--quiet", "--no-checkout", "--filter=blob:none", REPOSITORY, str(repo)], timeout=300, error="비교 코드를 내려받지 못했습니다.")
        captured(["git", "fetch", "--quiet", "--depth", "1", "origin", PINNED_COMMIT], cwd=repo, timeout=300, error="지정한 코드 버전을 가져오지 못했습니다.")
        captured(["git", "-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", PINNED_COMMIT], cwd=repo, error="지정한 코드 버전을 선택하지 못했습니다.")
        if captured(["git", "rev-parse", "HEAD"], cwd=repo).strip() != PINNED_COMMIT:
            raise SetupError("코드 커밋이 일치하지 않아 실행을 중단했습니다.")
        print("[3/5] 의존성과 합성 비교 사례를 준비합니다. 아직 모델 API를 호출하지 않습니다.", flush=True)
        captured(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=repo, timeout=600, error="비교 도구 의존성을 설치하지 못했습니다.")
        captured(["npm", "run", "compare:ai", "--", "--dry-run"], cwd=repo, error="합성 비교 사례를 준비하지 못했습니다.")
        if options.dry_run:
            if options.reuse_gemini:
                print("기존 Gemini 결과 파일은 실제 실행 시 확인합니다. 준비 점검에서는 파일 조회나 모델 요청을 하지 않습니다.", flush=True)
            print("준비 점검 완료. Cloud Run·보안 비밀·모델 API에 접근하지 않았습니다.", flush=True)
            return 0
        output = persistent_output(project, region)
        print(f"중간 결과 저장 위치: {output}", flush=True)
        if baseline is not None:
            print("기존 Gemini 7개 결과를 검증해 재사용합니다. OpenAI 7개만 새로 요청하며, 이번 실행에서 이미 완료된 요청은 건너뜁니다.", flush=True)
        print("[4/5] 등록된 키를 메모리에서만 읽고 합성 사례 7개를 비교합니다. 앱 배포나 설정 변경은 없습니다.", flush=True)
        descriptor = os.open(output / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SetupError("같은 비교가 다른 터미널에서 진행 중입니다. 기존 실행이 끝난 뒤 다시 실행해주세요.") from None
            keys = resolve_keys(sources)
            sources.clear()
            try:
                try:
                    returncode = run_comparison(repo, output, keys, lock_fd=lock.fileno(), baseline=baseline)
                except KeyboardInterrupt:
                    print("중단했습니다. 저장된 결과는 유지됩니다. 같은 명령을 다시 실행하면 완료된 요청을 건너뜁니다.", flush=True)
                    return 130
                if returncode not in (0, 1):
                    raise SetupError("비교 프로그램이 중단되었습니다. 중간 결과는 유지됩니다. 같은 명령으로 다시 실행할 수 있습니다.")
                print("[5/5] 비교 보고서를 압축합니다.", flush=True)
                archive, count, failures = archive_results(output, keys)
            finally:
                keys.clear()
        print(f"완료: 합성 사례 {count}개, 실패한 API 요청 {failures}개. 품질 판정은 결과 검토 후 진행합니다.", flush=True)
        print(f"결과 파일: {archive}", flush=True)
        print("다운로드 명령: " + shlex.join(["cloudshell", "download", str(archive)]), flush=True)
        return 1 if returncode or failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SetupError as error:
        print("중단: " + str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("사용자가 실행을 중단했습니다. 앱 설정과 배포는 변경하지 않았습니다.", file=sys.stderr)
        sys.exit(130)
    except Exception:
        # Tracebacks can include credentials or raw provider/configuration data.
        print("중단: 실행 환경 또는 결과 파일을 확인하지 못했습니다. 민감정보 보호를 위해 원문 오류는 표시하지 않습니다.", file=sys.stderr)
        sys.exit(1)
