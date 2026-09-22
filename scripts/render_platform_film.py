from PIL import Image, ImageDraw, ImageFont
import math, subprocess, os

W,H,FPS,DURATION=1280,720,30,22
BG=(249,249,251); INK=(18,18,21); MUTED=(105,105,118); VIOLET=(88,77,255); LINE=(225,225,232); SOFT=(241,240,255); GREEN=(39,154,102); AMBER=(213,143,44); RED=(205,71,77)
FONT='/nix/store/xbs17gmksi0pljxcs4l6gshklzpmv8gr-dejavu-fonts-2.37/share/fonts/truetype/DejaVuSans.ttf'; BOLD='/nix/store/xbs17gmksi0pljxcs4l6gshklzpmv8gr-dejavu-fonts-2.37/share/fonts/truetype/DejaVuSans-Bold.ttf'; MONO='/nix/store/xbs17gmksi0pljxcs4l6gshklzpmv8gr-dejavu-fonts-2.37/share/fonts/truetype/DejaVuSansMono.ttf'

def font(sz,bold=False,mono=False): return ImageFont.truetype(MONO if mono else BOLD if bold else FONT,sz)
def ease(x):
    x=max(0,min(1,x)); return 1-(1-x)**3
def alpha(t,a,b): return ease((t-a)/(b-a)) if t<b else 1
def txt(d,xy,s,sz=24,c=INK,b=False,anchor=None): d.text(xy,s,font=font(sz,b),fill=c,anchor=anchor)
def line(d,xy,fill=LINE,w=1): d.line(xy,fill=fill,width=w)
def rr(d,box,r=10,fill=(255,255,255),outline=LINE,w=1): d.rounded_rectangle(box,radius=r,fill=fill,outline=outline,width=w)
def chip(d,x,y,label,c=VIOLET):
    f=font(13,True); box=d.textbbox((0,0),label,font=f); ww=box[2]+24
    d.rounded_rectangle((x,y,x+ww,y+28),radius=14,fill=tuple(int(c[i]*.12+255*.88) for i in range(3)))
    d.text((x+12,y+6),label,font=f,fill=c); return ww

def chrome(d,title,section='LEADERSHIP INTELLIGENCE'):
    d.rectangle((0,0,W,56),fill=INK); txt(d,(24,18),'yavar',18,(255,255,255),True); txt(d,(84,20),'ATSIQ',12,(190,190,202),True)
    txt(d,(1040,20),section,10,(190,190,202),True)
    txt(d,(42,88),title,29,INK,True)
    line(d,(42,127,1238,127))

