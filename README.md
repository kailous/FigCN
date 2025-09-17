# FigCN

Figma 汉化代理助手（Electron + mitmproxy）

## 构建指南

1. 克隆项目
   ```
   git clone https://github.com/kailous/FigCN.git
   ```
2. 安装依赖
   ```
   cd FigCN
   npm install
   ```
3. 创建并激活 Python 虚拟环境，安装依赖
   ```
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
4. 构建项目

   ```
   npm run build
   ```

5. 测试汉化
   ```
   curl -s -x http://localhost:8080 -I "https://www.figma.com/webpack-artifacts/assets/figma_app-d2f511861c52ac4d.min.en.json.br" | grep -qi '^server: GitHub.com' && echo "汉化成功\n如果界面没有生效，请尝试清理缓存。" || echo "汉化失败\n请检查是否启动代理，并正确的应用了系统代理设置。"
   ```
