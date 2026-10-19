import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../report.js';
test('ZIP contains valid UTF-8 entries, central directory and independently verified CRC', async () => {
  const data = new Uint8Array(await zip([{ name: 'report.md', data: '你好 BugSnap' }, { name: 'screenshot.png', data: new Uint8Array([1, 2, 3]) }]).arrayBuffer());
  const view = new DataView(data.buffer); assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x800);
  const size = view.getUint32(18, true), start = 30 + view.getUint16(26, true);
  assert.equal(new TextDecoder().decode(data.slice(start, start + size)), '你好 BugSnap');
  const end = data.length - 22; assert.equal(view.getUint32(end, true), 0x06054b50); assert.equal(view.getUint16(end + 10, true), 2);
  assert.equal(view.getUint32(view.getUint32(end + 16, true), true), 0x02014b50);
  const { writeFile, mkdtemp, rm } = await import('node:fs/promises'); const { tmpdir } = await import('node:os'); const { execFileSync } = await import('node:child_process');
  const dir = await mkdtemp(`${tmpdir()}/bugsnap-test-`);
  try { await writeFile(`${dir}/test.zip`, data); assert.match(execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("report.md").decode()=="你好 BugSnap"; print("ok")', `${dir}/test.zip`], { encoding: 'utf8' }), /ok/); } finally { await rm(dir, { recursive: true }); }
});
