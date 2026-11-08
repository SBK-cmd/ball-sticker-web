#!/usr/bin/env python3
"""Offline safety tests: private Git fixture, never Worker/Illustrator/Graphtec.
Run from any directory: python3 signtools-panel/tests/rollback-test.py
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

PANEL = Path(__file__).resolve().parents[1]
REPO = Path(subprocess.check_output(['git', '-C', str(PANEL), 'rev-parse', '--show-toplevel'], text=True).strip())
STABLE = 'eb32bcd8baa9c1c4ae7834ad4fa58100324f9046'


def execute(args, cwd, env=None):
    return subprocess.run([str(a) for a in args], cwd=cwd, env=env,
                          text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)


def snapshot(root):
    files = {}
    for p in root.rglob('*'):
        if p.is_file() and '.git' not in p.relative_to(root).parts:
            files[str(p.relative_to(root))] = (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mode)
    status = subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain=v1', '-z'])
    head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'])
    return files, status, head


class RollbackSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sandbox = tempfile.TemporaryDirectory(prefix='signtools-rollback-tests-')
        cls.root = Path(cls.sandbox.name)
        cls.fixture = cls.root / 'repository with spaces'
        result = execute(['git', 'clone', '--shared', '--no-checkout', REPO, cls.fixture], cls.root)
        if result.returncode:
            raise RuntimeError(result.stdout)
        result = execute(['git', 'checkout', '--detach', STABLE], cls.fixture)
        if result.returncode:
            raise RuntimeError(result.stdout)
        cls.panel = cls.fixture / 'signtools-panel'
        (cls.panel / 'tests').mkdir(exist_ok=True)
        shutil.copy2(PANEL / 'rollback.sh', cls.panel / 'rollback.sh')
        shutil.copy2(PANEL / 'tests/panel-smoke.cjs', cls.panel / 'tests/panel-smoke.cjs')
        # Deliberately break both runtime and build files in the working tree.
        # A safe rollback must still build the Git commit, not these edits.
        (cls.panel / 'SignTools/js/sticker.js').write_text('DO NOT PACKAGE THIS DIRTY FILE\n')
        (cls.panel / 'SignTools/jsx/host.jsx').write_text('DIRTY HOST\n')
        (cls.panel / 'build.sh').write_text('#!/bin/sh\nexit 93\n')
        cls.original = snapshot(cls.fixture)

    @classmethod
    def tearDownClass(cls):
        cls.sandbox.cleanup()

    def setUp(self):
        self.out = self.root / ('output ' + self.id().rsplit('.', 1)[1])

    def run_script(self, *args, env=None, script=None):
        command = ['bash', script or self.panel / 'rollback.sh', *args]
        return execute(command, self.panel, env)

    def reject(self, *args, message=None):
        result = self.run_script(*args)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn('สำเร็จ:', result.stdout)
        if message:
            self.assertIn(message, result.stdout)
        self.assertEqual(snapshot(self.fixture), self.original)
        return result

    def build(self, version='1.13.59', current='1.13.58', **kwargs):
        return self.run_script(version, '--current', current, '--out', self.out, **kwargs)

    def assert_clean_failure(self, result, version='1.13.59'):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.out / ('rollback-v' + version)).exists())
        self.assertFalse((self.out / '.rollback.lock').exists())
        self.assertFalse(list(self.out.glob('.rollback-stage.*')))

    def test_help(self):
        result = self.run_script('--help')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn('--current', result.stdout)

    def test_missing_version(self):
        self.reject()

    def test_missing_current(self):
        self.reject('1.13.59')

    def test_equal_version(self):
        self.reject('1.13.58', '--current', '1.13.58')

    def test_lower_version(self):
        self.reject('1.13.57', '--current', '1.13.58')

    def test_not_above_stable(self):
        self.reject('1.13.48', '--current', '1.12.3')

    def test_invalid_versions(self):
        for version in ['1.13', '1.13.59-beta', '01.13.59', '../1.13.59', '1.13.59;touch bad', '1.13.1000000000']:
            with self.subTest(version=version):
                self.reject(version, '--current', '1.13.58')
        self.reject('1.13.59', '--current', 'bad')

    def test_missing_option_value(self):
        self.reject('1.13.59', '--current')
        self.reject('1.13.59', '--current', '1.13.58', '--out')

    def test_duplicate_and_unknown_options(self):
        self.reject('1.13.59', '--current', '1.13.58', '--current', '1.13.57')
        self.reject('1.13.59', '--current', '1.13.58', '--from', 'HEAD')
        self.reject('1.13.59', '--current', '1.13.58', '--upload')

    def test_dry_run_creates_nothing(self):
        result = self.run_script('1.13.59', '--current', '1.13.58', '--out', self.out, '--dry-run')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertFalse(self.out.exists())
        self.assertEqual(snapshot(self.fixture), self.original)

    def test_forbidden_output_paths(self):
        for out in [self.panel / 'SignTools/unsafe', self.fixture / 'signtools-worker/unsafe', self.fixture / '.git/unsafe']:
            self.reject('1.13.59', '--current', '1.13.58', '--out', out, '--dry-run')
            self.assertFalse(out.exists())

    def test_build_uses_stable_git_not_dirty_worktree(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout)
        final = self.out / 'rollback-v1.13.59'
        metadata = json.loads((final / 'rollback.json').read_text())
        self.assertEqual(metadata['stable_commit'], STABLE)
        self.assertFalse(metadata['uploaded'])
        self.assertFalse(metadata['server_version_checked'])
        self.assertIn('passed', metadata['checks']['panel_simulator'])
        self.assertEqual(metadata['checks']['illustrator'], 'not-tested')
        archive = final / 'SignTools-v1.13.59.zip'
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), metadata['sha256'])
        with zipfile.ZipFile(archive) as z:
            for rel in ['SignTools/js/sticker.js', 'SignTools/jsx/host.jsx', 'SignTools/index.html', 'SignTools/js/core.js']:
                stable_bytes = subprocess.check_output(['git', '-C', str(self.fixture), 'show', STABLE + ':signtools-panel/' + rel])
                self.assertEqual(z.read(rel), stable_bytes)
            self.assertNotIn('tests/panel-smoke.cjs', z.namelist())
            self.assertIn(b'ExtensionBundleVersion="1.13.59"', z.read('SignTools/CSXS/manifest.xml'))
        self.assertEqual(snapshot(self.fixture), self.original)
        self.assertFalse((self.out / '.rollback.lock').exists())
        self.assertFalse(list(self.out.glob('.rollback-stage.*')))
        # Never overwrite even if the caller repeats a previously used number.
        before = archive.read_bytes()
        repeat = self.build()
        self.assertNotEqual(repeat.returncode, 0, repeat.stdout)
        self.assertEqual(archive.read_bytes(), before)

    def test_existing_higher_output_rejected(self):
        (self.out / 'rollback-v1.13.60').mkdir(parents=True)
        result = self.build()
        self.assert_clean_failure(result)
        self.assertIn('สูงกว่า', result.stdout)

    def test_lock_of_other_job_not_removed(self):
        lock = self.out / '.rollback.lock'
        lock.mkdir(parents=True)
        result = self.build()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertTrue(lock.exists())
        self.assertFalse((self.out / 'rollback-v1.13.59').exists())

    def test_missing_stable_commit(self):
        empty = self.root / 'empty repo'
        empty.mkdir(exist_ok=True)
        execute(['git', 'init', empty], self.root)
        panel = empty / 'signtools-panel'
        (panel / 'tests').mkdir(parents=True, exist_ok=True)
        shutil.copy2(self.panel / 'rollback.sh', panel / 'rollback.sh')
        shutil.copy2(self.panel / 'tests/panel-smoke.cjs', panel / 'tests/panel-smoke.cjs')
        result = self.run_script('1.13.59', '--current', '1.13.58', '--out', self.out, script=panel / 'rollback.sh')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse(self.out.exists())

    def test_simulator_failure_blocks_output_and_cleans(self):
        simulator = self.panel / 'tests/panel-smoke.cjs'
        original = simulator.read_bytes()
        simulator.write_text("console.error('intentional simulator failure'); process.exit(7);\n")
        try:
            result = self.build()
            self.assert_clean_failure(result)
            self.assertIn('intentional simulator failure', result.stdout)
        finally:
            simulator.write_bytes(original)
        self.assertEqual(snapshot(self.fixture), self.original)

    def test_tampered_zip_blocks_output_and_cleans(self):
        bindir = self.root / 'fake tools'
        bindir.mkdir(exist_ok=True)
        real_zip = shutil.which('zip')
        wrapper = bindir / 'zip'
        wrapper.write_text('#!/usr/bin/env python3\n' +
            'import pathlib, subprocess, sys, zipfile\n' +
            f'result = subprocess.run([{real_zip!r}] + sys.argv[1:])\n' +
            'if result.returncode: sys.exit(result.returncode)\n' +
            'p = pathlib.Path(next(a for a in sys.argv[1:] if a.endswith(".zip")))\n' +
            'with zipfile.ZipFile(p) as src:\n' +
            '    items = [(i, src.read(i.filename)) for i in src.infolist()]\n' +
            'with zipfile.ZipFile(p, "w") as dst:\n' +
            '    for info, data in items:\n' +
            '        if info.filename == "SignTools/js/sticker.js": data += b"\\n// tampered\\n"\n' +
            '        dst.writestr(info, data)\n')
        wrapper.chmod(0o755)
        env = os.environ.copy()
        env['PATH'] = str(bindir) + os.pathsep + env['PATH']
        result = self.build(env=env)
        self.assert_clean_failure(result)
        self.assertIn('โค้ดเปลี่ยนเกิน', result.stdout)
        self.assertEqual(snapshot(self.fixture), self.original)

    def test_actual_updater_version_comparator(self):
        # Instantiate the real stable core, use cmpVer only; request is a tripwire.
        code = r'''
const create = require(process.argv[1]);
const core = create({extDir: process.argv[2], dataDir: process.argv[3], server: [],
  pubkey: '', machineIdOverride: 'offline-test', request() { throw Error('NETWORK FORBIDDEN'); }});
const checks = [['1.13.59','1.13.58',1], ['1.13.59','1.13.60',-1],
  ['1.13.59','1.13.59',0], ['1.13.100','1.13.99',1], ['1.14.0','1.13.999',1]];
for (const [a,b,sign] of checks) {
  if (Math.sign(core.cmpVer(a,b)) !== sign) throw Error(a+' / '+b);
}
console.log('PASS actual core.cmpVer offline');
'''
        result = execute(['node', '-e', code, self.panel / 'SignTools/js/core.js',
                          self.panel / 'SignTools', self.root / 'fake-license-data'], self.panel)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.root / 'fake-license-data').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
