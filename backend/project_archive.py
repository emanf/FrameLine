"""Portable FrameLine projects: project data, originals and working assets."""

import copy
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path

PATH_FIELDS = ("path", "originalPath", "sourcePath", "outlineSourcePath")
ASSET_NAME = re.compile(r"assets/[0-9a-f]{32}\.[a-z0-9]{1,10}\Z")


def save_project_archive(request, render_image):
    project = copy.deepcopy(request["project"])
    if not isinstance(project, dict) or project.get("version") != 1:
        raise ValueError("This is not a supported FrameLine project.")
    output = Path(request["output"])
    output.parent.mkdir(parents=True, exist_ok=True)
    assets = {}
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for index, image in enumerate(project["images"]):
            working = request["project"]["images"][index]
            for field in PATH_FIELDS:
                value = image.get(field)
                if value is None:
                    continue
                source = Path(value).resolve()
                if not source.is_file():
                    raise ValueError(f"Cannot save project: image is missing: {source}")
                if source not in assets:
                    suffix = source.suffix.lower().lstrip(".")
                    if not re.fullmatch(r"[a-z0-9]{1,10}", suffix):
                        suffix = "img"
                    assets[source] = f"assets/{uuid.uuid4().hex}.{suffix}"
                    archive.write(source, assets[source])
                image[field] = assets[source]
            # Include a flattened result as well as editable strokes/crop data.
            result = render_image(working["path"], working.get("paintStrokes", []), working.get("crop"), working.get("outline"))
            with archive.open(f"results/{index + 1:06d}.png", "w", force_zip64=True) as stream:
                result.save(stream, format="PNG")
        manifest = {"format": "FrameLine", "archiveVersion": 1, "project": project}
        archive.writestr("project.json", json.dumps(manifest, ensure_ascii=False), compress_type=zipfile.ZIP_DEFLATED)
    return {"output": str(output.resolve())}


def open_project_archive(request):
    output = Path(request["output"])
    with zipfile.ZipFile(request["path"], "r") as archive:
        if archive.getinfo("project.json").file_size > 64 * 1024 * 1024:
            raise ValueError("The project manifest is too large.")
        manifest = json.loads(archive.read("project.json"))
        if not isinstance(manifest, dict) or manifest.get("format") != "FrameLine" or manifest.get("archiveVersion") != 1:
            raise ValueError("This is not a supported FrameLine project archive.")
        project = manifest.get("project")
        if not isinstance(project, dict) or project.get("version") != 1 or not isinstance(project.get("images"), list):
            raise ValueError("The project archive contains invalid project data.")
        references = set()
        for image in project["images"]:
            if not isinstance(image, dict):
                raise ValueError("The project archive contains an invalid image.")
            for field in PATH_FIELDS:
                value = image.get(field)
                if value is None:
                    continue
                if not isinstance(value, str) or not ASSET_NAME.fullmatch(value):
                    raise ValueError("The project archive contains an invalid image asset path.")
                archive.getinfo(value)  # Check all references before writing.
                references.add(value)
        output.mkdir(parents=True, exist_ok=False)
        for name in references:
            destination = output / Path(name).name
            # Extract only referenced files to generated leaf names. Never use
            # extractall: archive paths must not select filesystem locations.
            with archive.open(name) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)
        for image in project["images"]:
            for field in PATH_FIELDS:
                if field in image:
                    image[field] = str((output / Path(image[field]).name).resolve())
        return {"project": project}
