# Bank lobby pixel art scene, generated entirely in code.
# Usage: python3 bank_lobby.py <output-dir>     (needs Pillow and numpy)
# Writes bank_lobby_1x.png (256x176) and bank_lobby.png (4x). See docs/pixel-art/README.md for the approach.
# STYLE CARD (from HLD / Party Hard / Hotline Miami references)
# - Locked palette: hue-shifted ramps, shadows shift cool/violet, highlights shift warm. Final image is snapped to it.
# - Daytime: low sun behind the back windows. Warm shafts cross the floor, figures cast long shadows toward the viewer,
#   and every sprite gets a rim of sunlight on the edges that face the windows (top / left).
# - Lighting carries the mood: cool interior shade, strong warm shafts. Dither only in narrow strips at band edges.
# - Small figures, ~1:4 head-to-body, dark outline on the silhouette only. Value contrast before colour for readability.
# - One read per area: the lit counter is the focal point; corners fall off into shadow.
import random, math, sys, colorsys
import numpy as np
from PIL import Image, ImageDraw
out = sys.argv[1]
random.seed(11)
W, H = 256, 176
C = dict(
 ink=(16,12,20), ceil=(30,24,28), ceil2=(44,34,36),
 wall=(118,108,96), wall2=(98,88,78), wall3=(78,70,62), pil=(132,122,108),
 wood=(70,44,34), wood2=(84,54,40), wood3=(46,30,24), wood4=(104,70,50),
 mar1=(72,88,80), mar2=(40,56,50), vein=(96,106,100), vein2=(34,38,40),
 top=(150,146,138), top2=(112,108,102),
 brass=(170,134,66), brass2=(112,86,44), brass3=(214,178,104),
 steel=(108,112,122), steel2=(80,84,96), steel3=(146,150,162), steel4=(52,54,66),
 rug=(104,36,46), rug2=(70,24,32), rug3=(136,56,62),
 leaf=(52,84,60), leaf2=(32,56,42), leaf3=(80,112,78), pot=(110,66,48), pot2=(78,46,36),
 paper=(196,190,170), dark=(24,24,30), red=(150,30,40), red2=(96,20,30), shadow=(0,0,0),
)
alb = Image.new('RGB',(W,H),C['mar1']); A = alb.load()
emi = Image.new('RGB',(W,H),(0,0,0)); E = emi.load()     # light that ignores the lighting pass
def col(c): return C[c] if isinstance(c,str) else c
def rect(x0,y0,x1,y1,c,im=None):
    im = im or alb; p = im.load()
    for y in range(max(0,y0),min(im.height,y1+1)):
        for x in range(max(0,x0),min(im.width,x1+1)): p[x,y] = col(c)
def put(x,y,c,im=None):
    im = im or alb
    if 0<=x<im.width and 0<=y<im.height: im.load()[x,y] = col(c)
def glow(x,y,c): put(x,y,c,emi)
def outline(im, colr=C['ink']):
    a = im.copy(); p = im.load(); q = a.load()
    for y in range(im.height):
        for x in range(im.width):
            if p[x,y][3]==0 and any(0<=x+dx<im.width and 0<=y+dy<im.height and p[x+dx,y+dy][3] for dx,dy in ((1,0),(-1,0),(0,1),(0,-1))):
                q[x,y] = colr+(254,)
    return a

# ---------- room shell
rect(0,0,W-1,7,'ceil'); rect(0,7,W-1,7,'ceil2')
rect(0,8,W-1,63,'wall')
for _ in range(120):   # grime on the plaster
    x,y = random.randrange(W), random.randrange(8,52); put(x,y,'wall2')
for x in range(W):
    for y in range(40,52):
        if random.random() < (y-44)/40: put(x,y,'wall2')
rect(0,52,W-1,63,'wood'); rect(0,52,W-1,52,'wood4'); rect(0,63,W-1,63,'wood3')
for x in range(0,W,16): rect(x,54,x,62,'wood3')
for x in (8,76,140,188,248):
    rect(x,8,x+7,51,'pil'); rect(x+6,8,x+7,51,'wall3'); rect(x,8,x+7,10,'wall3'); rect(x,48,x+7,51,'wall3')
