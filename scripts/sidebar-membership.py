"""Exact native Playwright membership for the Sidebar cold/warm pair."""
import copy
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, label, allow_empty=False):
    require(isinstance(value, str) and (allow_empty or bool(value.strip())) and '\x00' not in value,
            'malformed ' + label)
    return value


def configuration(report, workers, subject):
    require(isinstance(report, dict), 'malformed report')
    require(report.get('errors') == [], 'global errors or malformed errors')
    config = report.get('config')
    require(isinstance(config, dict), 'malformed config')
    require(type(config.get('workers')) is int and config['workers'] == workers,
            'wrong worker count')
    root = Path(text(config.get('rootDir'), 'rootDir'))
    require(root.is_absolute() and root.is_relative_to(subject), 'rootDir outside tested source')
    projects = config.get('projects')
    require(isinstance(projects, list) and len(projects) == 1, 'wrong project configuration')
    project = projects[0]
    require(isinstance(project, dict) and project.get('id') == 'chromium'
            and project.get('name') == 'chromium', 'wrong project configuration')
    require(project.get('retries') == 0 and project.get('repeatEach') == 1,
            'wrong retry/repeat configuration')
    # Only execution bookkeeping may differ. All discovery/configuration inputs
    # (including rootDir, configFile, project filters and runner version) stay bound.
    bound = copy.deepcopy(config)
    bound.pop('argv', None)  # --list and each cell's artifact output are different.
    native = report.get('nativeMembership')
    require(isinstance(native, dict), 'missing or malformed native membership')
    configured = native.get('configuredMetadata')
    require(isinstance(configured, dict) and isinstance(configured.get('root'), dict)
            and isinstance(configured.get('projects'), list) and len(configured['projects']) == 1,
            'malformed configured metadata')

    def bind_metadata(owner, inputs):
        require(isinstance(inputs, dict) and isinstance(owner.get('metadata', {}), dict),
                'malformed metadata')
        metadata = copy.deepcopy(owner.get('metadata', {}))
        # Playwright's execution-only git-info plugin adds these report annotations.
        # Bind the pre-plugin values captured by onConfigure instead of discarding
        # configured metadata, including configured values with these same names.
        for key in ('actualWorkers', 'ci', 'gitCommit', 'gitDiff'):
            if key in inputs:
                metadata[key] = copy.deepcopy(inputs[key])
            else:
                metadata.pop(key, None)
        require(metadata == inputs, 'unexpected report metadata mutation')
        owner['metadata'] = metadata

    bind_metadata(bound, configured['root'])
    for project, inputs in zip(bound['projects'], configured['projects']):
        require(isinstance(inputs, dict) and inputs.get('name') == project['name'],
                'malformed configured project metadata')
        project.pop('outputDir', None)
        bind_metadata(project, inputs.get('metadata'))
    return root, bound


def load_report(directory):
    report = None
    for filename in ('results.json', 'native-membership.json'):
        path = directory / filename
        require(path.stat().st_size <= 8 * 1024 * 1024, 'report size limit: ' + filename)
        value = json.loads(path.read_text())
        require(isinstance(value, dict), 'malformed ' + filename)
        if report is None:
            report = value
        else:
            report['nativeMembership'] = value
    return report


