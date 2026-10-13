"""Robust local curve fitting with scale-aware corner locks and bounded movement."""
import math
from statistics import median
from processing_cache import CACHE, cached_image, image_key

DEFAULTS = {'method': 'curve', 'strength': 100, 'radius': 32,
            'preserve_corners': True, 'corner_angle': 110}


def validate_curve_options(options):
    """Validate independent smoothing, detail-scale, and corner-preservation settings."""
    if not isinstance(options, dict) or set(options)-set(DEFAULTS):
        raise ValueError('Contour options must contain supported curve settings.')
    result = {**DEFAULTS, **options}
    if result['method'] not in ('curve', 'pixel'):
        raise ValueError('Contour method must be curve or pixel.')
    for name, lower, upper in [('strength', 0, 100), ('radius', 1, 128), ('corner_angle', 10, 160)]:
        value = result[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lower <= value <= upper:
            raise ValueError(f'Contour {name} must be between {lower} and {upper}.')
    if not isinstance(result['preserve_corners'], bool):
        raise ValueError('Preserve corners must be enabled or disabled.')
    return result


def _sample_contour(points, cancel):
    """Sample closed pixel boundaries uniformly, avoiding bias from long run segments."""
    lengths = [math.dist(points[i], points[(i+1)%len(points)]) for i in range(len(points))]
    perimeter = sum(lengths)
    count = max(4, math.ceil(perimeter))
    if count > 100000:
        raise ValueError('This boundary is too complex for curve smoothing. Use Clean Pixels or Pixel cleanup first.')
    step = perimeter/count
    result, edge, distance = [], 0, 0
    for index in range(count):
        if index % 256 == 0:
            cancel()
        target = index*step
        while distance+lengths[edge] < target and edge < len(points)-1:
            distance += lengths[edge]
            edge += 1
        fraction = (target-distance)/lengths[edge]
        a, b = points[edge], points[(edge+1)%len(points)]
        result.append((a[0]+(b[0]-a[0])*fraction, a[1]+(b[1]-a[1])*fraction))
    return result, step


def _quadratic(samples, weights):
    """Solve the weighted 3×3 normal equations for a local normal-displacement curve."""
    sums, rhs = [0.]*5, [0.]*3
    for (position, height), weight in zip(samples, weights):
        value = weight
        for power in range(5):
            sums[power] += value
            if power < 3:
                rhs[power] += value*height
            value *= position
    a, b, c, d, e = sums
    A, B, C = c*e-d*d, c*d-b*e, b*d-c*c
    D, E, F = a*e-c*c, b*c-a*d, a*c-b*b
    determinant = a*A+b*B+c*C
    if abs(determinant) < 1e-9:
        return None
    return tuple((p*rhs[0]+q*rhs[1]+r*rhs[2])/determinant
                 for p, q, r in [(A, B, C), (B, D, E), (C, E, F)])


class CurveSmoother:
    """Fit arbitrary closed outlines, partitioning them at persistent protected corners."""
    def __init__(self, options, cancel, advance):
        self.options = options
        self.cancel = cancel
        self.advance = advance

    def _angle(self, points, index, distance):
        """Measure an interior angle from chords at a meaningful detail scale."""
        p = points[index]
        a, b = points[(index-distance)%len(points)], points[(index+distance)%len(points)]
        u, v = (a[0]-p[0], a[1]-p[1]), (b[0]-p[0], b[1]-p[1])
        length = math.hypot(*u)*math.hypot(*v)
        return math.degrees(math.acos(max(-1, min(1, (u[0]*v[0]+u[1]*v[1])/length)))) if length else 180

    def _corners(self, points, radius):
        """Lock angles present at two scales, rejecting single-pixel spike corners."""
        if not self.options['preserve_corners']:
            return []
        candidates = []
        for index in range(len(points)):
            if index % 256 == 0:
                self.cancel()
            angle = self._angle(points, index, radius)
            if angle <= self.options['corner_angle'] and self._angle(points, index, min(radius*2, len(points)//4)) <= self.options['corner_angle']:
                candidates.append((angle, index))
        corners = []
        for _, index in sorted(candidates):
            if all(min(abs(index-other), len(points)-abs(index-other)) > radius for other in corners):
                corners.append(index)
        return sorted(corners)

    def _predict(self, points, index, radius, closed, start, end):
        """Robustly fit along the local tangent, downweighting bumps and uneven sampling."""
        length = len(points)
        p = points[index]
        first = points[(index-radius)%length] if closed else points[max(start, index-radius)]
        last = points[(index+radius)%length] if closed else points[min(end, index+radius)]
        chord = math.dist(first, last)
        if chord < 1e-6:
            return p
        tx, ty = (last[0]-first[0])/chord, (last[1]-first[1])/chord
        nx, ny = -ty, tx
        samples, base = [], []
        for offset in range(-radius, radius+1):
            other = (index+offset)%length if closed else index+offset
            if not closed and not start <= other <= end:
                continue
            q = points[other]
            position = ((q[0]-p[0])*tx+(q[1]-p[1])*ty)/radius
            height = (q[0]-p[0])*nx+(q[1]-p[1])*ny
            previous = points[(other-1)%length] if closed else points[max(start, other-1)]
            following = points[(other+1)%length] if closed else points[min(end, other+1)]
            density = max(.01, abs((following[0]-previous[0])*tx+(following[1]-previous[1])*ty)/2)
            samples.append((position, height))
            base.append(math.exp(-2*position*position)*density)
        weights = base
        for _ in range(4):
            coefficients = _quadratic(samples, weights)
            if coefficients is None:
                return p
            a, b, c = coefficients
            errors = [abs(height-(a+b*position+c*position*position)) for position, height in samples]
            cutoff = max(.75, median(errors)*2.5+.35)
            weights = [weight*max(.001, (1-(error/cutoff)**2)**2 if error < cutoff else 0)
                       for weight, error in zip(base, errors)]
        return p[0]+nx*coefficients[0], p[1]+ny*coefficients[0]

    def _pass(self, points, radius, anchors):
        """Fit dense arcs without crossing locked corners; interpolate at two-pixel spacing."""
        count = len(points)
        if anchors:
            offset = anchors[0]
            chain = points[offset:]+points[:offset]
            chain.append(chain[0])
            boundaries = [(index-offset)%count for index in anchors]+[count]
        else:
            offset, chain, boundaries = 0, points, [0, count]
        result = list(chain)
        if not anchors:
            selected = list(range(0, count, 2))
            for index in selected:
                if index % 128 == 0:
                    self.cancel()
                result[index] = self._predict(chain, index, radius, True, 0, count-1)
                self.advance()
            for a, b in zip(selected, selected[1:]+[selected[0]+count]):
                for index in range(a+1, b):
                    fraction = (index-a)/(b-a)
                    p, q = result[a], result[b%count]
                    result[index%count] = (p[0]+(q[0]-p[0])*fraction, p[1]+(q[1]-p[1])*fraction)
            return result
        for start, end in zip(boundaries, boundaries[1:]):
            selected = [start]+list(range(start+2, end, 2))+[end]
            for index in selected[1:-1]:
                self.cancel()
                result[index] = self._predict(chain, index, radius, False, start, end)
                self.advance()
            for a, b in zip(selected, selected[1:]):
                for index in range(a+1, b):
                    fraction = (index-a)/(b-a)
                    p, q = result[a], result[b]
                    result[index] = (p[0]+(q[0]-p[0])*fraction, p[1]+(q[1]-p[1])*fraction)
        return [result[(index-offset)%count] for index in range(count)]

    def fit(self, contour):
        """Return an original sample chain and a smooth target for later strength blending."""
        from edge_smoothing import _area
        xs, ys = [p[0] for p in contour], [p[1] for p in contour]
        if _area(contour) <= 4 or min(max(xs)-min(xs), max(ys)-min(ys)) <= 2:
            return contour, contour
        original, spacing = _sample_contour(contour, self.cancel)
        radius = max(2, min(round(self.options['radius']/spacing), len(original)//12))
        anchors = self._corners(original, radius)
        target = original
        for _ in range(3):
            target = self._pass(target, radius, anchors)
        if not .8*_area(original) <= _area(target) <= 1.2*_area(original):
            return original, original
        return original, target


def smooth_curves(rgb, alpha, maximum, options, antialias=0, cancel=lambda: None, progress=lambda *_: None):
    """Blend cached curve targets by strength, bound displacement, and render cutout coverage."""
    from PIL import Image
    from edge_smoothing import _contours, _rasterize, _apply_coverage
    options = validate_curve_options(options)
    cancel()
    if not maximum or not options['strength']:
        return rgb.copy(), alpha.copy()
    solid = alpha.point(lambda value: 255 if value else 0)
    if solid.getextrema() in ((0, 0), (255, 255)):
        return rgb.copy(), alpha.copy()
    target_key = image_key('curve-targets-v1', solid, parameters=(options['radius'], options['preserve_corners'], options['corner_angle']))
    progress(44, 100, 'Tracing curved outline…')
    targets = CACHE.get(target_key)
    if targets is None:
        contours = _contours(solid, cancel)
        estimate = max(1, sum(sum(math.dist(c[i], c[(i+1)%len(c)]) for i in range(len(c))) for c in contours)*1.5)
        completed, reported = 0, 44
        def advance():
            nonlocal completed, reported
            completed += 1
            value = min(53, 45+int(completed/estimate*8))
            if value != reported:
                progress(value, 100, 'Fitting smooth curves and protecting corners…')
                reported = value
        smoother = CurveSmoother(options, cancel, advance)
        targets = [smoother.fit(contour) for contour in contours]
        CACHE.put(target_key, targets, sum(len(a)+len(b) for a, b in targets)*160)
    progress(54, 100, 'Applying curve strength…')
    def render():
        curves = []
        for original, target in targets:
            cancel()
            blended = []
            for p, q in zip(original, target):
                dx, dy = (q[0]-p[0])*options['strength']/100, (q[1]-p[1])*options['strength']/100
                distance = math.hypot(dx, dy)
                factor = min(1, maximum/distance) if distance else 1
                blended.append((p[0]+dx*factor, p[1]+dy*factor))
            curves.append(blended)
        hard = _rasterize(curves, alpha.size, 1, cancel)
        if not antialias:
            return hard
        smooth = _rasterize(curves, alpha.size, 4, cancel)
        return Image.blend(hard, smooth, antialias/100)
    coverage = cached_image(image_key('curve-coverage-v1', solid, parameters=(maximum, tuple(options.items()), antialias)), render)
    progress(58, 100, 'Finishing curved outline…')
    cancel()
    return _apply_coverage(rgb, alpha, coverage, cancel)
