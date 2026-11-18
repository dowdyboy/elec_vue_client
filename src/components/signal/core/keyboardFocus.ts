/**
 * 图表键盘焦点仲裁：同页多张图共享「当前响应键盘的实例」。
 *
 * 键盘快捷键挂在 window 上（每个实例都会收到），若不仲裁，
 * 「A 图有焦点 + B 图被悬停」时两张图会同时响应同一个按键。
 * 规则：pointerenter / focus 时认领，只有 active 实例处理 keydown；
 * pointerleave / blur 不清空 active（否则鼠标移开就丢掉键盘焦点态）。
 * 输入框内不响应仍由各组件在 keydown 里判断（target 为 INPUT/TEXTAREA/SELECT）。
 */

let seq = 0
let activeId = 0

export class KeyboardArbiter {
  private readonly id = ++seq

  /** 认领键盘响应权（pointerenter / focus 时调用） */
  claim(): void {
    activeId = this.id
  }

  /** 当前是否由本实例响应键盘 */
  get active(): boolean {
    return activeId === this.id
  }
}
