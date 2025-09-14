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