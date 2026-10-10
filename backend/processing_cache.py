"""Bounded, process-local caches for immutable image-processing inputs/stages."""
from collections import OrderedDict
from hashlib import blake2b


class ProcessingCache:
    def __init__(self, maximum_bytes=48 * 1024 * 1024):
        self.maximum_bytes = maximum_bytes
        self.entries = OrderedDict()
        self.bytes = 0

    def get(self, key):
        entry = self.entries.get(key)
        if entry is None:
            return None
        self.entries.move_to_end(key)
        return entry[0]

    def put(self, key, value, size):
        if size > self.maximum_bytes:
            return value
        previous = self.entries.pop(key, None)
        if previous:
            self.bytes -= previous[1]
        while self.entries and self.bytes + size > self.maximum_bytes:
            _, (_, weight) = self.entries.popitem(last=False)
            self.bytes -= weight
        self.entries[key] = (value, size)
        self.bytes += size
        return value

    def clear(self):
        self.entries.clear()
        self.bytes = 0


CACHE = ProcessingCache()


def image_key(stage, *images, parameters=()):
    digest = blake2b(digest_size=20)
    digest.update(repr((stage, parameters)).encode())
    for image in images:
        digest.update(repr((image.mode, image.size)).encode())
        digest.update(image.tobytes())
    return digest.digest()


def cached_image(key, factory):
    value = CACHE.get(key)
    if value is None:
        value = factory()
        CACHE.put(key, value, value.width * value.height * len(value.getbands()))
    # Callers may mutate their results; never expose the cached image itself.
    return value.copy()
