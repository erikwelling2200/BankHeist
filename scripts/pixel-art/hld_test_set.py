# Hyper Light Drifter style test set: 32x32 character with 4-frame idle, 16x16 tiles, a crystal prop and a small scene.
# Usage: python3 hld_test_set.py <output-dir>     (needs Pillow)
import random, math, sys
from PIL import Image
out = sys.argv[1]
P = {  # one shared palette, HLD-style: deep purples, magenta/coral, teal/mint
 'O':(26,16,48),'H':(140,42,92),'h':(217,68,122),'l':(255,122,138),'V':(14,10,28),'E':(127,245,217),
 'C':(31,95,107),'c':(47,165,154),'t':(95,214,192),'B':(59,37,86),'b':(107,58,120),'G':(255,204,77),
 'S':(200,208,240),'s':(138,144,184),'F':(36,24,56),
 'k':(40,38,70),'d':(58,60,96),'m':(84,92,133),'n':(118,128,170),'w':(168,180,214),
 'g':(36,110,96),'q':(62,160,120),'r':(130,214,150),
}
def withblade(rows):
    # sword slung behind the right shoulder: drawn only where the body leaves the grid empty
    rows=[r.ljust(32,'.') for r in rows]
    def put(x,y,ch):
        if rows[y][x] not in P: rows[y]=rows[y][:x]+ch+rows[y][x+1:]
    put(22,4,'O'); put(23,4,'O')
    for y in range(5,14): put(21,y,'O'); put(22,y,'S'); put(23,y,'s'); put(24,y,'O')
    return rows
def grid(rows, w=32, h=32):
    im = Image.new('RGBA',(w,h),(0,0,0,0))
    for y,row in enumerate(rows):
        for x,ch in enumerate(row[:w]):
            if ch in P: im.putpixel((x,y),P[ch]+(255,))
    return im

body = [""]*1 + [
"","","","",
"               OO",
"              OhlO",
"             OhhllO",
"            OhhhhllO",
"           OHhhhhhlO",
"           OHhVVVVhO",
"          OHhVEVVEVhO",
"          OHhVVVVVVhO",
"          OHHhhhhhhlO",
"        OOCcHHhhhhhlcOGGO",
"       OCccOBBbbGbbOcctO",
"      OCccCOBbbbbbbOCcctO",
"      OCcCCOBBbbbbbOCCctO",
"     OCccCCOBBbbbbbOCCcctO",
"     OCcCCCOBBGGGbbOCCCctO",
"    OCccCCCOBBbbbbbOCCCcctO",
"    OCcCCCCOBBbbbbbOCCCCctO",
"   OCccCCCCOBBBbbbbOCCCCcctO",
"   OCcCCCCCOBBBbbbbOCCCCCctO",
"   OCcCCCCCOBBBbbbbOCCCCCctO",
"   OCcCCCCCCOBBbbbOCCCCCCctO",
]
hems = [
["   OCCCCCCOOFFOOFFOOCCCCCCO", "   OOOCCOO.OFFOOFFO.OOCCOOO", "           OFO..OFO", "          OFFO..OFFO", "          OOOO..OOOO"],
["   OCCCCCCOOFFOOFFOOCCCCCCCO","    OOOCCOOOFFOOFFOOOCCCOOO", "           OFO..OFO", "          OFFO..OFFO", "          OOOO..OOOO"],
["  OCCCCCCCOOFFOOFFOOCCCCCCO", "  OOOCCOOO.OFFOOFFO.OOCCOOO", "           OFO..OFO", "          OFFO..OFFO", "          OOOO..OOOO"],
["   OCCCCCCOOFFOOFFOOCCCCCCO", "   OOOCCOO.OFFOOFFO.OOCCOOO", "           OFO..OFO", "          OFFO..OFFO", "          OOOO..OOOO"],
]
frames=[]
for i in range(4):
    rows = body[:] + hems[i]
    if i in (1,2): rows = rows[:1] + [""] + rows[1:22] + rows[23:]   # breathe: squash torso 1px
    if i == 3: rows = [r.replace('E','S') for r in rows]               # visor glint
    frames.append(grid(withblade(rows)))

