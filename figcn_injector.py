# figcn_injector.py
import re
from mitmproxy import http, ctx

# 目标域名与路径前缀（写死）
TARGET_HOST = "www.figma.com"
TARGET_PREFIX = "/webpack-artifacts/assets/"

# 固定规则（写死在这里）
RULES = [
    {
        "host": "www.figma.com",
        "pattern": re.compile(r"^/webpack-artifacts/assets/figma_app-[a-f0-9]{16}\.min\.en\.json(\.br)?$"),
        "replace_url": "https://kailous.github.io/figma-zh-CN-localized/lang/zh.json",
    },
    {
        "host": "www.figma.com",
        "pattern": re.compile(r"^/webpack-artifacts/assets/auth_iframe-[a-f0-9]+\.min\.en\.json(\.br)?$"),
        "replace_url": "https://kailous.github.io/figma-zh-CN-localized/lang/auth_iframe-zh.json",
    },
    {
        "host": "www.figma.com",
        "pattern": re.compile(r"^/webpack-artifacts/assets/community-[a-f0-9]+\.min\.en\.json(\.br)?$"),
        "replace_url": "https://kailous.github.io/figma-zh-CN-localized/lang/community-zh.json",
    },
]

class FigCNInjector:
    def __init__(self):
        self.rules = RULES

    def request(self, flow: http.HTTPFlow) -> None:
        """
        仅在命中并替换时输出一条日志：
          [FigCN] 命中：old_url -> new_url
        其它情况静默（不打印跳过或请求详情）
        """
        host = (flow.request.host or "").lower()
        path = flow.request.path or ""
        url = flow.request.url or ""

        # 只处理目标域和目标前缀，其他直接返回（静默）
        if host != TARGET_HOST:
            return
        if not path.startswith(TARGET_PREFIX):
            return

        # 匹配并替换（仅在替换时记录日志）
        for rule in self.rules:
            if host == rule["host"] and rule["pattern"].match(path):
                old = url
                flow.request.url = rule["replace_url"]
                ctx.log.info(f"[FigCN] 命中：{old} -> {rule['replace_url']}")
                return

addons = [FigCNInjector()]