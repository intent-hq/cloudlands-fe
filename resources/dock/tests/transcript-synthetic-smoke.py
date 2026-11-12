import wave,struct,json,subprocess,sys,pathlib
root=pathlib.Path(sys.argv[1]); target=pathlib.Path(sys.argv[2]); total=[0]*(35*48000)
for n,(offset,text) in enumerate([(0.2,'Opening checkpoint alpha one two three.'),(13,'Middle checkpoint bravo four five six.'),(28,'Closing checkpoint charlie seven eight nine.')]):
 file=root/('voice-'+str(n)+'.wav')
 r=subprocess.run(['/usr/bin/say','-v','Samantha','--file-format=WAVE','--data-format=LEI16@48000','-o',str(file),text],capture_output=True,timeout=20)
 if r.returncode: raise RuntimeError('System synthetic voice unavailable; no installation attempted')
 with wave.open(str(file),'rb') as f:
  assert f.getnchannels()==1 and f.getsampwidth()==2 and f.getframerate()==48000
  data=f.readframes(f.getnframes()); values=struct.unpack('<'+str(len(data)//2)+'h',data)
 start=int(offset*48000); total[start:start+len(values)]=values[:len(total)-start]
source=root/'synthetic-speech.wav'
with wave.open(str(source),'wb') as f:
 f.setparams((1,2,48000,0,'NONE','not compressed'));f.writeframes(struct.pack('<'+str(len(total))+'h',*total))
job={'source':str(source),'audio':str(root/'recognition-input.wav'),'durationMs':35000}
r=subprocess.run([sys.argv[3]],input=json.dumps(job),capture_output=True,text=True,timeout=190)
events=[json.loads(line) for line in r.stdout.splitlines() if line.startswith('{')]
last=events[-1] if events else {}; t=last.get('transcript'); receipt={'syntheticOnly':True,'durationMs':35000,'exitCode':r.returncode,'event':last.get('event'),'errorCode':last.get('code')}
if t:
 (target/'synthetic-canonical.json').write_text(json.dumps(t,indent=2))
 words=t['words'];text=''.join(w['text'] for w in words).lower(); times=[w['startMs'] for w in words if w.get('startMs') is not None]
 receipt.update(status=t['status'],unitCount=len(words),firstStartMs=min(times) if times else None,lastStartMs=max(times) if times else None,openingPresent='opening' in text,middlePresent='middle' in text,closingPresent='closing' in text)
timed=[w for w in t.get('words',[]) if w.get('startMs') is not None and w.get('endMs',0)>w['startMs']] if t else []
receipt.update(earlyTimedUnits=sum(w['startMs']<3000 for w in timed),middleTimedUnits=sum(10000<=w['startMs']<18000 for w in timed),lateTimedUnits=sum(25000<=w['startMs']<33000 for w in timed),uniqueIds=len({w['id'] for w in t.get('words',[])})==len(t.get('words',[])) if t else False)
(target/'synthetic-speech-receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))

assert receipt.get("earlyTimedUnits",0)>0 and receipt.get("middleTimedUnits",0)>0 and receipt.get("lateTimedUnits",0)>0 and receipt["uniqueIds"], "Recognition lost a synthetic checkpoint"