random.seed(7)
def tile(kind):
    im = Image.new('RGBA',(16,16),P['m']+(255,))
    px = im.load()
    for y in range(16):
        for x in range(16):
            if kind=='wall':
                c = 'd' if y>3 else 'n'
                if y==3: c='w'
                if y>4 and (y-4)%6==0: c='k'
                if y>4 and ((x+(8 if ((y-4)//6)%2 else 0))%16==0): c='k'
                if y==15: c='k'
                px[x,y]=P[c]+(255,); continue
            c='m'
            if x%16==0 or y%16==0: c='n'
            if x==15 or y==15: c='d'
            if (x+y)%7==0 and random.random()<.25: c='d'
            px[x,y]=P[c]+(255,)
    if kind=='floor_crack':
        x,y=4,3
        for _ in range(11):
            px[x,y]=P['k']+(255,); x+=random.choice((0,1)); y+=1
    if kind=='floor_moss':
        for _ in range(26):
            x,y=random.randint(1,14),random.randint(9,14)
            px[x,y]=P[random.choice('gqq')]+(255,)
        for x in (3,4,11,12): px[x,8]=P['r']+(255,)
    return im
tiles={k:tile(k) for k in ('floor','floor_crack','floor_moss','wall')}

def crystal():
    im = Image.new('RGBA',(32,48),(0,0,0,0)); px=im.load()
    def put(x,y,c):
        if 0<=x<32 and 0<=y<48: px[x,y]=P[c]+(255,)
    for y in range(36,47):
        for x in range(7,25):
            c='m'
            if y==36: c='w'
            elif y==37 or x==7: c='n'
            elif x==24 or y==46: c='k'
            elif y in (41,42) and x%4==0: c='d'
            put(x,y,c)
    for x in range(6,26): put(x,35,'O'); put(x,47,'O')
    for y in range(35,48): put(6,y,'O'); put(25,y,'O')
    top,mid,bot,cx=3,17,34,16
    for y in range(top,bot+1):
        half = (y-top)*7//(mid-top) if y<=mid else (bot-y)*7//(bot-mid)
        for x in range(cx-half,cx+half+1):
            c = 'c' if x<cx else 'C'
            if x==cx-half or x==cx+half: c='O'
            elif x<cx and x>cx-3 and y<mid: c='t'
            elif x==cx: c='E' if y<mid else 't'
            put(x,y,c)
    for (x,y) in ((14,9),(13,11),(14,12)): put(x,y,'S')
    return im

def scale(im,k): return im.resize((im.width*k,im.height*k),Image.NEAREST)

# sprite sheet + animated idle
sheet = Image.new('RGBA',(32*4,32),(0,0,0,0))
for i,f in enumerate(frames): sheet.paste(f,(32*i,0))
scale(sheet,6).save(f'{out}/drifter_sheet.png')
bg=P['V']
gf=[]
for f in frames:
    b=Image.new('RGB',(32,32),bg); b.paste(f,(0,0),f); gf.append(scale(b,10))
gf[0].save(f'{out}/drifter_idle.gif',save_all=True,append_images=gf[1:],duration=[420,180,180,240],loop=0)

ts = Image.new('RGBA',(16*4+3*4,16),(0,0,0,0))
for i,k in enumerate(tiles): ts.paste(tiles[k],(i*20,0))
scale(ts,10).save(f'{out}/tiles.png')
cr=crystal(); scale(cr,8).save(f'{out}/crystal.png')

# little scene: 10x6 tiles, wall row on top, crystal glow lights the floor
W,H=160,96
sc=Image.new('RGBA',(W,H),P['k']+(255,))
for ty in range(6):
    for tx in range(10):
        k='wall' if ty==0 else random.choice(['floor']*5+['floor_crack','floor_moss','floor_moss'])
        sc.paste(tiles[k],(tx*16,ty*16))
ramp=[P['k'],P['d'],P['m'],P['n'],P['w']]
teal=[P['O'],P['C'],P['c'],P['t'],P['E']]
spx=sc.load(); gx,gy=104,62
for y in range(16,H):
    for x in range(W):
        d=math.hypot(x-gx,(y-gy)*1.4)
        col=spx[x,y][:3]
        if col in ramp:
            i=ramp.index(col)
            if d<13 or (d<21 and (x+y)%2==0): spx[x,y]=teal[min(4,i+1)]+(255,)
            pass
for y in range(H):
    for x in range(W):
        if abs(x-44)/8+abs(y-78)/2.2<1 and (x+y)%2==0: spx[x,y]=P['O']+(255,)
sc.paste(cr,(gx-16,gy-40),cr)
sc.paste(frames[0],(28,46),frames[0])
scale(sc,6).save(f'{out}/scene.png')
