# -*- coding: utf-8 -*-
"""ComfyUI-HTML-Note

Renders an HTML documentation panel inside a canvas node. The content is kept as a string in
the node's widget, so it is saved with / travels with the workflow json - no readme, no txt,
no local path needed on another machine.

The backend only serves an empty shell node that is never executed (the frontend does the
rendering), so this package has no Python dependencies, reads no local files and uses no VRAM.
"""

import os

__version__ = "1.1.3"

WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class HTMLNote:
    """Display-only node: no outputs, not part of the execution chain - just a DOM slot for the frontend."""

    CATEGORY = "Notes"
    FUNCTION = "noop"
    RETURN_TYPES = ()
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "html": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "placeholder": "HTML documentation, saved with the workflow",
                    },
                ),
                "height": ("INT", {"default": 420, "min": 120, "max": 8000, "step": 20}),
            }
        }

    def noop(self, html, height):
        # Never executed; only here to satisfy ComfyUI's registration requirement.
        return {}


# Registration must come after the class definition, otherwise the import raises NameError and
# the whole package fails with IMPORT FAILED.
NODE_CLASS_MAPPINGS = {"HTMLNote": HTMLNote}
NODE_DISPLAY_NAME_MAPPINGS = {"HTMLNote": "HTML Note (saved with the json)"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "__version__"]
