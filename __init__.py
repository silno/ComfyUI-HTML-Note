# -*- coding: utf-8 -*-
"""ComfyUI-HTML-Note

在画布节点里渲染 HTML 说明文档。内容以字符串形式存在节点的 widget 里，
随工作流 json 一起保存 / 拷贝，换机器不用另外带 readme、txt 或本地路径。

后端只提供一个不会被真正执行的空壳节点（纯前端负责渲染），
所以这个包没有任何 Python 依赖、不读本机文件、不占显存。
"""

import os

__version__ = "1.1.2"

WEB_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class HTMLNote:
    """纯展示节点：没有输出口，不排进执行链，只是给前端一个可以挂 DOM 的槽位。"""

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
                        "placeholder": "HTML 说明内容，会随工作流保存",
                    },
                ),
                "height": ("INT", {"default": 420, "min": 120, "max": 8000, "step": 20}),
            }
        }

    def noop(self, html, height):
        # 空实现：节点不会被执行，这里只是满足 ComfyUI 的注册要求。
        return {}


# 注册必须放在类定义之后，否则会在 import 阶段抛 NameError 导致整个包 IMPORT FAILED。
NODE_CLASS_MAPPINGS = {"HTMLNote": HTMLNote}
NODE_DISPLAY_NAME_MAPPINGS = {"HTMLNote": "HTML 说明（随 json 保存）"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "__version__"]
