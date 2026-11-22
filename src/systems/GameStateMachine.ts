export type GameSceneState = 'SPLASH' | 'HOME' | 'PLAYING' | 'PAUSED' | 'APPRAISAL' | 'GALLERY';

/**
 * 全局状态机与切前后台安全暂停调度器
 */
export class GameStateMachine {
  private current: GameSceneState = 'SPLASH';
  private beforePause: GameSceneState = 'HOME';
  private listeners: Array<(prev: GameSceneState, next: GameSceneState) => void> = [];

  public get state(): GameSceneState {
    return this.current;
  }

  public onChange(fn: (prev: GameSceneState, next: GameSceneState) => void): void {
    this.listeners.push(fn);
  }

  public transitionTo(next: GameSceneState): void {
    if (this.current === next) return;
    const prev = this.current;
    this.current = next;
    for (const fn of this.listeners) {
      fn(prev, next);
    }
  }

  public pauseFromBackground(): void {
    if (this.current === 'PAUSED') return;
    this.beforePause = this.current;
    this.transitionTo('PAUSED');
  }

  public resumeToForeground(): void {
    if (this.current !== 'PAUSED') return;
    this.transitionTo(this.beforePause);
  }
}
