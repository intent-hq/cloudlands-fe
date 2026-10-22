"""Setup-only inert extraction and native x86-64 ELF metadata, never executes a candidate."""
import hashlib,json,os,pathlib,stat,struct,sys,tarfile
root=pathlib.Path(sys.argv[1]); plan=json.loads(pathlib.Path(__file__).with_name('plan.json').read_text())['candidate']
archive=root/plan['name']
assert archive.is_file() and not archive.is_symlink()
assert archive.stat().st_size==plan['bytes'] and hashlib.sha256(archive.read_bytes()).hexdigest()==plan['sha256']
selected=None; seen=set(); total=0
with tarfile.open(archive,'r:xz') as tar:
 for index,m in enumerate(tar):
  p=pathlib.PurePosixPath(m.name)
  assert index<100 and not p.is_absolute() and '..' not in p.parts and len(p.parts)<=8
  assert m.name not in seen;seen.add(m.name)
  assert m.isdir() or m.isreg();total+=m.size;assert total<=512*1024*1024
  if m.isreg() and p.name=='intentd':
   assert selected is None and 0<m.size<=512*1024*1024
   selected=tar.extractfile(m).read(m.size+1);assert len(selected)==m.size
assert selected is not None and selected[:6]==b'\x7fELF\x02\x01'
assert struct.unpack_from('<H',selected,18)[0]==62
phoff=struct.unpack_from('<Q',selected,32)[0];phentsize,phnum=struct.unpack_from('<HH',selected,54)
assert phnum<=256 and phentsize>=56 and phoff+phentsize*phnum<=len(selected)
segments=[]
for i in range(phnum):
 t,flags,offset,va,pa,filesz,memsz,align=struct.unpack_from('<IIQQQQQQ',selected,phoff+i*phentsize)
 assert offset+filesz<=len(selected)
 segments.append({'type':t,'offset':offset,'bytes':filesz})
 # This musl route admits only an ELF with no dynamic interpreter or DT_NEEDED.
 assert t!=3,'unexpected interpreter: separate ABI disposition required'
 if t==2:
  assert filesz%16==0 and filesz<=1048576
  for pos in range(offset,offset+filesz,16):
   key,value=struct.unpack_from('<QQ',selected,pos)
   if key==0:break
   assert key not in (1,15,29),'dynamic dependency/RPATH requires separate disposition'
fd=os.open(root/'intentd',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o555)
with os.fdopen(fd,'wb') as f:f.write(selected)
info=os.lstat(root/'intentd');assert stat.S_ISREG(info.st_mode) and info.st_nlink==1
digest=hashlib.sha256(selected).hexdigest();assert hashlib.sha256((root/'intentd').read_bytes()).hexdigest()==digest
(root/'binary.json').write_text(json.dumps({'sha256':digest,'bytes':len(selected),'mode':oct(stat.S_IMODE(info.st_mode)),'machine':'x86_64','interpreter':None,'needed':[],'segments':segments,'classification':'NEW candidate, no execution or old ABI acceptance'},indent=2))
