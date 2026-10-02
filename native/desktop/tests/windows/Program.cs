using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

// Runs only on an isolated Windows test desktop. Observes actual window input;
// it does not substitute for Electron, UAC or mixed-monitor qualification.
static class Program {
    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    static string helper = "";
    static int result = 1;
    [STAThread] static int Main(string[] args) {
        helper = Path.GetFullPath(args.Single());
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        using var target = new Form { Text="Intent native desktop functional test", StartPosition=FormStartPosition.Manual, Location=new Point(100,100), ClientSize=new Size(640,480), BackColor=Color.CornflowerBlue };
        target.Shown += async (_,_) => {
            try { await Run(target); result=0; Console.WriteLine("PASS: native Windows input, capture, exclusion, exclusivity and EOF cleanup"); }
            catch(Exception e) { Console.Error.WriteLine(e); }
            finally { target.Close(); }
        };
        Application.Run(target);
        return result;
    }
    sealed class Peer : IDisposable {
        readonly Process process;
        long id;
        public Peer() {
            process=Process.Start(new ProcessStartInfo(helper) {UseShellExecute=false,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,CreateNoWindow=true}) ?? throw new Exception("Helper failed to start");
        }
        public async Task<JsonElement> Call(string op, object? fields=null, string? expectedError=null) {
            var request=fields is null ? new Dictionary<string,object>() : JsonSerializer.Deserialize<Dictionary<string,object>>(JsonSerializer.Serialize(fields))!;
            request["operation"]=op; request["id"]=++id;
            await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request));
            var line=await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)) ?? throw new Exception("Helper exited unexpectedly");
            var response=JsonSerializer.Deserialize<JsonElement>(line);
            Require(response.GetProperty("id").GetInt64()==id,"Mismatched helper response");
            if(expectedError is not null) { Require(response.GetProperty("error").GetProperty("code").GetString()==expectedError,"Wrong refusal"); return response; }
            if(response.TryGetProperty("error",out var error)) throw new Exception(error.GetRawText());
            return response.GetProperty("result").Clone();
        }
        public async Task End() { process.StandardInput.Close(); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); Require(process.ExitCode==0,"Helper failed on EOF"); }
        public void Dispose() { if(!process.HasExited) { process.StandardInput.Close(); if(!process.WaitForExit(3000)) process.Kill(true); } process.Dispose(); }
    }
    static void Require(bool ok,string message) { if(!ok) throw new Exception(message); }
    static async Task Observe(Func<bool> condition,string description) {
        for(int i=0;i<60;i++) { if(condition()) return; await Task.Delay(50); }
        throw new Exception("No native evidence for " + description);
    }
    static async Task Run(Form target) {
        using var input=new TextBox { Location=new Point(20,20),Width=300 };
        target.Controls.Add(input);
        int right=0, doubled=0, scroll=0, dragged=0;
        target.MouseUp+=(_,e)=>{if(e.Button==MouseButtons.Right)right++;};
        target.MouseDoubleClick+=(_,e)=>{if(e.Button==MouseButtons.Left)doubled++;};
        target.MouseWheel+=(_,e)=>scroll+=e.Delta;
        target.MouseMove+=(_,e)=>{if(e.Button==MouseButtons.Left)dragged++;};
        using var overlay=new Form {FormBorderStyle=FormBorderStyle.None,StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(target.PointToScreen(new Point(400,200)),new Size(80,60)),BackColor=Color.Magenta,TopMost=true,ShowInTaskbar=false,Opacity=0.99};
        overlay.Show();
        Require(SetWindowDisplayAffinity(overlay.Handle,0x11),"Cannot set native capture exclusion");
        target.Activate();
        await Task.Delay(250);
        using var peer=new Peer();
        var identity=await peer.Call("identity");
        Require(identity.GetProperty("platform").GetString()=="windows","Wrong native platform");
        await peer.Call("acquire");
        using(var competitor=new Peer()) await competitor.Call("acquire",expectedError:"desktop-busy");
        var layout=await peer.Call("layout");
        var screen=Screen.FromControl(target);
        var display=layout.EnumerateArray().Single(d=>d.GetProperty("displayId").GetString()==screen.DeviceName).Clone();
        Require(display.GetProperty("width").GetInt32()==screen.Bounds.Width,"Physical display width mismatch");
        Require(display.GetProperty("scaleFactor").GetDouble()>0,"Missing DPI scale");
        var exclusions=new {excludedWindows=new[]{overlay.Handle.ToInt64().ToString()}};
        await peer.Call("validateExclusion",new {excludedWindows=new[]{"0"}},"desktop-unsupported-operation");
        await peer.Call("validateExclusion",exclusions);
        var captures=await peer.Call("capture",exclusions);
        var capture=captures.EnumerateArray().Single(d=>d.GetProperty("displayId").GetString()==screen.DeviceName);
        using(var bytes=new MemoryStream(Convert.FromBase64String(capture.GetProperty("data").GetString()!)))
        using(var bitmap=new Bitmap(bytes)) {
            Require(bitmap.Width==screen.Bounds.Width && bitmap.Height==screen.Bounds.Height,"Capture dimensions mismatch");
            var sample=overlay.PointToScreen(new Point(40,30));
            var pixel=bitmap.GetPixel(sample.X-screen.Bounds.X,sample.Y-screen.Bounds.Y);
            Require(pixel.B>100 && pixel.G>70 && pixel.R<160,"Excluded indicator leaked into native capture");
            Directory.CreateDirectory("native/desktop/tests/windows/artifacts");
            bitmap.Save("native/desktop/tests/windows/artifacts/capture.png");
        }
        async Task Move(Point p) => await peer.Call("move",new {display,x=p.X-screen.Bounds.X,y=p.Y-screen.Bounds.Y});
        async Task Button(string button,bool down) => await peer.Call("button",new {button,down,clickCount=1});
        var point=target.PointToScreen(new Point(200,150));
        await Move(point); await Button("right",true); await Button("right",false);
        await Observe(()=>right==1,"right click");
        for(int i=0;i<2;i++) { await Button("left",true); await Button("left",false); }
        await Observe(()=>doubled>0,"double click");
        input.Focus(); await peer.Call("text",new {text="é"});
        await Observe(()=>input.Text=="é","Unicode text");
        await peer.Call("key",new {key="Control",down=true});
        await peer.Call("key",new {key="a",down=true}); await peer.Call("key",new {key="a",down=false});
        await peer.Call("key",new {key="Control",down=false});
        await peer.Call("text",new {text="Z"}); await Observe(()=>input.Text=="Z","Control+A chord");
        target.ActiveControl=null; target.Focus(); await Move(point);
        await peer.Call("scroll",new {deltaX=0,deltaY=48}); await Observe(()=>scroll!=0,"scroll wheel");
        await Button("left",true); await Move(new Point(point.X+50,point.Y+50));
        await Observe(()=>dragged>0,"drag continuation");
        await peer.Call("releaseInput");
        await Observe(()=>(GetAsyncKeyState(1)&0x8000)==0,"cancelled button release");
        await peer.Call("key",new {key="Shift",down=true});
        await Observe(()=>(GetAsyncKeyState(0x10)&0x8000)!=0,"held Shift");
        await peer.End();
        await Observe(()=>(GetAsyncKeyState(0x10)&0x8000)==0,"EOF releases held Shift");
        using var successor=new Peer(); await successor.Call("acquire"); await successor.Call("release");
        await successor.Call("check",expectedError:"desktop-not-active");
    }
}
