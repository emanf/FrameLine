"""Apply the Color Cleanup brush's mixture recovery to a local cutout edge band."""
from collections import deque
from PIL import Image, ImageChops, ImageFilter, ImageOps
from healing_brush import recover_color_pixel


def recover_edge_colors(image, cutout_alpha, key_color, options, check_cancelled=lambda: None, region=None):
    rgb = image.convert('RGB')
    alpha = cutout_alpha.copy()
    repaired = Image.new('L', image.size)
    if not options['strength']:
        return rgb, alpha, repaired
    remove = tuple(options.get('color') or key_color)
    if options.get('keep_color') is not None and tuple(options['keep_color']) == remove:
        raise ValueError('Color Cleanup Keep color and Remove color must be different.')
    source_alpha = image.getchannel('A')
    difference = None
    for channel, value in zip(rgb.split(), remove):
        delta = ImageChops.difference(channel, Image.new('L', image.size, value))
        difference = delta if difference is None else ImageChops.lighter(difference, delta)
    # Include mixed pixels that the removal tolerance may have discarded, but
    # never use the uniform background as a bridge between separate shapes.
    visible = cutout_alpha.point(lambda a: 255 if a else 0)
    padded = ImageOps.expand(visible, border=1, fill=0)
    for _ in range(options['width']):
        check_cancelled()
        padded = padded.filter(ImageFilter.MinFilter(3))
    core = padded.crop((1,1,image.width+1,image.height+1))
    expanded = visible.filter(ImageFilter.MaxFilter(options['width']*2+1))
    band = ImageChops.subtract(expanded,core)
    key_difference = None
    for channel, value in zip(image.convert('RGB').split(),key_color):
        delta = ImageChops.difference(channel,Image.new('L',image.size,value))
        key_difference = delta if key_difference is None else ImageChops.lighter(key_difference,delta)
    candidate = ImageChops.multiply(source_alpha.point(lambda a: 255 if a else 0),
                                    key_difference.point(lambda d: 255 if d>2 else 0))
    band = ImageChops.multiply(band,candidate)
    minimum = round(options['min_opacity']*255/100)
    maximum = round(options['max_opacity']*255/100)
    targets = ImageChops.multiply(band,source_alpha.point(lambda a: 255 if a and minimum<=a<=maximum else 0))
    if region is not None:
        # Connected sampling protects other same-colored islands and holes.
        nearby_region = region.filter(ImageFilter.MaxFilter(options['width']*2+1))
        targets = ImageChops.multiply(targets,nearby_region)
    if not targets.getbbox():
        return rgb, alpha, repaired
    width, height = image.size
    source, out, out_alpha, marked = image.load(), rgb.load(), alpha.load(), repaired.load()
    target_data = targets.tobytes()
    strength = options['strength']/100

    def replace(index, keep):
        if not target_data[index]:
            return
        position = (index % width,index // width)
        recovered = recover_color_pixel(source[position],keep,remove,options['tolerance'],strength)
        if recovered is not None:
            out[position] = recovered[:3]
            out_alpha[position] = recovered[3]
            marked[position] = 255

    keep = options.get('keep_color')
    if keep is not None:
        for y in range(height):
            if y % 64 == 0:
                check_cancelled()
            for x in range(width):
                replace(y*width+x,tuple(keep))
        return rgb,alpha,repaired

    # Reliable interior donors keep each part of a multicolored shape local.
    # Do not invent colors for thin components with no usable interior sample.
    confidence = source_alpha.filter(ImageFilter.MaxFilter(options['width']*2+1))
    cutoff = confidence.point(lambda a: max(8,round(a*.85)))
    opaque_enough = ImageChops.subtract(cutoff,source_alpha).point(lambda d: 255 if d==0 else 0)
    local_distance = difference.filter(ImageFilter.MaxFilter(max(2,options['width'])*2+1))
    clean_distance = ImageChops.subtract(local_distance.point(lambda d: round(d*.85)),difference).point(lambda d: 255 if d==0 else 0)
    donors = ImageChops.multiply(ImageChops.multiply(core,opaque_enough),
                                 ImageChops.multiply(clean_distance,difference.point(lambda d: 255 if d>16 else 0))).tobytes()
    for _ in range(max(0,options['sample_distance']-options['width'])):
        check_cancelled()
        padded = padded.filter(ImageFilter.MinFilter(3))
    search = ImageChops.multiply(ImageChops.subtract(expanded,padded.crop((1,1,width+1,height+1))),candidate)
    pending = bytearray(ImageChops.multiply(search,ImageChops.invert(Image.frombytes('L',image.size,donors))).tobytes())

    def neighbors(index):
        x, y = index % width,index // width
        if x:
            yield index-1
        if x+1<width:
            yield index+1
        if y:
            yield index-width
        if y+1<height:
            yield index+width

    queue = deque()
    for y in range(height):
        if y % 64 == 0:
            check_cancelled()
        for x in range(width):
            index = y*width+x
            if not pending[index]:
                continue
            samples = [n for n in neighbors(index) if donors[n]]
            if samples:
                donor = max(samples,key=lambda n:source[n%width,n//width][3])
                keep = source[donor%width,donor//width][:3]
                pending[index] = 0
                replace(index,keep)
                queue.append((index,keep,1))
    processed = 0
    while queue:
        if processed % 4096 == 0:
            check_cancelled()
        processed += 1
        index,keep,distance = queue.popleft()
        if distance >= options['sample_distance']:
            continue
        for neighbor in neighbors(index):
            if pending[neighbor]:
                pending[neighbor] = 0
                replace(neighbor,keep)
                queue.append((neighbor,keep,distance+1))
    return rgb,alpha,repaired
