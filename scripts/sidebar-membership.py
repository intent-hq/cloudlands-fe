"""Exact native Playwright membership for the Sidebar cold/warm pair."""
import copy
import json
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, label):
    require(isinstance(value, str) and bool(value.strip()) and '\x00' not in value,
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
    bound.get('metadata', {}).pop('actualWorkers', None)
    for project in bound['projects']:
        project.pop('outputDir', None)
        project.get('metadata', {}).pop('actualWorkers', None)
    return root, bound


def identities(report, root, subject, specs, collecting):
    entries = []

    def visit(suites, file=None, titles=()):
        require(isinstance(suites, list), 'malformed suites')
        for suite in suites:
            require(isinstance(suite, dict), 'malformed suite')
            title = text(suite.get('title'), 'suite title')
            if file is None:
                # JSON file-suite titles retain the selected file path. With
                # generated tests, suite.file can point into the registration
                # helper (just like spec.file), so it is not a selection key.
                text(suite.get('file'), 'file-suite location')
                location = Path(title)
                require('..' not in location.parts, 'malformed file-suite path')
                location = (root / location).resolve()
                require(location.is_relative_to(subject), 'file-suite outside tested source')
                spec_file = location.relative_to(subject).as_posix()
                require(spec_file in specs, 'unexpected selected file: ' + spec_file)
                parents = ()
            else:
                spec_file, parents = file, (*titles, title)
            require(isinstance(suite.get('specs'), list), 'malformed specs')
            for spec in suite['specs']:
                require(isinstance(spec, dict), 'malformed spec')
                native_id = text(spec.get('id'), 'native id')
                name = text(spec.get('title'), 'test title')
                require(isinstance(spec.get('tests'), list) and bool(spec['tests']),
                        'malformed tests')
                for case in spec['tests']:
                    require(isinstance(case, dict), 'malformed case')
                    require(case.get('projectId') == 'chromium'
                            and case.get('projectName') == 'chromium', 'wrong case project')
                    require(case.get('expectedStatus') == 'passed', 'non-passing expected status')
                    results = case.get('results')
                    require(isinstance(results, list), 'malformed results')
                    identity = {'id': native_id, 'file': spec_file,
                                'titlePath': [*parents, name],
                                'projectId': case['projectId'], 'projectName': case['projectName']}
                    if collecting:
                        require(results == [], 'collection unexpectedly executed tests')
                    entries.append((identity, case))
            visit(suite.get('suites', []), spec_file, parents)

    visit(report.get('suites'))
    require(bool(entries), 'empty collected membership' if collecting else 'empty execution membership')
    native_ids, logical_ids = set(), set()
    for identity, _ in entries:
        native = (identity['projectId'], identity['id'])
        logical = (identity['file'], tuple(identity['titlePath']), identity['projectId'])
        require(native not in native_ids, 'duplicate native identity: ' + json.dumps(identity))
        require(logical not in logical_ids, 'duplicate/ambiguous logical identity: ' + json.dumps(identity))
        native_ids.add(native)
        logical_ids.add(logical)
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
