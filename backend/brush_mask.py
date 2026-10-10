"""Deterministic edge coverage and feathering; mirrors renderer/brush-mask.mjs."""
import math
from array import array
from PIL import Image, ImageDraw
from pixel_brush import draw_pixel_round_stroke

SCALE = 8


def brush_mask(stroke, width, height, check_cancelled=lambda: None):
    sigma = stroke['size'] * stroke.get('feather', 0) / 100
    padding = stroke['size'] / 2 + math.ceil(sigma * 3) + 3
    points = [(x * width, y * height) for x, y in stroke['points']]
    left = max(0, min(math.floor(x - padding) for x, y in points))
    top = max(0, min(math.floor(y - padding) for x, y in points))
    right = min(width, max(math.ceil(x + padding) for x, y in points))
    bottom = min(height, max(math.ceil(y + padding) for x, y in points))
    w, h = right - left, bottom - top
    values = array('d', [0]) * (w * h)
    if not stroke['antiAlias']:
        # The offset remains integral, preserving the native pixel grid.
        local = Image.new('L', (w, h), 0)
        coordinates = [(min(width-1, math.floor(x))-left, min(height-1, math.floor(y))-top) for x, y in points]
        draw_pixel_round_stroke(ImageDraw.Draw(local), coordinates, stroke['size'], w, h,
                                check_cancelled, shape=stroke.get('shape', 'round'))
        values = array('d', (value for value in local.tobytes()))
    else:
        rows = {}

        def add_span(row, start, end):
            a = max(0, math.ceil((start-left) * SCALE - .5))
            b = min(w * SCALE, math.ceil((end-left) * SCALE - .5))
            if a < b:
                rows.setdefault(row, []).append((a, b))

        radius = stroke['size'] / 2

        def add_circle(cx, cy):
            first = max(0, math.ceil((cy-radius-top) * SCALE - .5))
            last = min(h * SCALE, math.ceil((cy+radius-top) * SCALE - .5))
            for row in range(first, last):
                dy = top + (row + .5) / SCALE - cy
                dx = math.sqrt(max(0, radius * radius - dy * dy))
                add_span(row, cx-dx, cx+dx)

        def add_polygon(vertices):
            first = max(0, math.ceil((min(y for x, y in vertices)-top) * SCALE - .5))
            last = min(h * SCALE, math.ceil((max(y for x, y in vertices)-top) * SCALE - .5))
            for row in range(first, last):
                y = top + (row + .5) / SCALE
                intersections = []
                for i, a in enumerate(vertices):
                    b = vertices[(i+1) % len(vertices)]
                    if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
                        intersections.append(a[0] + (y-a[1]) * (b[0]-a[0]) / (b[1]-a[1]))
                if intersections:
                    add_span(row, min(intersections), max(intersections))

        square = stroke.get('shape', 'round') == 'square'
        corners = [(-radius,-radius), (radius,-radius), (radius,radius), (-radius,radius)]
        for i, (x, y) in enumerate(points):
            check_cancelled()
            if square:
                add_polygon([(x+ox, y+oy) for ox, oy in corners])
            else:
                add_circle(x, y)
            if not i:
                continue
            px, py = points[i-1]
            dx, dy = x-px, y-py
            if not dx and not dy:
                continue
            if square:
                for c, a in enumerate(corners):
                    b = corners[(c+1) % 4]
                    add_polygon([(px+a[0],py+a[1]), (px+b[0],py+b[1]), (x+b[0],y+b[1]), (x+a[0],y+a[1])])
            else:
                length = math.hypot(dx, dy)
                ox, oy = -dy*radius/length, dx*radius/length
                add_polygon([(px+ox,py+oy), (x+ox,y+oy), (x-ox,y-oy), (px-ox,py-oy)])
        for row, intervals in rows.items():
            if row % 256 == 0:
                check_cancelled()
            merged = []
            for a, b in sorted(intervals):
                if merged and a <= merged[-1][1]:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a,b])
            offset = (row // SCALE) * w
            for a, b in merged:
                for x in range(a // SCALE, math.ceil(b / SCALE)):
                    values[offset+x] += (min(b,(x+1)*SCALE)-max(a,x*SCALE)) * 255 / (SCALE*SCALE)
    if sigma:
        low = math.floor(math.sqrt(4*sigma*sigma+1))
        if not low % 2:
            low -= 1
        low = max(1, low)
        count = math.floor((12*sigma*sigma-3*low*low-12*low-9) / (-4*low-4) + .5)
        for step in range(3):
            radius = ((low if step < count else low+2)-1) // 2
            if radius:
                values = box_blur(values, w, h, radius, False, check_cancelled)
                values = box_blur(values, w, h, radius, True, check_cancelled)
    local = Image.frombytes('L', (w,h), bytes(max(0,min(255,math.floor(value+.5))) for value in values))
    mask = Image.new('L', (width,height), 0)
    mask.paste(local, (left,top))
    return mask


def box_blur(values, width, height, radius, vertical, check_cancelled):
    result = array('d', [0]) * len(values)
    divisor = radius*2+1
    lines, length = (width,height) if vertical else (height,width)
    stride = width if vertical else 1
    for line in range(lines):
        if line % 64 == 0:
            check_cancelled()
        base = line if vertical else line * width
        total = sum(values[base+p*stride] for p in range(min(radius,length-1)+1))
        for p in range(length):
            result[base+p*stride] = total/divisor
            if p-radius >= 0:
                total -= values[base+(p-radius)*stride]
            if p+radius+1 < length:
                total += values[base+(p+radius+1)*stride]
    return result
