const btn = document.getElementById("btnStart");

let angle = 0;
let animId = null;

function startSpin() {
  if (animId) return; // 已在转
  function step() {
    angle = (angle + 1) % 360;
    btn.style.setProperty("--angle", angle + "deg");
    animId = requestAnimationFrame(step);
  }
  animId = requestAnimationFrame(step);
}

function stopSpin() {
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

// 示例：hover 时转，移开停
btn.addEventListener("mouseenter", startSpin);
btn.addEventListener("mouseleave", stopSpin);

// 也可以用“代理启动/停止”来触发：
// startSpin(); stopSpin();