def scene_open(d,t):
    p=alpha(t,0,.8)
    txt(d,(70,75),'ATSIQ',14,VIOLET,True)
    y=250-int((1-p)*18)
    txt(d,(W//2,y),'Hiring intelligence',58,INK,True,'mm')
    txt(d,(W//2,y+72),'that compounds.',58,VIOLET,True,'mm')
    txt(d,(W//2,y+138),'From evidence-led matching to organisational capability.',19,MUTED,False,'mm')
    d.rectangle((70,640,1210,643),fill=LINE); d.rectangle((70,640,70+1140*min(1,t/4),643),fill=VIOLET)

def metric(d,x,y,w,label,value,note,accent=False):
    rr(d,(x,y,x+w,y+110),8,(255,255,255),LINE)
    txt(d,(x+18,y+17),label.upper(),11,MUTED,True); txt(d,(x+18,y+43),value,28,VIOLET if accent else INK,True,mono=True); txt(d,(x+18,y+82),note,12,MUTED)

def scene_chro(d,t):
    chrome(d,'CHRO command centre')
    txt(d,(42,140),'One view for value, capability, risk and action.',15,MUTED)
    labels=[('RETURN ON INDIVIDUAL','128','28% above median hire',True),('CAPABILITY RETURNED','74','Across committed hires',False),('PROGRAMMES READY','6','Two need one lead hire',False),('SUCCESSION EXPOSURE','3','Single-person dependencies',False)]
    for i,(a,b,c,e) in enumerate(labels):
        yy=178+int((1-alpha(t,.15+i*.08,.65+i*.08))*14)
        metric(d,42+i*296,yy,280,a,b,c,e)
    rr(d,(42,315,810,655),8)
    txt(d,(62,334),'DECISIONS & PRESCRIPTIONS',12,VIOLET,True)
    rows=[('Close capability gap','GenAI platform ownership rests on one person','Build'),('Protect offer conversion','Two priority roles exceed decision SLA','Act'),('Deploy available strength','Cloud modernisation team is staffable now','Ready')]
    for i,(a,b,c) in enumerate(rows):
        y=378+i*82; d.ellipse((64,y,78,y+14),fill=[RED,AMBER,GREEN][i]); txt(d,(94,y-2),a,16,INK,True); txt(d,(94,y+23),b,12,MUTED); chip(d,690,y-7,c,[RED,AMBER,GREEN][i]); line(d,(62,y+57,790,y+57))
    rr(d,(828,315,1238,655),8,SOFT)
    txt(d,(850,336),'PIPELINE HEALTH',12,VIOLET,True)
    vals=[('Applied',80),('AI screened',64),('Shortlisted',43),('Interview',27),('Offer',14)]
    for i,(lab,v) in enumerate(vals):
        y=382+i*48; txt(d,(850,y),lab,12,MUTED); d.rounded_rectangle((948,y+2,1195,y+12),5,fill=LINE); d.rounded_rectangle((948,y+2,948+247*v/80,y+12),5,fill=VIOLET); txt(d,(1208,y-2),str(v),12,INK,True)

def scene_roi(d,t):
    chrome(d,'Return on Individual')
    txt(d,(42,140),'What did each hire return — and what can the organisation do now?',15,MUTED)
    rr(d,(42,182,530,650),8)
    txt(d,(66,205),'PORTFOLIO RoI',12,VIOLET,True); txt(d,(66,235),'128',58,INK,True,); txt(d,(195,263),'100 = median-cost hire',13,MUTED)
    line(d,(66,322,505,322)); txt(d,(66,348),'CAPABILITY COMPOSITION',11,MUTED,True)
    parts=[('JD ↔ CV fit',.82,VIOLET),('Scarce capability',.68,RED),('Delivered impact',.76,GREEN),('Career trajectory',.61,AMBER)]
    for i,(lab,v,c) in enumerate(parts):
        y=389+i*51; txt(d,(66,y),lab,12,INK); d.rounded_rectangle((220,y+3,485,y+13),5,fill=LINE); d.rounded_rectangle((220,y+3,220+265*v*alpha(t,.2+i*.08,.8+i*.08),y+13),5,fill=c); txt(d,(490,y-2),f'{round(v*100)}',12,MUTED)
    rr(d,(548,182,1238,650),8)
    txt(d,(570,205),'WHAT THIS ORGANISATION CAN STAFF NOW',12,VIOLET,True)
    goals=[('Cloud modernisation',92,'READY'),('Data platform',84,'READY'),('GenAI copilot',67,'ONE LEAD HIRE'),('Security hardening',48,'CAPABILITY GAP')]
    for i,(name,v,status) in enumerate(goals):
        y=255+i*91; txt(d,(570,y),name,17,INK,True); txt(d,(1132,y),f'{v}%',16,VIOLET,True); d.rounded_rectangle((570,y+32,1188,y+43),5,fill=LINE); d.rounded_rectangle((570,y+32,570+618*v/100,y+43),5,fill=GREEN if v>=80 else AMBER if v>=55 else RED); txt(d,(570,y+54),status,10,MUTED,True)

def scene_match(d,t):
    chrome(d,'Evidence-linked matching','DECISION EVIDENCE')
    rr(d,(42,162,360,650),8); txt(d,(64,184),'ROLE REQUIREMENTS',12,VIOLET,True)
    req=['Distributed systems','Kubernetes','Platform strategy','Team leadership','FinOps']
    for i,s in enumerate(req): chip(d,64,230+i*58,s,VIOLET if i<4 else MUTED)
    rr(d,(382,162,1238,650),8); txt(d,(408,184),'CANDIDATE EVIDENCE',12,VIOLET,True); txt(d,(1110,184),'91 / 100',20,VIOLET,True)
    rows=[('Skills match',40,37),('Experience',15,14),('Career history',10,8),('Impact & innovation',10,9),('Education',10,9),('Social & public proof',15,14)]
    for i,(lab,maxv,v) in enumerate(rows):
        y=238+i*61; txt(d,(408,y),lab,13,INK); d.rounded_rectangle((610,y+3,1115,y+15),6,fill=LINE); d.rounded_rectangle((610,y+3,610+505*(v/maxv)*alpha(t,.15+i*.06,.7+i*.06),y+15),6,fill=VIOLET); txt(d,(1140,y-2),f'{v}/{maxv}',13,INK,True)

def scene_brain(d,t):
    chrome(d,'Talent Brain')
    txt(d,(42,140),'A living map of organisational strength, scarcity and adjacency.',15,MUTED)
    rr(d,(42,175,1238,655),8,SOFT)
    centers=[(270,365,'Cloud',VIOLET),(615,300,'Data',GREEN),(940,410,'Product',AMBER),(660,520,'Security',RED)]
    for a,b in [(0,1),(1,2),(1,3),(0,3),(2,3)]:
        x1,y1,_,_=centers[a];x2,y2,_,_=centers[b]; line(d,(x1,y1,x2,y2),LINE,2)
    for ci,(cx,cy,label,c) in enumerate(centers):
        for j in range(7):
            ang=j*math.pi*2/7+t*.3; rad=58+(j%2)*22; x=cx+math.cos(ang)*rad; y=cy+math.sin(ang)*rad; line(d,(cx,cy,x,y),c,1); r=8+(j%3)*3; d.ellipse((x-r,y-r,x+r,y+r),fill=c,outline=(255,255,255),width=2)
        pulse=8+5*(.5+.5*math.sin(t*4+ci)); d.ellipse((cx-28-pulse,cy-28-pulse,cx+28+pulse,cy+28+pulse),outline=c,width=2); d.ellipse((cx-27,cy-27,cx+27,cy+27),fill=c,outline=(255,255,255),width=3); txt(d,(cx,cy+48),label,14,INK,True,'mm')
    chip(d,62,600,'Healthy coverage',GREEN); chip(d,220,600,'Tightening',AMBER); chip(d,340,600,'Scarce',RED)

def scene_close(d,t):
    txt(d,(W//2,255),'ATSIQ',18,VIOLET,True,'mm'); txt(d,(W//2,325),'Know who to hire.',46,INK,True,'mm'); txt(d,(W//2,383),'Know what they unlock.',46,VIOLET,True,'mm'); txt(d,(W//2,450),'Evidence for every decision. Capability for every ambition.',17,MUTED,False,'mm'); chip(d,540,515,'THE TALENT INTELLIGENCE OS',VIOLET)

scenes=[(0,3.2,scene_open),(3.2,8.0,scene_chro),(8.0,12.2,scene_roi),(12.2,16.3,scene_match),(16.3,20.0,scene_brain),(20.0,22.0,scene_close)]
out='/tmp/atsiq-platform-new.mp4'
cmd=['ffmpeg','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',out]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
for frame in range(FPS*DURATION):
    t=frame/FPS; im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
    for x in range(8,W,22):
        for y in range(8,H,22): d.point((x,y),fill=(232,232,238))
    for start,end,fn in scenes:
        if start<=t<end: fn(d,t-start); break
    p.stdin.write(im.tobytes())
p.stdin.close(); err=p.stderr.read().decode(); code=p.wait()
if code: raise SystemExit(err)
# poster from the dashboard scene
im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
for x in range(8,W,22):
    for y in range(8,H,22): d.point((x,y),fill=(232,232,238))
scene_chro(d,1.5); im.save('/tmp/atsiq-platform-new-poster.jpg',quality=92,optimize=True)
print(out,os.path.getsize(out))