rect(0,64,W-1,79,'wood3')
for y in range(64,80,4): rect(0,y,W-1,y,'wood')
for y in range(80,H):          # dark green marble checker, worn
    for x in range(W):
        A[x,y] = C['mar1'] if ((x//16)+(y-80)//16)%2==0 else C['mar2']
for _ in range(140):
    x,y = random.randrange(W), random.randrange(82,H)
    for k in range(random.randint(4,10)):
        if x<W and y<H: put(x,y,'vein' if A[x,y]==C['mar2'] else 'vein2')
        x += random.choice((1,1,0)); y += random.choice((0,1))
for x0,x1 in ((0,5),(250,255)):
    rect(x0,8,x1,H-1,'wall2'); rect(x1 if x0==0 else x0,8,x1 if x0==0 else x0,H-1,'wall3')
rect(1,96,4,150,(30,30,50)); rect(1,96,4,97,'wood'); rect(1,149,4,150,'wood')   # side door glass (night)
for y in range(98,149): glow(2,y,(40,46,80)); glow(3,y,(30,34,64))
rect(112,104,148,H-1,'rug'); rect(112,104,112,H-1,'rug2'); rect(148,104,148,H-1,'rug2'); rect(115,104,115,H-1,'rug3'); rect(145,104,145,H-1,'rug3')

# ---------- night windows: emissive sky, skyline, neon across the street, rain on the glass
def window(x0,x1,y0=14,y1=46,neon=None):
    cx = (x0+x1)/2; r = (x1-x0)/2
    inside = lambda xx,yy: (yy>=y0 or ((xx-cx)/r)**2+((yy-y0)/(r/2))**2<=1) and x0<=xx<=x1 and yy<=y1
    for y in range(y0-int(r)//2, y1+1):
        for x in range(x0,x1+1):
            if not inside(x,y): continue
            t = (y-(y0-r/2))/(y1-(y0-r/2))
            c = (int(150+80*t), int(196+44*t), int(232+16*t))
            bx = (x*7)//9
            top = y1-10-((bx*37)%13)
            if y > top:
                c = (196,184,166) if (bx//3)%2 else (168,160,150)
                if x%3==0 and y%3==1: c = (120,146,170)
            if y > y1-5: c = (130,124,118)
            if (x-y)%19 in (0,1,2) and y < top: c = (252,252,246)          # glare on the glass
            A[x,y] = (12,10,18); E[x,y] = c
    for y in range(y0-int(r)//2-1, y1+2):
        for x in range(x0-1,x1+2):
            if not inside(x,y) and any(inside(x+dx,y+dy) for dx,dy in ((1,0),(-1,0),(0,1),(0,-1))): A[x,y] = C['wood3']
    for y in range(y0-int(r)//2, y1+1):
        if inside(int(cx),y): A[int(cx),y] = C['wood3']; E[int(cx),y] = (0,0,0)
    for x in range(x0,x1+1):
        for yy in (y0, y0+12):
            if inside(x,yy): A[x,yy] = C['wood3']; E[x,yy] = (0,0,0)
    rect(x0-2,y1+1,x1+2,y1+2,'wood4'); rect(x0-2,y1+3,x1+2,y1+3,'wood3')
window(20,64)
window(92,132)
window(152,180)
# wall clock
cx,cy = 84,24
for y in range(cy-6,cy+7):
    for x in range(cx-6,cx+7):
        d = math.hypot(x-cx,y-cy)
        if d<=6: put(x,y,'brass2' if d>5 else (190,184,168))
for k in range(4): put(cx,cy-k,'ink'); put(cx-k+1,cy+k-1,'ink')
# vault
vx,vy = 220,32
for y in range(vy-21,vy+22):
    for x in range(vx-21,vx+22):
        d = math.hypot(x-vx,y-vy)
        if d<=21: put(x,y,'steel4' if d>19 else 'steel2' if d>16 else 'steel' if d>4 else 'steel3')
        if 13<d<15.5 and (math.atan2(y-vy,x-vx)*8/math.pi)%2<0.5: put(x,y,'steel3')
for a in range(6):
    t = a*math.pi/3+0.3
    for k in range(4,12): put(round(vx+math.cos(t)*k), round(vy+math.sin(t)*k), 'brass2')
    put(round(vx+math.cos(t)*12), round(vy+math.sin(t)*12), 'brass')
# exit sign above the side door
rect(6,86,16,90,(20,40,24))
for x in range(7,16):
    for y in range(87,90): glow(x,y,(60,230,110) if (x+y)%3 else (200,255,210))

# ---------- people: small heads, longer bodies, muted clothes
# ---------- people, Door Kickers: Action Squad style: realistic ~1:5 proportions, 3-4 tone shading,
# visible faces, clothing detail (collars, lapels, belts, folds), coloured sel-out outlines. Front/back views for the 3/4 camera.
def selout(im):
    # outline each figure in a darkened, slightly purple version of the colour it borders; alpha 254 marks outline pixels
    a = im.copy(); p = im.load(); q = a.load()
    for y in range(im.height):
        for x in range(im.width):
            if p[x,y][3]: continue
            nb = [p[x+dx,y+dy] for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)) if 0<=x+dx<im.width and 0<=y+dy<im.height and p[x+dx,y+dy][3]]
            if nb:
                c = min(nb, key=lambda t: sum(t[:3]))
                q[x,y] = (int(c[0]*.30+10), int(c[1]*.26+6), int(c[2]*.30+14), 254)
    return a

def person(facing='front', skin=(196,150,120), hair=(40,28,22), hairstyle='short', top=(60,60,70), kind='suit',
           inner=(214,210,200), tie=None, pants=(40,40,48), shoes=(26,22,22), build=1, prop=None, seated=False,
           beard=False, glasses=False, step=0):
    W_, H_ = 18, 33
    im = Image.new('RGBA',(W_,H_),(0,0,0,0)); q = im.load()
    def tone(c,f):
        c = col(c)
        if f >= 1: return tuple(min(255,int(v+(255-v)*(f-1)*0.9 + 6*(f-1))) for v in c)
        return tuple(int(v*f) for v in c)
    def P(x,y,c):
        if 0<=x+1<W_ and 0<=y+1<H_: q[x+1,y+1] = col(c)+(255,)
    def part(x0,x1,y0,y1,c,lit=True):
        for y in range(y0,y1+1):
            for x in range(x0,x1+1):
                f = 1.0
                if x==x0 and lit: f = 1.18
                elif x==x1: f = .68
                elif x==x1-1 and x1-x0>2: f = .84
                if y==y1 and y1-y0>2: f *= .9
                P(x,y,tone(c,f))
    sh = {0:(4,11),1:(3,12),2:(2,13)}[build]          # shoulder span
    L0,R1 = sh
    legs_top = 19
    # legs and shoes
    if seated:
        part(5,10,19,20,pants)                         # thighs toward the camera, lap catches light
        for x in range(5,11): P(x,19,tone(pants,1.22))
        part(5,7,21,24,pants); part(8,10,21,24,pants,lit=False)
        part(4,7,25,26,shoes); part(8,11,25,26,shoes,lit=False)
    elif kind=='dress':
        for y in range(19,24):
            w = (y-19)//2
            part(5-w,10+w,y,y,top)
        part(6,7,24,27,skin); part(8,9,24,27,skin,lit=False)
        part(5,7,28,29,shoes); part(8,10,28,29,shoes,lit=False)
    else:
        a_, b_ = (0, step), (step, 0)
        part(5,7,19+a_[0],27,pants); part(8,10,19,27-b_[1],pants,lit=False)
        for y in range(22,27): P(8,y,tone(pants,.55))   # crease between the legs
        P(6,23,tone(pants,1.25)); P(9,23,tone(pants,.95))   # knees
        part(4,7,28,29,shoes); part(8,11,28-step,29-step,shoes,lit=False)
        if facing=='front': P(4,29,tone(shoes,1.6))
    # torso
    long_coat = kind=='coat'
    t_bot = 23 if long_coat else 18
    part(L0+2,R1-2,8,t_bot,top)
    if kind=='tee':
        part(L0,L0+1,8,10,top); part(R1-1,R1,8,10,top,lit=False)
        part(L0,L0+1,11,16,skin); part(R1-1,R1,11,16,skin,lit=False)
    else:
        part(L0,L0+1,8,16,top); part(R1-1,R1,8,16,top,lit=False)
        P(L0,16,tone(top,.8)); P(R1,16,tone(top,.5))   # cuffs
    for x in (L0+2,): 
        for y in range(9,16): P(x,y,tone(top,.78))     # shadow between arm and body
    for y in range(9,16): P(R1-2,y,tone(top,.62))
    # hands
    hand_r = (R1-1,17)
    P(L0,17,tone(skin,1.1)); P(L0+1,17,skin); P(R1-1,17,tone(skin,.8)); P(R1,17,tone(skin,.65))
    if prop=='phone':
        part(R1-1,R1,8,12,top,lit=False); 
        for y in range(13,18): q[R1+1,y+1] = (0,0,0,0); q[R1,y+1] = (0,0,0,0)
        P(R1-2,12,tone(skin,.9)); P(R1-3,12,skin); P(R1-3,11,(30,30,36)); P(R1-2,11,(80,120,150) if facing=='front' else (30,30,36))
    # belt / waist
    if kind not in ('dress','coat','hoodie'):
        for x in range(L0+2,R1-1): P(x,18,(28,22,20))
        if facing=='front': P(7,18,(200,170,90))
    # clothing detail
    if facing=='front':
        if kind=='suit':
            for y in range(8,14):
                w = max(0,(13-y)//3)
                for x in range(7-w,9+w): P(x,y,tone(inner,1.05 if x<8 else .9))
            if tie:
                for y in range(9,15): P(7,y,tone(tie,1.1)); P(8,y,tone(tie,.8))
            for y in range(8,15): P(6,y,tone(top,.62)); P(9,y,tone(top,.62))   # lapels
            P(8,15,tone(top,1.2)); P(8,17,tone(top,1.2))                     # buttons
        elif kind in ('shirt','uniform'):
            P(6,8,tone(top,1.3)); P(9,8,tone(top,1.1)); P(7,8,tone(skin,.8)); P(8,8,tone(skin,.7))
            for y in range(9,18): P(8,y,tone(top,.82))                      # placket
            P(6,10,tone(top,.8)); P(9,10,tone(top,.8))                      # pockets
            if kind=='uniform':
                P(5,10,(230,196,90)); P(6,10,(170,140,60))                  # badge
                P(L0+1,8,(30,30,30)); P(L0+1,9,(60,60,60))                  # radio
                for y in range(17,21): P(R1-1,y,(24,22,22))                 # holster
        elif kind=='tee':
            P(7,8,tone(skin,.75)); P(8,8,tone(skin,.65))
            for x,y in ((6,12),(7,13),(9,11)): P(x,y,tone(top,.8))          # folds
        elif kind=='hoodie':
            for x in range(6,10): P(x,8,tone(top,.6))
            P(7,9,(220,220,210)); P(8,10,(220,220,210))
            for x in range(6,10): 
                for y in range(14,17): P(x,y,tone(top,.82))                 # pocket
        elif kind=='coat':
            for y in range(8,24): P(8,y,tone(top,.6))
            for y in (11,14,17,20): P(7,y,tone(top,1.25))
            P(6,8,tone(top,1.25)); P(9,8,tone(top,.9))
        elif kind=='dress':
            for x in range(6,10): P(x,8,tone(skin,.85))
            for x in range(L0+2,R1-1): P(x,17,tone(top,.7))
    else:
        for y in range(10,t_bot+1): P(8,y,tone(top,.78))                    # back seam
        if kind=='hoodie':
            for x in range(5,11):
                for y in range(7,10): P(x,y,tone(top,.9 if x<9 else .7))    # hood
        if kind=='suit': P(8,17,tone(top,.5)); P(8,18,tone(top,.5))         # vent
    # neck
    if facing=='front': P(7,7,tone(skin,.8)); P(8,7,tone(skin,.65))
    else: P(7,7,tone(skin,.75)); P(8,7,tone(skin,.6))
    # head 6x7 with ears
    for y in range(0,7):
        for x in range(5,11):
            if y==0 and x in (5,10): continue
            f = 1.15 if x==5 else .72 if x==10 else .9 if x==9 else 1.0
            P(x,y,tone(skin,f))
    P(4,4,tone(skin,.9)); P(11,4,tone(skin,.6))
    hair_rows = 3 if facing=='front' else 6
    if hairstyle=='bald':
        P(6,0,tone(skin,1.35)); P(7,0,tone(skin,1.2))
        if facing=='back':
            for x in range(5,11): P(x,4,tone(hair,1)); P(x,5,tone(hair,.9))
        else:
            P(5,3,hair); P(10,3,tone(hair,.8))
    else:
        for y in range(0,hair_rows):
            for x in range(5,11):
                if y==0 and x in (5,10): continue
                P(x,y,tone(hair,1.3 if (x==6 and y<2) else .75 if x==10 else 1.0))
        if facing=='front':
            P(5,3,hair); P(10,3,tone(hair,.75))                              # sideburns
        if hairstyle=='long':
            rows = range(3,11) if facing=='back' else range(3,10)
            for y in rows:
                for x in ((4,5,10,11) if facing=='front' else range(4,12)):
                    P(x,y,tone(hair,1.15 if x<=5 else .72 if x>=10 else 1.0))
        if hairstyle=='bun' and facing=='back':
            for x in (7,8): P(x,-1+1,tone(hair,1.2))
        if hairstyle=='cap':
            for x in range(4,12): P(x,0,tone(top,.85)); P(x,1,tone(top,.75)); P(x,2,tone(top,.85))
            if facing=='front':
                for x in range(4,12): P(x,3,tone(top,.45))
                P(7,1,(220,190,90))
    if facing=='front':
        eye = tone(skin,.30)
        P(6,4,eye); P(9,4,eye)
        P(6,3,tone(hair,.9)); P(9,3,tone(hair,.9))
        P(8,5,tone(skin,.7))
        P(7,6,tone(skin,.62)); P(8,6,tone(skin,.62))
        if glasses:
            for x in range(5,11): P(x,4,(30,28,34))
            P(6,4,(54,60,72)); P(9,4,(54,60,72))
        if beard:
            for x in range(5,11): P(x,6,tone(hair,1.0 if x<9 else .7))
            P(5,5,hair); P(10,5,tone(hair,.7)); P(7,6,tone(hair,.6)); P(8,6,tone(hair,.6))
    # props
    if prop=='case':
        side = R1+1
        for y in range(18,23):
            for x in range(side,side+3): P(x,y,tone((86,54,34),1.15 if x==side else .7 if x==side+2 else 1))
        P(side+1,17,(30,24,20))
    if prop=='bag':
        side = L0-2
        for y in range(17,23):
            for x in range(side,side+3): P(x,y,tone((200,190,170),1.1 if x==side else .75))
        P(side+1,16,(90,80,70))
    return selout(im)

layers = []
shadows = []          # (cx, cy, rx, ry) contact shadows
def add(im,x,y,shadow=True):
    layers.append((y+im.height, im, x, y))
    if shadow: shadows.append((x+im.width/2, y+im.height-1, im.width/2+1, 2.5))

# tellers behind glass
TELLERS = [(person('front',(150,104,80),(24,20,20),'short',(46,52,72),'suit',tie=(130,26,36),glasses=True),38),
           (person('front',(214,170,140),(90,56,34),'long',(120,140,168),'shirt',build=0),94)]
for im,x in TELLERS: alb.paste(im,(x,52),im)
# teller monitors (backs face us, screens light the tellers)
for s in (38,94):
    rect(s+10,72,s+17,78,'dark'); rect(s+13,79,s+14,79,'dark')
# counter
rect(14,80,186,87,'top'); rect(14,80,186,80,(176,172,164)); rect(14,87,186,87,'top2')
for _ in range(60): put(random.randint(15,185),random.randint(81,86),'top2')
rect(14,88,186,104,'wood'); rect(14,88,186,88,'wood3')
for x in range(14,170,28):
    rect(x+3,91,x+24,101,'wood2'); rect(x+3,91,x+24,91,'wood4'); rect(x+3,101,x+24,101,'wood3')
rect(14,104,186,105,'wood3'); rect(187,80,187,105,'ink'); rect(13,80,13,105,'ink')
glass = Image.new('RGBA',(W,H),(0,0,0,0))
for x in range(15,186):
    for y in range(52,79):
        if any(abs(x-s)<9 for s in (46,102,158)) and y>70: continue
        glass.putpixel((x,y),(150,190,200,28 if (x+y)%11 else 90))
alb = Image.alpha_composite(alb.convert('RGBA'),glass).convert('RGB'); A = alb.load()
for x in (14,74,130,186): rect(x,50,x+1,79,'brass'); rect(x+1,50,x+1,79,'brass2')
rect(14,50,187,51,'brass'); rect(14,52,187,52,'brass2')
for s in (46,102,158): rect(s-9,70,s+9,70,'brass2')
rect(144,73,170,79,'paper'); rect(144,79,170,79,'top2')
F = {'C':"011100100100011",'L':"100100100100111",'O':"010101101101010",'S':"011100010001110",'E':"111100110100111",'D':"110101101101110"}
for i,ch in enumerate("CLOSED"):
    for k,b in enumerate(F[ch]):
        if b=='1': put(146+i*4+k%3, 74+k//3, 'red')

# stanchions + ropes
def stanchion():
    im = Image.new('RGBA',(6,13),(0,0,0,0))
    rect(2,1,3,10,'brass',im); rect(3,1,3,10,'brass2',im); rect(2,0,3,0,'brass3',im); rect(1,11,4,11,'brass2',im)
    return outline(im)
st = stanchion()
for x in (116,140):
    for y in range(104,170,16):
        add(st,x-3,y-12)
        if y+16 < 170:
            for k in range(17): put(x+(1 if x==116 else -1), y-10+k+int(2*math.sin(math.pi*k/16)), 'red')
# queue
queue = [
  dict(skin=(196,150,120),hair=(30,24,20),top=(62,62,72),kind='suit',pants=(40,40,48),prop='case'),
  dict(skin=(150,100,74),hair=(24,18,16),hairstyle='long',top=(150,60,70),kind='dress',build=0,shoes=(60,24,30)),
  dict(skin=(214,176,146),hair=(170,170,170),hairstyle='bald',top=(122,102,78),kind='coat',pants=(60,52,46)),
  dict(skin=(120,82,62),hair=(20,16,16),hairstyle='cap',top=(70,96,80),kind='hoodie',pants=(56,74,110),shoes=(220,220,214),build=2),
]
for i,spec in enumerate(queue):
    add(person('back',step=i%2,**spec), 122, 92+i*18)
add(person('back',(176,128,100),(40,28,22),'short',(150,120,90),'shirt',pants=(52,70,104)), 38, 78)
add(person('back',(132,92,70),(28,22,20),'bun',(58,84,90),'coat',build=0,prop='bag'), 94, 78)
# loan desk with green banker's lamp
desk = Image.new('RGBA',(36,22),(0,0,0,0))
rect(0,6,35,12,'wood4',desk); rect(0,6,35,6,'brass2',desk); rect(0,13,35,21,'wood',desk)
rect(3,15,15,19,'wood2',desk); rect(20,15,32,19,'wood2',desk); rect(9,17,10,17,'brass',desk); rect(26,17,27,17,'brass',desk)
rect(4,2,11,4,(30,84,52),desk); rect(7,5,8,6,'brass2',desk); rect(20,8,28,10,'paper',desk)
desk = outline(desk)
add(person('front',(170,124,96),(30,24,22),'short',(70,62,76),'suit',tie=(40,60,100),beard=True), 23, 104)
add(desk, 14, 122); layers[-1] = (layers[-1][0]+1,)+layers[-1][1:]
add(person('back',(196,150,120),(110,80,50),'short',(92,96,102),'hoodie',pants=(40,44,58),step=1), 26, 132)
# guard
add(person('front',(130,90,66),(20,16,16),'cap',(40,48,68),'uniform',pants=(34,38,52),build=2), 212, 68)
for x in (200,240): add(st,x-3,72)
for k in range(41): put(200+k, 75+int(2*math.sin(math.pi*k/40)), 'red')
# bench
bench = Image.new('RGBA',(40,12),(0,0,0,0))
rect(0,0,39,3,'wood4',bench); rect(0,4,39,6,'wood2',bench); rect(2,7,3,11,'wood3',bench); rect(36,7,37,11,'wood3',bench)
add(outline(bench), 196, 132)
add(person('front',(200,156,126),(110,60,30),'long',(120,64,74),'shirt',pants=(40,36,44),build=0,seated=True,prop='phone'), 202, 115, shadow=False)
add(person('front',(126,86,64),(20,16,16),'short',(200,196,186),'tee',pants=(60,80,120),seated=True,beard=True), 220, 115, shadow=False)
def plant(h=18):
    im = Image.new('RGBA',(16,h+8),(0,0,0,0)); d = ImageDraw.Draw(im)
    for (x,y,r,c) in ((8,6,5,'leaf2'),(4,10,4,'leaf2'),(12,10,4,'leaf2'),(8,8,4,'leaf'),(5,9,3,'leaf'),(11,7,3,'leaf'),(7,5,1,'leaf3'),(10,6,1,'leaf3')):
        d.ellipse((x-r,y-r,x+r,y+r),fill=col(c))
    d.rectangle((4,h-2,11,h+5),fill=C['pot']); d.rectangle((9,h-2,11,h+5),fill=C['pot2']); d.rectangle((3,h-3,12,h-2),fill=C['pot2'])
    return outline(im)
add(plant(), 8, 64); add(plant(), 236, 152); add(plant(), 66, 150)
add(person('front',(204,160,128),(60,40,26),'short',(170,150,110),'coat',pants=(40,40,48),step=1,prop='bag'), 168, 140)   # walking in
rect(160,164,196,175,'wood3'); rect(162,166,194,175,'wood')

# contact shadows go on the floor before sprites
for (sx,sy,rx,ry) in shadows:
    for y in range(int(sy-ry),int(sy+ry)+1):
        for x in range(int(sx-rx),int(sx+rx)+1):
            if ((x-sx)/rx)**2+((y-sy)/ry)**2<=1 and 0<=x<W and 0<=y<H:
                A[x,y] = tuple(int(v*.45) for v in A[x,y])
IDB = np.zeros((H,W),int); CAST = np.zeros((H,W)); sid = [0]
def paste_sprite(im,x,y,cast=True):
    sid[0] += 1
    alb.paste(im,(x,y),im)
    a = np.asarray(im)
    foot = y + max(r for r in range(im.height) if a[r,:,3].any())
    for r in range(im.height):
        for c in range(im.width):
            if a[r,c,3] == 0: continue
            X,Y = x+c, y+r
            if 0<=X<W and 0<=Y<H: IDB[Y,X] = -1 if a[r,c,3]==254 else sid[0]
            if cast:                                  # sun from the back wall: shadow falls toward the viewer, sheared right
                h = foot-Y; sx = int(X + h*0.3); sy = int(foot + h*0.8)
                for yy2 in (sy, sy+1):
                    if 0<=sx<W and 0<=yy2<H and yy2>foot: CAST[yy2,sx] = 1
for im,x in TELLERS: paste_sprite(im,x,63,cast=False)
for _,im,x,y in sorted(layers, key=lambda t:t[0]): paste_sprite(im,x,y)

# ---------- lighting: dim blue ambient, warm pools, neon and moon spill, quantised with ordered dither
yy, xx = np.mgrid[0:H,0:W].astype(float)
L = np.zeros((H,W,3)); L[:] = (0.56,0.58,0.68)          # cool interior shade
def point(x,y,r,c,k=1.0,sq=1.5):
    d = np.sqrt((xx-x)**2+((yy-y)*sq)**2)
    f = np.clip(1-d/r,0,1)**1.6*k
    L[...] += f[...,None]*np.array(c)
point(110,40,150,(0.30,0.30,0.30),0.7)                         # daylight bouncing off the back wall
for s_ in (46,102): point(s_,66,40,(1.0,0.80,0.52),0.35)        # pendant lamps, on but weak against daylight
point(31,124,24,(0.75,0.95,0.55),0.35)                          # banker's lamp
point(11,92,16,(0.25,0.9,0.45),0.4)                             # exit sign
SUN = np.zeros((H,W))
for (x0,x1) in ((20,64),(92,132),(152,180)):
    dy = yy-48; a_ = x0+dy*0.25; b_ = x1+dy*0.25
    m = (yy>=48)&(xx>=a_)&(xx<=b_)&(dy<150)
    SUN[m] = np.clip(1.25-dy[m]/150,0,1)
    for xm in (int((x0+x1)/2),):                               # mullion shadows inside each shaft
        mm = m & (np.abs(xx-(xm+dy*0.25))<1.5); SUN[mm] *= .25
SUN *= (1-0.85*CAST)
L += SUN[...,None]*np.array((1.0,0.84,0.58))*1.05
bayer = np.array([[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]])/16.0
steps = 5.0
th = bayer[yy.astype(int)%4, xx.astype(int)%4][...,None]
f = L*steps; base = np.floor(f); frac = f-base
edge = np.clip((frac-0.38)/0.24,0,1)          # dither only where a band boundary falls
Lq = (base + (edge > th))/steps
a = np.asarray(alb).astype(float)/255
o = np.clip(a*Lq*1.25 + np.asarray(emi).astype(float)/255, 0, 1)
# rim light: sprite pixels whose top or left neighbour is not the same sprite catch the sun
up = np.vstack([np.full((1,W),-2), IDB[:-1]]); left = np.hstack([np.full((H,1),-2), IDB[:,:-1]])
down = np.vstack([IDB[1:], np.full((1,W),-2)]); right = np.hstack([IDB[:,1:], np.full((H,1),-2)])
rim_top = (IDB>0) & (up!=IDB)
rim_left = (IDB>0) & ~rim_top & (left!=IDB)
k = 0.15 + 0.85*np.clip(SUN*1.4,0,1)
RC = np.array((1.0,0.93,0.74))
o[rim_top] = o[rim_top]*(1-0.50*k[rim_top,None]) + RC*0.50*k[rim_top,None]
o[rim_left] = o[rim_left]*(1-0.28*k[rim_left,None]) + RC*0.28*k[rim_left,None]
lit_ol = (IDB==-1) & (down>0) & (up<=0) & (SUN>0.35)            # only sun-facing (top) outlines turn warm brown
o[lit_ol] = np.array((0.42,0.26,0.16))
def ramp(h,s0,n,hs=-0.035,vlo=.08,vhi=.92,slo=None):
    out=[]
    for i in range(n):
        t=i/(n-1)
        hh=(h+hs*(1-t)*2 - hs*t)%1           # darks drift one way, lights the other
        ss=s0*(1-0.35*t) if slo is None else slo+(s0-slo)*(1-abs(t-.5)*2)
        r,g,b=colorsys.hsv_to_rgb(hh,ss,vlo+(vhi-vlo)*t)
        out.append((r,g,b))
    return out
PAL = np.array(
    ramp(0.66,0.35,6,hs=0.02,vlo=.05,vhi=.60) +    # cool shade family
    ramp(0.56,0.32,5,hs=0.02,vlo=.55,vhi=1.0) +    # daylight sky
    ramp(0.12,0.35,4,hs=-0.02,vlo=.70,vhi=1.0) +   # sunlight / rim
    ramp(0.42,0.30,7,hs=0.04,vlo=.06,vhi=.62) +    # green marble
    ramp(0.98,0.55,5,hs=0.02,vlo=.07,vhi=.55) +    # velvet runner and coats
    ramp(0.66,0.10,6,hs=0.01,vlo=.06,vhi=.80) +    # near-neutral greys for suits and plaster
    ramp(0.07,0.55,8,hs=-0.03,vlo=.06,vhi=.95) +   # wood -> warm lamp light
    ramp(0.11,0.55,4,hs=-0.02,vlo=.25,vhi=.95) +   # brass
    ramp(0.05,0.40,5,hs=-0.02,vlo=.25,vhi=.95) +   # skin
    ramp(0.60,0.30,5,hs=0.02,vlo=.12,vhi=.85) +    # cold steel / tube light
    [(1,.24,.67),(.24,.9,.95),(.24,.9,.43),(.62,.12,.16),(.94,.92,.86),(.03,.02,.05)]  # neon pink, cyan, exit green, red, paper, ink
)
def snap(arr):
    flat = arr.reshape(-1,3)
    w = np.array([2.0,4.0,3.0])
    d = (((flat[:,None,:]-PAL[None,:,:])**2)*w).sum(-1)
    return PAL[d.argmin(1)].reshape(arr.shape)
o = snap(o)
img = Image.fromarray((o*255).astype(np.uint8))
# bulbs and pendants drawn last so they read as light sources
P = img.load()
for x in range(144,171):                       # keep the closed sign legible
    for y in range(73,80): P[x,y] = (214,206,188)
for i,ch in enumerate("CLOSED"):
    for k,b in enumerate(F[ch]):
        if b=='1': P[146+i*4+k%3, 74+k//3] = (150,26,36)
for s in (46,102,158):
    for y in range(8,44): P[s,y] = (14,10,18)
    for x,y in [(s-1,44),(s,44),(s+1,44)]+[(x,45) for x in range(s-3,s+4)]+[(x,46) for x in range(s-4,s+5)]+[(x,47) for x in range(s-5,s+6)]:
        P[x,y] = (30,52,40) if x>s else (52,86,62)
    for x in range(s-2,s+3): P[x,48] = (255,232,170) if s!=158 else (120,96,64)
for x in range(21,28): P[x,124] = (230,255,180)
img.save(f'{out}/bank_lobby_1x.png')
img.resize((W*4,H*4),Image.NEAREST).save(f'{out}/bank_lobby.png')
