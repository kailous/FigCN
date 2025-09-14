# figcn_injector.py
import re
from pathlib import Path
from mitmproxy import http

try:
    import yaml
    YAML_OK = True
except Exception as e:
    YAML_OK = False
    print(f"[FigCN] PyYAML 未安装或导入失败：{e}（将使用内置兜底规则）")

RULES_PATH = Path(__file__).with_name("figcn_rules.yaml")

# 兜底规则（即使 YAML 失败也能工作）
FALLBACK_RULES = [
    {
        "host": "www.figma.com",
        "pattern": re.compile(r"^/webpack-artifacts/assets/figma_app-[a-f0-9]{16}\.min\.en\.json(\.br)?$"),
        "replace_url": "https://kailous.github.io/figma-zh-CN-localized/lang/zh.json"
    },
    {
        "host": "www.figma.com",
        "pattern": re.compile(r"^/webpack-artifacts/assets/auth_iframe-[a-f0-9]+\.min\.en\.json(\.br)?$"),
        "replace_url": "https://kailous.github.io/figma-zh-CN-localized/lang/auth_iframe-zh.json"
    },
    {
        "host": "www.figma.com",
        "pattern": re.compile(r"^/webpack-artifacts/assets/community-[a-f0-9]+\.min\.en\.json(\.br)?$"),
        "replace_url": "https://kailous.github.io/figma-zh-CN-localized/lang/community-zh.json"
    },
]

class FigCNInjector:
    def __init__(self):
        self.rules = []
        self._load_rules()

    def _load_rules(self):
        if YAML_OK and RULES_PATH.exists():
            try:
                data = yaml.safe_load(RULES_PATH.read_text(encoding="utf-8")) or {}
                loaded = []
                for item in (data.get("interception_rule") or []):
                    host = (item.get("host") or "").strip()
                    pat  = (item.get("pattern") or "").strip()
                    rep  = (item.get("replace_url") or "").strip()
                    if not (host and pat and rep):
                        continue
                    loaded.append({"host": host, "pattern": re.compile(pat), "replace_url": rep})
                if loaded:
                    self.rules = loaded
                    print(f"[FigCN] 规则已加载：{len(self.rules)} 条，来自 {RULES_PATH.name}")
                else:
                    self.rules = FALLBACK_RULES
                    print("[FigCN] YAML 中未找到有效规则，使用内置兜底规则。")
            except Exception as e:
                self.rules = FALLBACK_RULES
                print(f"[FigCN] 解析 {RULES_PATH.name} 失败：{e}，使用内置兜底规则。")
        else:
            self.rules = FALLBACK_RULES
            if YAML_OK:
                print(f"[FigCN] 未找到 {RULES_PATH.name}，使用内置兜底规则。")

        # 启动时把所有规则打印出来，便于核对
        for r in self.rules:
            print(f"[FigCN] 规则：host={r['host']}  pattern={r['pattern'].pattern}  -> {r['replace_url']}")

    def request(self, flow: http.HTTPFlow) -> None:
        # 仅处理目标域名 + 目标路径前缀
        host = flow.request.host
        path = flow.request.path
        if host != "www.figma.com":
            return
        if not path.startswith("/webpack-artifacts/assets/"):
            print(f"[FigCN] 跳过（同域非目标路径）：{host}{path}")
            return

        print(f"[FigCN] 检查命中：{host}{path}")
        for rule in self.rules:
            if host == rule["host"] and rule["pattern"].match(path):
                old = flow.request.url
                flow.request.url = rule["replace_url"]
                print(f"[FigCN] 替换成功：\n  {old}\n  --> {rule['replace_url']}")
                break

addons = [FigCNInjector()]