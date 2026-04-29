// gui/FigCNApp.swift
// FigCN — macOS 菜单栏常驻应用

import SwiftUI
import AppKit

// MARK: - 代理管理器

class ProxyManager: ObservableObject {
    @Published var isRunning = false
    @Published var statusText = "已停止"
    @Published var upstreamInfo = ""
    @Published var isLoading = false

    private var process: Process?
    private let binPath: String

    init() {
        let bundle = Bundle.main.bundlePath
        let p = (bundle as NSString).appendingPathComponent("Contents/MacOS/figcn-bin")
        binPath = FileManager.default.fileExists(atPath: p) ? p : ""
        checkStatus()
    }

    func checkStatus() {
        let pidPath = NSHomeDirectory() + "/.figcn/figcn.pid"
        guard FileManager.default.fileExists(atPath: pidPath),
              let s = try? String(contentsOfFile: pidPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
              let pid = Int32(s) else {
            set(running: false, status: "已停止")
            return
        }
        if kill(pid, 0) == 0 {
            set(running: true, status: "运行中 (PID \(pid))")
        } else {
            try? FileManager.default.removeItem(atPath: pidPath)
            set(running: false, status: "已停止")
        }
    }

    func toggle() {
        isRunning ? stop() : start()
    }

    func start() {
        guard !isRunning && !isLoading && !binPath.isEmpty else { return }
        isLoading = true
        statusText = "正在启动..."
        upstreamInfo = ""

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            // 确保证书
            let cert = NSHomeDirectory() + "/.figcn/ca-cert.pem"
            if !FileManager.default.fileExists(atPath: cert) {
                self.run(["cert", "generate"])
                self.run(["cert", "install"])
            }

            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: self.binPath)
            proc.arguments = ["start"]
            let pipe = Pipe()
            proc.standardOutput = pipe
            proc.standardError = pipe

            pipe.fileHandleForReading.readabilityHandler = { [weak self] fh in
                guard let text = String(data: fh.availableData, encoding: .utf8), !text.isEmpty else { return }
                for line in text.components(separatedBy: .newlines) where !line.isEmpty {
                    DispatchQueue.main.async {
                        if line.contains("检测到") || line.contains("上游代理") {
                            self?.upstreamInfo = line.trimmingCharacters(in: .whitespacesAndNewlines)
                                .replacingOccurrences(of: "📡 ", with: "")
                        } else if line.contains("直连") {
                            self?.upstreamInfo = "直连模式"
                        }
                    }
                }
            }

            proc.terminationHandler = { [weak self] p in
                DispatchQueue.main.async {
                    self?.process = nil
                    self?.isLoading = false
                    self?.set(running: false, status: p.terminationStatus == 0 ? "已停止" : "异常退出")
                    self?.upstreamInfo = ""
                    NotificationCenter.default.post(name: .proxyStateChanged, object: nil)
                }
            }

            do {
                try proc.run()
                self.process = proc
                DispatchQueue.main.async {
                    self.isLoading = false
                    self.set(running: true, status: "运行中 (PID \(proc.processIdentifier))")
                    NotificationCenter.default.post(name: .proxyStateChanged, object: nil)
                }
            } catch {
                DispatchQueue.main.async {
                    self.isLoading = false
                    self.set(running: false, status: "启动失败")
                }
            }
        }
    }

    func stop() {
        guard (isRunning || process != nil) && !isLoading else { return }
        isLoading = true
        statusText = "正在停止..."

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            if let proc = self.process, proc.isRunning {
                proc.terminate()
                proc.waitUntilExit()
            } else {
                self.run(["stop"])
            }
            DispatchQueue.main.async {
                self.process = nil
                self.isLoading = false
                self.set(running: false, status: "已停止")
                self.upstreamInfo = ""
                NotificationCenter.default.post(name: .proxyStateChanged, object: nil)
            }
        }
    }

    func clearCache() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.run(["cache", "clear"])
            DispatchQueue.main.async {
                let a = NSAlert()
                a.messageText = "缓存已清理"
                a.informativeText = "请重启 Figma。"
                a.alertStyle = .informational
                a.addButton(withTitle: "好")
                a.runModal()
            }
        }
    }

    private func set(running: Bool, status: String) {
        DispatchQueue.main.async { [weak self] in
            self?.isRunning = running
            self?.statusText = status
        }
    }

    @discardableResult
    private func run(_ args: [String]) -> String {
        guard !binPath.isEmpty else { return "" }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: binPath)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe; p.standardError = pipe
        try? p.run(); p.waitUntilExit()
        return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    }
}

extension Notification.Name {
    static let proxyStateChanged = Notification.Name("proxyStateChanged")
}

// MARK: - 菜单栏面板