def identities(report, root, subject, specs, collecting):
    # This sidecar comes from the SAME native invocation, before JSON merges file
    # suites by generator location. Native IDs join the two independent views.
    native = report.get('nativeMembership')
    require(isinstance(native, dict) and native.get('schema') == 1,
            'missing or malformed native membership')
    require(native.get('rootDir') == str(root) and native.get('workers') == report['config']['workers'],
            'native membership configuration mismatch')
    require(isinstance(native.get('cases'), list), 'malformed native membership cases')
    by_id = {}
    logical_ids = set()
    for entry in native['cases']:
        require(isinstance(entry, dict), 'malformed native identity')
        native_id = text(entry.get('id'), 'native id')
        require(native_id not in by_id, 'duplicate native identity: ' + native_id)
        location = Path(text(entry.get('file'), 'native file path'))
        require(location.is_absolute() and '..' not in location.parts, 'malformed native file path')
        location = location.resolve()
        require(location.is_relative_to(subject), 'native file outside tested source')
        file = location.relative_to(subject).as_posix()
        require(file in specs, 'unexpected selected file: ' + file)
        titles = entry.get('titlePath')
        require(isinstance(titles, list) and bool(titles), 'malformed native title path')
        titles = [text(title, 'native title', allow_empty=index < len(titles) - 1)
                  for index, title in enumerate(titles)]
        require(entry.get('projectName') == 'chromium', 'wrong native project')
        logical = (file, tuple(titles), entry['projectName'])
        require(logical not in logical_ids, 'duplicate/ambiguous logical identity: ' + str(logical))
        logical_ids.add(logical)
        by_id[native_id] = {'id': native_id, 'file': file, 'titlePath': titles,
                            'projectId': 'chromium', 'projectName': entry['projectName']}

    entries = []
    seen = set()

    def visit(suites, titles=(), top=True):
        require(isinstance(suites, list), 'malformed suites')
        for suite in suites:
            require(isinstance(suite, dict), 'malformed suite')
            title = text(suite.get('title'), 'suite title', allow_empty=not top)
            parents = () if top else (*titles, title)
            require(isinstance(suite.get('specs'), list), 'malformed specs')
            for spec in suite['specs']:
                require(isinstance(spec, dict), 'malformed spec')
                native_id = text(spec.get('id'), 'native id')
                name = text(spec.get('title'), 'test title')
                require(isinstance(spec.get('tests'), list) and bool(spec['tests']),
                        'malformed tests')
                for case in spec['tests']:
                    require(native_id not in seen, 'duplicate native report identity: ' + native_id)
                    seen.add(native_id)
                    require(isinstance(case, dict), 'malformed case')
                    require(case.get('projectId') == 'chromium'
                            and case.get('projectName') == 'chromium', 'wrong case project')
                    require(case.get('expectedStatus') == 'passed', 'non-passing expected status')
                    results = case.get('results')
                    require(isinstance(results, list), 'malformed results')
                    require(native_id in by_id, 'unexpected native report identity: ' + native_id)
                    identity = by_id[native_id]
                    require(identity['titlePath'] == [*parents, name],
                            'native identity disagrees with JSON title: ' + native_id)
                    if collecting:
                        require(results == [], 'collection unexpectedly executed tests')
                    entries.append((identity, case))
            visit(suite.get('suites', []), parents, top=False)

    visit(report.get('suites'))
    require(bool(entries), 'empty collected membership' if collecting else 'empty execution membership')
    require(seen == by_id.keys(), 'native membership mismatch: missing=' + json.dumps(sorted(by_id.keys() - seen)))
    return entries


def collect_membership(report, workers, subject, specs, native_exit):
    require(native_exit == 0, 'native collection failed: ' + str(native_exit))
    root, config = configuration(report, workers, subject)
    entries = identities(report, root, subject, specs, collecting=True)
    return {'schema': 1, 'config': config, 'specs': list(specs),
            'cases': sorted((identity for identity, _ in entries), key=identity_key)}


def identity_key(identity):
    return json.dumps(identity, sort_keys=True, ensure_ascii=True)


def validate_report(report, manifest, workers, subject, specs, native_exit):
    require(native_exit == 0, 'native execution failed: ' + str(native_exit))
    root, config = configuration(report, workers, subject)
    require(manifest['schema'] == 1 and manifest['config'] == config
            and manifest['specs'] == list(specs), 'collection/execution configuration changed')
    entries = identities(report, root, subject, specs, collecting=False)
    expected = {identity_key(identity) for identity in manifest['cases']}
    actual = {identity_key(identity) for identity, _ in entries}
    require(actual == expected, 'membership mismatch: missing=' + json.dumps(sorted(expected - actual))
            + '; unexpected=' + json.dumps(sorted(actual - expected)))
    rows = []
    for identity, case in entries:
        results = case['results']
        require(len(results) == 1 and isinstance(results[0], dict)
                and type(results[0].get('retry')) is int and results[0]['retry'] == 0,
                'expected exactly one retry-0 result: ' + identity_key(identity))
        result = results[0]
        require(case.get('status') == 'expected' and result.get('status') == 'passed',
                'case did not pass: ' + identity_key(identity))
        require(type(result.get('workerIndex')) is int and result['workerIndex'] >= 0,
                'malformed worker identity')
        rows.append({**identity, 'title': identity['titlePath'][-1],
                     'worker': result['workerIndex'], 'status': result['status'], 'retry': result['retry']})
    return rows


def require_cold_caches(before, after):
    require(bool(before) and all(row.get('absent') is True for row in before),
            'runner must start without harness caches')
    require(after == before, 'collection changed cold caches; evidence retained')