struct PopoverView: View {
    @ObservedObject var manager: ProxyManager
    var onQuit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // 顶栏
            HStack {
                Text("FigCN")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                Text("v2.0")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                    .offset(y: 1)
                Spacer()
                Circle()
                    .fill(manager.isRunning ? Color.green : Color(white: 0.55))
                    .frame(width: 7, height: 7)
                    .shadow(color: manager.isRunning ? .green.opacity(0.6) : .clear, radius: 3)
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
            .padding(.bottom, 7)

            Divider().padding(.horizontal, 10)

            // 状态
            VStack(spacing: 3) {
                HStack(spacing: 5) {
                    Image(systemName: manager.isRunning ? "checkmark.shield.fill" : "shield.slash")
                        .font(.system(size: 11))
                        .foregroundColor(manager.isRunning ? .green : .secondary)
                    Text(manager.statusText)
                        .font(.system(size: 11))
                    Spacer()
                }
                if !manager.upstreamInfo.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 9))
                            .foregroundColor(.secondary)
                        Text(manager.upstreamInfo)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)

            Divider().padding(.horizontal, 10)

            // 按钮
            VStack(spacing: 5) {
                Button(action: { manager.toggle() }) {
                    HStack(spacing: 4) {
                        if manager.isLoading {
                            ProgressView().scaleEffect(0.45).frame(width: 11, height: 11)
                        } else {
                            Image(systemName: manager.isRunning ? "stop.fill" : "play.fill")
                                .font(.system(size: 9))
                        }
                        Text(manager.isRunning ? "停止" : "启动")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .frame(maxWidth: .infinity).frame(height: 24)
                    .background(manager.isRunning ? Color.red.opacity(0.1) : Color.accentColor.opacity(0.1))
                    .foregroundColor(manager.isRunning ? .red : .accentColor)
                    .cornerRadius(5)
                }
                .buttonStyle(.plain).disabled(manager.isLoading)

                HStack(spacing: 8) {
                    Button(action: { manager.clearCache() }) {
                        HStack(spacing: 3) {
                            Image(systemName: "trash").font(.system(size: 9))
                            Text("清理缓存").font(.system(size: 10))
                        }
                        .frame(maxWidth: .infinity).frame(height: 20)
                        .foregroundColor(.secondary)
                    }.buttonStyle(.plain)

                    Button(action: onQuit) {
                        HStack(spacing: 3) {
                            Image(systemName: "power").font(.system(size: 9))
                            Text("退出").font(.system(size: 10))
                        }
                        .frame(maxWidth: .infinity).frame(height: 20)
                        .foregroundColor(.secondary)
                    }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 7)
            .padding(.bottom, 10)
        }
        .frame(width: 210)
    }
}

// MARK: - App Delegate（菜单栏模式）

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var popover: NSPopover!
    let manager = ProxyManager()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 创建状态栏图标
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateIcon()

        if let btn = statusItem.button {
            btn.action = #selector(togglePopover)
            btn.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        // Popover
        let popover = NSPopover()
        popover.contentSize = NSSize(width: 210, height: 170)
        popover.behavior = .transient
        popover.animates = true
        popover.contentViewController = NSHostingController(
            rootView: PopoverView(manager: manager, onQuit: { [weak self] in
                self?.quit()
            })
        )
        self.popover = popover

        // 监听状态变化更新图标
        NotificationCenter.default.addObserver(
            self, selector: #selector(onStateChange),
            name: .proxyStateChanged, object: nil
        )
    }

    @objc func togglePopover() {
        guard let btn = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            manager.checkStatus()
            popover.show(relativeTo: btn.bounds, of: btn, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    @objc func onStateChange() {
        DispatchQueue.main.async { [weak self] in
            self?.updateIcon()
        }
    }

    func updateIcon() {
        if let btn = statusItem.button {
            // 使用 tray icon 或 SF Symbol
            let icon = manager.isRunning ? "globe" : "globe.badge.chevron.backward"
            let img = NSImage(systemSymbolName: icon, accessibilityDescription: "FigCN")
            img?.isTemplate = true
            btn.image = img
            btn.toolTip = manager.isRunning ? "FigCN: 运行中" : "FigCN: 已停止"
        }
    }

    func quit() {
        // 退出前停止代理
        if manager.isRunning {
            manager.stop()
            // 等一下让 stop 完成
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                NSApp.terminate(nil)
            }
        } else {
            NSApp.terminate(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        // 兜底：确保退出时代理被停止
        let bin = Bundle.main.bundlePath + "/Contents/MacOS/figcn-bin"
        let pid = NSHomeDirectory() + "/.figcn/figcn.pid"
        if FileManager.default.fileExists(atPath: pid) && FileManager.default.fileExists(atPath: bin) {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: bin)
            p.arguments = ["stop"]
            try? p.run()
            p.waitUntilExit()
        }
    }
}

// MARK: - 入口

let app = NSApplication.shared
app.setActivationPolicy(.accessory)  // 不在 Dock 显示
let delegate = AppDelegate()
app.delegate = delegate
app.run()
